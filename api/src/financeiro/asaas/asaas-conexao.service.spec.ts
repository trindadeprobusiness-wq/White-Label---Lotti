import { randomBytes } from 'node:crypto';
import { HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConectarAsaasDto } from '../financeiro.dto';
import { AsaasConexaoService } from './asaas-conexao.service';
import { EVENTOS_WEBHOOK_ASAAS } from './asaas-regras';

const CORRETOR = '55555555-5555-4555-8555-555555555555';
const CHAVE = randomBytes(32).toString('hex');
const API_KEY = '$aact_chave_nova_do_corretor_9876';
const claims = { sub: 'user-1', role: 'authenticated', email: 'sessao@teste.local' };

type Rota = [metodo: string, caminho: RegExp, status: number, corpo: unknown];

const OK: Rota[] = [
  ['GET', /^\/myAccount\/commercialInfo\/$/, 200, { companyName: 'Imobiliária X', email: 'conta@teste.local', cpfCnpj: '11222333000181' }],
  ['GET', /^\/customers\?limit=1$/, 200, { data: [] }],
  ['GET', /^\/payments\?limit=1$/, 200, { data: [] }],
  ['GET', /^\/finance\/balance$/, 200, { balance: 10 }],
  ['GET', /^\/webhooks\?limit=100$/, 200, { data: [] }],
  ['POST', /^\/webhooks$/, 200, { id: 'wh_1' }],
  ['DELETE', /^\/webhooks\/wh_1$/, 200, { deleted: true }],
];

function montar(o: { rotas?: Rota[]; salvar?: 'ok' | 'erro'; existente?: Record<string, unknown> | null } = {}) {
  const chamadas: Array<{ metodo: string; caminho: string; corpo: any }> = [];
  const f = jest.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    const caminho = url.replace(/^https:\/\/api(-sandbox)?\.asaas\.com\/v3/, '');
    chamadas.push({ metodo, caminho, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = (o.rotas ?? OK).find(([m, re]) => m === metodo && re.test(caminho));
    return new Response(JSON.stringify(r ? r[3] : {}), { status: r ? r[2] : 500 });
  });
  const tenant = { $queryRaw: jest.fn(async (_q: Prisma.Sql) => [{ id: CORRETOR }]) };
  const servicoTx = {
    $queryRaw: jest.fn(async (q: Prisma.Sql) => {
      if (q.text.includes('salvar_conexao_asaas')) {
        if (o.salvar === 'erro') throw new Prisma.PrismaClientKnownRequestError('x', { code: 'P2010', clientVersion: 't', meta: { code: 'P0001', message: 'ERROR: conexão Asaas incompleta' } });
        return [{ id: 'con_1' }];
      }
      if (q.text.includes('select id::text as id, webhook_id, webhook_slug')) return o.existente ? [o.existente] : [];
      return [];
    }),
    $executeRaw: jest.fn(async (_q: Prisma.Sql) => 1),
  };
  const db = { run: jest.fn(async (_c: unknown, w: (t: typeof tenant) => unknown) => w(tenant)) };
  const servico = { run: jest.fn(async (w: (t: typeof servicoTx) => unknown) => w(servicoTx)) };
  return { svc: new AsaasConexaoService(db as never, servico as never, f as unknown as typeof fetch), chamadas, f, servicoTx };
}

const corpo = (api_key = API_KEY) => Object.assign(new ConectarAsaasDto(), { api_key, ambiente: 'sandbox' as const });

async function erroDe(p: Promise<unknown>) {
  try { await p; } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('não lançou');
}

describe('AsaasConexaoService', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.ASAAS_TOKEN_ENCRYPTION_KEY = CHAVE;
    process.env.ASAAS_WEBHOOK_URL_BASE = 'https://api.lotti.teste/';
  });
  afterEach(() => { process.env = { ...env }; jest.restoreAllMocks(); });

  it('conecta: webhook na URL da API (D6), 13 eventos, NON_SEQUENTIALLY, segredos cifrados no salvar', async () => {
    const { svc, chamadas, servicoTx } = montar();
    const r = await svc.conectar(claims, corpo());
    expect(r).toEqual({
      ok: true, balance: 10, aviso: null,
      conexao: {
        id: 'con_1', ambiente: 'sandbox', status: 'conectada', conta_nome: 'Imobiliária X', conta_email: 'conta@teste.local',
        chave_final: '9876', escopos_faltando: [], webhook_configurado: true,
      },
    });
    const wh = chamadas.find((c) => c.metodo === 'POST')!.corpo;
    expect(wh.url).toMatch(/^https:\/\/api\.lotti\.teste\/api\/financeiro\/asaas\/webhook\?t=[\w-]+$/);
    expect(wh.events).toEqual([...EVENTOS_WEBHOOK_ASAAS]);
    expect(wh.sendType).toBe('NON_SEQUENTIALLY');
    const salvar = servicoTx.$queryRaw.mock.calls.map((c) => c[0]).find((q) => q.text.includes('salvar_conexao_asaas'))!;
    expect(salvar.values).not.toContain(API_KEY);
    expect(salvar.values).toContain(wh.url.split('?t=')[1]);
    expect(salvar.values.filter((v) => typeof v === 'string' && v.startsWith('v1.'))).toHaveLength(2);
  });

  it('chave com espaço → 400 chave_invalida sem chamar fetch', async () => {
    const { svc, f } = montar();
    expect(await erroDe(svc.conectar(claims, corpo('$aact_chave com espaço no meio 123')))).toEqual({
      status: 400, body: { statusCode: 400, codigo: 'chave_invalida', message: 'A chave informada não tem um formato válido.' },
    });
    expect(f).not.toHaveBeenCalled();
  });

  it('401 do Asaas → 400 ASAAS_CHAVE_INVALIDA; 403 → ASAAS_PERMISSOES_INSUFICIENTES; 5xx → 502 ASAAS_REJEITOU_CONEXAO', async () => {
    const r401 = montar({ rotas: [['GET', /commercialInfo/, 401, {}]] });
    expect((await erroDe(r401.svc.conectar(claims, corpo())))).toMatchObject({ status: 400, body: { codigo: 'ASAAS_CHAVE_INVALIDA' } });
    const r403 = montar({ rotas: [OK[0], ['GET', /^\/customers/, 403, {}]] });
    expect((await erroDe(r403.svc.conectar(claims, corpo())))).toMatchObject({ status: 400, body: { codigo: 'ASAAS_PERMISSOES_INSUFICIENTES' } });
    const r500 = montar({ rotas: [OK[0], ['GET', /^\/customers/, 503, { errors: [{ description: 'fora do ar' }] }]] });
    expect((await erroDe(r500.svc.conectar(claims, corpo())))).toEqual({
      status: 502, body: { statusCode: 502, codigo: 'ASAAS_REJEITOU_CONEXAO', message: 'A Asaas não aceitou a conexão: fora do ar' },
    });
  });

  it("403 em /finance/balance → status sem_permissao com ['FINANCIAL_TRANSACTION:READ']", async () => {
    const { svc } = montar({ rotas: OK.map((r) => (r[1].source.includes('balance') ? ['GET', r[1], 403, {}] : r)) });
    const r = await svc.conectar(claims, corpo()) as { balance: unknown; conexao: Record<string, unknown> };
    expect(r.balance).toBeNull();
    expect(r.conexao.status).toBe('sem_permissao');
    expect(r.conexao.escopos_faltando).toEqual(['FINANCIAL_TRANSACTION:READ']);
  });

  it('sem ASAAS_WEBHOOK_URL_BASE → 503 sem chamar fetch', async () => {
    delete process.env.ASAAS_WEBHOOK_URL_BASE;
    const { svc, f } = montar();
    expect((await erroDe(svc.conectar(claims, corpo()))).status).toBe(503);
    expect(f).not.toHaveBeenCalled();
  });

  it('falha do salvar_conexao_asaas apaga o webhook criado e responde 500 ASAAS_CONEXAO_FALHOU', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { svc, chamadas } = montar({ salvar: 'erro' });
    expect(await erroDe(svc.conectar(claims, corpo()))).toEqual({
      status: 500, body: { statusCode: 500, codigo: 'ASAAS_CONEXAO_FALHOU', message: 'Não foi possível salvar a conexão com a Asaas. Tente de novo.' },
    });
    expect(chamadas.at(-1)).toMatchObject({ metodo: 'DELETE', caminho: '/webhooks/wh_1' });
  });

  it('desconectar sem conexão → { ok, aviso: null } sem fetch; com chave ilegível vira aviso e apaga localmente', async () => {
    const sem = montar();
    expect(await sem.svc.desconectar(claims)).toEqual({ ok: true, aviso: null });
    expect(sem.f).not.toHaveBeenCalled();
    const com = montar({ existente: { id: 'con_1', webhook_id: 'wh_1', webhook_slug: 's' } });
    expect(await com.svc.desconectar(claims)).toEqual({
      ok: true, aviso: 'A conexão foi removida da Lotti, mas confira o webhook antigo no painel do Asaas.',
    });
    expect((com.servicoTx.$executeRaw.mock.calls[0][0]).text).toContain('delete from public.asaas_conexoes where corretor_id = $1::uuid');
  });

  it('nenhum log carrega chave, token ou e-mail da conta', async () => {
    const espioes = (['log', 'error', 'warn'] as const).map((m) => jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined));
    const { svc } = montar({ salvar: 'erro' });
    await erroDe(svc.conectar(claims, corpo()));
    const tudo = JSON.stringify(espioes.flatMap((s) => s.mock.calls));
    expect(tudo).not.toContain(API_KEY);
    expect(tudo).not.toContain('conta@teste.local');
    expect(tudo).not.toContain('v1.');
  });
});
