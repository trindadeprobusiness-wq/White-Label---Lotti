import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../../prisma/tenant-db';
import { ConectarAsaasDto } from '../financeiro.dto';
import { erroApi, erroPg, exigirCorretor, Linha, traduzirErroBanco } from '../financeiro.erros';
import { ServicoDb } from '../servico-db';
import { chaveCifra, urlWebhookBase } from './asaas.config';
import { resolverCredencial } from './asaas-credencial';
import { cifrar, finalDaChave, tokenAleatorio } from './asaas-crypto';
import { AsaasError, AsaasHttp, baseUrlPara, descricaoErroAsaas, FETCH_ASAAS, FetchAsaas } from './asaas-http';
import { ErroValidacaoAsaas, extrairDadosConta, montarWebhookAsaas, normalizarAmbiente, normalizarApiKey } from './asaas-regras';

/** Porte de supabase/functions/asaas-conexao (contrato §2.3). Nunca loga chave, token, ciphertext, e-mail ou CPF. */

const ESCOPO_SALDO = 'FINANCIAL_TRANSACTION:READ';
const AVISO_WEBHOOK_ANTIGO = 'A conexão foi removida da Lotti, mas confira o webhook antigo no painel do Asaas.';
export const CAMINHO_WEBHOOK = '/api/financeiro/asaas/webhook';

interface ConexaoExistente {
  id: string;
  webhook_id: string | null;
  webhook_slug: string | null;
}

function erroDaAsaas(e: AsaasError): HttpException {
  if (e.status === 401) {
    return erroApi(400, 'ASAAS_CHAVE_INVALIDA',
      'A Asaas recusou essa chave. Confira se ela pertence ao ambiente escolhido e tente novamente.');
  }
  if (e.status === 403) {
    return erroApi(400, 'ASAAS_PERMISSOES_INSUFICIENTES',
      'A chave é válida, mas não tem todas as permissões necessárias. Libere leitura e escrita de clientes, cobranças e webhooks; para exibir o saldo, libere também dados financeiros.');
  }
  const detalhe = descricaoErroAsaas(e.body);
  return erroApi(e.status >= 500 ? 502 : 400, 'ASAAS_REJEITOU_CONEXAO',
    detalhe ? `A Asaas não aceitou a conexão: ${detalhe}` : 'A Asaas não aceitou a conexão. Revise a chave e tente novamente.');
}

@Injectable()
export class AsaasConexaoService {
  private readonly logger = new Logger(AsaasConexaoService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly servico: ServicoDb,
    @Inject(FETCH_ASAAS) private readonly fetchImpl: FetchAsaas,
  ) {}

  async status(claims: SupabaseClaims): Promise<{ disponivel: true; conexao: Linha | null }> {
    try {
      return await this.db.run(claims, async (tx) => {
        await exigirCorretor(tx);
        const linhas = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
          select jsonb_build_object('id', c.id, 'ambiente', c.ambiente, 'status', c.status, 'conta_nome', c.conta_nome,
            'conta_email', c.conta_email, 'chave_final', c.chave_final, 'escopos_faltando', to_jsonb(c.escopos_faltando),
            'validada_em', c.validada_em, 'webhook_configurado_em', c.webhook_configurado_em,
            'herdada_do_ambiente', c.herdada_do_ambiente, 'rotacao_pendente', c.rotacao_pendente) as linha
            from public.asaas_conexoes c where c.corretor_id = public.get_corretor_id()`);
        return { disponivel: true as const, conexao: linhas[0]?.linha ?? null };
      });
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  async conectar(claims: SupabaseClaims, dto: ConectarAsaasDto): Promise<Record<string, unknown>> {
    const corretorId = await this.corretor(claims);
    const chave = chaveCifra();
    const base = urlWebhookBase();
    try {
      const apiKey = normalizarApiKey(dto.api_key);
      const ambiente = normalizarAmbiente(dto.ambiente);
      const novo = new AsaasHttp(baseUrlPara(ambiente), apiKey, this.fetchImpl);

      let infoComercial: unknown = {};
      try {
        infoComercial = await novo.get('/myAccount/commercialInfo/');
      } catch (e) {
        if (!(e instanceof AsaasError) || e.status !== 403) throw e;
      }
      // Provam que a chave opera os dois recursos que a emissão usa.
      await novo.get('/customers?limit=1');
      await novo.get('/payments?limit=1');

      let saldo: number | null = null;
      let saldoSemPermissao = false;
      try {
        const r = await novo.get<{ balance?: number | string | null }>('/finance/balance');
        saldo = Number.isFinite(Number(r?.balance)) ? Number(r?.balance) : null;
      } catch (e) {
        if (e instanceof AsaasError && e.status === 403) saldoSemPermissao = true;
        else throw e;
      }

      const conta = extrairDadosConta(infoComercial, typeof claims.email === 'string' ? claims.email : null);
      const anterior = await this.conexaoExistente(corretorId);
      let clienteAnterior: AsaasHttp | null = null;
      if (anterior) {
        try { clienteAnterior = await this.clienteSalvo(corretorId); } catch { /* conexão anterior inválida */ }
      }

      const webhookToken = tokenAleatorio(36);
      let webhookSlug = anterior?.webhook_slug ?? tokenAleatorio(24);
      const urlPara = (slug: string) => `${base}${CAMINHO_WEBHOOK}?t=${encodeURIComponent(slug)}`;
      let webhookId: string | null = null;

      // Mesma conta: reaproveita o webhook (o Asaas limita a dez). Outra conta: cria um novo, com slug novo.
      const listagem = await novo.get<{ data?: Array<{ id?: string }> }>('/webhooks?limit=100');
      const webhooks = Array.isArray(listagem?.data) ? listagem.data : [];
      if (anterior?.webhook_id && webhooks.some((w) => w?.id === anterior.webhook_id)) {
        const atualizado = await novo.put<{ id?: string }>(`/webhooks/${encodeURIComponent(anterior.webhook_id)}`,
          montarWebhookAsaas(urlPara(webhookSlug), conta.email, webhookToken));
        webhookId = atualizado?.id ?? anterior.webhook_id;
      } else {
        webhookSlug = tokenAleatorio(24);
        const criado = await novo.post<{ id?: string }>('/webhooks', montarWebhookAsaas(urlPara(webhookSlug), conta.email, webhookToken));
        webhookId = criado?.id ?? null;
      }
      if (!webhookId) throw erroApi(502, 'ASAAS_WEBHOOK_INVALIDO', 'A Asaas não confirmou a criação do webhook.');

      const status = saldoSemPermissao ? 'sem_permissao' : 'conectada';
      const escopos = saldoSemPermissao ? [ESCOPO_SALDO] : [];
      const chaveFinal = finalDaChave(apiKey);
      let conexaoId: string | null = null;
      try {
        const linhas = await this.servico.run((tx) => tx.$queryRaw<Array<{ id: string | null }>>(Prisma.sql`
          select public.salvar_conexao_asaas(${corretorId}::uuid, ${ambiente}::text, ${status}::text, ${conta.nome}::text, ${conta.email}::text,
            ${conta.cpfCnpj}::text, ${chaveFinal}::text, ${escopos}::text[], ${webhookId}::text, ${webhookSlug}::text,
            ${cifrar(apiKey, chave)}::text, ${cifrar(webhookToken, chave)}::text)::text as id`));
        conexaoId = linhas[0]?.id ?? null;
      } catch (e) {
        this.logger.error({ codigo: 'salvar_conexao_falhou', sqlstate: erroPg(e)?.sqlstate ?? null });
      }
      if (!conexaoId) {
        try { await novo.delete(`/webhooks/${encodeURIComponent(webhookId)}`); } catch { /* limpeza best-effort */ }
        throw erroApi(500, 'ASAAS_CONEXAO_FALHOU', 'Não foi possível salvar a conexão com a Asaas. Tente de novo.');
      }

      let aviso: string | null = null;
      if (anterior?.webhook_id && anterior.webhook_id !== webhookId) {
        aviso = await this.apagarWebhookSemBloquear(clienteAnterior, anterior.webhook_id);
      }

      return {
        ok: true,
        balance: saldo,
        aviso,
        conexao: {
          id: conexaoId, ambiente, status, conta_nome: conta.nome, conta_email: conta.email, chave_final: chaveFinal,
          escopos_faltando: escopos, webhook_configurado: true,
        },
      };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      if (e instanceof ErroValidacaoAsaas) throw erroApi(400, 'chave_invalida', e.message);
      if (e instanceof AsaasError) throw erroDaAsaas(e);
      this.logger.error({ codigo: 'ASAAS_CONEXAO_FALHOU', sqlstate: erroPg(e)?.sqlstate ?? null });
      throw erroApi(500, 'ASAAS_CONEXAO_FALHOU', 'Não foi possível salvar a conexão Asaas agora.');
    }
  }

  async desconectar(claims: SupabaseClaims): Promise<{ ok: true; aviso: string | null }> {
    const corretorId = await this.corretor(claims);
    chaveCifra();
    const existente = await this.conexaoExistente(corretorId);
    if (!existente) return { ok: true, aviso: null };
    let aviso: string | null = null;
    if (existente.webhook_id) {
      let anterior: AsaasHttp | null = null;
      try { anterior = await this.clienteSalvo(corretorId); } catch { /* chave revogada ou ilegível */ }
      aviso = anterior ? await this.apagarWebhookSemBloquear(anterior, existente.webhook_id) : AVISO_WEBHOOK_ANTIGO;
    }
    try {
      // Os segredos saem em cascata.
      await this.servico.run((tx) => tx.$executeRaw(Prisma.sql`delete from public.asaas_conexoes where corretor_id = ${corretorId}::uuid`));
    } catch (e) {
      traduzirErroBanco(e);
    }
    return { ok: true, aviso };
  }

  private async corretor(claims: SupabaseClaims): Promise<string> {
    try {
      return await this.db.run(claims, (tx) => exigirCorretor(tx));
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  private async conexaoExistente(corretorId: string): Promise<ConexaoExistente | null> {
    try {
      const linhas = await this.servico.run((tx) => tx.$queryRaw<ConexaoExistente[]>(Prisma.sql`
        select id::text as id, webhook_id, webhook_slug from public.asaas_conexoes where corretor_id = ${corretorId}::uuid`));
      return linhas[0] ?? null;
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  private async clienteSalvo(corretorId: string): Promise<AsaasHttp> {
    const cred = await resolverCredencial(this.servico, corretorId);
    return new AsaasHttp(baseUrlPara(cred.ambiente), cred.apiKey, this.fetchImpl);
  }

  private async apagarWebhookSemBloquear(cliente: AsaasHttp | null, webhookId: string | null): Promise<string | null> {
    if (!cliente || !webhookId) return null;
    try {
      await cliente.delete(`/webhooks/${encodeURIComponent(webhookId)}`);
      return null;
    } catch (e) {
      if (e instanceof AsaasError && e.status === 404) return null;
      return AVISO_WEBHOOK_ANTIGO;
    }
  }
}
