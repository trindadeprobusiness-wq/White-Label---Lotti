// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WhatsAppConnectionPage from './WhatsAppConnectionPage';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));

beforeEach(() => invoke.mockResolvedValue({ data: { state: 'connected', agentEnabled: true }, error: null }));
afterEach(cleanup);

it('mantém uma página de Conexão acessível quando o número já está conectado', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><WhatsAppConnectionPage /></QueryClientProvider></MemoryRouter>);

  expect(screen.getByRole('heading', { name: 'Conexão' })).not.toBeNull();
  expect(await screen.findByText('Conectado')).not.toBeNull();
  expect(screen.getByRole('textbox', { name: 'Empresa' }).getAttribute('value')).toBe('Lotti Imóveis');
  expect(screen.queryByText(/WABA ID:/)).toBeNull();
  expect(screen.queryByText(/Phone ID:/)).toBeNull();
  expect(screen.getByRole('heading', { name: 'Teste de recebimento' })).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Desconectar' })).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Enviar “Olá, tudo bem?”' })).toBeNull();
  expect(screen.queryByText(/E\.164/)).toBeNull();
  expect(screen.queryByRole('link', { name: 'Abrir Inbox' })).toBeNull();
  expect(screen.getByTestId('connection-panels').className).not.toContain('lg:grid-cols-2');
  expect(screen.getByTestId('connection-panels').className).toContain('space-y-4');
  expect(screen.getByTestId('status-details').className).toContain('space-y-4');
  expect(screen.getByTestId('status-details').className).not.toContain('sm:grid-cols');
  expect(screen.getByTestId('connection-page').className).toContain('-mb-16');
});

it('mostra estado desconectado real sem oferecer desconexão fictícia', async () => {
  invoke.mockResolvedValue({ data: { state: 'disconnected', agentEnabled: false }, error: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><WhatsAppConnectionPage /></QueryClientProvider></MemoryRouter>);

  expect(await screen.findByText('Desconectado')).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Desconectar' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Conectar WhatsApp' })).toBeNull();
  expect(screen.queryByText('Conecte ao WhatsApp')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Abrir Inbox' })).toBeNull();
});

it('desconecta pelo servidor apenas após confirmação', async () => {
  let connected = true;
  invoke.mockImplementation((_name, options) => {
    if (options?.body?.action === 'disconnect') connected = false;
    return Promise.resolve({ data: { state: connected ? 'connected' : 'disconnected', agentEnabled: false }, error: null });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><WhatsAppConnectionPage /></QueryClientProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Desconectar' }));
  expect(invoke).not.toHaveBeenCalledWith('lotti-whatsapp', { body: { action: 'disconnect' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Desconectar' }).at(-1)!);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('lotti-whatsapp', { body: { action: 'disconnect' } }));
  expect(await screen.findByText('Desconectado')).not.toBeNull();
});
