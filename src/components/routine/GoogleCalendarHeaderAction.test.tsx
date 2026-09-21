/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleCalendarHeaderAction } from './GoogleCalendarHeaderAction';

afterEach(cleanup);

const connectedProps = {
  connected: true,
  pending: false,
  providerEmail: 'corretor@lotti.com.br',
  lastSyncAt: null,
  syncing: false,
  disconnecting: false,
  onConnect: vi.fn(),
  onSync: vi.fn(),
  onDisconnect: vi.fn(),
};

describe('ação do Google Agenda no cabeçalho da Rotina', () => {
  it('oferece conexão direta quando a agenda ainda não está conectada', () => {
    const onConnect = vi.fn();
    render(
      <GoogleCalendarHeaderAction
        {...connectedProps}
        connected={false}
        onConnect={onConnect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Conectar Google Agenda' }));
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it('abre os detalhes da conta conectada e permite sincronizar', () => {
    const onSync = vi.fn();
    render(<GoogleCalendarHeaderAction {...connectedProps} onSync={onSync} />);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir configurações do Google Agenda' }));

    expect(screen.getByRole('dialog', { name: 'Agenda' })).toBeTruthy();
    expect(screen.getByText('corretor@lotti.com.br')).toBeTruthy();
    expect(screen.getByText('Ainda não sincronizado')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar agora' }));
    expect(onSync).toHaveBeenCalledOnce();
  });

  it('exige confirmação antes de desconectar a conta', () => {
    const onDisconnect = vi.fn();
    render(<GoogleCalendarHeaderAction {...connectedProps} onDisconnect={onDisconnect} />);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir configurações do Google Agenda' }));
    fireEvent.click(screen.getByRole('button', { name: 'Desconectar Google Agenda' }));

    expect(screen.getByText('Desconectar o Google Agenda?')).toBeTruthy();
    expect(onDisconnect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Sim, desconectar' }));
    expect(onDisconnect).toHaveBeenCalledOnce();
  });
});
