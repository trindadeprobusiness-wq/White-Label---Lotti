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
const mockDb = { missingColumns: false, missingOptOut: false, filters: [] as string[], reads: {} as Record<string, number>, rpcError: null as null | { message: string },
  rpcResults: {} as Record<string, { data: unknown; error: unknown }>, invokeResult: null as null | { data: unknown; error: unknown } };
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
      if (table === 'lotti_agent_conversations' && mockDb.missingOptOut && columns.includes('opted_out_at'))
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
    rpc: (...args: unknown[]) => { previewRpc(...args); const named = mockDb.rpcResults[args[0] as string]; if (named) return Promise.resolve(named); return Promise.resolve(mockDb.rpcError ? { data: null, error: mockDb.rpcError } : { data: true, error: null }); },
    functions: { invoke: (...args: unknown[]) => { previewInvoke(...args); return Promise.resolve(mockDb.invokeResult ?? { data: { sendStatus: 'sent' }, error: null }); } },
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
  await screen.findByRole('button', { name: /99999-0000/ });
  await waitFor(() => expect(mockDb.reads.lotti_agent_messages).toBeGreaterThan(0));
  const listBefore = mockDb.reads.lotti_agent_conversations;
  const messagesBefore = mockDb.reads.lotti_agent_messages;
  await new Promise(resolve => setTimeout(resolve, 3500));
  expect(mockDb.reads.lotti_agent_messages - messagesBefore).toBeGreaterThanOrEqual(2);
  expect(mockDb.reads.lotti_agent_conversations - listBefore).toBeLessThanOrEqual(1);
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); mockDb.missingColumns = false; mockDb.missingOptOut = false; mockDb.rpcError = null; mockDb.rpcResults = {}; mockDb.invokeResult = null; mockDb.filters = []; mockDb.reads = {}; dataByTable.lotti_agent_conversations = [conversationFixture()]; dataByTable.lotti_agent_messages = []; dataByTable.lotti_inbox_events = []; });

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
      profile: { budget: 'até 500 mil', timeframe: 'em 3 meses', needs: '2 quartos com garagem', nextStep: 'enviar opções', region: 'Centro' } },
  })];
  mount(true);
  const profile = await screen.findByRole('complementary', { name: 'Perfil do contato' });
  expect(profile.textContent).toContain('Quer comprar no Centro com financiamento aprovado.');
  expect(profile.textContent).toContain('Qualificado para busca');
  expect(profile.textContent).toContain('Prioridade alta');
  for (const [label, value] of [['Orçamento', 'até 500 mil'], ['Prazo', 'em 3 meses'], ['Essenciais', '2 quartos com garagem'], ['Próximo passo', 'enviar opções'], ['Região', 'Centro']]) {
    const term = Array.from(profile.querySelectorAll('dt')).find(dt => dt.textContent === label);
    expect(term?.nextElementSibling?.textContent).toBe(value);
  }
});

it('abre a conversa rolada até a última mensagem, como no WhatsApp', async () => {
  const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2400);
  dataByTable.lotti_agent_messages = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, direction: i % 2 ? 'out' : 'in', sender: i % 2 ? 'human' : 'lead', content: `Mensagem ${i}`, media_path: null, created_at: new Date(Date.parse('2026-09-27T12:00:00Z') + i * 60000).toISOString() }));
  mount(true);
  await screen.findByText('Mensagem 29');
  await waitFor(() => expect(screen.getByTestId('message-timeline').scrollTop).toBe(2400));
  height.mockRestore();
});

it('conversa sem cliente vinculado entra no CRM com um clique e o botão some', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Neves' })];
  mount(true);
  const button = await screen.findByRole('button', { name: 'Adicionar ao CRM' });
  expect(screen.getByTestId('conversation-stage-pill').textContent).toContain('Sem cliente vinculado');
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Neves', cliente_id: 'cliente-1' })];
  fireEvent.click(button);
  await waitFor(() => expect(previewRpc).toHaveBeenCalledWith('lotti_inbox_add_to_crm', { p_conversation: 'c1' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Adicionar ao CRM' })).toBeNull());
  expect(screen.queryByRole('alert')).toBeNull();
});

it('explica quando não foi possível adicionar ao CRM', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Neves' })];
  mockDb.rpcError = { message: 'phone_required' };
  mount(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Adicionar ao CRM' }));
  expect((await screen.findByRole('alert')).textContent).toContain('ainda não revelou o número');
  mockDb.rpcError = { message: 'boom' };
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar ao CRM' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Não foi possível adicionar ao CRM'));
});

it('número oculto: o botão espera o WhatsApp revelar o número e diz isso na tela', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ phone: null, lid: '123456789012345', contact_name: 'Paula' })];
  mount(true);
  const button = await screen.findByRole('button', { name: 'Adicionar ao CRM' });
  expect(button.hasAttribute('disabled')).toBe(true);
  expect(screen.getByText('Aguardando o número do WhatsApp')).not.toBeNull();
  expect(button.getAttribute('aria-describedby')).toBe('crm-waiting-phone');
});

it('conversa que já é cliente não mostra o botão', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ cliente_id: 'cliente-1', contact_name: 'Neves' })];
  mount(true);
  await screen.findByRole('button', { name: /Neves/ });
  expect(screen.queryByRole('button', { name: 'Adicionar ao CRM' })).toBeNull();
});

it('depois de adicionar ao CRM, atualiza a lista de clientes do CRM', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Neves' })];
  mount(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Adicionar ao CRM' }));
  await waitFor(() => expect(mockDb.reads.clientes ?? 0).toBeGreaterThan(0));
});

it('o erro ao adicionar uma conversa não aparece em outra conversa', async () => {
  dataByTable.lotti_agent_conversations = [conversationFixture({ contact_name: 'Neves' }), conversationFixture({ id: 'c2', phone: '5511888880000', contact_name: 'Ana' })];
  mockDb.rpcError = { message: 'boom' };
  mount(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Adicionar ao CRM' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: /Ana/ }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByRole('button', { name: 'Adicionar ao CRM' }).hasAttribute('disabled')).toBe(false);
});

it('na prévia, adicionar ao CRM não chama o banco nem mostra link de cadastro', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><ConnectedInbox connected={false} preview /></QueryClientProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Adicionar ao CRM' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Adicionar ao CRM' })).toBeNull());
  expect(previewRpc).not.toHaveBeenCalledWith('lotti_inbox_add_to_crm', expect.anything());
  expect(screen.queryByText('Abrir cadastro do cliente')).toBeNull();
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
  expect(await screen.findByText('Este telefone já era de outro cliente do CRM. A conversa foi vinculada a esse cadastro.')).not.toBeNull();
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
  expect(await screen.findByText('Envio sem confirmação. Confira no WhatsApp antes de mandar de novo.')).not.toBeNull();
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
