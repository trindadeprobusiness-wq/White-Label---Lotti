import { HttpException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { AnalisarContratoIaDto, GerarContratoIaDto } from './contratos-ia.dto';
import { erroApi, traduzirErroBanco } from './contratos.erros';
import { corretorDoUsuario } from './contratos.service';
import { ClienteCota, finalizarCota, reservarCota } from './ia/cota';
import { externalDataBlock } from './ia/dados-externos';
import { valorParaExtenso } from './ia/extenso';
import { chatGemini, chaveGemini, CONFIG_EXTRACAO, conteudoGemini, modeloContrato } from './ia/gemini';
import { promptAnalise, promptUsuarioGeracao, SYSTEM_PROMPT_GERACAO, VERSOES_PROMPT } from './ia/prompts';
import { PedidoInvalido, sanitizarPedidoGeracao, sanitizeCentral, sanitizeExtraction } from './ia/sanitizar';

export interface RespostaGeracao {
  contrato: string;
  modelo_ia: string;
  prompt_version: string;
  tempo_geracao_ms: number;
}

const IA_INDISPONIVEL = () => erroApi(503, 'ia_indisponivel', 'A IA de contratos está indisponível no momento.');

/**
 * Porte de gerar-contrato e analisar-contrato. Logs: só status do provedor, código e tempo;
 * nunca prompt, base64, resposta da IA ou dados de pessoas.
 */
@Injectable()
export class ContratosIaService {
  private readonly log = new Logger('ContratosIa');
  /** Injetável para teste; nunca chamado de verdade nos testes. */
  fetchImpl: typeof globalThis.fetch = (...a) => globalThis.fetch(...a);

  constructor(private readonly db: TenantDb, private readonly prisma: PrismaService) {}

  private async corretor(claims: SupabaseClaims): Promise<string> {
    try {
      return await this.db.run(claims, corretorDoUsuario);
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  /** Fluxo comum: corretor → chave → reserva → trabalho → finish(true); no finally, finish(false) se não deu certo. */
  private async comCota<T>(claims: SupabaseClaims, trabalho: (chave: string) => Promise<T>): Promise<T> {
    const corretorId = await this.corretor(claims);
    const chave = chaveGemini();
    if (!chave) throw IA_INDISPONIVEL();
    const cliente = this.prisma as unknown as ClienteCota;
    const cota = await reservarCota(cliente, corretorId);
    if (!cota?.allowed || !cota.reservation_id) {
      throw erroApi(402, 'PLAN_LIMIT_REACHED', 'Limite mensal de operações com IA atingido.', {
        recurso: 'ai_contracts_monthly', usado: cota?.used ?? 0, limite: cota?.quota ?? null,
      });
    }
    const reserva = cota.reservation_id;
    let sucesso = false;
    try {
      const resultado = await trabalho(chave);
      sucesso = true;
      try {
        await finalizarCota(cliente, reserva, true);
      } catch (e) {
        this.log.error(`QUOTA_FINISH_FAILED ${codigoDe(e)}`);
      }
      return resultado;
    } finally {
      if (!sucesso) {
        await finalizarCota(cliente, reserva, false).catch((e) => this.log.error(`QUOTA_RELEASE_FAILED ${codigoDe(e)}`));
      }
    }
  }

  async gerar(claims: SupabaseClaims, dto: GerarContratoIaDto): Promise<RespostaGeracao> {
    let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      body = sanitizarPedidoGeracao({ ...dto });
    } catch (e) {
      if (e instanceof PedidoInvalido) throw erroApi(400, 'pedido_invalido', e.message);
      throw e;
    }
    const dataAtual = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
    const userPrompt = promptUsuarioGeracao(body, valorParaExtenso(body.detalhes.valor), dataAtual);
    const safeUserPrompt = `Use os dados e a estrutura abaixo para produzir a minuta.\n${externalDataBlock('contract_request', userPrompt, 16_000)}`;
    const modelo = modeloContrato();

    return this.comCota(claims, async (chave) => {
      const falhou = () => erroApi(502, 'ia_falhou', 'Erro ao gerar contrato. Tente novamente.');
      const inicio = Date.now();
      let resposta: Response;
      try {
        resposta = await chatGemini({
          chave, modelo, temperature: 0.2, fetchImpl: this.fetchImpl,
          mensagens: [{ role: 'system', content: SYSTEM_PROMPT_GERACAO }, { role: 'user', content: safeUserPrompt }],
        });
      } catch (e) {
        this.log.error(`IA_GERAR_REDE ${nomeDe(e)}`);
        throw falhou();
      }
      const tempo = Date.now() - inicio;
      this.log.log(`IA_GERAR status=${resposta.status} ms=${tempo}`);
      if (!resposta.ok) {
        if (resposta.status === 429) throw erroApi(429, 'ia_limite_requisicoes', 'Limite de requisições excedido. Tente novamente em alguns minutos.');
        if (resposta.status === 402) throw erroApi(402, 'ia_sem_creditos', 'Créditos insuficientes. Adicione créditos à sua conta.');
        throw falhou();
      }
      let data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        data = await resposta.json();
      } catch {
        throw erroApi(502, 'ia_resposta_invalida', 'Resposta da IA inválida');
      }
      const contrato = data?.choices?.[0]?.message?.content;
      if (!contrato) throw erroApi(502, 'ia_resposta_invalida', 'Resposta da IA inválida');
      return { contrato, modelo_ia: modelo, prompt_version: VERSOES_PROMPT.geracao, tempo_geracao_ms: tempo };
    });
  }

  async analisar(claims: SupabaseClaims, dto: AnalisarContratoIaDto): Promise<{ dados: unknown }> {
    const central = dto.modo === 'central';
    const prompt = promptAnalise(central);
    const modelo = modeloContrato();

    return this.comCota(claims, async (chave) => {
      const falhou = () => erroApi(502, 'ia_falhou', 'Falha ao analisar o contrato com a IA');
      let resposta: Response;
      const inicio = Date.now();
      try {
        resposta = await conteudoGemini({
          chave, modelo, fetchImpl: this.fetchImpl, generationConfig: { ...CONFIG_EXTRACAO },
          partes: [{ text: prompt }, { inline_data: { mime_type: dto.mimeType, data: dto.fileBase64 } }],
        });
      } catch (e) {
        this.log.error(`IA_ANALISAR_REDE ${nomeDe(e)}`);
        throw falhou();
      }
      this.log.log(`IA_ANALISAR status=${resposta.status} ms=${Date.now() - inicio}`);
      if (!resposta.ok) throw falhou();

      const data: any = await resposta.json(); // eslint-disable-line @typescript-eslint/no-explicit-any
      const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      // Parse robusto: remove cercas de código e isola o trecho do 1º { ao último }.
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      const jsonSlice = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(jsonSlice);
      } catch {
        this.log.error('IA_ANALISAR_SEM_JSON');
        throw erroApi(502, 'ia_sem_estrutura', 'A IA não conseguiu estruturar os dados do contrato');
      }
      return { dados: central ? sanitizeCentral(parsed) : sanitizeExtraction(parsed) };
    });
  }
}

function codigoDe(e: unknown): string {
  if (e instanceof HttpException) return String(e.getStatus());
  const meta = (e as { meta?: { code?: unknown }; code?: unknown })?.meta;
  return String(meta?.code ?? (e as { code?: unknown })?.code ?? 'erro');
}

function nomeDe(e: unknown): string {
  return e instanceof Error ? e.name : 'erro';
}
