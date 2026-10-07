// @vitest-environment jsdom
/**
 * /nova-senha no modo API (login próprio): o link do checkout do site traz `?token=` e a conta
 * ainda não tem sessão. A página aceita o token sem sessão, manda token + senha para o
 * definirNovaSenha e entra; sem token mostra "Link expirado".
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({
  api: true,
  auth: { session: null, loading: true, definirNovaSenha: vi.fn() } as Record<string, unknown>,
}));

vi.mock('@/lib/api', () => ({ apiDisponivel: () => estado.api }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => estado.auth }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import NovaSenha from './NovaSenha';

function abrir(url: string) {
  window.history.replaceState({}, '', url);
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/nova-senha" element={<NovaSenha />} />
        <Route path="/" element={<p>Início</p>} />
        <Route path="/recuperar-senha" element={<p>Recuperar</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  estado.api = true;
  estado.auth = { session: null, loading: true, definirNovaSenha: vi.fn(async () => ({ ok: true })) };
});
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); });

it('com ?token= e sem sessão: mostra o formulário, salva e vai para o início', async () => {
  abrir('/nova-senha?token=tok-do-checkout');
  const senha = screen.getByLabelText('Nova senha');
  fireEvent.change(senha, { target: { value: 'senha-forte-123' } });
  fireEvent.change(screen.getByLabelText('Repita a senha'), { target: { value: 'senha-forte-123' } });
  const botao = screen.getByRole('button', { name: 'Salvar nova senha' }) as HTMLButtonElement;
  expect(botao.disabled).toBe(false);
  fireEvent.click(botao);
  await waitFor(() => expect(estado.auth.definirNovaSenha).toHaveBeenCalledWith('senha-forte-123'));
  expect(await screen.findByText('Início')).not.toBeNull();
});

it('link vencido: o erro da API aparece no formulário', async () => {
  estado.auth.definirNovaSenha = vi.fn(async () => ({ ok: false, erro: 'Este link expirou ou já foi usado. Peça um novo.' }));
  abrir('/nova-senha?token=tok-usado');
  fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'senha-forte-123' } });
  fireEvent.change(screen.getByLabelText('Repita a senha'), { target: { value: 'senha-forte-123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Este link expirou ou já foi usado. Peça um novo.');
});

it('sem token no link: "Link expirado" com o caminho para pedir outro', () => {
  abrir('/nova-senha');
  expect(screen.getByText('Link expirado')).not.toBeNull();
  expect(screen.queryByLabelText('Nova senha')).toBeNull();
});

it('modo Supabase segue exigindo a sessão de recuperação', () => {
  estado.api = false;
  estado.auth = { session: null, loading: false, definirNovaSenha: vi.fn() };
  abrir('/nova-senha?token=ignorado');
  expect(screen.getByText('Link expirado')).not.toBeNull();
});
