// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
// missingColumns simulates the production database before the account-scope migration.
const mockDb = { missingColumns: false, filters: [] as string[], reads: {} as Record<string, number> };
function builder(table: string) {
  let columns = '';
  const filters: string[] = [];
  const b: Record<string, unknown> = {
    select: (cols: string) => { columns = cols ?? ''; return b; }, order: () => b, limit: () => b, eq: () => b,
    is: (column: string, value: unknown) => { filters.push(column); mockDb.filters.push(`${table}.${column} is ${value}`); return b; },
    single: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: (v: { data: unknown[] | null; error: { code: string } | null }) => unknown) => {
      mockDb.reads[table] = (mockDb.reads[table] ?? 0) + 1;
      const usesNewColumns = columns.includes('contact_name') || filters.length > 0;
      if (table === 'lotti_agent_conversations' && mockDb.missingColumns && usesNewColumns)
        return Promise.resolve({ data: null, error: { code: '42703' } }).then(resolve);
      return Promise.resolve({ data: dataByTable[table] ?? [], error: null }).then(resolve);
    },
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

afterEach(() => { cleanup(); vi.useRealTimers(); mockDb.missingColumns = false; mockDb.filters = []; mockDb.reads = {}; dataByTable.lotti_agent_conversations = [conversationFixture()]; });

function conversationFixture(extra: Record<string, unknown> = {}) {
  return { id: 'c1', phone: '5511999990000', cliente_id: null, mode: 'ai', updated_at: new Date().toISOString(), qualification: {}, last_error: null, ...extra };
}

it('mostra o nome do contato do WhatsApp em vez do número cru', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Maria Souza' })];
  mount(true);
  expect(await screen.findByRole('button', { name: /Maria Souza/ })).not.toBeNull();
});

it('lista só conversas do número conectado, sem as arquivadas', async () => {
  mount(true);
  await screen.findByRole('button', { name: /5511999990000/ });
  expect(mockDb.filters).toContain('lotti_agent_conversations.archived_at is null');
});

it('banco ainda sem a migration nova continua listando as conversas', async () => {
  mockDb.missingColumns = true;
  mount(true);
  expect(await screen.findByRole('button', { name: /5511999990000/ })).not.toBeNull();
  expect(screen.queryByText(/Não foi possível carregar as conversas/)).toBeNull();
});

it('conectado oferece o compositor para responder pela tela', async () => {
  mount(true);
  expect(await screen.findByLabelText('Mensagem')).not.toBeNull();
  expect(screen.queryByText(/não está disponível/i)).toBeNull();
});

it('atualiza mensagens novas em menos de dois segundos', async () => {
  vi.useFakeTimers();
  mount(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const initial = mockDb.reads.lotti_agent_messages ?? 0;
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(mockDb.reads.lotti_agent_messages).toBeGreaterThan(initial);
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

it('abre as três ações essenciais pelos controles do Inbox', async () => {
  mount(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Nova' }));
  expect(screen.getByRole('dialog', { name: 'Nova conversa' })).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Editar nome' }));
  expect(screen.getByRole('dialog', { name: 'Editar contato' })).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Aberta' }));
  expect(screen.getByRole('dialog', { name: 'Fechar conversa?' })).not.toBeNull();
});
