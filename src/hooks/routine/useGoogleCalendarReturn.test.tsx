/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGoogleCalendarReturn } from './useGoogleCalendarReturn';

const success = vi.fn();
const failure = vi.fn();
const invoke = vi.fn(() => Promise.resolve({ data: null, error: null }));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => success(...args),
    error: (...args: unknown[]) => failure(...args),
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

afterEach(() => {
  cleanup();
  success.mockReset();
  failure.mockReset();
  invoke.mockClear();
});

function Sonda() {
  useGoogleCalendarReturn();
  return <span data-testid="busca">{useLocation().search}</span>;
}

function renderizar(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/rotina" element={<Sonda />} />
          <Route path="/configuracoes" element={<Sonda />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('useGoogleCalendarReturn', () => {
  it('avisa e dispara a primeira sincronização quando o Google devolve conectado', () => {
    const { getByTestId } = renderizar('/rotina?google_calendar=connected');

    expect(success).toHaveBeenCalledTimes(1);
    expect(failure).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('google-calendar-sync', { body: { action: 'sync' } });
    // O parâmetro não pode sobreviver na URL: recarregar repetiria o aviso.
    expect(getByTestId('busca').textContent).toBe('');
  });

  it('avisa a falha sem sincronizar quando o Google devolve erro', () => {
    const { getByTestId } = renderizar('/rotina?google_calendar=error');

    expect(failure).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(getByTestId('busca').textContent).toBe('');
  });

  it('trata a volta também fora da Rotina, que é para onde o secret publicado aponta', () => {
    const { getByTestId } = renderizar('/configuracoes?tab=agenda&google_calendar=connected');

    expect(success).toHaveBeenCalledTimes(1);
    // Os demais parâmetros da rota seguem intactos.
    expect(getByTestId('busca').textContent).toBe('?tab=agenda');
  });

  it('não avisa nada numa visita comum', () => {
    renderizar('/rotina');

    expect(success).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
