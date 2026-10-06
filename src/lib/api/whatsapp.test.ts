import { beforeEach, describe, expect, it, vi } from 'vitest';

const { chamarApi } = vi.hoisted(() => ({ chamarApi: vi.fn() }));
vi.mock('@/lib/api', () => ({ chamarApi }));

import { listarConversasApi, modoApi, whatsappBridgeApi } from './whatsapp';

beforeEach(() => chamarApi.mockReset());

describe('adaptador da API do WhatsApp', () => {
  it('usa a rota autenticada da ponte', async () => {
    chamarApi.mockResolvedValue(new Response(JSON.stringify({ state: 'connected' }), { status: 200 }));
    await expect(whatsappBridgeApi({ action: 'status' })).resolves.toEqual({ state: 'connected' });
    expect(chamarApi).toHaveBeenCalledWith('/api/whatsapp/bridge', expect.objectContaining({ method: 'POST' }));
  });

  it('mapeia leitura e mutação sem recorrer ao Supabase', async () => {
    chamarApi.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    await listarConversasApi();
    chamarApi.mockResolvedValue(new Response(JSON.stringify(true), { status: 200 }));
    await modoApi('conversa-1', 'human');
    expect(chamarApi.mock.calls.map((call) => call[0])).toEqual([
      '/api/whatsapp/conversas',
      '/api/whatsapp/conversas/conversa-1/modo',
    ]);
  });
});
