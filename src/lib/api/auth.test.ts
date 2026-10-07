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

  it('definirNovaSenha: POST /definir-senha com o token do link e, no sucesso, já entra (sessão montada)', async () => {
    const { clienteAuth } = await carregar();
    rotear({ accessToken: 'acc-senha', expiresIn: 900 }, CLAIMS);

    await expect(clienteAuth.definirNovaSenha('tok-do-link', 'novaSenha1')).resolves.toEqual({ ok: true });

    const def = chamada(0);
    expect(def.url).toBe(`${BASE}/api/auth/definir-senha`);
    expect(def.method).toBe('POST');
    expect(def.init.credentials).toBe('include');
    expect(JSON.parse(def.init.body as string)).toEqual({ token: 'tok-do-link', senha: 'novaSenha1' });
    expect(clienteAuth.obterAccessToken()).toBe('acc-senha');
    expect(clienteAuth.obterSessao()?.user.id).toBe('user-uuid-1');
  });

  it('definirNovaSenha: link vencido/limite mostram o texto da API; 5xx, rede e link sem token viram genéricos', async () => {
    const { clienteAuth } = await carregar();

    expect((await clienteAuth.definirNovaSenha('', 'novaSenha1')).erro).toMatch(/expirou ou já foi usado/);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(json({ codigo: 'link_invalido', message: 'Este link expirou ou já foi usado. Peça um novo.' }, 400));
    expect((await clienteAuth.definirNovaSenha('tok', 'novaSenha1')).erro).toBe('Este link expirou ou já foi usado. Peça um novo.');
    fetchMock.mockResolvedValueOnce(json({ message: 'Muitas tentativas em pouco tempo.' }, 429));
    expect((await clienteAuth.definirNovaSenha('tok', 'novaSenha1')).erro).toBe('Muitas tentativas em pouco tempo.');
    fetchMock.mockResolvedValueOnce(json({ message: 'detalhe interno' }, 503));
    const off = await clienteAuth.definirNovaSenha('tok', 'novaSenha1');
    expect(off.ok).toBe(false);
    expect(off.erro).not.toContain('detalhe interno');
    fetchMock.mockRejectedValueOnce(new Error('rede caiu'));
    expect((await clienteAuth.definirNovaSenha('tok', 'novaSenha1')).ok).toBe(false);
    expect(clienteAuth.obterSessao()).toBeNull();
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

describe('clienteAuth — token para chamarApi', () => {
  const refreshes = () => fetchMock.mock.calls.filter(([u]) => (u as string).endsWith('/api/auth/refresh')).length;

  it('token em dia: devolve o da memória sem ir ao servidor', async () => {
    const { clienteAuth } = await carregar();
    rotear({ accessToken: 'acc-1', expiresIn: 900 }, CLAIMS);
    await clienteAuth.login('a@b.com', 'segredo');
    fetchMock.mockClear();

    await expect(clienteAuth.obterTokenValido()).resolves.toBe('acc-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('token vencido (aba que dormiu): renova pelo cookie antes de devolver', async () => {
    vi.useFakeTimers();
    const { clienteAuth } = await carregar();
    rotear({ accessToken: 'acc-1', expiresIn: 900 }, CLAIMS);
    await clienteAuth.login('a@b.com', 'segredo');
    // Relógio pula 20 min sem o timer rodar (computador suspenso).
    vi.setSystemTime(Date.now() + 1_200_000);
    rotear({ accessToken: 'acc-2', expiresIn: 900 }, CLAIMS);

    await expect(clienteAuth.obterTokenValido()).resolves.toBe('acc-2');
    expect(refreshes()).toBe(1);
  });

  it('sem sessão em memória (boot): tenta o cookie; sem cookie válido devolve null', async () => {
    const { clienteAuth } = await carregar();
    fetchMock.mockResolvedValue(json({ message: 'sem cookie' }, 401));
    await expect(clienteAuth.obterTokenValido()).resolves.toBeNull();
    expect(refreshes()).toBe(1);
  });

  it('chamadas simultâneas com token vencido fazem UM refresh só (rotação não vira "reuso")', async () => {
    const { clienteAuth } = await carregar();
    rotear({ accessToken: 'acc-9', expiresIn: 900 }, CLAIMS);
    const tokens = await Promise.all([clienteAuth.obterTokenValido(), clienteAuth.obterTokenValido(), clienteAuth.restaurar()]);
    expect(tokens[0]).toBe('acc-9');
    expect(tokens[1]).toBe('acc-9');
    expect(refreshes()).toBe(1);
  });

  it('renovarAposRecusa: se outra chamada já renovou, usa o novo sem outro refresh', async () => {
    const { clienteAuth } = await carregar();
    rotear({ accessToken: 'acc-1', expiresIn: 900 }, CLAIMS);
    await clienteAuth.login('a@b.com', 'segredo');
    rotear({ accessToken: 'acc-2', expiresIn: 900 }, CLAIMS);

    await expect(clienteAuth.renovarAposRecusa('acc-0')).resolves.toBe('acc-1');
    expect(refreshes()).toBe(0);
    await expect(clienteAuth.renovarAposRecusa('acc-1')).resolves.toBe('acc-2');
    expect(refreshes()).toBe(1);
  });
});

describe('clienteAuth — cadastro', () => {
  const DADOS = { email: 'nova@b.com', senha: 'segredo1', nome: 'Nova', cnpj: '11.222.333/0001-81', telefone: '(62) 99999-0000' };

  it('POST /cadastro com credentials e, no sucesso, já entra (sessão montada)', async () => {
    const { clienteAuth } = await carregar();
    rotear({ accessToken: 'acc-novo', expiresIn: 900 }, CLAIMS);

    await expect(clienteAuth.cadastrar(DADOS)).resolves.toEqual({ ok: true });

    const cad = chamada(0);
    expect(cad.url).toBe(`${BASE}/api/auth/cadastro`);
    expect(cad.method).toBe('POST');
    expect(cad.init.credentials).toBe('include');
    expect(JSON.parse(cad.init.body as string)).toEqual(DADOS);
    expect(clienteAuth.obterAccessToken()).toBe('acc-novo');
    expect(clienteAuth.obterSessao()?.user.id).toBe('user-uuid-1');
  });

  it('409, 400 e 429 mostram o texto da API; 5xx vira mensagem genérica', async () => {
    const { clienteAuth } = await carregar();
    fetchMock.mockResolvedValueOnce(json({ message: 'Não foi possível criar a conta com este e-mail.' }, 409));
    expect((await clienteAuth.cadastrar(DADOS)).erro).toBe('Não foi possível criar a conta com este e-mail.');
    fetchMock.mockResolvedValueOnce(json({ message: ['CNPJ inválido', 'Telefone inválido'] }, 400));
    expect((await clienteAuth.cadastrar(DADOS)).erro).toBe('CNPJ inválido Telefone inválido');
    fetchMock.mockResolvedValueOnce(json({ message: 'Muitas tentativas em pouco tempo.' }, 429));
    expect((await clienteAuth.cadastrar(DADOS)).erro).toBe('Muitas tentativas em pouco tempo.');
    fetchMock.mockResolvedValueOnce(json({ message: 'detalhe interno' }, 500));
    const r = await clienteAuth.cadastrar(DADOS);
    expect(r.ok).toBe(false);
    expect(r.erro).not.toContain('detalhe interno');
    expect(clienteAuth.obterSessao()).toBeNull();
  });
});
