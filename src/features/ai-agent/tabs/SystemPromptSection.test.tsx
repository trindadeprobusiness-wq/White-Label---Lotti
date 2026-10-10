// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemPromptSection } from './SystemPromptSection';
import { createDefaultAgentSettings, PROMPT_PADRAO_AGENTE } from '../settings';

afterEach(cleanup);

function montar(systemPrompt: string) {
  const onChange = vi.fn();
  render(<SystemPromptSection settings={{ ...createDefaultAgentSettings(), systemPrompt }} onChange={onChange} issues={[]} stages={[]} onOpenTab={vi.fn()} />);
  return onChange;
}

describe('prompt do agente', () => {
  it('sem prompt salvo, mostra o padrão do código para editar e sem botão de restaurar', () => {
    montar('');
    expect((screen.getByLabelText('Prompt do agente') as HTMLTextAreaElement).value).toBe(PROMPT_PADRAO_AGENTE);
    expect(screen.queryByText('Restaurar padrão')).toBeNull();
    expect(PROMPT_PADRAO_AGENTE).toContain('{{nome_agente}}');
    expect(PROMPT_PADRAO_AGENTE).toContain('<comeco-e-retomada>');
  });

  it('editar grava o texto; voltar ao padrão grava vazio', () => {
    const onChange = montar('');
    fireEvent.change(screen.getByLabelText('Prompt do agente'), { target: { value: 'Você é {{nome_agente}}.' } });
    expect(onChange.mock.calls[0][0].systemPrompt).toBe('Você é {{nome_agente}}.');
    fireEvent.change(screen.getByLabelText('Prompt do agente'), { target: { value: `${PROMPT_PADRAO_AGENTE}\n` } });
    expect(onChange.mock.calls[1][0].systemPrompt).toBe('');
  });

  it('prompt personalizado tem "Restaurar padrão", que volta para o do código', () => {
    const onChange = montar('Meu prompt.');
    fireEvent.click(screen.getByText('Restaurar padrão'));
    expect(onChange.mock.calls[0][0].systemPrompt).toBe('');
  });
});
