import { describe, expect, it, vi } from 'vitest';
import { createLeadHandler } from './handler';

function fixture(options: { existing?: boolean; rate?: boolean; rateError?: boolean; orphanError?: boolean; owners?: number; upsertError?: boolean } = {}) {
  const writes: { table: string; data: unknown }[] = [];
  const from = vi.fn((table: string) => {
    let operation = 'read';
    const result = () => {
      if (table === 'corretores') return { data: Array.from({ length: options.owners ?? 1 }, (_, i) => ({ id: `owner-${i}` })), error: null };
      if (table === 'leads_sem_destino') return { error: options.orphanError ? { message: 'private database details' } : null };
      return { data: [], error: null };
    };
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query), ilike: vi.fn(() => query), limit: vi.fn(() => query), gte: vi.fn(() => query),
      insert: vi.fn((data: unknown) => { operation = 'insert'; writes.push({ table, data }); return query; }),
      update: vi.fn((data: unknown) => { operation = 'update'; writes.push({ table, data }); return query; }),
      single: vi.fn(async () => result()), maybeSingle: vi.fn(async () => result()),
      then: (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  });
  const rpc = vi.fn(async (name: string, _args?: Record<string, unknown>) => {
    if (name === 'consume_public_lead_limit') return { data: options.rate ?? true, error: options.rateError ? { message: 'internal' } : null };
    // Busca pela chave do telefone e cadastro na mesma transação, no banco.
    if (name === 'lead_capture_upsert_cliente') return options.upsertError
      ? { data: null, error: { message: 'private database details' } }
      : { data: { cliente_id: 'private-client-id', created: !options.existing }, error: null };
    return { data: { permitido: false, limite: 0 }, error: null };
  });
  const client = { from, rpc } as unknown as Parameters<typeof createLeadHandler>[0];
  const handler = createLeadHandler(client, { integrationSecret: 'test-integration-secret', rateSecret: 'test-rate-secret' });
  return { handler, from, rpc, writes };
}
const payload = { nome: 'Contato teste', telefone: '11999991234' };
const request = (body: unknown = payload, headers = {}) => new Request('https://example.test', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('handler de captura pública', () => {
  it('recusa método e payload antes de consultar ou gravar no banco', async () => {
    const f = fixture();
    expect((await f.handler(new Request('https://example.test'))).status).toBe(405);
    expect((await f.handler(request({ telefone: {} }))).status).toBe(400);
    expect(f.from).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('bloqueia gravações quando o limite foi excedido ou está indisponível', async () => {
    for (const opts of [{ rate: false }, { rateError: true }]) {
      const f = fixture(opts);
      const response = await f.handler(request());
      expect(response.status).toBe(opts.rateError ? 503 : 429);
      expect(f.from).not.toHaveBeenCalled();
      expect(await response.text()).not.toContain('internal');
    }
  });
  it('respostas anônimas não diferenciam cliente novo, existente ou sem dono', async () => {
    const responses = [];
    for (const options of [{}, { existing: true }, { owners: 2 }]) {
      const f = fixture(options);
      const r = await f.handler(request());
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store');
      responses.push(await r.json());
    }
    expect(responses[0]).toEqual(responses[1]);
    expect(responses[0]).toEqual(responses[2]);
    expect(responses[0]).not.toHaveProperty('cliente_id');
  });
  it('não informa sucesso se o lead sem destino não foi salvo', async () => {
    const f = fixture({ owners: 2, orphanError: true });
    const r = await f.handler(request());
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('private database details');
  });
  it('preserva o contrato interno somente para integração autenticada', async () => {
    const f = fixture();
    const r = await f.handler(request(payload, { 'x-n8n-secret': 'test-integration-secret' }));
    expect(await r.json()).toMatchObject({ cliente_id: 'private-client-id', is_new: true, qualificar_com_ia: false });
    const invalid = fixture();
    expect((await invalid.handler(request(payload, { 'x-n8n-secret': 'wrong' }))).status).toBe(401);
    expect(invalid.from).not.toHaveBeenCalled();
  });
  it('não sobrescreve nome ou email de cliente existente por POST anônimo', async () => {
    const f = fixture({ existing: true });
    await f.handler(request({ ...payload, email: 'test@example.test' }));
    // O handler não escreve em clientes: a RPC só atualiza ultimo_contato e o
    // tracking_data de quem já existe (coberto no teste SQL).
    expect(f.writes.filter(w => w.table === 'clientes')).toEqual([]);
    expect(f.from).not.toHaveBeenCalledWith('clientes');
    const alerta = f.writes.find(w => w.table === 'alertas')?.data as { metadata?: { lead_type?: string } };
    expect(alerta?.metadata?.lead_type).toBe('returning');
  });
  it('procura e cadastra o cliente numa chamada só, pela chave do telefone, sem ilike', async () => {
    const f = fixture();
    await f.handler(request({ ...payload, email: 'test@example.test' }));
    const call = f.rpc.mock.calls.find(c => c[0] === 'lead_capture_upsert_cliente');
    expect(call?.[1]).toMatchObject({ p_corretor: 'owner-0', p_nome: 'Contato teste', p_telefone: '5511999991234', p_email: 'test@example.test' });
    expect(call?.[1]?.p_tracking).toMatchObject({ origem: 'landing_page' });
    expect(f.from).not.toHaveBeenCalledWith('clientes');
    const alerta = f.writes.find(w => w.table === 'alertas')?.data as { cliente_id?: string; metadata?: { lead_type?: string } };
    expect(alerta).toMatchObject({ cliente_id: 'private-client-id', metadata: { lead_type: 'new' } });
  });
  it('não informa sucesso se o cliente não foi salvo', async () => {
    const f = fixture({ upsertError: true });
    const r = await f.handler(request());
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('private database details');
    expect(f.writes.find(w => w.table === 'alertas')).toBeUndefined();
  });
  it('captura pública não consulta nem consome cota paga de IA', async () => {
    const f = fixture();
    await f.handler(request());
    expect(f.rpc.mock.calls.map(call => call[0])).toEqual(['consume_public_lead_limit', 'lead_capture_upsert_cliente']);
  });
  it('integração consulta permissão, mas não cobra IA antes da operação', async () => {
    const f = fixture();
    await f.handler(request(payload, { 'x-n8n-secret': 'test-integration-secret' }));
    expect(f.rpc.mock.calls.map(call => call[0])).toEqual(['consume_public_lead_limit', 'lead_capture_upsert_cliente', 'checar_cota']);
  });
});
