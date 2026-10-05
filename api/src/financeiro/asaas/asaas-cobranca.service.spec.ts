import { randomBytes } from 'node:crypto';
import { HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AcaoAsaasDto } from '../financeiro.dto';
import { AsaasCobrancaService } from './asaas-cobranca.service';
import { cifrar } from './asaas-crypto';

const FATURA = '11111111-1111-4111-8111-111111111111';
const CORRETOR = '55555555-5555-4555-8555-555555555555';
const OUTRO = '66666666-6666-4666-8666-666666666666';
const CLIENTE = '77777777-7777-4777-8777-777777777777';
const CHAVE = randomBytes(32).toString('hex');
const API_KEY = '$aact_chave_do_corretor_000123';
const CPF = '123.456.789-09';
const claims = { sub: 'user-1', role: 'authenticated' };

type Rota = [metodo: string, caminho: RegExp, status: number, corpo: unknown];
type Registro = Record<string, unknown>;

function faturaBase(extra: Registro = {}): Registro {
  return {
    id: FATURA, corretor_id: CORRETOR, status: 'PENDENTE', external_id: null, valor_total: 2300.5, mes_referencia: '11/2026',
    data_vencimento: '2026-11-10', boleto_url_asaas: null, pix_qrcode_text: null, ...extra,
  };
}

function montar(o: { fatura?: Registro | null; corretor?: string | null; cliente?: Registro | null; rotas?: Rota[]; linhasUpdate?: unknown[]; falhaAuditoria?: boolean } = {}) {
  const chamadas: Array<{ metodo: string; caminho: string; corpo: unknown }> = [];
  const f = jest.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    const caminho = url.replace(/^https:\/\/api(-sandbox)?\.asaas\.com\/v3/, '');
    chamadas.push({ metodo, caminho, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = (o.rotas ?? []).find(([m, re]) => m === metodo && re.test(caminho));
    return new Response(JSON.stringify(r ? r[3] : { errors: [{ description: 'não prevista' }] }), { status: r ? r[2] : 500 });
  });
  const tenant = {
    $queryRaw: jest.fn(async (q: Prisma.Sql) => {
      if (q.text.includes('get_corretor_id')) return [{ id: o.corretor === undefined ? CORRETOR : o.corretor }];
      if (q.text.includes('from public.faturas_aluguel f where f.id')) {
        return o.fatura === null ? [] : [{
          fatura: o.fatura ?? faturaBase(), contrato: { multa_atraso_percentual: 2, juros_mora_diario_percentual: 0.0333 },
          cliente: o.cliente === undefined ? { id: CLIENTE, nome: 'Ana', cpf: CPF, telefone: '(62) 99999-8888', email: 'ana@x', asaas_customer_id: null } : o.cliente,
          imovel: { titulo: 'Apto 1' },
        }];
      }
      if (q.text.includes('update public.faturas_aluguel')) return o.linhasUpdate ?? [{ id: FATURA }];
      if (q.text.includes('update public.clientes')) return [{ id: CLIENTE }];
      throw new Error(`consulta inesperada: ${q.text}`);
    }),
  };
  const servicoTx = {
    $queryRaw: jest.fn(async (_q: Prisma.Sql) => [{ id: 'c1', ambiente: 'producao', status: 'conectada', herdada_do_ambiente: false, api_key_ciphertext: cifrar(API_KEY, CHAVE) }]),
    $executeRaw: jest.fn(async (_q: Prisma.Sql) => {
      if (o.falhaAuditoria) throw new Prisma.PrismaClientKnownRequestError('x', { code: 'P2010', clientVersion: 't', meta: { code: '42501', message: 'ERROR: x' } });
      return 1;
    }),
  };
  const db = { run: jest.fn(async (_c: unknown, w: (t: typeof tenant) => unknown) => w(tenant)) };
  const servico = { run: jest.fn(async (w: (t: typeof servicoTx) => unknown) => w(servicoTx)) };
  const svc = new AsaasCobrancaService(db as never, servico as never, f as unknown as typeof fetch);
  svc.agora = () => new Date('2026-10-05T15:00:00Z');
  return { svc, chamadas, f, tenant, servicoTx };
}

const acao = (a: AcaoAsaasDto['acao'], extra: Partial<AcaoAsaasDto> = {}) => Object.assign(new AcaoAsaasDto(), { acao: a, ...extra });

async function erroDe(p: Promise<unknown>) {
  try { await p; } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() as Registro };
    throw e;
  }
  throw new Error('não lançou');
}

const EMISSAO: Rota[] = [
  ['GET', /^\/customers\?cpfCnpj=12345678909$/, 200, { data: [] }],
  ['POST', /^\/customers$/, 200, { id: 'cus_1' }],
  ['PUT', /^\/customers\/cus_1$/, 200, {}],
  ['GET', /^\/payments\?externalReference=/, 200, { data: [] }],
  ['POST', /^\/payments$/, 200, { id: 'pay_1', status: 'PENDING', bankSlipUrl: 'https://b/1', value: 2300.5 }],
  ['GET', /^\/payments\/pay_1\/pixQrCode$/, 200, { payload: 'pix-1' }],
];

describe('AsaasCobrancaService', () => {
  const env = { ...process.env };
  beforeEach(() => { process.env.ASAAS_TOKEN_ENCRYPTION_KEY = CHAVE; delete process.env.ASAAS_BASE_URL; });
  afterEach(() => { process.env = { ...env }; jest.restoreAllMocks(); });

  it('emitir: cria cliente e cobrança, grava fatura e auditoria, resposta igual à Edge', async () => {
    const { svc, chamadas, tenant, servicoTx } = montar({ rotas: EMISSAO });
    const r = await svc.acao(claims, FATURA, acao('emitir_cobranca'));
    expect(r).toEqual({ ok: true, external_id: 'pay_1', boleto_url: 'https://b/1', pix: 'pix-1', status: 'PENDING', avisos: [] });
    expect(chamadas.map((c) => `${c.metodo} ${c.caminho}`)).toEqual([
      'GET /customers?cpfCnpj=12345678909', 'POST /customers', 'PUT /customers/cus_1',
      `GET /payments?externalReference=${FATURA}`, 'POST /payments', 'GET /payments/pay_1/pixQrCode',
    ]);
    expect(chamadas[4].corpo).toEqual({
      customer: 'cus_1', billingType: 'UNDEFINED', dueDate: '2026-11-10', value: 2300.5, description: 'Aluguel 11/2026 — Apto 1',
      externalReference: FATURA, fine: { value: 2, type: 'PERCENTAGE' }, interest: { value: 1 },
    });
    const update = tenant.$queryRaw.mock.calls.map((c) => c[0] as Prisma.Sql).find((q) => q.text.includes('update public.faturas_aluguel'))!;
    expect(JSON.parse(update.values[0] as string)).toEqual({
      external_id: 'pay_1', data_vencimento: '2026-11-10', boleto_url_asaas: 'https://b/1', pix_qrcode_text: 'pix-1', asaas_status: 'PENDING',
    });
    const aud = servicoTx.$executeRaw.mock.calls[0][0] as Prisma.Sql;
    expect(aud.text).toContain('insert into public.auditoria_financeira');
    expect(aud.values).toContain('COBRANCA_EMITIDA');
    expect(aud.values).toContain('user-1');
    expect(chamadas.some((c) => c.caminho.includes('/transfers'))).toBe(false);
  });

  it('emitir já emitida devolve already sem falar com o Asaas', async () => {
    const { svc, f } = montar({ fatura: faturaBase({ external_id: 'pay_9', boleto_url_asaas: 'u', pix_qrcode_text: 'p' }) });
    expect(await svc.acao(claims, FATURA, acao('emitir_cobranca'))).toEqual({
      ok: true, already: true, external_id: 'pay_9', boleto_url: 'u', pix: 'p', avisos: [],
    });
    expect(f).not.toHaveBeenCalled();
  });

  it('D4: reaproveita a cobrança achada por externalReference, sem POST /payments', async () => {
    const rotas: Rota[] = EMISSAO.map((r) => (r[1].source.includes('externalReference')
      ? ['GET', r[1], 200, { data: [{ id: 'pay_old', status: 'DELETED' }, { id: 'pay_1', status: 'PENDING', invoiceUrl: 'https://i/1' }] }]
      : r));
    const { svc, chamadas } = montar({ rotas, cliente: { id: CLIENTE, nome: 'Ana', cpf: CPF, telefone: '', asaas_customer_id: 'cus_1' } });
    const r = await svc.acao(claims, FATURA, acao('emitir_cobranca'));
    expect(r.external_id).toBe('pay_1');
    expect(r.boleto_url).toBe('https://i/1');
    expect(chamadas.some((c) => c.metodo === 'POST' && c.caminho === '/payments')).toBe(false);
    expect(chamadas.some((c) => c.caminho.startsWith('/customers'))).toBe(false);
  });

  it('sem CPF → 422 cpf_ausente', async () => {
    const { svc, f } = montar({ cliente: { id: CLIENTE, nome: 'Ana', cpf: null, telefone: '' } });
    const { status, body } = await erroDe(svc.acao(claims, FATURA, acao('emitir_cobranca')));
    expect(status).toBe(422);
    expect(body).toEqual({ statusCode: 422, codigo: 'cpf_ausente', message: 'O inquilino precisa ter CPF cadastrado para emitir a cobrança.' });
    expect(f).not.toHaveBeenCalled();
  });

  it('fatura de outro corretor (ou invisível) → 404 ANTES de qualquer fetch', async () => {
    for (const fatura of [faturaBase({ corretor_id: OUTRO }), null]) {
      const { svc, f } = montar({ fatura });
      const { status, body } = await erroDe(svc.acao(claims, FATURA, acao('emitir_cobranca')));
      expect(status).toBe(404);
      expect(body).toEqual({ statusCode: 404, codigo: 'fatura_nao_encontrada', message: 'Fatura não encontrada' });
      expect(f).toHaveBeenCalledTimes(0);
    }
  });

  it('sem corretor na sessão → 403 com o texto da Edge', async () => {
    const { svc } = montar({ corretor: null });
    const { status, body } = await erroDe(svc.acao(claims, FATURA, acao('emitir_cobranca')));
    expect(status).toBe(403);
    expect(body.message).toBe('Não foi possível identificar o corretor da sua sessão.');
  });

  it('UPDATE com 0 linhas depois do POST /payments → 500 gravacao_pos_asaas, log sem segredo', async () => {
    const erro = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { svc } = montar({ rotas: EMISSAO, linhasUpdate: [] });
    const { status, body } = await erroDe(svc.acao(claims, FATURA, acao('emitir_cobranca')));
    expect(status).toBe(500);
    expect(body.codigo).toBe('gravacao_pos_asaas');
    expect(erro).toHaveBeenCalledWith({ sqlstate: null, codigo: 'gravacao_pos_asaas', fatura_id: FATURA });
  });

  it('auditoria que falha depois do Asaas → gravacao_pos_asaas', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { svc } = montar({ rotas: EMISSAO, falhaAuditoria: true });
    expect((await erroDe(svc.acao(claims, FATURA, acao('emitir_cobranca')))).body.codigo).toBe('gravacao_pos_asaas');
  });

  it('receber em dinheiro com RECEIVED devolve aviso e não chama receiveInCash', async () => {
    const { svc, chamadas } = montar({ fatura: faturaBase({ external_id: 'pay_1' }), rotas: [['GET', /^\/payments\/pay_1$/, 200, { status: 'RECEIVED' }]] });
    const r = await svc.acao(claims, FATURA, acao('receber_em_dinheiro'));
    expect(r).toEqual({ ok: true, status: 'RECEIVED', avisos: [expect.stringContaining('já constava paga no Asaas')] });
    expect(chamadas.some((c) => c.caminho.includes('receiveInCash'))).toBe(false);
  });

  it('receber em dinheiro pendente usa a data do corpo e grava asaas_status', async () => {
    const { svc, chamadas } = montar({
      fatura: faturaBase({ external_id: 'pay_1' }),
      rotas: [['GET', /^\/payments\/pay_1$/, 200, { status: 'PENDING' }], ['POST', /^\/payments\/pay_1\/receiveInCash$/, 200, { status: 'RECEIVED_IN_CASH' }]],
    });
    expect(await svc.acao(claims, FATURA, acao('receber_em_dinheiro', { data_pagamento: '2026-10-01' })))
      .toEqual({ ok: true, status: 'RECEIVED_IN_CASH', avisos: [] });
    expect(chamadas[1].corpo).toEqual({ paymentDate: '2026-10-01', value: 2300.5, notifyCustomer: false });
  });

  it('desfazer recebimento que não foi em dinheiro → nao_aplicavel', async () => {
    const { svc } = montar({ fatura: faturaBase({ external_id: 'pay_1' }), rotas: [['GET', /^\/payments\/pay_1$/, 200, { status: 'PENDING' }]] });
    expect(await svc.acao(claims, FATURA, acao('desfazer_recebimento'))).toEqual({ ok: true, nao_aplicavel: true, status: 'PENDING', avisos: [] });
  });

  it('atualizar: sem external_id → 409; cobrança paga → 409', async () => {
    const sem = montar();
    expect((await erroDe(sem.svc.acao(claims, FATURA, acao('atualizar_cobranca')))).body.codigo).toBe('cobranca_nao_emitida');
    const paga = montar({ fatura: faturaBase({ external_id: 'pay_1' }), rotas: [['GET', /^\/payments\/pay_1$/, 200, { status: 'CONFIRMED' }]] });
    expect((await erroDe(paga.svc.acao(claims, FATURA, acao('atualizar_cobranca')))).body.codigo).toBe('cobranca_paga');
  });

  it('excluir: fatura paga → 409; cobrança pendente é removida e a fatura cancelada', async () => {
    const paga = montar({ fatura: faturaBase({ status: 'PAGO' }) });
    expect((await erroDe(paga.svc.acao(claims, FATURA, acao('excluir_cobranca')))).body.codigo).toBe('fatura_paga');
    const { svc, tenant } = montar({
      fatura: faturaBase({ external_id: 'pay_1' }),
      rotas: [['GET', /^\/payments\/pay_1$/, 200, { status: 'PENDING' }], ['DELETE', /^\/payments\/pay_1$/, 200, { deleted: true }]],
    });
    expect(await svc.acao(claims, FATURA, acao('excluir_cobranca'))).toEqual({ ok: true, avisos: [] });
    const update = tenant.$queryRaw.mock.calls.map((c) => c[0] as Prisma.Sql).find((q) => q.text.includes('update public.faturas_aluguel'))!;
    expect(JSON.parse(update.values[0] as string)).toMatchObject({ status: 'CANCELADO', asaas_status: 'DELETED', external_id: null });
  });

  it('erro do Asaas vira 400 asaas_recusou com a descrição; 401 vira 502', async () => {
    const { svc } = montar({ rotas: [...EMISSAO.filter((r) => !(r[0] === 'POST' && r[1].source.includes('payments'))), ['POST', /^\/payments$/, 400, { errors: [{ description: 'Valor inválido' }] }]] });
    expect(await erroDe(svc.acao(claims, FATURA, acao('emitir_cobranca')))).toEqual({
      status: 400, body: { statusCode: 400, codigo: 'asaas_recusou', message: 'Valor inválido' },
    });
  });

  it('saldo: 403 do Asaas → unavailable com a mensagem da Edge', async () => {
    const { svc } = montar({ rotas: [['GET', /^\/finance\/balance$/, 403, {}]] });
    expect(await svc.saldo(claims)).toEqual({
      balance: null, unavailable: true,
      message: 'Ative a permissão de leitura de saldo (FINANCIAL_TRANSACTION:READ) na sua chave de API do Asaas para ver o saldo aqui.',
    });
  });

  it('nenhum log carrega a chave de API, o CPF ou o corpo do Asaas', async () => {
    const espioes = (['log', 'error', 'warn', 'debug', 'verbose'] as const).map((m) => jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined));
    const consoles = (['log', 'error', 'warn'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    const rotas: Rota[] = [...EMISSAO.filter((r) => !r[1].source.startsWith('^\\/customers\\/')), ['PUT', /^\/customers\/cus_1$/, 400, { errors: [{ description: CPF }] }]];
    const { svc } = montar({ rotas, linhasUpdate: [] });
    await erroDe(svc.acao(claims, FATURA, acao('emitir_cobranca')));
    const tudo = JSON.stringify([...espioes, ...consoles].flatMap((s) => s.mock.calls));
    expect(tudo).not.toContain(API_KEY);
    expect(tudo).not.toContain('12345678909');
    expect(tudo).not.toContain(CPF);
  });
});
