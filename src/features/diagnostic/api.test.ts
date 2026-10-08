/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A conversa é pública: nunca usa o login próprio nem a sessão do Supabase.
vi.mock('@/lib/api/auth', () => ({ clienteAuth: { obterTokenValido: vi.fn(), renovarAposRecusa: vi.fn() } }));

const API = 'https://api.exemplo.com';
const SUPABASE = 'https://projeto.supabase.co';
const identidade = { session_id: '11111111-1111-4111-8111-111111111111', token: 'a'.repeat(64) };
const snapshot = {
  session: { id: identidade.session_id, status: 'started', started_at: '2026-10-08T12:00:00+00:00', last_activity_at: '2026-10-08T12:00:00+00:00', completed_at: null, version: 0 },
  answers: {},
  next_question: { id: 'name', prompt: 'Fala! Antes de qualquer coisa, como posso te chamar?', type: 'text', placeholder: 'Seu nome', maxLength: 100 },
  summary: null,
  cta_requested: false,
};
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

async function carregar(ambiente: { api?: string; supabase?: string; chave?: string }) {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', ambiente.api ?? '');
  vi.stubEnv('VITE_SUPABASE_URL', ambiente.supabase ?? '');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', ambiente.chave ?? '');
  return import('./api');
}

describe('diagnosticRequest', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const chamada = (i = 0) => {
    const init = (fetchMock.mock.calls[i][1] ?? {}) as RequestInit & { headers: Record<string, string> };
    return { url: fetchMock.mock.calls[i][0] as string, method: init.method, headers: init.headers, corpo: JSON.parse(String(init.body)) };
  };

  it('com VITE_API_URL vai para a rota pública da API, sem apikey nem Authorization', async () => {
    const { diagnosticRequest } = await carregar({ api: `${API}/`, supabase: SUPABASE, chave: 'chave-publica' });
    fetchMock.mockResolvedValueOnce(json(snapshot));
    const r = await diagnosticRequest(identidade, { action: 'start', consent: true, tracking: { utm_source: 'ig' } });
    expect(r.next_question?.id).toBe('name');
    const c = chamada();
    expect(c.url).toBe(`${API}/api/publico/diagnostico`);
    expect(c.method).toBe('POST');
    expect(c.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(c.corpo).toEqual({ action: 'start', consent: true, tracking: { utm_source: 'ig' }, ...identidade });
  });

  it('sem VITE_API_URL segue na Edge Function do Supabase com a apikey', async () => {
    const { diagnosticRequest } = await carregar({ supabase: `${SUPABASE}/`, chave: 'chave-publica' });
    fetchMock.mockResolvedValueOnce(json(snapshot));
    await diagnosticRequest(identidade, { action: 'resume' });
    const c = chamada();
    expect(c.url).toBe(`${SUPABASE}/functions/v1/diagnostic`);
    expect(c.headers).toEqual({ 'Content-Type': 'application/json', apikey: 'chave-publica' });
    expect(c.corpo).toEqual({ action: 'resume', ...identidade });
  });

  it('sem nenhum destino configurado: indisponível, sem rede', async () => {
    const { diagnosticRequest, DiagnosticApiError } = await carregar({});
    await expect(diagnosticRequest(identidade, { action: 'resume' })).rejects.toBeInstanceOf(DiagnosticApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('os erros da API chegam com o mesmo tratamento da Edge ({ error } e status)', async () => {
    const { diagnosticRequest } = await carregar({ api: API });
    fetchMock.mockResolvedValueOnce(json({ error: 'Confira seu WhatsApp, incluindo o DDD.' }, 400));
    await expect(diagnosticRequest(identidade, { action: 'answer' })).rejects.toMatchObject({ message: 'Confira seu WhatsApp, incluindo o DDD.', status: 400 });
    fetchMock.mockResolvedValueOnce(json({ error: 'Muitas tentativas. Aguarde um pouco e tente novamente.' }, 429));
    await expect(diagnosticRequest(identidade, { action: 'answer' })).rejects.toMatchObject({ message: 'Vamos com calma. Aguarde um minuto e tente novamente.', status: 429 });
    fetchMock.mockResolvedValueOnce(json({ error: 'Sessão não encontrada.' }, 404));
    await expect(diagnosticRequest(identidade, { action: 'resume' })).rejects.toMatchObject({ status: 404 });
    fetchMock.mockResolvedValueOnce(json({ error: 'Diagnóstico temporariamente indisponível. Tente novamente.' }, 503));
    await expect(diagnosticRequest(identidade, { action: 'answer' })).rejects.toMatchObject({
      message: 'Não conseguimos salvar agora. Sua resposta continua aqui. Tente novamente.', status: 503,
    });
  });
});
