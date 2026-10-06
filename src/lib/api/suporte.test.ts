// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAVE_SUPORTE, type SessaoSuporte } from '@/lib/admin/suporte';

// O token do administrador vem do login próprio (clienteAuth). Durante o atendimento (aba com a
// sessão em sessionStorage) os dados da conta atendida só podem ir com o token de atendimento.
const auth = vi.hoisted(() => ({
  obterTokenValido: vi.fn(async (): Promise<string | null> => 'tok-admin'),
  renovarAposRecusa: vi.fn(async (_usado: string): Promise<string | null> => 'tok-admin-novo'),
}));
vi.mock('@/lib/api/auth', () => ({ clienteAuth: auth }));

const BASE = 'https://api.exemplo.com';
const sessao = (extra: Partial<SessaoSuporte> = {}): SessaoSuporte => ({
  id: 'sessao-1', corretor_id: 'corretor-1', nome: 'Conta Atendida',
  expira_em: new Date(Date.now() + 30 * 60_000).toISOString(),
  user: { id: 'titular-1', email: 'titular@x.com' } as SessaoSuporte['user'],
  token: 'tok-atendimento',
  ...extra,
});
const emAtendimento = (s: SessaoSuporte = sessao()) => sessionStorage.setItem(CHAVE_SUPORTE, JSON.stringify(s));

async function carregar() {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', BASE);
  return { api: await import('@/lib/api'), suporte: await import('./suporte') };
}

const fetchMock = vi.fn();
beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  auth.obterTokenValido.mockReset().mockResolvedValue('tok-admin');
  auth.renovarAposRecusa.mockReset().mockResolvedValue('tok-admin-novo');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const bearer = (i: number) => (fetchMock.mock.calls[i][1].headers as Record<string, string>).Authorization;

describe('chamarApi / obterTokenApi durante o atendimento', () => {
  it('usa o token de atendimento e nunca consulta o login do administrador', async () => {
    const { api } = await carregar();
    emAtendimento();
    fetchMock.mockResolvedValueOnce(new Response('[]', { status: 200 }));
    await api.chamarApi('/api/clientes');
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/clientes`);
    expect(bearer(0)).toBe('Bearer tok-atendimento');
    expect(await api.obterTokenApi()).toBe('tok-atendimento');
    expect(auth.obterTokenValido).not.toHaveBeenCalled();
  });

  it('401/403 do servidor (sessão encerrada) voltam como vieram: sem renovar e sem trocar para o token do administrador', async () => {
    const { api } = await carregar();
    emAtendimento();
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 })).mockResolvedValueOnce(new Response('{}', { status: 403 }));
    expect((await api.chamarApi('/api/clientes', { method: 'PATCH', body: '{}' })).status).toBe(401);
    expect((await api.chamarApi('/api/clientes')).status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.renovarAposRecusa).not.toHaveBeenCalled();
    expect(auth.obterTokenValido).not.toHaveBeenCalled();
  });

  it('atendimento vencido ou sem token (sessão do Supabase) → erro, sem chamar a API nem usar o token do administrador', async () => {
    const { api } = await carregar();
    emAtendimento(sessao({ expira_em: new Date(Date.now() - 1000).toISOString() }));
    await expect(api.chamarApi('/api/clientes')).rejects.toThrow('O atendimento expirou');
    await expect(api.obterTokenApi()).rejects.toThrow('O atendimento expirou');
    emAtendimento(sessao({ token: undefined }));
    await expect(api.chamarApi('/api/clientes')).rejects.toThrow('O atendimento expirou');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(auth.obterTokenValido).not.toHaveBeenCalled();
  });

  it('fora do atendimento segue o login próprio (com a renovação de sempre)', async () => {
    const { api } = await carregar();
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 })).mockResolvedValueOnce(new Response('{}', { status: 200 }));
    expect((await api.chamarApi('/api/clientes')).status).toBe(200);
    expect(bearer(0)).toBe('Bearer tok-admin');
    expect(bearer(1)).toBe('Bearer tok-admin-novo');
  });

  it('chamarApiAdministrador vai com o token do administrador mesmo na aba de atendimento', async () => {
    const { api } = await carregar();
    emAtendimento();
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await api.chamarApiAdministrador('/api/admin/suporte/encerrar', { method: 'POST' });
    expect(bearer(0)).toBe('Bearer tok-admin');
  });
});

describe('abrirSuporteApi / encerrarSuporteApi', () => {
  const corpo = { ...sessao(), user: { id: 'titular-1', email: 'titular@x.com', aud: 'authenticated' } };

  it('abrir: POST com o corretor_id e o token do administrador; devolve a sessão com o token de atendimento', async () => {
    const { suporte } = await carregar();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(corpo), { status: 200 }));
    const r = await suporte.abrirSuporteApi('corretor-1');
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/admin/suporte/abrir`);
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ corretor_id: 'corretor-1' });
    expect(bearer(0)).toBe('Bearer tok-admin');
    expect(r).toMatchObject({ id: 'sessao-1', token: 'tok-atendimento', user: { id: 'titular-1' } });
  });

  it('abrir: erro da API chega com o texto dela; resposta sem token não vira sessão', async () => {
    const { suporte } = await carregar();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      statusCode: 403, codigo: 'conta_administrativa', message: 'Contas administrativas não podem ser abertas em modo de atendimento.',
    }), { status: 403 }));
    await expect(suporte.abrirSuporteApi('corretor-1')).rejects.toMatchObject({
      status: 403, codigo: 'conta_administrativa', message: 'Contas administrativas não podem ser abertas em modo de atendimento.',
    });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...corpo, token: undefined }), { status: 200 }));
    await expect(suporte.abrirSuporteApi('corretor-1')).rejects.toThrow('A sessão não foi criada.');
  });

  it('encerrar: POST com a sessão e o token do administrador, mesmo em atendimento; erro lança', async () => {
    const { suporte } = await carregar();
    emAtendimento();
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    await suporte.encerrarSuporteApi('sessao-1');
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/admin/suporte/encerrar`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ sessao_id: 'sessao-1' });
    expect(bearer(0)).toBe('Bearer tok-admin');
    fetchMock.mockResolvedValueOnce(new Response('{"statusCode":403,"message":"Não foi possível encerrar o atendimento."}', { status: 403 }));
    await expect(suporte.encerrarSuporteApi('sessao-1')).rejects.toThrow('Não foi possível encerrar o atendimento.');
  });
});
