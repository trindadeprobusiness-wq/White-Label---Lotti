// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AgentSettingsPage from './AgentSettingsPage';
import { AGENT_SETTINGS_STORAGE_KEY } from './settings';

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
  localStorage.clear();
  cleanup();
});

const stored = () => JSON.parse(localStorage.getItem(AGENT_SETTINGS_STORAGE_KEY) ?? 'null');
const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

it('saves the active state locally without any WhatsApp connection control', () => {
  render(<AgentSettingsPage />);

  expect(screen.getByRole('heading', { name: 'Agente de IA' })).toBeTruthy();
  expect(screen.queryByText(/Conecte ao WhatsApp/i)).toBeNull();
  expect(screen.queryByText(/QR/)).toBeNull();

  fireEvent.click(screen.getByRole('switch', { name: 'Agente ativo' }));
  expect(screen.getByText('Alterações não salvas')).toBeTruthy();
  save();

  expect(screen.getByText('Salvo neste navegador')).toBeTruthy();
  expect(stored().active).toBe(false);
});

it('shows the model in use and changes it from the identity tab', () => {
  render(<AgentSettingsPage />);
  expect(screen.getByTestId('model-in-use').textContent).toContain('GPT-4o mini');

  openTab('Prompt');
  fireEvent.click(screen.getByRole('button', { name: 'Trocar modelo' }));
  expect(screen.getByRole('tab', { name: 'Identidade' }).getAttribute('aria-selected')).toBe('true');

  fireEvent.change(screen.getByLabelText('Modelo de IA'), { target: { value: 'gpt-4.1-mini' } });
  save();

  expect(screen.getByTestId('model-in-use').textContent).toContain('GPT-4.1 mini');
  expect(stored().model).toBe('gpt-4.1-mini');
});

it('does not show loose notices in any tab', () => {
  render(<AgentSettingsPage />);

  for (const tab of ['Identidade', 'Comportamento', 'Ciclo da conversa', 'Agendamento', 'Ferramentas', 'Prompt']) {
    openTab(tab);
    expect(screen.queryByText(/nenhuma mensagem é enviada|salva só neste navegador/i)).toBeNull();
  }
});

it('blocks saving while a tab has an error and points to that tab', () => {
  render(<AgentSettingsPage />);

  fireEvent.change(screen.getByLabelText('Nome do agente'), { target: { value: '' } });
  openTab('Prompt');
  save();

  expect(stored()).toBeNull();
  const alert = screen.getByRole('alert');
  expect(within(alert).getByText('Dê um nome ao agente.')).toBeTruthy();
  fireEvent.click(within(alert).getByRole('button', { name: 'Abrir Identidade' }));
  expect(screen.getByRole('tab', { name: 'Identidade' }).getAttribute('aria-selected')).toBe('true');
});

it('discards unsaved changes back to the last saved version', () => {
  render(<AgentSettingsPage />);

  fireEvent.change(screen.getByLabelText('Nome do agente'), { target: { value: 'Lia' } });
  fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));

  expect((screen.getByLabelText('Nome do agente') as HTMLInputElement).value).toBe('Ana');
  expect(screen.queryByText('Alterações não salvas')).toBeNull();
});

it('previews the greeting with the agent and company names', () => {
  render(<AgentSettingsPage />);

  fireEvent.change(screen.getByLabelText('Nome do agente'), { target: { value: 'Lia' } });
  fireEvent.change(screen.getByLabelText('Nome da imobiliária'), { target: { value: 'Imobiliária Aurora' } });

  expect(screen.getByTestId('greeting-preview').textContent).toBe('Olá! Aqui é Lia, da Imobiliária Aurora. Como posso ajudar você a encontrar seu imóvel?');
});

it('opens the matching tab from the summary of the active card', () => {
  render(<AgentSettingsPage />);

  fireEvent.click(screen.getByRole('button', { name: /Follow-up/ }));

  expect(screen.getByRole('tab', { name: 'Ciclo da conversa' }).getAttribute('aria-selected')).toBe('true');
});

it('keeps follow-up only in the conversation cycle and lets the broker add touches', () => {
  render(<AgentSettingsPage />);
  expect(screen.queryByRole('heading', { name: 'Follow-up' })).toBeNull();

  openTab('Ciclo da conversa');
  expect(screen.getByRole('heading', { name: 'Follow-up' })).toBeTruthy();
  expect(screen.getAllByRole('spinbutton', { name: /º toque/ })).toHaveLength(3);

  fireEvent.click(screen.getByRole('button', { name: 'Adicionar toque' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: '4º toque, horas após o anterior' }), { target: { value: '3' } });
  save();

  expect(stored().followUp.delaysHours).toEqual([2, 6, 12, 3]);
});

it('warns when the touches go past the WhatsApp window without blocking the save', () => {
  render(<AgentSettingsPage />);
  openTab('Ciclo da conversa');

  fireEvent.change(screen.getByRole('spinbutton', { name: '3º toque, horas após o anterior' }), { target: { value: '20' } });

  expect(screen.getByText(/somam mais de 23 horas/)).toBeTruthy();
  save();
  expect(stored().followUp.delaysHours).toEqual([2, 6, 20]);
});

it('moves the lead to a real funnel stage on handoff', () => {
  render(<AgentSettingsPage />);
  openTab('Comportamento');

  fireEvent.change(screen.getByLabelText('Mover o lead para a etapa do funil'), { target: { value: 'etapa-humano' } });
  save();

  expect(stored().behavior.handoff.stageId).toBe('etapa-humano');
  expect(screen.getByRole('button', { name: /Encaminhamento/ }).textContent).toContain('Atendimento humano');
});

it('shows each weekday with its own hours in scheduling', () => {
  render(<AgentSettingsPage />);
  openTab('Agendamento');

  expect(screen.getByRole('switch', { name: 'Atender no domingo' }).getAttribute('data-state')).toBe('unchecked');
  fireEvent.change(screen.getByLabelText('Terça: início'), { target: { value: '19:00' } });

  expect(screen.getByText('Terça: o horário final precisa ser depois do inicial.')).toBeTruthy();
});

it('shows capability tools as locked and controlled by their own tab', () => {
  render(<AgentSettingsPage />);
  openTab('Ferramentas');

  expect(screen.getByRole('switch', { name: 'Buscar imóveis compatíveis' })).toBeTruthy();
  expect(screen.queryByRole('switch', { name: 'Retomar conversas paradas' })).toBeNull();
  expect(screen.getByText('Retomar conversas paradas').closest('li')?.textContent).toContain('Ciclo da conversa');
});

it('saves additional instructions without a generated prompt preview', () => {
  render(<AgentSettingsPage />);
  openTab('Prompt');

  fireEvent.change(screen.getByLabelText('Instruções adicionais'), { target: { value: 'Priorize imóveis prontos.' } });
  save();

  expect(screen.queryByText('Prompt gerado')).toBeNull();
  expect(stored().prompt).toBe('Priorize imóveis prontos.');
});

it('loads settings saved in the first local format', () => {
  localStorage.setItem(AGENT_SETTINGS_STORAGE_KEY, JSON.stringify({ active: false, name: 'Lia', followUp: true }));
  render(<AgentSettingsPage />);

  expect((screen.getByLabelText('Nome do agente') as HTMLInputElement).value).toBe('Lia');
  expect(screen.getByRole('switch', { name: 'Agente ativo' }).getAttribute('data-state')).toBe('unchecked');
});
