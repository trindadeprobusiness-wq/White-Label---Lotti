// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LiveAgentInbox from './LiveAgentInbox';

const { invoke, from } = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke }, from, rpc: vi.fn() },
}));

function mount(initialEntry = '/whatsapp') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={client}><LiveAgentInbox /></QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}

describe('acesso ao Inbox pela conexão do WhatsApp', () => {
  beforeEach(() => { invoke.mockReset(); from.mockReset(); });
  afterEach(cleanup);

  it('desconectado mostra somente a conexão e não consulta conversas', async () => {
    invoke.mockResolvedValue({ data: { state: 'disconnected', agentEnabled: false }, error: null });
    mount();

    expect(await screen.findByRole('heading', { name: 'Conecte seu WhatsApp' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Atendimento conectado' })).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('conectado esconde a etapa de conexão e carrega o atendimento', async () => {
    invoke.mockResolvedValue({ data: { state: 'connected', agentEnabled: true }, error: null });
    const chain = {
      select: vi.fn(), order: vi.fn(), limit: vi.fn(), eq: vi.fn(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    chain.select.mockReturnValue(chain); chain.order.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
    from.mockReturnValue(chain);
    mount();

    expect(await screen.findByRole('heading', { name: 'Atendimento conectado' })).not.toBeNull();
    await waitFor(() => expect(from).toHaveBeenCalledWith('lotti_agent_conversations'));
    expect(screen.queryByLabelText('Conexão com WhatsApp')).toBeNull();
  });

  it('fecha o Inbox quando uma nova consulta de status falha', async () => {
    invoke.mockResolvedValueOnce({ data: { state: 'connected', agentEnabled: true }, error: null });
    const chain = {
      select: vi.fn(), order: vi.fn(), limit: vi.fn(), eq: vi.fn(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    chain.select.mockReturnValue(chain); chain.order.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
    from.mockReturnValue(chain);
    const client = mount();

    expect(await screen.findByRole('heading', { name: 'Atendimento conectado' })).not.toBeNull();
    invoke.mockResolvedValue({ data: null, error: new Error('offline') });
    await client.invalidateQueries({ queryKey: ['whatsapp-connection', 'owner-1'] });

    expect(await screen.findByRole('heading', { name: 'Conecte seu WhatsApp' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Atendimento conectado' })).toBeNull();
  });

  it('mostra conversas de demonstração na prévia conectada sem consultar o banco', async () => {
    invoke.mockResolvedValue({ data: { state: 'disconnected', agentEnabled: false }, error: null });
    mount('/whatsapp?preview=connected');

    expect(await screen.findByRole('heading', { name: 'Atendimento conectado' })).not.toBeNull();
    expect(screen.getByText('Mariana Souza')).not.toBeNull();
    expect(screen.getByText('Olá! Procuro uma casa com 3 quartos na região sul.')).not.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});
