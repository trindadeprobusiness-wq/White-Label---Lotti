import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { corretorDaSessao } from './conversas.service';
import { checarCota, ClienteSql, consumirLimiteIa, COTA_ASSISTENTE, registrarUso } from './cotas';
import { chatIa, chaveGemini, FetchImpl, modeloRapido } from './gemini';
import { MensagemWhatsappDto, SugestaoInboxDto } from './ia.dto';
import { codigoDe, erroApi, traduzirErroBanco } from './ia.erros';
import {
  CAMPOS_IMOVEL_SUGESTAO, contextoPublicoImovel, PROMPT_SISTEMA_SUGESTAO_INBOX, PROMPT_SISTEMA_WHATSAPP, promptUsuarioWhatsapp,
  VERSOES_PROMPT_IA,
} from './prompts';

export const SUGESTOES_POR_MINUTO = 10;
/** Teto da lista de imóveis do ReplySuggestion (o .limit(200) da tela). */
export const LIMITE_IMOVEIS_SUGESTAO = 200;

const ENTRADA_SUGESTAO = 'Selecione um imóvel e informe uma pergunta de até 2.000 caracteres.';

/** validateSuggestionInput (inbox-suggestion.ts). */
export function validarEntradaSugestao(corpo: SugestaoInboxDto): { propertyId: string; question: string } {
  const propertyId = typeof corpo.propertyId === 'string' ? corpo.propertyId : '';
  const question = typeof corpo.question === 'string' ? corpo.question.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propertyId) || !question || question.length > 2000) {
    throw erroApi(400, 'pedido_invalido', ENTRADA_SUGESTAO);
  }
  return { propertyId, question };
}

/** Porte de generate-whatsapp-message e inbox-suggest. */
@Injectable()
export class MensagensIaService {
  private readonly log = new Logger('IaMensagens');
  /** Injetável para teste; nunca chamado de verdade nos testes. */
  fetchImpl: FetchImpl = (...a) => globalThis.fetch(...a);

  constructor(private readonly db: TenantDb, private readonly prisma: PrismaService) {}

  private get sql(): ClienteSql {
    return this.prisma as unknown as ClienteSql;
  }

  /** Só sessão válida (o guard), sem cota, como a função. */
  async gerarWhatsapp(dto: MensagemWhatsappDto): Promise<{ message: string; model: string; prompt_version: string }> {
    if (typeof dto.clientName !== 'string' || !dto.clientName.trim()) throw erroApi(400, 'pedido_invalido', 'Nome do cliente é obrigatório.');
    const chave = chaveGemini();
    if (!chave) throw erroApi(503, 'ia_indisponivel', 'A IA está indisponível no momento.');
    const modelo = modeloRapido();
    const falhou = () => erroApi(502, 'ia_falhou', 'Erro ao gerar mensagem com IA');
    let resposta: Response;
    try {
      resposta = await chatIa({
        chave,
        modelo,
        fetchImpl: this.fetchImpl,
        politica: { timeoutMs: 30_000, retries: 1 },
        corpo: {
          messages: [
            { role: 'system', content: PROMPT_SISTEMA_WHATSAPP },
            { role: 'user', content: promptUsuarioWhatsapp({ clientName: dto.clientName, messageType: dto.messageType, tone: dto.tone, details: dto.details }) },
          ],
          temperature: 0.4,
        },
      });
    } catch (e) {
      this.log.error(`IA_WHATSAPP rede ${codigoDe(e)}`);
      throw falhou();
    }
    if (!resposta.ok) {
      if (resposta.status === 429) throw erroApi(429, 'ia_limite_requisicoes', 'Limite de requisições excedido. Tente novamente em alguns segundos.');
      if (resposta.status === 402) throw erroApi(402, 'ia_sem_creditos', 'Créditos de IA esgotados. Adicione créditos ao workspace.');
      this.log.error(`IA_WHATSAPP status=${resposta.status}`);
      throw falhou();
    }
    let data: { choices?: Array<{ message?: { content?: unknown } }> };
    try {
      data = (await resposta.json()) as typeof data;
    } catch {
      throw falhou();
    }
    const conteudo = data?.choices?.[0]?.message?.content;
    return { message: typeof conteudo === 'string' ? conteudo : '', model: modelo, prompt_version: VERSOES_PROMPT_IA.whatsapp };
  }

  private async corretor(claims: SupabaseClaims): Promise<string | null> {
    try {
      return await this.db.run(claims, corretorDaSessao);
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  /** Imóveis ativos da conta para o seletor do ReplySuggestion (substitui rpc('get_corretor_id') + select). */
  async imoveisParaSugestao(claims: SupabaseClaims): Promise<Array<{ id: string; titulo: string }>> {
    try {
      const linhas = await this.db.run(claims, async (tx) => {
        const dono = await corretorDaSessao(tx);
        if (!dono) throw erroApi(403, 'corretor_nao_identificado', 'Conta não autorizada.');
        return tx.$queryRaw<Array<{ id: string; titulo: string }>>(Prisma.sql`
          select i.id::text as id, i.titulo from public.imoveis i
          where i.corretor_id = ${dono}::uuid and i.ativo = true
          order by i.titulo asc, i.id limit ${LIMITE_IMOVEIS_SUGESTAO}::int`);
      });
      return linhas;
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  async sugerirResposta(claims: SupabaseClaims, dto: SugestaoInboxDto): Promise<{ suggestion: string; propertyId: string; requiresReview: true }> {
    try {
      const dono = await this.corretor(claims);
      if (!dono) throw erroApi(403, 'corretor_nao_identificado', 'Conta não autorizada.');
      const entrada = validarEntradaSugestao(dto);

      let imovel: Record<string, unknown> | undefined;
      try {
        const colunas = Prisma.raw(CAMPOS_IMOVEL_SUGESTAO.map((c) => `'${c}', i.${c}`).join(', '));
        const r = await this.db.run(claims, (tx) => tx.$queryRaw<Array<{ linha: Record<string, unknown> }>>(Prisma.sql`
          select jsonb_build_object(${colunas}) as linha from public.imoveis i
          where i.id = ${entrada.propertyId}::uuid and i.corretor_id = ${dono}::uuid and i.ativo = true limit 1`));
        imovel = r[0]?.linha;
      } catch (e) {
        this.log.warn(`imóvel da sugestão não lido ${codigoDe(e)}`);
        throw erroApi(503, 'consulta_falhou', 'Não foi possível consultar o cadastro.');
      }
      if (!imovel) throw erroApi(404, 'imovel_indisponivel', 'Imóvel indisponível ou sem acesso.');

      const chave = chaveGemini();
      if (!chave) throw erroApi(503, 'ia_indisponivel', 'IA indisponível. Tente novamente mais tarde.');
      if ((await consumirLimiteIa(this.sql, dono, SUGESTOES_POR_MINUTO)) !== 'permitido') {
        throw erroApi(429, 'limite_de_mensagens', 'Aguarde um minuto para tentar novamente.');
      }
      if (!(await checarCota(this.sql, dono, COTA_ASSISTENTE)).permitido) {
        throw erroApi(402, 'PLAN_LIMIT_REACHED', 'Cota de IA indisponível para esta conta.', { recurso: COTA_ASSISTENTE });
      }

      const resposta = await chatIa({
        chave,
        modelo: modeloRapido(),
        fetchImpl: this.fetchImpl,
        politica: { timeoutMs: 30_000 },
        corpo: {
          messages: [
            { role: 'system', content: PROMPT_SISTEMA_SUGESTAO_INBOX },
            { role: 'user', content: JSON.stringify({ cadastro: contextoPublicoImovel(imovel), pergunta: entrada.question }) },
          ],
          temperature: 0.2,
          max_tokens: 500,
        },
      });
      if (!resposta.ok) {
        this.log.error(`IA_INBOX status=${resposta.status}`);
        throw erroApi(503, 'ia_indisponivel', 'IA indisponível. Tente novamente mais tarde.');
      }
      const resultado = (await resposta.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const sugestao = resultado.choices?.[0]?.message?.content;
      if (typeof sugestao !== 'string' || !sugestao.trim() || sugestao.length > 5000) {
        throw erroApi(502, 'sugestao_invalida', 'Não foi possível gerar uma sugestão válida.');
      }
      await registrarUso(this.sql, dono, COTA_ASSISTENTE);
      return { suggestion: sugestao.trim(), propertyId: entrada.propertyId, requiresReview: true };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.log.error(`IA_INBOX ${codigoDe(e)}`);
      throw erroApi(503, 'sugestao_falhou', 'Não foi possível gerar a sugestão. Tente novamente.');
    }
  }
}
