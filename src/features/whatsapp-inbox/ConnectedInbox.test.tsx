// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import ConnectedInbox from './ConnectedInbox';

const { previewInvoke, previewRpc } = vi.hoisted(() => ({ previewInvoke: vi.fn(), previewRpc: vi.fn() }));
const dataByTable: Record<string, unknown[]> = {
  lotti_agent_conversations: [
    { id: 'c1', phone: '5511999990000', cliente_id: null, mode: 'ai', updated_at: new Date().toISOString(), qualification: {}, last_error: null },
  ],
  lotti_agent_latest_messages: [],
  lotti_agent_messages: [],
  lotti_inbox_events: [],
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
    rpc: (...args: unknown[]) => { previewRpc(...args); return Promise.resolve({ data: true, error: null }); },
    functions: { invoke: (...args: unknown[]) => { previewInvoke(...args); return Promise.resolve({ data: { sendStatus: 'sent' }, error: null }); } },
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://example.invalid/Custos.xlsx' }, error: null }) }) },
  },
}));

function mount(connected: boolean | 'unknown') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><ConnectedInbox connected={connected} /></QueryClientProvider></MemoryRouter>);
}

it('prévia permite ligar/desligar IA sem consultar nem alterar o backend', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><ConnectedInbox connected={false} preview /></QueryClientProvider></MemoryRouter>);
  expect(await screen.findByRole('button', { name: /Rafael/ })).not.toBeNull();
  expect(screen.getByText(/Prévia interativa com dados fictícios/)).not.toBeNull();
  const ai = screen.getByRole('switch', { name: 'IA' });
  expect(ai.hasAttribute('disabled')).toBe(false);
  fireEvent.click(ai);
  await waitFor(() => expect(ai.getAttribute('aria-checked')).toBe('false'));
  expect(await screen.findByText(/IA desligada por Corretor/)).not.toBeNull();
  expect(mockDb.reads).toEqual({});
  expect(previewRpc).not.toHaveBeenCalled();
  expect(previewInvoke).not.toHaveBeenCalled();
});

it('prévia permite editar contato, fechar, atribuir, adicionar tag e nota só na tela', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><ConnectedInbox connected={false} preview /></QueryClientProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Editar nome' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome do cliente' }), { target: { value: 'Rafael Teste' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar contato' }));
  expect(await screen.findByRole('button', { name: /Rafael Teste/ })).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Aberta' }));
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  expect(await screen.findByRole('button', { name: 'Fechada' })).not.toBeNull();
  expect(await screen.findByText(/Conversa fechada por Corretor/)).not.toBeNull();
  fireEvent.change(screen.getByLabelText('Atribuição'), { target: { value: 'Equipe' } });
  expect((screen.getByLabelText('Atribuição') as HTMLSelectElement).value).toBe('Equipe');
  fireEvent.change(screen.getByLabelText('Adicionar tag'), { target: { value: 'Comprador' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar tag' }));
  expect(screen.getByText('Comprador')).not.toBeNull();
  fireEvent.change(screen.getByLabelText('Nota interna'), { target: { value: 'Prefere imóvel no Centro.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar nota' }));
  expect(screen.getByText('Prefere imóvel no Centro.')).not.toBeNull();
  expect(mockDb.reads).toEqual({});
  expect(previewRpc).not.toHaveBeenCalled();
  expect(previewInvoke).not.toHaveBeenCalled();
});

it('prévia inicia conversa e mostra a mensagem inicial sem chamar envio real', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><ConnectedInbox connected={false} preview /></QueryClientProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Nova' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Telefone' }), { target: { value: '11988887777' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome (opcional)' }), { target: { value: 'Cliente Teste' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem inicial' }), { target: { value: 'Olá, tudo bem?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
  expect(await screen.findByRole('button', { name: /Cliente Teste/ })).not.toBeNull();
  expect(screen.getAllByText('Olá, tudo bem?').length).toBe(2);
  expect(previewInvoke).not.toHaveBeenCalled();
});

it('prévia mantém o histórico compacto nas laterais e entre mensagens', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><ConnectedInbox connected={false} preview /></QueryClientProvider></MemoryRouter>);
  const timeline = screen.getByTestId('message-timeline');
  expect(timeline.className).toContain('px-[clamp(10px,1.5vw,18px)]');
  expect(timeline.className).toContain('space-y-1');
});

it('prévia usa o fundo verde claro da Lotti no histórico', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><ConnectedInbox connected={false} preview /></QueryClientProvider></MemoryRouter>);
  expect(screen.getByTestId('message-timeline').className).toContain('bg-[#f4f8f5]');
});

it('organiza nome, telefone, etapa, status e IA no mesmo cabeçalho', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><ConnectedInbox connected={false} preview /></QueryClientProvider></MemoryRouter>);
  const header = await screen.findByTestId('conversation-header');
  expect(header.textContent).toContain('Rafael');
  expect(header.textContent).toContain('+55 (11) 99999-0000');
  expect(header.textContent).toContain('Em qualificação');
  expect(header.textContent).toContain('Aberta');
  expect(header.textContent).toContain('IA ligada');
  expect(screen.queryByTestId('conversation-stage-bar')).toBeNull();
  expect(screen.getByRole('switch', { name: 'IA' })).not.toBeNull();
  expect(screen.getByTestId('conversation-header-actions').className).toContain('flex-wrap');
  expect(screen.getByTestId('conversation-header-actions').className).not.toContain('lg:flex-nowrap');
});

it('usa a inicial do nome exibido quando o nome antigo é Contato WhatsApp', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Contato WhatsApp', clientes: { nome: 'Rafael' } })];
  mount(true);
  await screen.findByRole('button', { name: /Rafael/ });
  expect(screen.getAllByLabelText('Inicial de Rafael')).toHaveLength(2);
  expect(screen.queryByLabelText('Inicial de Contato WhatsApp')).toBeNull();
});

it('mostra fechamento como conversa fechada, não IA pausada', async () => {
  dataByTable.lotti_inbox_events = [{ id: 'event-closed', kind: 'status', from_label: 'Aberta', to_label: 'Fechada', subject_label: null, actor_label: 'Corretor', created_at: new Date().toISOString() }];
  mount(true);
  expect(await screen.findByText(/Conversa fechada por Corretor/)).not.toBeNull();
  expect(screen.queryByText(/IA pausada/)).toBeNull();
});

it('atualiza a conversa aberta sem repetir toda a lista a cada ciclo', async () => {
  mount(true);
  await screen.findByRole('button', { name: /5511999990000/ });
  await waitFor(() => expect(mockDb.reads.lotti_agent_messages).toBeGreaterThan(0));
  const listBefore = mockDb.reads.lotti_agent_conversations;
  const messagesBefore = mockDb.reads.lotti_agent_messages;
  await new Promise(resolve => setTimeout(resolve, 3500));
  expect(mockDb.reads.lotti_agent_messages - messagesBefore).toBeGreaterThanOrEqual(2);
  expect(mockDb.reads.lotti_agent_conversations - listBefore).toBeLessThanOrEqual(1);
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); mockDb.missingColumns = false; mockDb.filters = []; mockDb.reads = {}; dataByTable.lotti_agent_conversations = [conversationFixture()]; dataByTable.lotti_agent_messages = []; dataByTable.lotti_inbox_events = []; });

function conversationFixture(extra: Record<string, unknown> = {}) {
  return { id: 'c1', phone: '5511999990000', cliente_id: null, mode: 'ai', updated_at: new Date().toISOString(), qualification: {}, last_error: null, ...extra };
}

it('mostra o nome do contato do WhatsApp em vez do número cru', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Maria Souza' })];
  mount(true);
  expect(await screen.findByRole('button', { name: /Maria Souza/ })).not.toBeNull();
});

it('usa a inicial do nome em todos os avatares, sem mostrar dígitos do telefone', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Rafael' })];
  mount(true);
  await screen.findByRole('button', { name: /Rafael/ });
  expect(screen.getAllByLabelText('Inicial de Rafael').length).toBe(2);
  expect(screen.queryByText('00')).toBeNull();
});

it('usa o nome do cadastro quando não há nome de perfil no WhatsApp', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: null, clientes: { nome: 'Beatriz' } })];
  mount(true);
  await screen.findByRole('button', { name: /Beatriz/ });
  expect(screen.getAllByLabelText('Inicial de Beatriz').length).toBe(2);
});

it('mostra a hora, e não a data, na lista das conversas de hoje', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-24T15:00:00Z'));
  dataByTable.lotti_agent_conversations = [conversationFixture({ updated_at: '2026-09-24T14:20:00Z' })];
  mount(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole('navigation', { name: 'Conversas conectadas' }).querySelector('time')?.textContent).toBe('11:20');
});

it('mostra somente a hora na bolha e diferencia um arquivo enviado de texto', async () => {
  dataByTable.lotti_agent_messages = [{ id: 'm1', direction: 'out', sender: 'human', content: 'Custos.xlsx', media_path: 'owner/request/Custos.xlsx', created_at: '2026-09-24T14:00:00Z' }];
  mount(true);
  const file = await screen.findByRole('link', { name: /Custos.xlsx/ });
  expect(file).not.toBeNull();
  expect(screen.getByText('Arquivo XLSX')).not.toBeNull();
  const time = screen.getByText('11:00');
  expect(time.closest('time')?.textContent).toBe('11:00');
  expect(screen.queryByText('24/09/2026, 11:00:00')).toBeNull();
});

it('mantém o layout de referência com as cores da Lotti, fundo pontilhado e seleção lateral', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Rafael' })];
  dataByTable.lotti_agent_messages = [{ id: 'm-visual', direction: 'out', sender: 'human', content: 'Olá!', media_path: null, created_at: new Date().toISOString() }];
  mount(true);
  const message = await screen.findByText('Olá!');
  expect(message.closest('article')?.className).toContain('bg-primary');
  expect(message.closest('[data-testid="message-timeline"]')?.className).toContain('bg-[radial-gradient(');
  expect(screen.getByRole('button', { name: /Rafael/ }).className).toContain('border-l-primary');
  expect(screen.getByRole('button', { name: 'Nova' }).className).toContain('bg-primary');
  expect(screen.getByRole('switch', { name: 'IA' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByTestId('conversation-stage-pill').textContent).toContain('Sem cliente vinculado');
  expect(screen.getByRole('button', { name: 'Ocultar info' }).className).toContain('border-primary');
});

it('mostra mudanças de IA e Funil como avisos internos ordenados no chat', async () => {
  dataByTable.lotti_agent_messages = [{ id: 'm2', direction: 'in', sender: 'lead', content: 'Olá', media_path: null, created_at: '2026-09-24T14:10:00Z' }];
  dataByTable.lotti_inbox_events = [
    { id: 'e1', kind: 'mode', from_label: 'Equipe', to_label: 'IA', actor_label: 'Corretor', created_at: '2026-09-24T14:00:00Z' },
    { id: 'e2', kind: 'stage', from_label: 'Novo lead', to_label: 'Agendado', subject_label: 'Compra da casa', actor_label: 'Corretor', created_at: '2026-09-24T14:20:00Z' },
  ];
  mount(true);
  const mode = await screen.findByText(/IA ligada por Corretor/);
  const stage = screen.getByText(/Negócio Compra da casa movido de Novo lead para Agendado por Corretor/);
  const text = screen.getByText('Olá');
  expect(mode.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(text.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

it('reproduz a hierarquia do Clix com cabeçalho compacto e painel de perfil', async () => {
  mount(true);
  expect(await screen.findByTestId('clix-inbox-shell')).not.toBeNull();
  expect(screen.getByTestId('conversation-header')).not.toBeNull();
  expect(screen.getByTestId('conversation-stage-pill')).not.toBeNull();
  expect(screen.getByRole('heading', { name: /Resumo do caso/ })).not.toBeNull();
  expect(screen.getByRole('heading', { name: 'Atribuição' })).not.toBeNull();
  expect(screen.getByRole('heading', { name: 'Tags' })).not.toBeNull();
  expect(screen.getByRole('heading', { name: 'Notas internas' })).not.toBeNull();
});

it('mantém a densidade compacta da referência do Clix', async () => {
  mount(true);
  const shell = await screen.findByTestId('clix-inbox-shell');
  expect(shell.className).toContain('lg:grid-cols-[230px_minmax(0,1fr)]');
  expect(shell.className).toContain('2xl:grid-cols-[306px_minmax(0,1fr)_330px]');
  expect(shell.className).toContain('gap-[10px]');
  expect(shell.className).toContain('p-[10px]');
  expect(screen.getByTestId('conversation-header').className).toContain('min-h-[68px]');
  expect(screen.getByTestId('conversation-stage-pill')).not.toBeNull();
  expect(screen.getByRole('button', { name: /5511999990000/ }).className).toContain('min-h-[64px]');
  expect(screen.getByRole('switch', { name: 'IA' })).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Ocultar info' })).not.toBeNull();
  expect(screen.getByRole('complementary', { name: 'Perfil do contato' }).className).toContain('2xl:static');
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
