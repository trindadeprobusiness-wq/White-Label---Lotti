// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE = 'https://api.exemplo.com';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

/** Importa o módulo fresco (instância nova do clienteAuth) com VITE_API_URL ligada. */
async function carregar() {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', BASE);
  return import('./auth');
}

/** Responde /login|/refresh com o token (camelCase, como o controller) e /me com as claims. */
function rotear(token: { accessToken: string; expiresIn?: number }, claims: unknown) {
  fetchMock.mockImplementation((url: string) => {
    if (url.endsWith('/api/auth/me')) return Promise.resolve(json(claims));
    return Promise.resolve(json(token));
  });
}

const chamada = (i: number) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, method: init?.method ?? 'GET', init };
};

const CLAIMS = { sub: 'user-uuid-1', email: 'a@b.com', role: 'authenticated' };

describe('clienteAuth — login próprio da API', () => {
  it('login: emite token em memória, monta sessão com sub preservado e manda credentials', async () => {
    const { clienteAuth } = await carregar();
    rotear({ accessToken: 'acc-1', expiresIn: 900 }, CLAIMS);

    const r = await clienteAuth.login('a@b.com', 'segredo');

    expect(r).toEqual({ ok: true });
    expect(clienteAuth.obterAccessToken()).toBe('acc-1');
    const sessao = clienteAuth.obterSessao();
    expect(sessao?.user.id).toBe('user-uuid-1');
    expect(sessao?.user.email).toBe('a@b.com');
    expect(sessao?.access_token).toBe('acc-1');

    // /login com corpo {email,senha} e credentials:'include' (cookie de refresh).
    const login = chamada(0);
    expect(login.url).toBe(`${BASE}/api/auth/login`);
    expect(login.method).toBe('POST');
    expect(login.init.credentials).toBe('include');
    expect(JSON.parse(login.init.body as string)).toEqual({ email: 'a@b.com', senha: 'segredo' });
    // /me vai com o Bearer do access recém-emitido.
    const me = chamada(1);
    expect(me.url).toBe(`${BASE}/api/auth/me`);
    expect((me.init.headers as Record<string, string>).Authorization).toBe('Bearer acc-1');
  });

  it('login: erro vira mensagem única e genérica, sem sessão (não vaza existência)', async () => {
    const { clienteAuth } = await carregar();
    fetchMock.mockResolvedValue(json({ message: 'invalid' }, 401));

    const r = await clienteAuth.login('a@b.com', 'errada');

    expect(r.ok).toBe(false);
    expect(r.erro).toBe('E-mail ou senha incorretos.');
    expect(clienteAuth.obterSessao()).toBeNull();
    expect(clienteAuth.obterAccessToken()).toBeNull();
    // Falhou no /login; nunca chegou a chamar /me.
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it('aoMudar: notifica o ouvinte no login e no logout', async () => {
    const { clienteAuth } = await carregar();
    const visto: Array<string | null> = [];
    clienteAuth.aoMudar((s) => visto.push(s?.user.id ?? null));

    rotear({ accessToken: 'acc-1', expiresIn: 900 }, CLAIMS);
    await clienteAuth.login('a@b.com', 'segredo');

    fetchMock.mockResolvedValue(json({ ok: true }));
    await clienteAuth.logout();

    expect(visto).toEqual(['user-uuid-1', null]);
    expect(clienteAuth.obterSessao()).toBeNull();
  });

  it('restaurar: recupera a sessão pelo cookie de refresh (POST /refresh sem corpo)', async () => {
    const { clienteAuth } = await carregar();
    rotear({ accessToken: 'acc-2', expiresIn: 900 }, CLAIMS);

    const sessao = await clienteAuth.restaurar();

    expect(sessao?.user.id).toBe('user-uuid-1');
    const refresh = chamada(0);
    expect(refresh.url).toBe(`${BASE}/api/auth/refresh`);
    expect(refresh.method).toBe('POST');
    expect(refresh.init.credentials).toBe('include');
    expect(refresh.init.body).toBeUndefined();
  });

  it('refresh: falha derruba a sessão e notifica null', async () => {
    const { clienteAuth } = await carregar();
    rotear({ accessToken: 'acc-1', expiresIn: 900 }, CLAIMS);
    await clienteAuth.login('a@b.com', 'segredo');
    expect(clienteAuth.obterSessao()).not.toBeNull();

    const visto: Array<string | null> = [];
    clienteAuth.aoMudar((s) => visto.push(s?.user.id ?? null));
    fetchMock.mockResolvedValue(json({ message: 'reuse' }, 401));

    const ok = await clienteAuth.refresh();

    expect(ok).toBe(false);
    expect(clienteAuth.obterSessao()).toBeNull();
    expect(visto).toEqual([null]);
  });

  it('refresh automático: agendado pouco antes do vencimento renova o access', async () => {
    vi.useFakeTimers();
    const { clienteAuth } = await carregar();
    rotear({ accessToken: 'acc-1', expiresIn: 900 }, CLAIMS);
    await clienteAuth.login('a@b.com', 'segredo');

    rotear({ accessToken: 'acc-2', expiresIn: 900 }, CLAIMS);
    // 900s - 60s de folga = 840s.
    await vi.advanceTimersByTimeAsync(840_000);

    expect(clienteAuth.obterAccessToken()).toBe('acc-2');
    expect(fetchMock.mock.calls.some(([u]) => (u as string).endsWith('/api/auth/refresh'))).toBe(true);
  });

  it('pedirRecuperacao: sempre resposta genérica de sucesso, mesmo em falha de rede', async () => {
    const { clienteAuth } = await carregar();
    fetchMock.mockRejectedValue(new Error('rede caiu'));

    const r = await clienteAuth.pedirRecuperacao('qualquer@b.com');

    expect(r).toEqual({ ok: true, erro: undefined });
  });

  it('definirNovaSenha: 503 (desabilitada) vira erro genérico; 200 vira sucesso', async () => {
    const { clienteAuth } = await carregar();

    fetchMock.mockResolvedValue(json({}, 503));
    const off = await clienteAuth.definirNovaSenha('tok', 'novaSenha1');
    expect(off.ok).toBe(false);
    expect(off.erro).toBeTruthy();

    fetchMock.mockResolvedValue(json({ ok: true }));
    const ok = await clienteAuth.definirNovaSenha('tok', 'novaSenha1');
    expect(ok).toEqual({ ok: true });
  });

  it('logout: idempotente mesmo se a rede falhar, limpa estado local', async () => {
    const { clienteAuth } = await carregar();
    rotear({ accessToken: 'acc-1', expiresIn: 900 }, CLAIMS);
    await clienteAuth.login('a@b.com', 'segredo');

    fetchMock.mockRejectedValue(new Error('offline'));
    await clienteAuth.logout();

    expect(clienteAuth.obterSessao()).toBeNull();
    expect(clienteAuth.obterAccessToken()).toBeNull();
  });
});
