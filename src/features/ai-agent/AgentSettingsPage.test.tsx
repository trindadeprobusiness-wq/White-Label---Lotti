// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AgentSettingsPage from './AgentSettingsPage';
import { AGENT_SETTINGS_STORAGE_KEY, createDefaultAgentSettings } from './settings';

// Banco simulado: sem a migration (padrão dos testes antigos) ou com a tabela.
const { server } = vi.hoisted(() => ({ server: { installed: false, failSave: false, row: null as null | { settings: unknown }, saves: [] as unknown[] } }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({ select: () => ({ maybeSingle: async () => (server.installed ? { data: server.row, error: null } : { data: null, error: { code: '42P01' } }) }) }),
    rpc: async (_name: string, args: { p_settings: unknown }) => {
      if (!server.installed) return { data: null, error: { code: 'PGRST202' } };
      if (server.failSave) return { data: null, error: { code: '500' } };
      server.saves.push(args.p_settings);
      server.row = { settings: args.p_settings };
      return { data: { updated_at: '2026-09-27T12:00:00Z' }, error: null };
    },
  },
}));

vi.mock('@/hooks/crm/useCrm', () => ({
  useEtapas: () => ({
    data: [
      { id: 'etapa-humano', nome: 'Atendimento humano' },
      { id: 'etapa-sem-retorno', nome: 'Sem retorno' },
    ],
    isError: false,
    isPending: false,
  }),
}));

afterEach(() => {
  Object.assign(server, { installed: false, failSave: false, row: null, saves: [] });
  localStorage.clear();
  cleanup();
});

const stored = () => JSON.parse(localStorage.getItem(AGENT_SETTINGS_STORAGE_KEY) ?? 'null');
const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
const save = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' })); }); await act(async () => { await Promise.resolve(); }); };

it('saves the active state locally without any WhatsApp connection control', async () => {
  render(<AgentSettingsPage />);

  expect(screen.getByRole('heading', { name: 'Agente de IA' })).toBeTruthy();
  expect(screen.queryByText(/Conecte ao WhatsApp/i)).toBeNull();
  expect(screen.queryByText(/QR/)).toBeNull();

  fireEvent.click(screen.getByRole('switch', { name: 'Agente ativo' }));
  expect(screen.getByText('Alterações não salvas')).toBeTruthy();
  await save();

  expect(screen.getByText('Salvo neste navegador')).toBeTruthy();
  expect(stored().active).toBe(true);
});

it('shows the model in use and changes it from the identity tab', async () => {
  render(<AgentSettingsPage />);
  expect(screen.getByTestId('model-in-use').textContent).toContain('GPT-4o mini');

  // O link "Trocar modelo" saiu: o modelo virou um cartão do resumo, e os
  // cartões já levam à aba ao serem clicados. Era um botão a mais para a
  // mesma viagem, ao lado de uma informação que já aparecia duas vezes.
  openTab('Prompt');
  fireEvent.click(within(screen.getByTestId('model-in-use')).getByRole('button'));
  expect(screen.getByRole('tab', { name: 'Identidade' }).getAttribute('aria-selected')).toBe('true');

  fireEvent.change(screen.getByLabelText('Modelo de IA'), { target: { value: 'gpt-4.1-mini' } });
  await save();

  expect(screen.getByTestId('model-in-use').textContent).toContain('GPT-4.1 mini');
  expect(stored().model).toBe('gpt-4.1-mini');
});

it('does not show loose notices in any tab', async () => {
  render(<AgentSettingsPage />);

  for (const tab of ['Identidade', 'Comportamento', 'Ciclo da conversa', 'Agendamento', 'Ferramentas', 'Prompt']) {
    openTab(tab);
    expect(screen.queryByText(/nenhuma mensagem é enviada|salva só neste navegador/i)).toBeNull();
  }
});

it('blocks saving while a tab has an error and points to that tab', async () => {
  render(<AgentSettingsPage />);

  fireEvent.change(screen.getByLabelText('Nome do agente'), { target: { value: '' } });
  openTab('Prompt');
  await save();

  expect(stored()).toBeNull();
  const alert = screen.getByRole('alert');
  expect(within(alert).getByText('Dê um nome ao agente.')).toBeTruthy();
  fireEvent.click(within(alert).getByRole('button', { name: 'Abrir Identidade' }));
  expect(screen.getByRole('tab', { name: 'Identidade' }).getAttribute('aria-selected')).toBe('true');
});

it('discards unsaved changes back to the last saved version', async () => {
  render(<AgentSettingsPage />);

  fireEvent.change(screen.getByLabelText('Nome do agente'), { target: { value: 'Lia' } });
  fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));

  expect((screen.getByLabelText('Nome do agente') as HTMLInputElement).value).toBe('Ana');
  expect(screen.queryByText('Alterações não salvas')).toBeNull();
});

it('previews the greeting with the agent and company names', async () => {
  render(<AgentSettingsPage />);

  fireEvent.change(screen.getByLabelText('Nome do agente'), { target: { value: 'Lia' } });
  fireEvent.change(screen.getByLabelText('Nome da imobiliária'), { target: { value: 'Imobiliária Aurora' } });

  expect(screen.getByTestId('greeting-preview').textContent).toBe('Olá! Aqui é Lia, da Imobiliária Aurora. Como posso ajudar você a encontrar seu imóvel?');
});

it('opens the matching tab from the summary of the active card', async () => {
  render(<AgentSettingsPage />);

  fireEvent.click(screen.getByRole('button', { name: /Follow-up/ }));

  expect(screen.getByRole('tab', { name: 'Ciclo da conversa' }).getAttribute('aria-selected')).toBe('true');
});

it('keeps follow-up only in the conversation cycle and lets the broker add touches', async () => {
  render(<AgentSettingsPage />);
  expect(screen.queryByRole('heading', { name: 'Follow-up' })).toBeNull();

  openTab('Ciclo da conversa');
  expect(screen.getByRole('heading', { name: 'Follow-up' })).toBeTruthy();
  expect(screen.getAllByRole('spinbutton', { name: /º toque/ })).toHaveLength(3);

  fireEvent.click(screen.getByRole('button', { name: 'Adicionar toque' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: '4º toque, horas após o anterior' }), { target: { value: '3' } });
  await save();

  expect(stored().followUp.delaysHours).toEqual([2, 6, 12, 3]);
});

it('warns when the touches go past the WhatsApp window without blocking the save', async () => {
  render(<AgentSettingsPage />);
  openTab('Ciclo da conversa');

  fireEvent.change(screen.getByRole('spinbutton', { name: '3º toque, horas após o anterior' }), { target: { value: '20' } });

  expect(screen.getByText(/somam mais de 23 horas/)).toBeTruthy();
  await save();
  expect(stored().followUp.delaysHours).toEqual([2, 6, 20]);
});

it('moves the lead to a real funnel stage on handoff', async () => {
  render(<AgentSettingsPage />);
  openTab('Comportamento');

  fireEvent.change(screen.getByLabelText('Mover o lead para a etapa do funil'), { target: { value: 'etapa-humano' } });
  await save();

  expect(stored().behavior.handoff.stageId).toBe('etapa-humano');
  expect(screen.getByRole('button', { name: /Encaminhamento/ }).textContent).toContain('Atendimento humano');
});

it('shows each weekday with its own hours in scheduling', async () => {
  // O seletor de hora deixou de ser `<select>` nativo — a lista dele saltava
  // para o topo da página. O Radix é um popover, e no jsdom ele precisa destes
  // dois apoios que o ambiente não implementa.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => {};

  render(<AgentSettingsPage />);
  openTab('Agendamento');

  expect(screen.getByRole('switch', { name: 'Atender no domingo' }).getAttribute('data-state')).toBe('unchecked');

  const inicioDaTerca = screen.getByRole('combobox', { name: 'Terça: início' });
  fireEvent.keyDown(inicioDaTerca, { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name: '19:00' }));

  expect(screen.getByText('Terça: o horário final precisa ser depois do inicial.')).toBeTruthy();
});

it('shows capability tools as locked and controlled by their own tab', async () => {
  render(<AgentSettingsPage />);
  openTab('Ferramentas');

  expect(screen.getByRole('switch', { name: 'Buscar imóveis compatíveis' })).toBeTruthy();
  expect(screen.queryByRole('switch', { name: 'Retomar conversas paradas' })).toBeNull();
  expect(screen.getByText('Retomar conversas paradas').closest('li')?.textContent).toContain('Ciclo da conversa');
});

it('saves additional instructions without a generated prompt preview', async () => {
  render(<AgentSettingsPage />);
  openTab('Prompt');

  fireEvent.change(screen.getByLabelText('Instruções adicionais'), { target: { value: 'Priorize imóveis prontos.' } });
  await save();

  expect(screen.queryByText('Prompt gerado')).toBeNull();
  expect(stored().prompt).toBe('Priorize imóveis prontos.');
});

it('loads settings saved in the first local format', async () => {
  localStorage.setItem(AGENT_SETTINGS_STORAGE_KEY, JSON.stringify({ active: false, name: 'Lia', followUp: true }));
  render(<AgentSettingsPage />);

  expect((screen.getByLabelText('Nome do agente') as HTMLInputElement).value).toBe('Lia');
  expect(screen.getByRole('switch', { name: 'Agente ativo' }).getAttribute('data-state')).toBe('unchecked');
});

it('abre com a configuração salva no banco e salva de volta no banco', async () => {
  server.installed = true;
  const base = createDefaultAgentSettings();
  server.row = { settings: { ...base, identity: { ...base.identity, name: 'Bia', company: 'Casa Nova' } } };
  render(<AgentSettingsPage />);
  await waitFor(() => expect((screen.getByLabelText('Nome do agente') as HTMLInputElement).value).toBe('Bia'));
  fireEvent.change(screen.getByLabelText('Nome do agente'), { target: { value: 'Bianca' } });
  await save();
  expect(await screen.findByText('Salvo')).toBeTruthy();
  expect(server.saves).toEqual([expect.objectContaining({ identity: expect.objectContaining({ name: 'Bianca' }) })]);
});

it('avisa quando o banco recusa e mantém a edição na tela', async () => {
  server.installed = true;
  server.failSave = true;
  render(<AgentSettingsPage />);
  fireEvent.change(screen.getByLabelText('Nome do agente'), { target: { value: 'Rita' } });
  await save();
  expect(await screen.findByText(/Não foi possível salvar a configuração agora/)).toBeTruthy();
  expect((screen.getByLabelText('Nome do agente') as HTMLInputElement).value).toBe('Rita');
});

it('começa desligado: nenhuma resposta automática sem o corretor ligar o agente', () => {
  render(<AgentSettingsPage />);
  expect((screen.getByRole('switch', { name: 'Agente ativo' }) as HTMLElement).getAttribute('aria-checked')).toBe('false');
});
