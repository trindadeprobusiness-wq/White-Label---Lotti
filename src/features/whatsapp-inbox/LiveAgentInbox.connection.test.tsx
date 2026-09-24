// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LiveAgentInbox from './LiveAgentInbox';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
vi.mock('@/pages/WhatsAppInbox', () => ({ default: () => <div><h1>Inbox completo</h1><p>Todas Atrasando Urgente</p></div> }));
vi.mock('./ConnectedInbox', () => ({ default: ({ connected, preview }: { connected: boolean | 'unknown'; preview?: boolean }) => <div><h1>Inbox real</h1><p>Conversas persistidas</p><span data-testid="connection-state">{String(connected)}</span>{preview && <span>Prévia da Inbox nova</span>}</div> }));

function mount(initialEntry = '/whatsapp') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter initialEntries={[initialEntry]}><QueryClientProvider client={client}><LiveAgentInbox /></QueryClientProvider></MemoryRouter>);
}

describe('acesso ao Inbox pela conexão do WhatsApp', () => {
  beforeEach(() => invoke.mockReset());
  afterEach(cleanup);

  it('desconectado exige o QR antes de abrir o Inbox', async () => {
    invoke.mockResolvedValue({ data: { state: 'disconnected', agentEnabled: false }, error: null });
    mount();
    expect(await screen.findByRole('heading', { name: 'Conecte ao WhatsApp' })).not.toBeNull();
    expect(await screen.findByText('Preparando QR Code…')).not.toBeNull();
    expect(screen.getByText(/WhatsApp → Configurações → Aparelhos conectados/)).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Inbox real' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Inbox completo' })).toBeNull();
  });

  it('conectado abre as conversas persistidas, não a demonstração', async () => {
    invoke.mockResolvedValue({ data: { state: 'connected', agentEnabled: true }, error: null });
    mount();
    expect(await screen.findByRole('heading', { name: 'Inbox real' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Inbox completo' })).toBeNull();
  });

  it('a prévia local abre a Inbox conectada nova, sem conexão real', async () => {
    invoke.mockResolvedValue({ data: { state: 'disconnected', agentEnabled: false }, error: null });
    mount('/whatsapp?preview=connected');
    expect(await screen.findByRole('heading', { name: 'Inbox real' })).not.toBeNull();
    expect(screen.getByText('Prévia da Inbox nova')).not.toBeNull();
  });

  it('erro da consulta não libera o Inbox sem confirmar a conexão', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('indisponível') });
    mount();
    expect(await screen.findByRole('heading', { name: 'Conecte ao WhatsApp' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Inbox real' })).toBeNull();
  });

  it('a prévia local de pareamento mostra QR e instruções sem chamar a ponte', async () => {
    invoke.mockResolvedValue({ data: { state: 'disconnected', agentEnabled: false }, error: null });
    mount('/whatsapp?preview=pairing');
    expect(await screen.findByAltText('QR Code de demonstração para conectar seu WhatsApp')).not.toBeNull();
    expect(screen.getByText(/WhatsApp → Configurações → Aparelhos conectados/)).not.toBeNull();
    expect(invoke.mock.calls.every(call => call[1].body.action === 'status')).toBe(true);
  });
});
