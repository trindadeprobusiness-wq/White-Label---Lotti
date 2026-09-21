// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import ConnectedInbox from './ConnectedInbox';

const dataByTable: Record<string, unknown[]> = {
  lotti_agent_conversations: [
    { id: 'c1', phone: '5511999990000', cliente_id: null, mode: 'ai', updated_at: new Date().toISOString(), qualification: {}, last_error: null },
  ],
  lotti_agent_latest_messages: [],
  lotti_agent_messages: [],
};
function builder(table: string) {
  const b: Record<string, unknown> = {
    select: () => b, order: () => b, limit: () => b, eq: () => b,
    single: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: dataByTable[table] ?? [], error: null }).then(resolve),
  };
  return b;
}
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (t: string) => builder(t),
    rpc: () => Promise.resolve({ data: true, error: null }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: { sendStatus: 'sent' }, error: null }) },
  },
}));

function mount(connected: boolean | 'unknown') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><ConnectedInbox connected={connected} /></QueryClientProvider></MemoryRouter>);
}

afterEach(cleanup);

it('conectado oferece o compositor para responder pela tela', async () => {
  mount(true);
  expect(await screen.findByLabelText('Mensagem')).not.toBeNull();
  expect(screen.queryByText(/não está disponível/i)).toBeNull();
});

it('desconectado orienta a conectar em vez de compor', async () => {
  mount(false);
  await screen.findByText(/Conecte o WhatsApp/i);
  expect(screen.queryByLabelText('Mensagem')).toBeNull();
});

it('falha de consulta não afirma que a sessão foi desconectada', async () => {
  mount('unknown');
  expect(await screen.findByText(/não foi possível confirmar a conexão/i)).not.toBeNull();
  expect(screen.queryByText(/desconectado/i)).toBeNull();
});

it('mantém a conversa como coluna principal e o compositor no rodapé do painel', async () => {
  mount(true);
  const history = await screen.findByRole('region', { name: 'Histórico conectado' });
  expect(history.className).toContain('min-h-0');
  expect(history.className).toContain('overflow-hidden');
  expect(history.querySelector('footer')).not.toBeNull();
  expect(screen.getByRole('navigation', { name: 'Conversas conectadas' }).className).toContain('min-h-0');
  expect(screen.getByRole('complementary', { name: 'Perfil do contato' }).className).toContain('min-h-0');
});

it('reproduz a hierarquia do Clix com cabeçalho do contato, barra de etapa e painel de perfil', async () => {
  mount(true);
  expect(await screen.findByTestId('clix-inbox-shell')).not.toBeNull();
  expect(screen.getByTestId('conversation-header')).not.toBeNull();
  expect(screen.getByTestId('conversation-stage-bar')).not.toBeNull();
  expect(screen.getByRole('heading', { name: /Resumo do caso/ })).not.toBeNull();
  expect(screen.getByRole('heading', { name: 'Atribuição' })).not.toBeNull();
  expect(screen.getByRole('heading', { name: 'Tags' })).not.toBeNull();
  expect(screen.getByRole('heading', { name: 'Notas internas' })).not.toBeNull();
});

it('mantém a densidade compacta da referência do Clix', async () => {
  mount(true);
  const shell = await screen.findByTestId('clix-inbox-shell');
  expect(shell.className).toContain('lg:grid-cols-[306px_minmax(0,1fr)_330px]');
  expect(shell.className).toContain('gap-[10px]');
  expect(shell.className).toContain('p-[10px]');
  expect(screen.getByTestId('conversation-header').className).toContain('min-h-[68px]');
  expect(screen.getByTestId('conversation-stage-bar').className).toContain('min-h-[42px]');
  expect(screen.getByRole('button', { name: /5511999990000/ }).className).toContain('min-h-[64px]');
  expect(screen.getByRole('switch', { name: 'IA' })).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Ocultar info' })).not.toBeNull();
});
