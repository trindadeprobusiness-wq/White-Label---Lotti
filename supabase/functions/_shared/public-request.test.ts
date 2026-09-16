import { describe, expect, it, vi } from 'vitest';
import { readPublicJson, parseLead, consumeLeadLimit, publicLeadResponse, isTrustedIntegration, publicInteger } from './public-request';

describe('entrada pública de leads', () => {
  it('rejeita paginação negativa, infinita ou fracionária', () => {
    for (const value of ['-1', 'NaN', 'Infinity', '1.5', '999999999999999999999999']) {
      expect(() => publicInteger(value, 12, 1, 20)).toThrow();
    }
    expect(publicInteger(null, 12, 1, 20)).toBe(12);
    expect(publicInteger('20', 12, 1, 20)).toBe(20);
  });
  const valid = { nome: 'Cliente de teste', telefone: '(11) 99999-1234' };
  it('normaliza aliases sem permitir campos privilegiados ou metadados arbitrários', () => {
    const result = parseLead({ first_name: 'Teste', phone: '+55 11 99999-1234', corretor_id: 'attacker', tracking_data: { utm_source: 'site', role: 'admin' } });
    expect(result.telefone).toBe('5511999991234');
    expect(result.nome).toBe('Teste');
    expect(result.tracking).toEqual({ utm_source: 'site' });
    expect(result).not.toHaveProperty('corretor_id');
  });
  it.each([null, [], { ...valid, telefone: {} }, { ...valid, nome: 'a'.repeat(121) }, { ...valid, email: 'bad' }, { ...valid, imovel_id: 'not-uuid' }, { ...valid, tracking_data: [] }, { ...valid, mensagem: 'a'.repeat(2001) }])('rejeita payload inválido %j', (input) => {
    expect(() => parseLead(input)).toThrow();
  });
  it('não confunde dois IDs de imóvel', () => {
    expect(() => parseLead({ ...valid, imovel_id: '11111111-1111-4111-8111-111111111111' }, '22222222-2222-4222-8222-222222222222')).toThrow();
  });
  it('limita bytes reais mesmo sem Content-Length e com JSON malformado', async () => {
    await expect(readPublicJson(new Request('https://example.test', { method: 'POST', body: 'x'.repeat(17000) }))).rejects.toMatchObject({ status: 413 });
    await expect(readPublicJson(new Request('https://example.test', { method: 'POST', body: '{' }))).rejects.toMatchObject({ status: 400 });
  });
  it('limita corpo em streaming sem confiar em Content-Length declarado', async () => {
    const req = new Request('https://example.test', { method: 'POST', body: JSON.stringify({ text: 'é'.repeat(10000) }), headers: { 'Content-Length': '1' } });
    await expect(readPublicJson(req)).rejects.toMatchObject({ status: 413 });
  });
  it('usa limite persistente e não transmite telefone bruto para a RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await consumeLeadLimit({ rpc }, '5511999991234', 'test-secret');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('consume_public_lead_limit');
    expect(rpc.mock.calls[0][1]._subject_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('5511999991234');
  });
  it('bloqueia excesso e falha fechada se a RPC não estiver disponível', async () => {
    await expect(consumeLeadLimit({ rpc: vi.fn().mockResolvedValue({ data: false, error: null }) }, '5511999991234', 'key')).rejects.toMatchObject({ status: 429 });
    await expect(consumeLeadLimit({ rpc: vi.fn().mockResolvedValue({ error: {} }) }, '5511999991234', 'key')).rejects.toMatchObject({ status: 503 });
  });
  it('não revela identificação, existência ou cota para visitantes', () => {
    expect(publicLeadResponse(false, { cliente_id: 'private', is_new: true, qualificar_com_ia: true })).toEqual(publicLeadResponse(false, { cliente_id: 'other', is_new: false, qualificar_com_ia: false }));
    expect(publicLeadResponse(false, { cliente_id: 'private' })).not.toHaveProperty('cliente_id');
    expect(publicLeadResponse(true, { cliente_id: 'internal' })).toHaveProperty('cliente_id', 'internal');
  });
  it('detalhes exigem segredo de integração válido, nunca apenas anon key ou Origin', async () => {
    expect(await isTrustedIntegration(new Headers(), 'key')).toBe(false);
    await expect(isTrustedIntegration(new Headers({ 'x-n8n-secret': 'wrong' }), 'key')).rejects.toMatchObject({ status: 401 });
    await expect(isTrustedIntegration(new Headers({ 'x-n8n-secret': 'key' }), undefined)).rejects.toMatchObject({ status: 401 });
    expect(await isTrustedIntegration(new Headers({ 'x-n8n-secret': 'key' }), 'key')).toBe(true);
  });
});
