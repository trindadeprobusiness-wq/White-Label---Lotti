// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const mockDb = { missingColumns: false, missingOptOut: false, filters: [] as string[], reads: {} as Record<string, number>, rpcError: null as null | { message: string },
  counts: {} as Record<string, number>, updates: [] as Array<{ table: string; valores: unknown }>, eqs: [] as Array<{ table: string; coluna: string; valor: unknown }>,
  rpcResults: {} as Record<string, { data: unknown; error: unknown }>, invokeResult: null as null | { data: unknown; error: unknown } };
function builder(table: string) {
  let columns = '';
  let contar = false;
  const filters: string[] = [];
  const b: Record<string, unknown> = {
    select: (cols: string, opcoes?: { count?: string; head?: boolean }) => { columns = cols ?? ''; contar = !!opcoes?.head; return b; }, order: () => b, limit: () => b, eq: (coluna: string, valor: unknown) => { mockDb.eqs.push({ table, coluna, valor }); return b; },
    update: (valores: unknown) => { mockDb.updates.push({ table, valores }); return b; },
    is: (column: string, value: unknown) => { filters.push(column); mockDb.filters.push(`${table}.${column} is ${value}`); return b; },
    // Devolvia null sempre, então nenhuma consulta com .single() (a do cliente,
    // por exemplo) conseguia ser testada com dados.
    single: () => Promise.resolve({ data: (dataByTable[table] ?? [])[0] ?? null, error: null }),
    then: (resolve: (v: { data: unknown[] | null; error: { code: string } | null }) => unknown) => {
      mockDb.reads[table] = (mockDb.reads[table] ?? 0) + 1;
      const usesNewColumns = columns.includes('contact_name') || filters.length > 0;
      if (table === 'lotti_agent_conversations' && mockDb.missingColumns && usesNewColumns)
        return Promise.resolve({ data: null, error: { code: '42703' } }).then(resolve);
      if (table === 'lotti_agent_conversations' && mockDb.missingOptOut && columns.includes('opted_out_at'))
        return Promise.resolve({ data: null, error: { code: '42703' } }).then(resolve);
      if (contar) return Promise.resolve({ data: null, error: null, count: mockDb.counts[table] ?? (dataByTable[table] ?? []).length } as never).then(resolve);
      return Promise.resolve({ data: dataByTable[table] ?? [], error: null }).then(resolve);
    },
  };
  return b;
}
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }));
// Avisos de ação viram notificação rápida (sonner), não faixa na conversa.
const { avisos } = vi.hoisted(() => ({ avisos: [] as string[] }));
vi.mock('sonner', () => ({ toast: { success: (m: string) => avisos.push(m), warning: (m: string) => avisos.push(m), error: (m: string) => avisos.push(m), info: (m: string) => avisos.push(m) } }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (t: string) => builder(t),
    rpc: (...args: unknown[]) => { previewRpc(...args); const named = mockDb.rpcResults[args[0] as string]; if (named) return Promise.resolve(named); return Promise.resolve(mockDb.rpcError ? { data: null, error: mockDb.rpcError } : { data: true, error: null }); },
    functions: { invoke: (...args: unknown[]) => { previewInvoke(...args); return Promise.resolve(mockDb.invokeResult ?? { data: { sendStatus: 'sent' }, error: null }); } },
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://example.invalid/Custos.xlsx' }, error: null }) }) },
  },
}));

function mountConectado() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><ConnectedInbox connected /></QueryClientProvider></MemoryRouter>);
}

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

it('prévia permite editar contato e fechar só na tela', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><ConnectedInbox connected={false} preview /></QueryClientProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Editar nome' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome do cliente' }), { target: { value: 'Rafael Teste' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar contato' }));
  expect(await screen.findByRole('button', { name: /Rafael Teste/ })).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Aberta' }));
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  // Como no Clix: fechada sai das Abertas e aparece em Fechadas, com quem fechou.
  expect(await screen.findByText('Nenhuma conversa aberta.')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Fechadas' }));
  expect(await screen.findByRole('button', { name: 'Fechada · Vendedor' })).not.toBeNull();
  expect(await screen.findByText(/Conversa fechada por Corretor/)).not.toBeNull();
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
  // Era space-y-1; o corretor pediu um pouco mais de ar entre as mensagens.
  // O espaço fica no conteúdo de dentro, que é o que o vigia de altura observa.
  expect(timeline.firstElementChild?.className).toContain('space-y-2');
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
  expect(header.textContent).toContain('Qualificação');
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
  expect(screen.getAllByLabelText('Inicial de Rafael')).toHaveLength(3);
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
  await screen.findByRole('button', { name: /99999-0000/ });
  await waitFor(() => expect(mockDb.reads.lotti_agent_messages).toBeGreaterThan(0));
  const listBefore = mockDb.reads.lotti_agent_conversations;
  const messagesBefore = mockDb.reads.lotti_agent_messages;
  await new Promise(resolve => setTimeout(resolve, 3500));
  expect(mockDb.reads.lotti_agent_messages - messagesBefore).toBeGreaterThanOrEqual(2);
  expect(mockDb.reads.lotti_agent_conversations - listBefore).toBeLessThanOrEqual(1);
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); mockDb.missingColumns = false; mockDb.missingOptOut = false; mockDb.rpcError = null; mockDb.rpcResults = {}; mockDb.invokeResult = null; mockDb.filters = []; mockDb.reads = {}; mockDb.updates = []; mockDb.eqs = []; dataByTable.lotti_agent_conversations = [conversationFixture()]; dataByTable.lotti_agent_messages = []; dataByTable.lotti_inbox_events = []; });

function conversationFixture(extra: Record<string, unknown> = {}) {
  return { id: 'c1', phone: '5511999990000', cliente_id: null, mode: 'ai', updated_at: new Date().toISOString(), qualification: {}, last_error: null, ...extra };
}

it('mostra o nome do contato do WhatsApp em vez do número cru', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Maria Souza' })];
  mount(true);
  expect(await screen.findByRole('button', { name: /Maria Souza/ })).not.toBeNull();
});

it('conversa com número oculto pelo WhatsApp avisa em vez de mostrar número vazio', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ phone: null, lid: '123456789012345', contact_name: 'Paula' })];
  mount(true);
  await screen.findByRole('button', { name: /Paula/ });
  expect(screen.getAllByText('Número oculto pelo WhatsApp').length).toBeGreaterThan(0);
  expect(screen.queryByText('+null')).toBeNull();
});

it('usa a inicial do nome em todos os avatares, sem mostrar dígitos do telefone', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Rafael' })];
  mount(true);
  await screen.findByRole('button', { name: /Rafael/ });
  expect(screen.getAllByLabelText('Inicial de Rafael').length).toBe(3);
  expect(screen.queryByText('00')).toBeNull();
});

it('usa o nome do cadastro quando não há nome de perfil no WhatsApp', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: null, clientes: { nome: 'Beatriz' } })];
  mount(true);
  await screen.findByRole('button', { name: /Beatriz/ });
  expect(screen.getAllByLabelText('Inicial de Beatriz').length).toBe(3);
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
  expect(await screen.findByText('Custos.xlsx')).not.toBeNull();
  // O botão busca o arquivo na hora do clique (antes o link só aparecia se a busca prévia desse certo).
  expect(screen.getByRole('button', { name: 'Baixar' })).not.toBeNull();
  expect(screen.getByText('Arquivo XLSX')).not.toBeNull();
  const time = screen.getByText('11:00');
  expect(time.closest('time')?.textContent).toBe('11:00');
  expect(screen.queryByText('24/09/2026, 11:00:00')).toBeNull();
});

it('arquivo sem caminho salvo avisa que está indisponível, em vez de só mostrar o nome', async () => {
  dataByTable.lotti_agent_messages = [{ id: 'm2', direction: 'in', sender: 'lead', content: 'Planilha.xlsx', media_path: null, created_at: '2026-09-24T14:00:00Z', preview_kind: 'file' }];
  mount(true);
  expect(await screen.findByText('Planilha.xlsx')).not.toBeNull();
  expect(screen.getByText('Arquivo indisponível')).not.toBeNull();
});

it('arquivo sem caminho salvo avisa que está indisponível, em vez de só mostrar o nome', async () => {
  dataByTable.lotti_agent_messages = [{ id: 'm2', direction: 'in', sender: 'lead', content: 'Planilha.xlsx', media_path: null, created_at: '2026-09-24T14:00:00Z', preview_kind: 'file' }];
  mount(true);
  expect(await screen.findByText('Planilha.xlsx')).not.toBeNull();
  expect(screen.getByText('Arquivo indisponível')).not.toBeNull();
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
  await screen.findByRole('button', { name: /99999-0000/ });
  expect(mockDb.filters).toContain('lotti_agent_conversations.archived_at is null');
});

it('banco ainda sem a migration nova continua listando as conversas', async () => {
  mockDb.missingColumns = true;
  mount(true);
  expect(await screen.findByRole('button', { name: /99999-0000/ })).not.toBeNull();
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
  // Atribuição, Tags e Notas internas saíram do perfil: só respondiam na
  // demonstração e ficavam inertes no uso real, prometendo o que não faziam.
  expect(screen.queryByRole('heading', { name: 'Atribuição' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Tags' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Notas internas' })).toBeNull();
});

it('mantém a densidade compacta da referência do Clix', async () => {
  mount(true);
  const shell = await screen.findByTestId('clix-inbox-shell');
  expect(shell.className).toContain('lg:grid-cols-[214px_minmax(0,1fr)]');
  expect(shell.className).toContain('2xl:grid-cols-[272px_minmax(0,1fr)_288px]');
  expect(shell.className).toContain('gap-[10px]');
  expect(shell.className).toContain('p-[10px]');
  expect(screen.getByTestId('conversation-header').className).toContain('min-h-[68px]');
  expect(screen.getByTestId('conversation-stage-pill')).not.toBeNull();
  expect(screen.getByRole('button', { name: /99999-0000/ }).className).toContain('min-h-[64px]');
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

it('contato que pediu para sair: sem compositor, IA bloqueada e opção de liberar', async () => {
  const since = '2026-09-27T12:00:00Z';
  dataByTable.lotti_agent_conversations = [conversationFixture({ mode: 'human', opted_out_at: since })];
  dataByTable.lotti_agent_messages = [{ id: 'm1', direction: 'in', sender: 'lead', content: 'SAIR', media_path: null, created_at: since }];
  dataByTable.lotti_inbox_events = [{ id: 'e1', kind: 'consent', from_label: null, to_label: 'Pediu para não receber mensagens', subject_label: null, actor_label: 'Contato', created_at: since }];
  mount(true);
  expect(await screen.findByText(/Você pode responder quando ele escrever de novo/)).not.toBeNull();
  expect(await screen.findByText(/^Contato pediu para não receber mensagens ·/)).not.toBeNull();
  expect(screen.queryByLabelText('Mensagem')).toBeNull();
  const ai = screen.getByRole('switch', { name: 'IA' });
  expect(ai.hasAttribute('disabled')).toBe(true);
  expect(ai.textContent).toContain('IA bloqueada');
  expect(screen.getByRole('button', { name: /99999-0000/ }).textContent).toContain('Não quer receber');
  fireEvent.click(screen.getByRole('button', { name: 'Liberar contato' }));
  await waitFor(() => expect(previewRpc).toHaveBeenCalledWith('lotti_inbox_clear_opt_out', { p_conversation: 'c1' }));
});

it('contato que pediu para sair e voltou a escrever pode receber resposta manual', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ mode: 'human', opted_out_at: '2026-09-27T12:00:00Z' })];
  dataByTable.lotti_agent_messages = [
    { id: 'm1', direction: 'in', sender: 'lead', content: 'SAIR', media_path: null, created_at: '2026-09-27T12:00:00Z' },
    { id: 'm2', direction: 'in', sender: 'lead', content: 'Mudei de ideia', media_path: null, created_at: '2026-09-27T12:10:00Z' },
  ];
  dataByTable.lotti_inbox_events = [{ id: 'e2', kind: 'consent', from_label: 'Pediu para não receber mensagens', to_label: 'Contato liberado', subject_label: null, actor_label: 'Corretor', created_at: '2026-09-27T12:20:00Z' }];
  mount(true);
  expect(await screen.findByText(/voltou a escrever/)).not.toBeNull();
  expect(screen.getByLabelText('Mensagem')).not.toBeNull();
  expect(await screen.findByText(/Contato liberado por Corretor/)).not.toBeNull();
});

it('banco sem a coluna de opt-out continua mostrando o nome do contato', async () => {
  mockDb.missingOptOut = true;
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Maria Souza' })];
  mount(true);
  expect(await screen.findByRole('button', { name: /Maria Souza/ })).not.toBeNull();
  expect(screen.getByLabelText('Mensagem')).not.toBeNull();
});

it('mostra ao corretor o resumo, a etapa e o perfil qualificado pela IA', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({
    qualification: { stage: 'qualificado_busca', temperature: 'quente', priority: 'alta', reason: 'Quer comprar no Centro com financiamento aprovado.',
      profile: { budget: 'Até 500 mil', timeframe: 'em 3 meses', needs: '2 quartos com garagem', nextStep: 'enviar opções', region: 'Centro' } },
  })];
  mount(true);
  const profile = await screen.findByRole('complementary', { name: 'Perfil do contato' });
  expect(profile.textContent).toContain('Quer comprar no Centro com financiamento aprovado.');
  expect(profile.textContent).toContain('Qualificado para busca');
  expect(profile.textContent).toContain('Prioridade alta');
  // O que a tela mostra é o valor legível: primeira letra maiúscula. O dado
  // gravado continua como a IA escreveu.
  for (const [label, value] of [['Orçamento', 'Até 500 mil'], ['Prazo', 'Em 3 meses'], ['Essenciais', '2 quartos com garagem'], ['Próximo passo', 'Enviar opções'], ['Região', 'Centro']]) {
    const term = Array.from(profile.querySelectorAll('dt')).find(dt => dt.textContent === label);
    expect(term?.nextElementSibling?.textContent).toBe(value);
  }
});

it('desce quando a última mensagem muda, com a conversa no teto de 200', async () => {
  // Cobertura parcial: o jsdom não reproduz de forma confiável a janela que
  // desliza sem mudar de tamanho, então este teste não distingue o gatilho por
  // comprimento do gatilho por identidade. Fica como proteção do caminho feliz.
  const base = Date.parse('2026-09-27T12:00:00Z');
  const janela = (desloc: number) => Array.from({ length: 200 }, (_, i) => ({
    id: `m${i + desloc}`, direction: 'in', sender: 'lead', content: `Mensagem ${i + desloc}`,
    media_path: null, created_at: new Date(base + (i + desloc) * 60000).toISOString(),
  }));
  const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2400);
  dataByTable.lotti_agent_messages = janela(0);
  mount(true);
  await waitFor(() => expect(screen.getByTestId('message-timeline').scrollTop).toBe(2400));

  // Zerar a rolagem é o que torna o teste honesto: sem isso o valor antigo
  // continua lá e passa por certo mesmo quando o efeito não roda.
  screen.getByTestId('message-timeline').scrollTop = 0;
  height.mockReturnValue(3000);
  dataByTable.lotti_agent_messages = janela(1);
  await waitFor(() => expect(screen.getByTestId('message-timeline').scrollTop).toBe(3000), { timeout: 5000 });
  height.mockRestore();
});

it('abre a conversa rolada até a última mensagem, como no WhatsApp', async () => {
  const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2400);
  dataByTable.lotti_agent_messages = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, direction: i % 2 ? 'out' : 'in', sender: i % 2 ? 'human' : 'lead', content: `Mensagem ${i}`, media_path: null, created_at: new Date(Date.parse('2026-09-27T12:00:00Z') + i * 60000).toISOString() }));
  mount(true);
  await screen.findByText('Mensagem 29');
  await waitFor(() => expect(screen.getByTestId('message-timeline').scrollTop).toBe(2400));
  height.mockRestore();
});

it('deixa entrar em filtro vazio, sempre com a saída à vista', async () => {
  // Com uma conversa recente, Atrasando e Urgente contam zero. Desabilitá-los
  // aí fazia o corretor ler defeito onde só havia fila vazia. Clicar é
  // permitido; o que não pode é ficar sem volta, e a saída já existe.
  mountConectado();

  const atrasando = await screen.findByRole('button', { name: /Atrasando: 0 conversas/ });
  const urgente = screen.getByRole('button', { name: /Urgente: 0 conversas/ });
  expect(atrasando.hasAttribute('disabled')).toBe(false);
  expect(urgente.hasAttribute('disabled')).toBe(false);

  fireEvent.click(atrasando);
  const doAtalho = await screen.findAllByRole('button', { name: 'Ver todas as conversas' });
  expect(doAtalho.length).toBeGreaterThan(0);
  expect(screen.queryByText('Selecione uma conversa')).toBeNull();
  fireEvent.click(doAtalho[0]);
  await waitFor(() => expect(screen.queryByText(/Nenhuma conversa neste filtro/)).toBeNull());

  // Pela busca ainda é possível zerar a lista; aí precisa existir a saída.
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar conversas' }), {
    target: { value: 'contato-que-nao-existe' },
  });

  const saidas = await screen.findAllByRole('button', { name: 'Ver todas as conversas' });
  expect(saidas.length).toBeGreaterThan(0);
  expect(screen.queryByText('Selecione uma conversa')).toBeNull();

  fireEvent.click(saidas[0]);
  await waitFor(() => expect(screen.queryByText(/Nenhuma conversa neste filtro/)).toBeNull());
});

it('sem faixa de aviso na conversa quando a IA parou por motivo que não pede ação (pedido do Rafael)', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Neves', last_error: 'no_active_entitlement' })];
  mount(true);
  await screen.findByRole('button', { name: 'Editar nome' });
  expect(screen.queryByTestId('motivo-da-parada')).toBeNull();
  expect(document.body.textContent).not.toContain('revisão operacional');
});

it('foto aparece como imagem na conversa, não como cartão de arquivo', async () => {
  dataByTable.lotti_agent_messages = [{ id: 'm1', direction: 'out', sender: 'human', content: 'fachada.jpg', media_path: 'owner-1/pedido/fachada.jpg', created_at: '2026-10-01T12:00:00Z' }];
  mount(true);
  const imagem = await screen.findByAltText('fachada.jpg');
  expect(imagem.getAttribute('src')).toContain('https://');
});

const ETAPAS_TESTE = [
  { id: 'e-novo', corretor_id: 'owner', nome: 'Novo lead', ordem: 1, cor: 'slate', tipo: 'ABERTA', ativo: true },
  { id: 'e-quali', corretor_id: 'owner', nome: 'Em qualificação', ordem: 3, cor: 'sky', tipo: 'ABERTA', ativo: true },
];
const negocioTeste = (extra: Record<string, unknown> = {}) => ({ id: 'n-1', corretor_id: 'owner', cliente_id: 'cliente-1', imovel_id: null, etapa_id: 'e-novo', titulo: 'Neves', valor_estimado: 0, probabilidade: 0, data_prevista_fechamento: null, motivo_perda: null, origem: 'whatsapp', ordem: 0, observacoes: null, fechada_em: null, created_at: '2026-10-09T12:00:00Z', updated_at: '2026-10-09T12:00:00.123456+00:00', ...extra });

it('a pílula ETAPA mostra a etapa do negócio no Funil, a mesma do cartão (não o status antigo do cadastro)', async () => {
  // O lead novo nasce com status_funil 'QUALIFICACAO' e o negócio em "Novo lead": o Inbox dizia
  // "Qualificação" e o Funil "Novo lead". Agora os dois leem o negócio.
  dataByTable.lotti_agent_conversations = [conversationFixture({ cliente_id: 'cliente-1', contact_name: 'Neves' })];
  dataByTable.clientes = [{ id: 'cliente-1', nome: 'Neves', email: null, telefone: '5511999990000', created_at: '2026-09-20T12:00:00Z', status_funil: 'QUALIFICACAO', tipo_interesse: 'AMBOS' }];
  dataByTable.crm_etapas = ETAPAS_TESTE;
  // Outro negócio já na coluna de destino: a ordem do movido tem de ser 1 (fim da coluna), não a dele (5).
  dataByTable.crm_oportunidades = [negocioTeste({ ordem: 5 }), negocioTeste({ id: 'n-outro', cliente_id: 'outro', etapa_id: 'e-quali', ordem: 0 })];
  try {
    mount(true);
    await screen.findByRole('button', { name: /Neves/ });
    await waitFor(() => expect(screen.getByTestId('conversation-stage-pill').textContent).toContain('Novo lead'));
    expect(screen.getByTestId('conversation-stage-pill').textContent).not.toContain('Qualificação');

    // Trocar pela pílula é o mesmo movimento de arrastar no Funil (mesmo token de concorrência).
    const pilula = screen.getByTestId('conversation-stage-pill');
    pilula.focus();
    fireEvent.keyDown(pilula, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Em qualificação/ }));
    await waitFor(() => expect(mockDb.updates).toContainEqual({ table: 'crm_oportunidades', valores: { etapa_id: 'e-quali', ordem: 1 } }));
    // Mesmo token de concorrência do arrastar no quadro: o id do negócio e o updated_at exato.
    expect(mockDb.eqs).toContainEqual({ table: 'crm_oportunidades', coluna: 'id', valor: 'n-1' });
    expect(mockDb.eqs).toContainEqual({ table: 'crm_oportunidades', coluna: 'updated_at', valor: '2026-10-09T12:00:00.123456+00:00' });
  } finally {
    delete dataByTable.clientes; delete dataByTable.crm_etapas; delete dataByTable.crm_oportunidades;
  }
});

it('a pílula ETAPA acompanha o PRIMEIRO movimento do negócio feito pelo agente (evento de etapa novo)', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ cliente_id: 'cliente-1', contact_name: 'Neves' })];
  dataByTable.crm_etapas = ETAPAS_TESTE;
  dataByTable.crm_oportunidades = [negocioTeste()];
  try {
    mount(true);
    await waitFor(() => expect(screen.getByTestId('conversation-stage-pill').textContent).toContain('Novo lead'));
    // O agente transfere: o banco move o negócio e grava o primeiro evento 'stage' da conversa.
    dataByTable.crm_oportunidades = [negocioTeste({ etapa_id: 'e-quali', updated_at: '2026-10-09T12:05:00.000001+00:00' })];
    dataByTable.lotti_inbox_events = [{ id: 'ev-1', kind: 'stage', from_label: 'Novo lead', to_label: 'Em qualificação', subject_label: 'Neves', actor_label: 'transferência automática para a equipe', created_at: '2026-10-09T12:05:00Z' }];
    await waitFor(() => expect(screen.getByTestId('conversation-stage-pill').textContent).toContain('Em qualificação'), { timeout: 6000 });
  } finally {
    delete dataByTable.crm_etapas; delete dataByTable.crm_oportunidades;
  }
}, 10000);

it('a pílula ETAPA diz quando o cliente não tem negócio no Funil', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ cliente_id: 'cliente-1', contact_name: 'Neves' })];
  dataByTable.crm_etapas = ETAPAS_TESTE;
  dataByTable.crm_oportunidades = [negocioTeste({ cliente_id: 'outro-cliente' })];
  try {
    mount(true);
    await waitFor(() => expect(screen.getByTestId('conversation-stage-pill').textContent).toContain('Sem negócio no funil'));
  } finally {
    delete dataByTable.crm_etapas; delete dataByTable.crm_oportunidades;
  }
});

it('evento antigo de status do cadastro aparece com o rótulo, não com o código do banco', async () => {
  dataByTable.lotti_inbox_events = [
    { id: 'e1', kind: 'stage', from_label: 'QUALIFICACAO', to_label: 'VISITA_PROPOSTA', subject_label: null, actor_label: 'Corretor', created_at: '2026-09-24T14:00:00Z' },
  ];
  mount(true);
  expect(await screen.findByText(/Status do cadastro mudou de Qualificação para Visita\/Proposta por Corretor/)).not.toBeNull();
});

it('o botão de adicionar ao CRM não existe mais: a conversa já entra sozinha', async () => {
  // A ligação virou invariante do banco (20260930190000): conversa com número
  // nasce com cliente em "Em qualificação". Um botão aqui só repetiria isso,
  // e repetia mal — era preciso lembrar de clicar, conversa por conversa.
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Neves' })];
  mount(true);
  await screen.findByRole('button', { name: /Neves/ });
  expect(screen.queryByRole('button', { name: 'Adicionar ao CRM' })).toBeNull();
  expect(previewRpc).not.toHaveBeenCalledWith('lotti_inbox_add_to_crm', expect.anything());
});

it('número oculto: a conversa diz que espera o número, sem botão morto', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ phone: null, lid: '123456789012345', contact_name: 'Paula' })];
  mount(true);
  await screen.findByRole('button', { name: /Paula/ });
  expect(screen.getByTestId('conversation-stage-pill').textContent).toContain('Sem cliente vinculado');
  expect(screen.queryByRole('button', { name: 'Adicionar ao CRM' })).toBeNull();
});

it('conversa que já é cliente oferece o cadastro', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ cliente_id: 'cliente-1', contact_name: 'Neves' })];
  mount(true);
  await screen.findByRole('button', { name: /Neves/ });
  expect(screen.getByRole('link', { name: 'Abrir cadastro do cliente' })).not.toBeNull();
});

const OTHER = '0b7c3c9e-4a8f-4a45-9f0e-0f3f1c2d3e4f';
function editPhone(phone: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Editar nome' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Telefone' }), { target: { value: phone } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar contato' }));
}

it('telefone de outra conversa: explica e une as duas pelo servidor', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Neves' })];
  mockDb.rpcResults.lotti_inbox_update_contact = { data: null, error: { message: 'phone_in_other_conversation', details: OTHER, code: 'P0001' } };
  mockDb.rpcResults.lotti_inbox_merge_conversations = { data: { conversation_id: OTHER, merged_id: 'c1' }, error: null };
  mount(true);
  await screen.findByRole('button', { name: /Neves/ });
  editPhone('(11) 98888-7777');
  expect((await screen.findByRole('alert')).textContent).toContain('Este telefone já está em outra conversa');
  mockDb.rpcResults.lotti_inbox_update_contact = { data: { name: 'Neves', phone: '5511988887777' }, error: null };
  fireEvent.click(screen.getByRole('button', { name: 'Unir conversas' }));
  await waitFor(() => expect(previewRpc).toHaveBeenCalledWith('lotti_inbox_merge_conversations', { p_keep: 'c1', p_drop: OTHER }));
  // The typed name is kept on the conversation that survives the merge.
  await waitFor(() => expect(previewRpc).toHaveBeenCalledWith('lotti_inbox_update_contact', { p_conversation: OTHER, p_name: 'Neves', p_phone: '5511988887777' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar contato' })).toBeNull());
});

it('conversas de contatos diferentes do WhatsApp não são unidas, e a tela diz por quê', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Neves' })];
  mockDb.rpcResults.lotti_inbox_update_contact = { data: null, error: { message: 'phone_in_other_conversation', details: OTHER } };
  mockDb.rpcResults.lotti_inbox_merge_conversations = { data: null, error: { message: 'different_contacts' } };
  mount(true);
  await screen.findByRole('button', { name: 'Editar nome' });
  editPhone('(11) 98888-7777');
  fireEvent.click(await screen.findByRole('button', { name: 'Unir conversas' }));
  expect((await screen.findByText(/contatos diferentes/)).textContent).toContain('não podem ser unidas');
  expect(screen.queryByRole('button', { name: 'Unir conversas' })).toBeNull();
});

it('telefone que já é de outro cliente do CRM: a conversa passa para esse cliente e a tela avisa', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Neves', cliente_id: 'cliente-1' })];
  mockDb.rpcResults.lotti_inbox_update_contact = { data: { name: 'Neves', phone: '5511988887777', cliente_id: 'cliente-2', relinked: true }, error: null };
  mount(true);
  await screen.findByRole('button', { name: 'Editar nome' });
  editPhone('(11) 98888-7777');
  await waitFor(() => expect(avisos).toContain('Este telefone já era de outro cliente do CRM. A conversa foi vinculada a esse cadastro.'));
  expect(previewRpc).toHaveBeenCalledWith('lotti_inbox_update_contact', { p_conversation: 'c1', p_name: 'Neves', p_phone: '5511988887777' });
  await waitFor(() => expect(mockDb.reads.clientes ?? 0).toBeGreaterThan(0));
});

it('nova conversa sem confirmação da entrega abre a conversa com o aviso, sem erro', async () => {
  mockDb.invokeResult = { data: { sendStatus: 'uncertain', conversationId: 'c1' }, error: null };
  mount(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Nova' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Telefone' }), { target: { value: '(11) 99999-0000' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem inicial' }), { target: { value: 'Olá' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
  await waitFor(() => expect(avisos).toContain('Envio sem confirmação. Confira no WhatsApp antes de mandar de novo.'));
  expect(screen.queryByRole('dialog', { name: 'Nova conversa' })).toBeNull();
  const body = (previewInvoke.mock.calls[0][1] as { body: { request_id: string } }).body;
  expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/);
});

it('nova conversa recusada mostra o motivo que veio da Edge Function', async () => {
  mockDb.invokeResult = { data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'conversation_unavailable', reason: 'channel_unavailable' }) } } };
  mount(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Nova' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Telefone' }), { target: { value: '(11) 99999-0000' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem inicial' }), { target: { value: 'Olá' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Conecte o WhatsApp antes de iniciar uma conversa.');
});

it('no celular a lista vira gaveta: abre pelo cabeçalho e fecha ao escolher', async () => {
  // Empilhada, a lista ficava inteira acima do chat e era preciso rolar dezenas
  // de conversas para alcançar a mensagem. Agora ela desliza por cima.
  mountConectado();

  const lista = await screen.findByRole('navigation', { name: 'Conversas conectadas' });
  expect(lista.className).toContain('max-lg:-translate-x-[104%]');

  fireEvent.click(screen.getByRole('button', { name: 'Ver conversas' }));
  await waitFor(() => expect(lista.className).toContain('max-lg:translate-x-0'));
  expect(screen.getByRole('button', { name: 'Fechar lista de conversas' })).not.toBeNull();

  // Tocar fora fecha, que é o gesto de quem abriu a gaveta sem querer.
  fireEvent.click(screen.getByRole('button', { name: 'Fechar lista de conversas' }));
  await waitFor(() => expect(lista.className).toContain('max-lg:-translate-x-[104%]'));
});

it('trocar de conversa abre no fim, mesmo depois de ter subido na anterior', async () => {
  // O corretor sobe para reler algo numa conversa e clica na próxima: a nova
  // abria no topo, obrigando a rolar até o fim toda vez.
  dataByTable.lotti_agent_conversations = [
    { id: 'c1', phone: '5511999990000', cliente_id: null, mode: 'ai', updated_at: new Date().toISOString(), qualification: {}, last_error: null },
    { id: 'c2', phone: '5511888880000', cliente_id: null, mode: 'ai', updated_at: new Date().toISOString(), qualification: {}, last_error: null },
  ];
  dataByTable.lotti_agent_messages = Array.from({ length: 30 }, (_, i) => ({
    id: `m${i}`, direction: 'in', sender: 'lead', content: `Mensagem ${i}`,
    media_path: null, created_at: new Date(Date.parse('2026-09-27T12:00:00Z') + i * 60000).toISOString(),
  }));
  const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2400);
  mount(true);

  const trilha = await screen.findByTestId('message-timeline');
  await waitFor(() => expect(trilha.scrollTop).toBe(2400));

  // Sobe na conversa atual (com a rodinha): a partir daqui a tela não deve mais perseguir o fim.
  fireEvent.wheel(trilha, { deltaY: -400 });
  trilha.scrollTop = 0;
  fireEvent.scroll(trilha);

  fireEvent.click(await screen.findByRole('button', { name: /8888/ }));
  await waitFor(() => expect(screen.getByTestId('message-timeline').scrollTop).toBe(2400));
  height.mockRestore();
});

it('linha do tempo segue a data, não a ordem em que os eventos são montados', async () => {
  // A conversa é mais ANTIGA que o cadastro do cliente aqui de propósito: só
  // assim o teste prova que existe ordenação, e não que a lista já vinha certa.
  dataByTable.lotti_agent_conversations = [
    { id: 'c1', phone: '5511999990000', cliente_id: 'cli-1', mode: 'ai', updated_at: '2026-09-20T10:00:00Z', qualification: {}, last_error: null },
  ];
  dataByTable.clientes = [{ id: 'cli-1', nome: 'Marina', created_at: '2026-09-24T23:06:43Z' }];
  mount(true);

  const tempos = await waitFor(() => {
    const encontrados = screen.getAllByText(/\/2026,/);
    expect(encontrados.length).toBeGreaterThanOrEqual(2);
    return encontrados;
  });
  expect(tempos[0].textContent).toContain('20/09/2026');
  expect(tempos[1].textContent).toContain('24/09/2026');
});

it('envio sem confirmação oferece a saída na própria tela', async () => {
  dataByTable.lotti_agent_conversations = [
    { id: 'c1', phone: '5511999990000', cliente_id: null, mode: 'human', updated_at: new Date().toISOString(), qualification: {}, last_error: 'delivery_failed_or_uncertain' },
  ];
  mount(true);

  const faixa = await screen.findByTestId('motivo-da-parada');
  expect(faixa.textContent).toContain('o envio não foi confirmado');

  fireEvent.click(within(faixa).getByRole('button', { name: 'A mensagem chegou' }));
  await waitFor(() => expect(previewRpc).toHaveBeenCalledWith('lotti_agent_reconciliar_envio', { p_id: 'c1', p_chegou: true }));
});

it('motivo que não é de envio não oferece os botões', async () => {
  dataByTable.lotti_agent_conversations = [
    { id: 'c1', phone: '5511999990000', cliente_id: null, mode: 'human', updated_at: new Date().toISOString(), qualification: {}, last_error: 'quota_exhausted' },
  ];
  mount(true);
  await screen.findByRole('button', { name: 'Editar nome' });
  expect(screen.queryByTestId('motivo-da-parada')).toBeNull();
});

it('o rodapé mostra o total real, não o teto da página', async () => {
  // A consulta traz no máximo 100; com 104 existindo, o rodapé dizia
  // "100 de 100" e parecia que não havia mais nada.
  // A lista vem cortada em 100 (o teto da consulta); abaixo disso ela mesma é a contagem.
  dataByTable.lotti_agent_conversations = Array.from({ length: 100 }, (_, i) => (
    { id: `c${i}`, phone: `55119999${String(i).padStart(5, '0')}`, cliente_id: null, mode: 'ai', updated_at: new Date().toISOString(), qualification: {}, last_error: null }));
  mockDb.counts.lotti_agent_conversations = 104;
  mount(true);
  expect(await screen.findByText('100 de 104')).toBeTruthy();
  delete mockDb.counts.lotti_agent_conversations;
});

it('IA esperando a vez dela não aparece como problema', async () => {
  // `lotti_agent_defer` grava o motivo da espera no mesmo campo das falhas.
  // Juntar mensagens por 10 segundos é o comportamento certo, e a tela dizia
  // "Esta conversa precisa de revisão operacional".
  dataByTable.lotti_agent_conversations = [
    { id: 'c1', phone: '5511999990000', cliente_id: null, mode: 'ai', updated_at: new Date().toISOString(), qualification: {}, last_error: 'aggregation' },
  ];
  mount(true);
  await screen.findByRole('button', { name: 'Editar nome' });
  expect(screen.queryByTestId('espera-da-ia')).toBeNull();
  expect(document.body.textContent).not.toContain('Juntando as mensagens');
  expect(screen.queryByTestId('motivo-da-parada')).toBeNull();
  expect(document.body.textContent).not.toContain('revisão operacional');
});

it('como no Clix: abre nas Abertas e as fechadas ficam em Fechadas, com quem fechou', async () => {
  dataByTable.lotti_agent_conversations = [
    conversationFixture({ id: 'c-aberta', contact_name: 'Ana Aberta', status: 'open' }),
    conversationFixture({ id: 'c-fechada', phone: '5511999990009', contact_name: 'Bruno Fechado', status: 'closed', closed_by: 'silencio' }),
    conversationFixture({ id: 'c-vendedor', phone: '5511999990008', contact_name: 'Carla Vendedor', status: 'closed', closed_by: 'humano' }),
  ];
  mount(true);
  expect(await screen.findByRole('button', { name: /Ana Aberta/ })).not.toBeNull();
  expect(screen.queryByRole('button', { name: /Bruno Fechado/ })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /^Fechadas/ }));
  expect(await screen.findByRole('button', { name: /Bruno Fechado.*Fechada · Sem resposta/ })).not.toBeNull();
  expect(screen.getByRole('button', { name: /Carla Vendedor.*Fechada · Vendedor/ })).not.toBeNull();
  expect(screen.queryByRole('button', { name: /Ana Aberta/ })).toBeNull();
  // O filtro "Fechada por" saiu a pedido do corretor; quem fechou continua escrito em cada conversa.
  expect(screen.queryByRole('combobox', { name: 'Fechada por' })).toBeNull();
  // O lado escolhido fica marcado e a contagem bate com a lista na tela.
  const fechadas = screen.getByRole('button', { name: /^Fechadas/ });
  expect(fechadas.getAttribute('aria-pressed')).toBe('true');
  expect(fechadas.className).toContain('border-primary');
  expect(fechadas.textContent).toBe('Fechadas2');
});

it('fechada pela IA porque o cliente encerrou aparece como "Cliente pediu", com o motivo', async () => {
  dataByTable.lotti_agent_conversations = [
    conversationFixture({ id: 'c-ia', contact_name: 'Dora Encerrou', status: 'closed', closed_by: 'cliente', closed_reason: 'cliente disse que era só isso' }),
  ];
  mount(true);
  fireEvent.click(await screen.findByRole('button', { name: /^Fechadas/ }));
  expect(await screen.findByRole('button', { name: /Dora Encerrou.*Fechada · Cliente pediu/ })).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Fechada · Cliente pediu' }).getAttribute('title')).toBe('Motivo: cliente disse que era só isso');
});

it('foto e arquivo recebidos sem a mídia guardada viram cartão com "Arquivo indisponível", não texto solto', async () => {
  dataByTable.lotti_agent_messages = [
    { id: 'f1', direction: 'in', sender: 'lead', content: '📷 Foto', media_path: null, created_at: '2026-10-08T13:59:00Z' },
    { id: 'f2', direction: 'in', sender: 'lead', content: '📄 Lotti.maestri', media_path: null, created_at: '2026-10-08T14:00:00Z' },
  ];
  mount(true);
  expect(await screen.findByText('Lotti.maestri')).not.toBeNull();
  expect(screen.getAllByText('Foto').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Arquivo indisponível')).toHaveLength(2);
  expect(screen.queryByText('📷 Foto')).toBeNull();
});

it('foto recebida com o arquivo guardado aparece como imagem, mesmo com o texto "📷 Foto"', async () => {
  dataByTable.lotti_agent_messages = [
    { id: 'f3', direction: 'in', sender: 'lead', content: '📷 Foto', media_path: 'corretor/in/K1/foto.jpg', created_at: '2026-10-08T14:01:00Z' },
  ];
  mount(true);
  const imagem = await screen.findByRole('img', { name: 'Foto' });
  expect(imagem.getAttribute('src')).toBe('https://example.invalid/Custos.xlsx');
});

it('conteúdo que cresce depois de aberto (foto carregando, eventos) mantém a conversa no fim', async () => {
  const observados: Element[] = [];
  const avisos: Array<() => void> = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: () => void) { avisos.push(cb); }
    observe(alvo: Element) { observados.push(alvo); }
    disconnect() {}
  });
  const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2400);
  dataByTable.lotti_agent_messages = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, direction: 'in', sender: 'lead', content: `Mensagem ${i}`, media_path: null, created_at: new Date(Date.parse('2026-09-27T12:00:00Z') + i * 60000).toISOString() }));
  mount(true);
  const trilha = await screen.findByTestId('message-timeline');
  await waitFor(() => expect(trilha.scrollTop).toBe(2400));
  // O vigia olha o conteúdo de dentro, não só a caixa.
  expect(observados.some(alvo => alvo !== trilha && trilha.contains(alvo))).toBe(true);
  height.mockReturnValue(3100);
  avisos.forEach(aviso => aviso());
  expect(trilha.scrollTop).toBe(3100);
  height.mockRestore();
  vi.unstubAllGlobals();
});

it('IA parada com motivo aparece como no Clix: quem assumiu pelo Inbox e a espera pelo celular', async () => {
  dataByTable.lotti_inbox_events = [
    { id: 'e1', kind: 'pausa', from_label: 'IA', to_label: 'Em espera', subject_label: 'respondeu_whatsapp', actor_label: 'a equipe', created_at: '2026-09-24T14:01:00Z' },
    { id: 'e2', kind: 'mode', from_label: 'ai', to_label: 'Equipe', subject_label: 'assumiu_inbox', actor_label: 'Evandro', created_at: '2026-09-24T14:02:00Z' },
    { id: 'e3', kind: 'mode', from_label: 'ai', to_label: 'Equipe', subject_label: 'respondeu_whatsapp', actor_label: 'a equipe', created_at: '2026-09-24T14:03:00Z' },
    { id: 'e4', kind: 'mode', from_label: 'Equipe', to_label: 'IA', subject_label: null, actor_label: 'Evandro', created_at: '2026-09-24T14:04:00Z' },
  ];
  mount(true);
  const avisos = await screen.findAllByTestId('evento-com-motivo');
  expect(avisos.map(a => a.textContent?.replace(/·.*$/, '').trim())).toEqual([
    'IA em espera porque a equipe respondeu pelo WhatsApp',
    'IA desligada: Evandro assumiu a conversa',
    'IA desligada porque a equipe respondeu pelo WhatsApp',
  ]);
  expect(Array.from(avisos[1].querySelectorAll('strong')).map(s => s.textContent)).toEqual(['desligada', 'Evandro']);
  // Troca sem motivo continua no formato de sempre.
  expect(screen.getByText(/IA ligada por Evandro/)).not.toBeNull();
});

it('abre no fim mesmo quando o aviso da própria rolagem chega depois de a conversa crescer; só a pessoa tira do fim', async () => {
  const avisos: Array<() => void> = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: () => void) { avisos.push(cb); }
    observe() {}
    disconnect() {}
  });
  const altura = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2400);
  dataByTable.lotti_agent_messages = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, direction: 'in', sender: 'lead', content: `Mensagem ${i}`, media_path: null, created_at: new Date(Date.parse('2026-09-27T12:00:00Z') + i * 60000).toISOString() }));
  try {
    mount(true);
    const trilha = await screen.findByTestId('message-timeline');
    await waitFor(() => expect(trilha.scrollTop).toBe(2400));
    // Fotos e eventos chegam: a conversa cresce e o aviso de rolagem (do nosso scrollTop) chega atrasado,
    // longe do fim. Não foi a pessoa: continua acompanhando o fim.
    altura.mockReturnValue(3200);
    fireEvent.scroll(trilha);
    avisos.forEach(aviso => aviso());
    expect(trilha.scrollTop).toBe(3200);
    // Agora a pessoa sobe com a rodinha: a conversa cresce de novo e a tela não puxa para baixo.
    fireEvent.wheel(trilha, { deltaY: -500 });
    trilha.scrollTop = 1000;
    fireEvent.scroll(trilha);
    altura.mockReturnValue(3600);
    avisos.forEach(aviso => aviso());
    expect(trilha.scrollTop).toBe(1000);
  } finally {
    altura.mockRestore();
    vi.unstubAllGlobals();
  }
});

it('responder citando: o ↩ abre "Respondendo a", o × cancela e a citação aparece no balão', async () => {
  dataByTable.lotti_agent_messages = [
    { id: 'q1', direction: 'in', sender: 'lead', content: 'Tem com 3 quartos?', media_path: null, created_at: '2026-10-09T12:00:00Z', external_id: 'WA-1' },
    { id: 'q2', direction: 'out', sender: 'human', content: 'Tem sim!', media_path: null, created_at: '2026-10-09T12:01:00Z', external_id: 'WA-2', quoted_external_id: 'WA-1', quoted_content: 'Tem com 3 quartos?', quoted_from_me: false },
    { id: 'q3', direction: 'in', sender: 'lead', content: 'Ligação perdida', media_path: null, created_at: '2026-10-09T12:02:00Z', external_id: 'call-1' },
  ];
  mount(true);
  const citacao = await screen.findByTestId('citacao');
  expect(citacao.textContent).toContain('Cliente');
  expect(citacao.textContent).toContain('Tem com 3 quartos?');
  // Ligação não pode ser citada: só as duas mensagens reais têm o botão.
  expect(screen.getAllByRole('button', { name: 'Responder citando' })).toHaveLength(2);
  fireEvent.click(screen.getAllByRole('button', { name: 'Responder citando' })[0]);
  expect((await screen.findByTestId('respondendo-a')).textContent).toContain('Tem com 3 quartos?');
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar resposta' }));
  expect(screen.queryByTestId('respondendo-a')).toBeNull();
});

it('reabrir a partir de Fechadas manda o id da conversa e volta para Abertas', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ id: 'c-f', contact_name: 'Felipe Fechado', status: 'closed', closed_by: 'humano' })];
  mount(true);
  fireEvent.click(await screen.findByRole('button', { name: /^Fechadas/ }));
  fireEvent.click(await screen.findByRole('button', { name: /^Fechada · Vendedor$/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Reabrir' }));
  await waitFor(() => expect(previewRpc).toHaveBeenCalledWith('lotti_inbox_set_status', { p_conversation: 'c-f', p_status: 'open' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /^Abertas/ }).getAttribute('aria-pressed')).toBe('true'));
});

it('aberto por ?telefone=, seleciona a conversa e tira o telefone do endereço', async () => {
  const { useLocation } = await import('react-router-dom');
  function Endereco() { const l = useLocation(); return <output data-testid="endereco">{l.pathname + l.search}</output>; }
  dataByTable.lotti_agent_conversations = [conversationFixture({ id: 'c-tel', contact_name: 'Telefone Alvo', phone: '5511988887777' })];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter initialEntries={['/whatsapp?telefone=5511988887777']}><QueryClientProvider client={client}><ConnectedInbox connected /><Endereco /></QueryClientProvider></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId('endereco').textContent).toBe('/whatsapp'));
  expect(await screen.findByRole('button', { name: 'Editar nome' })).not.toBeNull();
});
