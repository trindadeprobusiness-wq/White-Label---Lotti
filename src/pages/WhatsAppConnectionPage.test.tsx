// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
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
  expect(await screen.findByText('WhatsApp conectado')).not.toBeNull();
  expect(screen.getByRole('link', { name: 'Abrir Inbox' }).getAttribute('href')).toBe('/whatsapp');
});

it('mostra a prévia conectada sem oferecer conexão do WhatsApp nesta página', async () => {
  invoke.mockResolvedValue({ data: { state: 'disconnected', agentEnabled: false }, error: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><WhatsAppConnectionPage /></QueryClientProvider></MemoryRouter>);

  expect(await screen.findByText('WhatsApp conectado')).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Conectar WhatsApp' })).toBeNull();
  expect(screen.queryByText('Conecte ao WhatsApp')).toBeNull();
  expect(screen.getByRole('link', { name: 'Abrir Inbox' }).getAttribute('href')).toBe('/whatsapp');
});
