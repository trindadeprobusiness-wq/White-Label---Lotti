// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Modo API (bloco B1): o diagnóstico fala com a rota pública da API, sem apikey do Supabase.
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true }));

const BASE = 'https://api.exemplo.com';
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));

async function carregar() {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', `${BASE}/`);
  vi.stubEnv('VITE_SUPABASE_URL', 'https://supabase.exemplo.co');
  return (await import('./CommercialDiagnostic')).default;
}

beforeEach(() => { sessionStorage.clear(); fetchMock.mockClear(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('CommercialDiagnostic com a API', () => {
  it('o evento de início vai para POST /api/diagnostico-comercial, com o mesmo corpo e sem apikey', async () => {
    const Pagina = await carregar();
    render(<MemoryRouter><Pagina /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Começar diagnóstico/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(`${BASE}/api/diagnostico-comercial`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toMatchObject({ action: 'event', event: 'diagnostic_started' });
  });
});
