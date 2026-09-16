// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LiveAgentInbox from './LiveAgentInbox';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
vi.mock('@/pages/WhatsAppInbox', () => ({ default: () => <div><h1>Inbox completo</h1><p>Todas Atrasando Urgente</p></div> }));

function mount(initialEntry = '/whatsapp') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter initialEntries={[initialEntry]}><QueryClientProvider client={client}><LiveAgentInbox /></QueryClientProvider></MemoryRouter>);
}

describe('acesso ao Inbox pela conexão do WhatsApp', () => {
  beforeEach(() => invoke.mockReset());
  afterEach(cleanup);

  it('desconectado mostra somente a etapa de conexão', async () => {
    invoke.mockResolvedValue({ data: { state: 'disconnected', agentEnabled: false }, error: null });
    mount('/whatsapp?preview=disconnected');
    expect(await screen.findByRole('heading', { name: 'Conecte seu WhatsApp' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Inbox completo' })).toBeNull();
  });

  it('conectado abre o Inbox completo criado para o WhatsApp', async () => {
    invoke.mockResolvedValue({ data: { state: 'connected', agentEnabled: true }, error: null });
    mount();
    expect(await screen.findByRole('heading', { name: 'Inbox completo' })).not.toBeNull();
    expect(screen.getByText('Todas Atrasando Urgente')).not.toBeNull();
  });

  it('a prévia local abre o Inbox completo mesmo sem conexão real', async () => {
    invoke.mockResolvedValue({ data: { state: 'disconnected', agentEnabled: false }, error: null });
    mount('/whatsapp?preview=connected');
    expect(await screen.findByRole('heading', { name: 'Inbox completo' })).not.toBeNull();
  });
});
