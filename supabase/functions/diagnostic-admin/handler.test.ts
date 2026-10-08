import { describe, expect, it, vi } from 'vitest';
import { createDiagnosticAdminHandler } from './handler.ts';
const request = (body: unknown, authorization = `Bearer ${'x'.repeat(64)}`) => new Request('https://local.test', { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body) });
describe('Railway-authenticated diagnostic backend', () => {
  it('requires a verified current admin role before touching lead data', async () => {
    const rpc = vi.fn(async () => ({ data: {}, error: null }));
    for (const response of [new Response('{}', { status: 401 }), Response.json([]), Response.json({ roles: ['admin'] })]) {
      const handler = createDiagnosticAdminHandler({ client: { rpc }, authApiUrl: 'https://api.example.test', fetch: async () => response });
      expect([401,403]).toContain((await handler(request({ action: 'list', roles: ['super_admin'] }))).status);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it('uses the pinned login API, validates filters and passes only configured operations to the database', async () => {
    const rpc = vi.fn(async () => ({ data: { items: [] }, error: null }));
    const authFetch = vi.fn(async () => Response.json(['super_admin']));
    const handler = createDiagnosticAdminHandler({ client: { rpc }, authApiUrl: 'https://api.example.test', fetch: authFetch });
    expect((await handler(request({ action: 'list', filters: { search: 'Pessoa', page: 2 } }))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('diagnostic_admin_list', expect.objectContaining({ _search: 'Pessoa', _offset: 25, _limit: 25 }));
    expect(String(authFetch.mock.calls[0][0])).toBe('https://api.example.test/api/admin/papeis');
    expect((await handler(request({ action: 'detail', session_id: 'sql-injection' }))).status).toBe(400);
    expect((await handler(request({ action: 'list', filters: { page: -1 } }))).status).toBe(400);
    expect((await handler(request({ action: 'follow_up', session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'contacted', notes: 'x'.repeat(3001) }))).status).toBe(400);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('fails closed when authentication is unavailable', async () => {
    const rpc = vi.fn(async () => ({ data: {}, error: null }));
    const handler = createDiagnosticAdminHandler({ client: { rpc }, authApiUrl: 'https://api.example.test', fetch: async () => { throw new Error('offline'); } });
    expect((await handler(request({ action: 'list' }))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
});
