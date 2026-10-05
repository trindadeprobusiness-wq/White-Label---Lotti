import { randomBytes } from 'node:crypto';
import { HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cifrar } from './asaas-crypto';
import { sha256Hex } from './asaas-regras';
import { AsaasWebhookService } from './asaas-webhook.service';

const CORRETOR = '55555555-5555-4555-8555-555555555555';
const CHAVE = randomBytes(32).toString('hex');
const TOKEN = 'token-do-webhook-1234567890';

function montar(o: { insertErro?: string; reserva?: unknown[] } = {}) {
  const tx = {
    $queryRaw: jest.fn(async (q: Prisma.Sql) => {
      if (q.text.includes('where c.webhook_slug')) {
        return q.values[0] === 'slug-a' ? [{ corretor_id: CORRETOR, webhook_token_ciphertext: cifrar(TOKEN, CHAVE) }] : [];
      }
      if (q.text.includes('insert into public.asaas_webhook_events')) {
        if (o.insertErro) throw new Prisma.PrismaClientKnownRequestError('x', { code: 'P2010', clientVersion: 't', meta: { code: o.insertErro, message: 'ERROR: dup' } });
        return [{ id: 'ev_1' }];
      }
      if (q.text.includes("set status = 'PROCESSING'")) return o.reserva ?? [];
      return [];
    }),
    $executeRaw: jest.fn(async (_q: Prisma.Sql) => 1),
  };
  const servico = { run: jest.fn(async (w: (t: typeof tx) => unknown) => w(tx)) };
  const svc = new AsaasWebhookService(servico as never);
  const agendados: string[] = [];
  svc.agendar = (id) => { agendados.push(id); };
  return { svc, tx, servico, agendados };
}

async function erroDe(p: Promise<unknown>) {
  try { await p; } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() };
    throw e;
  }
  throw new Error('não lançou');
}

const RECUSADO = { status: 401, body: { statusCode: 401, codigo: 'webhook_recusado', message: 'Não autorizado.' } };

describe('AsaasWebhookService', () => {
  const env = { ...process.env };
  beforeEach(() => { process.env.ASAAS_TOKEN_ENCRYPTION_KEY = CHAVE; });
  afterEach(() => { process.env = { ...env }; jest.restoreAllMocks(); });

  it('sem slug → 401 (D5: sem webhook global), sem tocar no banco', async () => {
    process.env.ASAAS_WEBHOOK_TOKEN = TOKEN;
    const { svc, servico } = montar();
    expect(await erroDe(svc.receber(null, { 'asaas-access-token': TOKEN }, {}))).toEqual(RECUSADO);
    expect(servico.run).not.toHaveBeenCalled();
  });

  it('token errado, ausente ou slug desconhecido → 401', async () => {
    const { svc } = montar();
    expect(await erroDe(svc.receber('slug-a', { 'asaas-access-token': 'outro' }, {}))).toEqual(RECUSADO);
    expect(await erroDe(svc.receber('slug-a', {}, {}))).toEqual(RECUSADO);
    expect(await erroDe(svc.receber('slug-x', { 'asaas-access-token': TOKEN }, {}))).toEqual(RECUSADO);
  });

  it('sem chave de cifra → 503', async () => {
    delete process.env.ASAAS_TOKEN_ENCRYPTION_KEY;
    const { svc } = montar();
    expect((await erroDe(svc.receber('slug-a', { 'asaas-access-token': TOKEN }, {}))).status).toBe(503);
  });

  it('aceita x-hook-token, grava RECEIVED com o dono e agenda o processamento', async () => {
    const { svc, tx, agendados } = montar();
    const payload = { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', dateCreated: '2026-10-05' } };
    expect(await svc.receber('slug-a', { 'x-hook-token': TOKEN }, payload)).toEqual({ received: true });
    const ins = tx.$queryRaw.mock.calls.map((c) => c[0]).find((q) => q.text.includes('insert into public.asaas_webhook_events'))!;
    expect(ins.values).toEqual([sha256Hex('PAYMENT_RECEIVED:pay_1:2026-10-05'), 'PAYMENT_RECEIVED', 'pay_1', JSON.stringify(payload), CORRETOR]);
    expect(agendados).toEqual(['ev_1']);
  });

  it('duplicado (23505) → 200 duplicate, sem agendar', async () => {
    const { svc, agendados } = montar({ insertErro: '23505' });
    expect(await svc.receber('slug-a', { 'asaas-access-token': TOKEN }, { id: 'evt_1' })).toEqual({ received: true, duplicate: true });
    expect(agendados).toEqual([]);
  });

  it('reserva sem linha não processa nada', async () => {
    const { svc, servico, tx } = montar({ reserva: [] });
    await svc.processar('ev_1');
    expect(servico.run).toHaveBeenCalledTimes(1);
    const q = tx.$queryRaw.mock.calls[0][0];
    expect(q.text).toContain("where id = $1::uuid and status in ('RECEIVED', 'FAILED')");
    expect(q.text).toContain('attempts = attempts + 1');
  });

  it('evento sem payment é IGNORED no terceiro run; nada de payload no log', async () => {
    const espiao = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { svc, tx } = montar({ reserva: [{ event_type: 'ACCOUNT_STATUS', payload: { segredo: 'nao-logar' }, corretor_id: CORRETOR }] });
    await svc.processar('ev_1');
    const final = tx.$executeRaw.mock.calls.at(-1)![0];
    expect(final.text).toContain('processed_at = now()');
    expect(final.values[0]).toBe('IGNORED');
    expect(JSON.stringify(espiao.mock.calls)).not.toContain('nao-logar');
  });

  it('UPDATE que precisava afetar linha e não afetou → FAILED com o código', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { svc, tx } = montar({ reserva: [{ event_type: 'PAYMENT_RECEIVED', payload: { payment: { id: 'pay_1' } }, corretor_id: CORRETOR }] });
    tx.$queryRaw.mockImplementation(async (q: Prisma.Sql) => {
      if (q.text.includes("set status = 'PROCESSING'")) return [{ event_type: 'PAYMENT_RECEIVED', payload: { payment: { id: 'pay_1' } }, corretor_id: CORRETOR }];
      if (q.text.includes('where f.external_id')) return [{ f: { id: 'f1', corretor_id: CORRETOR, status: 'PENDENTE' } }];
      return [];
    });
    tx.$executeRaw.mockImplementation(async (q: Prisma.Sql) => (q.text.includes('update public.faturas_aluguel') ? 0 : 1));
    await svc.processar('ev_1');
    const final = tx.$executeRaw.mock.calls.at(-1)![0];
    expect(final.values).toEqual(['FAILED', 'fatura_nao_atualizada', 'fatura_nao_atualizada', 'ev_1']);
  });
});
