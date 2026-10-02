// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptTab } from './PromptTab';
import { anexarSugestao } from '../markdownPrompt';
import { createDefaultAgentSettings } from '../settings';

afterEach(cleanup);

function montar(prompt: string) {
  const onChange = vi.fn();
  render(<PromptTab settings={{ ...createDefaultAgentSettings(), prompt }} onChange={onChange} issues={[]} stages={[]} />);
  return onChange;
}

describe('sugestões em Markdown', () => {
  it('a primeira sugestão já entra como item de lista', () => {
    expect(anexarSugestao('', 'Priorize prontos.')).toBe('- Priorize prontos.');
  });

  it('depois de um parágrafo, abre linha em branco', () => {
    // Uma quebra simples não quebra linha em Markdown: viraria o mesmo
    // parágrafo e a regra desapareceria no meio do texto anterior.
    expect(anexarSugestao('Atenda rápido.', 'Priorize prontos.')).toBe('Atenda rápido.\n\n- Priorize prontos.');
  });

  it('dentro de uma lista, continua a lista', () => {
    expect(anexarSugestao('- Já existe.', 'Priorize prontos.')).toBe('- Já existe.\n- Priorize prontos.');
  });

  it('não acumula linhas em branco do fim do texto', () => {
    expect(anexarSugestao('Atenda rápido.\n\n\n', 'Priorize.')).toBe('Atenda rápido.\n\n- Priorize.');
  });
});

describe('editor do prompt', () => {
  it('escreve em fonte monoespaçada, como arquivo', () => {
    montar('## Regras');
    expect(screen.getByLabelText('Instruções adicionais').className).toContain('font-mono');
  });

  it('a pré-visualização renderiza o Markdown de verdade', () => {
    montar('## Prioridades\n\n- Prontos para morar');
    fireEvent.click(screen.getByRole('radio', { name: 'Pré-visualizar' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Prioridades' })).toBeTruthy();
    expect(screen.getByRole('listitem').textContent).toBe('Prontos para morar');
  });

  it('o modelo inicial só aparece com o campo vazio', () => {
    montar('já escrevi algo');
    expect(screen.queryByRole('button', { name: /Começar com um modelo/ })).toBeNull();
  });
});
