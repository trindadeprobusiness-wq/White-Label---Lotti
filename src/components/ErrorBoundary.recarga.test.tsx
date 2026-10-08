// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const reload = vi.fn();

function Quebra({ erro }: { erro: Error }): never {
  throw erro;
}

async function carregar() {
  vi.resetModules();
  const versao = await import('@/lib/recarregar-versao');
  const { ErrorBoundary } = await import('./ErrorBoundary');
  return { versao, ErrorBoundary };
}

describe('ErrorBoundary durante o reload de versão nova', () => {
  beforeEach(() => {
    sessionStorage.clear();
    reload.mockClear();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('lazy quebrado depois do preventDefault ("Element type is invalid") mostra Atualizando…, não a tela de erro', async () => {
    const { versao, ErrorBoundary } = await carregar();
    expect(versao.recarregarParaVersaoNova()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    render(<ErrorBoundary><Quebra erro={new Error('Element type is invalid. Received a promise that resolves to: undefined.')} /></ErrorBoundary>);
    expect(screen.getByText('Atualizando…')).toBeTruthy();
    expect(screen.queryByText('Algo deu errado nesta tela')).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('chunk que sumiu no deploy recarrega uma vez sozinho', async () => {
    const { ErrorBoundary } = await carregar();
    render(<ErrorBoundary><Quebra erro={new TypeError('Failed to fetch dynamically imported module: https://app/assets/Crm-abc.js')} /></ErrorBoundary>);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Atualizando…')).toBeTruthy();
  });

  it('dois reloads em menos de 10s: não entra em loop', async () => {
    const { versao } = await carregar();
    expect(versao.recarregarParaVersaoNova()).toBe(true);
    const { versao: outraAba } = await carregar();
    expect(outraAba.recarregarParaVersaoNova()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('erro de verdade, sem reload pedido, continua mostrando a tela de erro', async () => {
    const { ErrorBoundary } = await carregar();
    render(<ErrorBoundary><Quebra erro={new Error('x is not a function')} /></ErrorBoundary>);
    expect(screen.getByText('Algo deu errado nesta tela')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });
});
