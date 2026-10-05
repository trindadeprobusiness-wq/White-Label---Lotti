import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../../prisma/tenant-db';
import { AcaoAsaasDto } from '../financeiro.dto';
import {
  erroApi, erroGravacaoPosAsaas, erroPg, exigirCorretor, traduzirErroAsaas, traduzirErroBanco,
} from '../financeiro.erros';
import { ServicoDb } from '../servico-db';
import { resolverCredencial } from './asaas-credencial';
import { AsaasError, AsaasHttp, baseUrlPara, FETCH_ASAAS, FetchAsaas } from './asaas-http';
import { encargosDaCobranca, hojeSaoPaulo, telefoneParaAsaas, vencimentoDaCobranca } from './asaas-regras';

/**
 * Porte de supabase/functions/asaas-sync (contrato §2.2). Nenhuma chamada ao Asaas acontece dentro
 * de um run: leitura (TenantDb) → credencial (ServicoDb) → HTTP → escrita (TenantDb) → auditoria (ServicoDb).
 */

const AVISO_TELEFONE =
  'A cobrança foi emitida, mas o telefone do inquilino não foi aceito pelo Asaas e ficou de fora do cadastro. Corrija o telefone no cadastro do cliente.';
const MSG_SEM_CORRETOR = 'Não foi possível identificar o corretor da sua sessão.';
const STATUS_PAGOS = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];

type Registro = Record<string, any>;
type Corpo = Record<string, unknown>;

interface PagamentoAsaas {
  id: string;
  status?: string | null;
  billingType?: string | null;
  bankSlipUrl?: string | null;
  invoiceUrl?: string | null;
  value?: number | null;
  deleted?: boolean | null;
}

interface Contexto {
  claims: SupabaseClaims;
  corretorId: string;
  fatura: Registro;
  contrato: Registro | null;
  cliente: Registro | null;
  imovel: Registro | null;
  asaas: () => Promise<AsaasHttp>;
}

@Injectable()
export class AsaasCobrancaService {
  private readonly logger = new Logger(AsaasCobrancaService.name);
  /** Relógio injetável para o "hoje" de São Paulo (testes determinísticos). */
  agora: () => Date = () => new Date();

  constructor(
    private readonly db: TenantDb,
    private readonly servico: ServicoDb,
    @Inject(FETCH_ASAAS) private readonly fetchImpl: FetchAsaas,
  ) {}

  async saldo(claims: SupabaseClaims): Promise<{ balance: number | null; unavailable?: boolean; message?: string }> {
    const corretorId = await this.corretor(claims);
    try {
      const asaas = await this.cliente(corretorId);
      const bal = await asaas.get<{ balance?: number | string | null }>('/finance/balance');
      return { balance: Number(bal?.balance ?? 0) };
    } catch (e) {
      // Chave sem escopo FINANCIAL_TRANSACTION:READ → não é erro do app.
      if (e instanceof AsaasError && (e.status === 403 || e.status === 401)) {
        return {
          balance: null,
          unavailable: true,
          message: 'Ative a permissão de leitura de saldo (FINANCIAL_TRANSACTION:READ) na sua chave de API do Asaas para ver o saldo aqui.',
        };
      }
      return this.tratar(e);
    }
  }

  async acao(claims: SupabaseClaims, faturaId: string, dto: AcaoAsaasDto): Promise<Corpo> {
    const lida = await this.lerFatura(claims, faturaId);
    // Credencial preguiçosa: ações que não falam com o Asaas (fatura nunca emitida) não exigem conta conectada.
    let memo: AsaasHttp | null = null;
    const ctx: Contexto = { claims, ...lida, asaas: async () => (memo ??= await this.cliente(lida.corretorId)) };
    try {
      switch (dto.acao) {
        case 'emitir_cobranca': return await this.emitir(ctx);
        case 'atualizar_cobranca': return await this.atualizar(ctx);
        case 'receber_em_dinheiro': return await this.receberEmDinheiro(ctx, dto.data_pagamento);
        case 'desfazer_recebimento': return await this.desfazerRecebimento(ctx);
        case 'excluir_cobranca': return await this.excluir(ctx);
        default: throw erroApi(400, 'acao_invalida', 'Ação inválida.');
      }
    } catch (e) {
      return this.tratar(e);
    }
  }

  // ---------------------------------------------------------------- ações

  private async emitir(ctx: Contexto): Promise<Corpo> {
    const { fatura, cliente } = ctx;
    this.recusarPagaOuCancelada(fatura);
    if (fatura.external_id) {
      return { ok: true, already: true, external_id: fatura.external_id, boleto_url: fatura.boleto_url_asaas, pix: fatura.pix_qrcode_text, avisos: [] };
    }
    const cpf = String(cliente?.cpf ?? '').replace(/\D/g, '');
    if (!cpf || !cliente) throw erroApi(422, 'cpf_ausente', 'O inquilino precisa ter CPF cadastrado para emitir a cobrança.');

    const asaas = await ctx.asaas();
    const avisos: string[] = [];
    const tel = telefoneParaAsaas(cliente.telefone);
    const temTelefoneValido = !!(tel.mobilePhone || tel.phone);
    if (!temTelefoneValido && String(cliente.telefone ?? '').trim()) avisos.push(AVISO_TELEFONE);

    let customerId: string | null = cliente.asaas_customer_id ?? null;
    if (!customerId) {
      try {
        const busca = await asaas.get<{ data?: Array<{ id: string }> }>(`/customers?cpfCnpj=${cpf}`);
        if (busca?.data?.length) customerId = busca.data[0].id;
      } catch { /* segue para a criação */ }
      if (!customerId) {
        const novo = await asaas.post<{ id: string }>('/customers', {
          name: cliente.nome, cpfCnpj: cpf, email: cliente.email || undefined, externalReference: cliente.id,
        });
        customerId = novo.id;
      }
      await this.gravarPosAsaas(fatura.id, () => this.db.run(ctx.claims, async (tx) => {
        const r = await tx.$queryRaw<unknown[]>(Prisma.sql`
          update public.clientes set asaas_customer_id = ${customerId}::text where id = ${cliente.id}::uuid returning id`);
        if (r.length === 0) throw new Error('zero_linhas');
      }));
    }

    if (temTelefoneValido) {
      try {
        await asaas.put(`/customers/${customerId}`, tel);
      } catch {
        this.logger.warn({ codigo: 'telefone_recusado', fatura_id: fatura.id });
        avisos.push(AVISO_TELEFONE);
      }
    }

    const vencimento = this.vencimento(ctx);
    const mj = encargosDaCobranca(ctx.contrato);
    // D4: antes de criar, procura cobrança desta fatura (uma tentativa anterior pode ter criado e não gravado).
    const existentes = await asaas.get<{ data?: PagamentoAsaas[] }>(`/payments?externalReference=${encodeURIComponent(fatura.id)}`);
    let payment = (existentes?.data ?? []).find((p) => p && p.deleted !== true && p.status !== 'DELETED') ?? null;
    if (!payment) {
      payment = await asaas.post<PagamentoAsaas>('/payments', {
        customer: customerId,
        billingType: 'UNDEFINED',
        dueDate: vencimento,
        value: Number(fatura.valor_total),
        description: `Aluguel ${fatura.mes_referencia} — ${this.descImovel(ctx)}`,
        externalReference: fatura.id,
        fine: mj.fine,
        interest: mj.interest,
      });
    }

    let pixText: string | null = null;
    try {
      const pix = await asaas.get<{ payload?: string | null }>(`/payments/${payment.id}/pixQrCode`);
      pixText = pix?.payload ?? null;
    } catch { /* segue sem PIX */ }

    const boleto = payment.bankSlipUrl ?? payment.invoiceUrl ?? null;
    await this.gravarFatura(ctx, {
      external_id: payment.id, data_vencimento: vencimento, boleto_url_asaas: boleto, pix_qrcode_text: pixText, asaas_status: payment.status ?? null,
    });
    await this.auditar(ctx, 'COBRANCA_EMITIDA',
      { external_id: payment.id, value: payment.value ?? null, dueDate: vencimento, status: payment.status ?? null },
      { multa_pct: mj.multaPct, juros_mensal_pct: mj.jurosMensalPct });
    return { ok: true, external_id: payment.id, boleto_url: boleto, pix: pixText, status: payment.status ?? null, avisos };
  }

  private async atualizar(ctx: Contexto): Promise<Corpo> {
    const { fatura } = ctx;
    this.recusarPagaOuCancelada(fatura);
    if (!fatura.external_id) throw erroApi(409, 'cobranca_nao_emitida', 'Esta cobrança ainda não foi emitida.');
    const asaas = await ctx.asaas();
    const atual = await asaas.get<PagamentoAsaas>(`/payments/${fatura.external_id}`);
    if (STATUS_PAGOS.includes(String(atual?.status))) {
      throw erroApi(409, 'cobranca_paga', 'Cobrança já foi paga/confirmada — não é possível alterar.');
    }
    const vencimento = this.vencimento(ctx);
    const mj = encargosDaCobranca(ctx.contrato);
    const payment = await asaas.put<PagamentoAsaas>(`/payments/${fatura.external_id}`, {
      billingType: atual?.billingType ?? 'UNDEFINED',
      dueDate: vencimento,
      value: Number(fatura.valor_total),
      description: `Aluguel ${fatura.mes_referencia} — ${this.descImovel(ctx)}`,
      externalReference: fatura.id,
      fine: mj.fine,
      interest: mj.interest,
    });

    let pixText: string | null = fatura.pix_qrcode_text ?? null;
    try {
      const pix = await asaas.get<{ payload?: string | null }>(`/payments/${payment.id}/pixQrCode`);
      pixText = pix?.payload ?? pixText;
    } catch { /* segue com o pix atual */ }

    const boleto = payment.bankSlipUrl ?? payment.invoiceUrl ?? fatura.boleto_url_asaas ?? null;
    await this.gravarFatura(ctx, { data_vencimento: vencimento, boleto_url_asaas: boleto, pix_qrcode_text: pixText, asaas_status: payment.status ?? null });
    await this.auditar(ctx, 'COBRANCA_ATUALIZADA',
      { external_id: payment.id, value: payment.value ?? null, dueDate: vencimento, status: payment.status ?? null },
      { multa_pct: mj.multaPct, juros_mensal_pct: mj.jurosMensalPct });
    return { ok: true, updated: true, external_id: payment.id, boleto_url: boleto, pix: pixText, status: payment.status ?? null, avisos: [] };
  }

  private async receberEmDinheiro(ctx: Contexto, dataPagamento?: string): Promise<Corpo> {
    const { fatura } = ctx;
    if (!fatura.external_id) return { ok: true, sem_cobranca: true, avisos: [] };
    const asaas = await ctx.asaas();
    const atual = await asaas.get<{ status?: string | null }>(`/payments/${fatura.external_id}`);
    const st = String(atual?.status ?? '');
    if (st === 'RECEIVED_IN_CASH') return { ok: true, already: true, status: st, avisos: [] };
    if (st === 'RECEIVED' || st === 'CONFIRMED') {
      // Já entrou por boleto/PIX; marcar em dinheiro duplicaria o recebimento no Asaas.
      return {
        ok: true,
        status: st,
        avisos: ['Esta cobrança já constava paga no Asaas (boleto ou PIX). A baixa foi registrada apenas no sistema, para não lançar o valor duas vezes.'],
      };
    }
    const dataPg = /^\d{4}-\d{2}-\d{2}$/.test(String(dataPagamento ?? '')) ? (dataPagamento as string) : hojeSaoPaulo(this.agora());
    const recebido = await asaas.post<{ status?: string | null }>(`/payments/${fatura.external_id}/receiveInCash`, {
      paymentDate: dataPg, value: Number(fatura.valor_total), notifyCustomer: false,
    });
    await this.gravarFatura(ctx, { asaas_status: recebido?.status ?? 'RECEIVED_IN_CASH' });
    await this.auditar(ctx, 'RECEBIMENTO_EM_DINHEIRO',
      { external_id: fatura.external_id, paymentDate: dataPg, value: Number(fatura.valor_total), status: recebido?.status ?? null });
    return { ok: true, status: recebido?.status ?? null, avisos: [] };
  }

  private async desfazerRecebimento(ctx: Contexto): Promise<Corpo> {
    const { fatura } = ctx;
    if (!fatura.external_id) return { ok: true, sem_cobranca: true, avisos: [] };
    const asaas = await ctx.asaas();
    const atual = await asaas.get<{ status?: string | null }>(`/payments/${fatura.external_id}`);
    const st = String(atual?.status ?? '');
    if (st !== 'RECEIVED_IN_CASH') {
      return {
        ok: true,
        nao_aplicavel: true,
        status: st,
        avisos: st === 'RECEIVED' || st === 'CONFIRMED'
          ? ['A cobrança consta paga no Asaas por boleto/PIX. O estorno foi feito só no sistema — se for o caso, estorne também no painel do Asaas.']
          : [],
      };
    }
    const desfeito = await asaas.post<{ status?: string | null }>(`/payments/${fatura.external_id}/undoReceivedInCash`, {});
    await this.gravarFatura(ctx, { asaas_status: desfeito?.status ?? 'PENDING' });
    await this.auditar(ctx, 'RECEBIMENTO_EM_DINHEIRO_DESFEITO', { external_id: fatura.external_id, status: desfeito?.status ?? null });
    return { ok: true, status: desfeito?.status ?? null, avisos: [] };
  }

  private async excluir(ctx: Contexto): Promise<Corpo> {
    const { fatura } = ctx;
    if (fatura.status === 'PAGO') throw erroApi(409, 'fatura_paga', "Fatura já está paga — use 'Desfazer pagamento' se foi um erro.");
    if (fatura.status === 'CANCELADO') throw erroApi(409, 'fatura_cancelada', 'Fatura já está cancelada.');
    const comCobranca = !!fatura.external_id;
    if (comCobranca) await this.excluirNoAsaas(await ctx.asaas(), String(fatura.external_id));
    const campos = { status: 'CANCELADO', asaas_status: 'DELETED', external_id: null, boleto_url: null, boleto_url_asaas: null, pix_qrcode_text: null };
    if (comCobranca) {
      await this.gravarFatura(ctx, campos);
      await this.auditar(ctx, 'COBRANCA_EXCLUIDA', { external_id: fatura.external_id ?? null, status_anterior: fatura.status });
    } else {
      // Nada mudou no Asaas: erro do banco segue o tradutor comum.
      await this.db.run(ctx.claims, (tx) => this.updateFatura(tx, fatura.id, campos)).then((n) => {
        if (n === 0) throw erroApi(404, 'fatura_nao_encontrada', 'Fatura não encontrada');
      });
      await this.gravarPosAsaas(fatura.id, () => this.inserirAuditoria(ctx, 'COBRANCA_EXCLUIDA',
        { external_id: null, status_anterior: fatura.status }), false);
    }
    return { ok: true, avisos: [] };
  }

  /** Porte de _shared/excluir-cobranca.ts: o Asaas é a fonte de verdade; 404 é idempotente. */
  private async excluirNoAsaas(asaas: AsaasHttp, externalId: string): Promise<void> {
    const path = `/payments/${externalId}`;
    let atual: { status?: unknown; deleted?: unknown } | null;
    try {
      atual = await asaas.get(path);
    } catch (e) {
      if (e instanceof AsaasError && e.status === 404) return;
      throw e;
    }
    const status = String(atual?.status ?? '');
    if (atual?.deleted === true || status === 'DELETED') return;
    if (STATUS_PAGOS.includes(status)) {
      throw erroApi(409, 'cobranca_paga', 'A cobrança já está paga/confirmada no Asaas e não pode ser excluída.');
    }
    let removida: { deleted?: unknown } | null;
    try {
      removida = await asaas.delete(path);
    } catch (e) {
      if (e instanceof AsaasError && e.status === 404) return;
      throw e;
    }
    if (removida?.deleted !== true) throw erroApi(502, 'asaas_nao_confirmou', 'O Asaas não confirmou a exclusão da cobrança.');
  }

  // ---------------------------------------------------------------- banco

  private async corretor(claims: SupabaseClaims): Promise<string> {
    try {
      return await this.db.run(claims, (tx) => exigirCorretor(tx, MSG_SEM_CORRETOR));
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  private async lerFatura(claims: SupabaseClaims, faturaId: string) {
    let r: { corretorId: string; linha?: { fatura: Registro; contrato: Registro | null; cliente: Registro | null; imovel: Registro | null } };
    try {
      r = await this.db.run(claims, async (tx) => {
        const corretorId = await exigirCorretor(tx, MSG_SEM_CORRETOR);
        const linhas = await tx.$queryRaw<Array<{ fatura: Registro; contrato: Registro | null; cliente: Registro | null; imovel: Registro | null }>>(Prisma.sql`
          select to_jsonb(f) as fatura,
                 (select to_jsonb(c) from public.contratos c where c.id = f.contrato_id) as contrato,
                 (select to_jsonb(k) from public.clientes k where k.id = f.cliente_id) as cliente,
                 (select to_jsonb(i) from public.imoveis i where i.id = f.imovel_id) as imovel
            from public.faturas_aluguel f where f.id = ${faturaId}::uuid`);
        return { corretorId, linha: linhas[0] };
      });
    } catch (e) {
      traduzirErroBanco(e);
    }
    // Defesa em profundidade: a RLS já filtra, mas esta rota move dinheiro na conta do corretor da sessão.
    if (!r.linha || r.linha.fatura.corretor_id !== r.corretorId) throw erroApi(404, 'fatura_nao_encontrada', 'Fatura não encontrada');
    return { corretorId: r.corretorId, ...r.linha };
  }

  private async cliente(corretorId: string): Promise<AsaasHttp> {
    const cred = await resolverCredencial(this.servico, corretorId);
    return new AsaasHttp(baseUrlPara(cred.ambiente), cred.apiKey, this.fetchImpl);
  }

  private updateFatura(tx: Prisma.TransactionClient, faturaId: string, campos: Record<string, unknown>): Promise<number> {
    const cols = Object.keys(campos);
    const alvo = Prisma.raw(cols.join(', '));
    const origem = Prisma.raw(cols.map((c) => `r.${c}`).join(', '));
    return tx.$queryRaw<unknown[]>(Prisma.sql`
      update public.faturas_aluguel f
         set (${alvo}) = (select ${origem} from jsonb_populate_record(null::public.faturas_aluguel, ${JSON.stringify(campos)}::jsonb) r)
       where f.id = ${faturaId}::uuid returning f.id::text as id`).then((l) => l.length);
  }

  /** UPDATE depois do Asaas: zero linhas ou erro → 500 gravacao_pos_asaas (D4). */
  private gravarFatura(ctx: Contexto, campos: Record<string, unknown>): Promise<void> {
    return this.gravarPosAsaas(ctx.fatura.id, () => this.db.run(ctx.claims, async (tx) => {
      if ((await this.updateFatura(tx, ctx.fatura.id, campos)) === 0) throw new Error('zero_linhas');
    }));
  }

  private auditar(ctx: Contexto, acao: string, depois: Corpo, calculo?: Corpo): Promise<void> {
    return this.gravarPosAsaas(ctx.fatura.id, () => this.inserirAuditoria(ctx, acao, depois, calculo));
  }

  /** auditoria_financeira não tem política de INSERT: vai pelo ServicoDb, com o usuário como ator. */
  private async inserirAuditoria(ctx: Contexto, acao: string, depois: Corpo, calculo?: Corpo): Promise<void> {
    await this.servico.run((tx) => tx.$executeRaw(Prisma.sql`
      insert into public.auditoria_financeira (corretor_id, entidade, entidade_id, acao, dados_antes, dados_depois, calculo, origem, ator)
      values (${ctx.corretorId}::uuid, 'faturas_aluguel', ${ctx.fatura.id}::uuid, ${acao}::text, ${null}::jsonb,
              ${JSON.stringify(depois)}::jsonb, ${calculo ? JSON.stringify(calculo) : null}::jsonb, 'ui', ${ctx.claims.sub}::text)`));
  }

  private async gravarPosAsaas(faturaId: string, trabalho: () => Promise<unknown>, posAsaas = true): Promise<void> {
    try {
      await trabalho();
    } catch (e) {
      const sqlstate = erroPg(e)?.sqlstate ?? null;
      this.logger.error({ sqlstate, codigo: 'gravacao_pos_asaas', fatura_id: faturaId });
      if (!posAsaas) traduzirErroBanco(e);
      throw erroGravacaoPosAsaas();
    }
  }

  // ---------------------------------------------------------------- regras

  private recusarPagaOuCancelada(fatura: Registro): void {
    if (fatura.status === 'PAGO') throw erroApi(409, 'fatura_paga', 'Fatura já está paga');
    if (fatura.status === 'CANCELADO') throw erroApi(409, 'fatura_cancelada', 'Fatura cancelada');
  }

  private vencimento(ctx: Contexto): string {
    return vencimentoDaCobranca(ctx.fatura, ctx.contrato, hojeSaoPaulo(this.agora()));
  }

  private descImovel(ctx: Contexto): string {
    return ctx.imovel?.titulo || ctx.imovel?.endereco || 'imóvel';
  }

  /** HttpException passa; erro do banco pelo tradutor; Asaas pelo tradutor do Asaas. */
  private tratar(e: unknown): never {
    if (e instanceof HttpException) throw e;
    if (erroPg(e)) traduzirErroBanco(e);
    traduzirErroAsaas(e);
  }
}
