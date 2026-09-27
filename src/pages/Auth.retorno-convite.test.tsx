// @vitest-environment jsdom
/**
 * Auditoria SCRUM-6/16 — link de convite aberto sem sessão.
 *
 * O ProtectedRoute guarda a localização completa (pathname + search) em
 * state.from, mas o Auth só devolve o pathname (Auth.tsx:34). O convite
 * `/onboarding?invite=...&etapa=aceitar_convite` perde o token no login e a
 * pessoa cai no wizard sem o convite.
 *
 * Falhava na main 052327d; corrigido em Auth.tsx. Ver docs/jira/onboarding.md.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

const { auth } = vi.hoisted(() => ({
  auth: { atual: { isAuthenticated: false, loading: false } as Record<string, unknown> },
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth.atual }));
vi.mock('@/lib/admin/atribuicao', () => ({ nomeParceiroIndicador: () => null }));

import Auth from './Auth';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

function DestinoConvite() {
  const { pathname, search } = useLocation();
  return <p data-testid="destino">{pathname}{search}</p>;
}

// Radix (Checkbox "Lembrar de mim") usa ResizeObserver, ausente no jsdom.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

afterEach(cleanup);

it('depois do login, devolve o link de convite com o token (Auth.tsx:34)', async () => {
  const destino = '/onboarding?invite=token-de-teste&etapa=aceitar_convite';
  auth.atual = { isAuthenticated: false, loading: false, signIn: vi.fn() };

  // Elemento novo a cada render: com a mesma referência o React pula o update.
  const arvore = () => (
    <MemoryRouter initialEntries={[destino]}>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/onboarding" element={<ProtectedRoute><DestinoConvite /></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>
  );
  const { rerender } = render(arvore());

  // Sem sessão, o ProtectedRoute manda para /auth com state.from.
  expect(await screen.findByText('Bem-vindo de volta!')).not.toBeNull();

  // Login concluído: o Auth navega para o destino guardado.
  auth.atual = { isAuthenticated: true, loading: false, signIn: vi.fn() };
  rerender(arvore());

  await waitFor(() => expect(screen.getByTestId('destino').textContent).toBe(destino));
});
