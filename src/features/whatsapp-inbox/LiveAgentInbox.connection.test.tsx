// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
  return client;
}

describe('acesso ao Inbox pela conexão do WhatsApp', () => {
  beforeEach(() => invoke.mockReset());
  afterEach(cleanup);

  it('desconectado exige o QR antes de abrir o Inbox', async () => {
    invoke.mockResolvedValue({ data: { state: 'disconnected', agentEnabled: false }, error: null });
    mount();
    expect(await screen.findByRole('heading', { name: 'Conecte seu WhatsApp' })).not.toBeNull();
    expect(await screen.findByText('Preparando QR Code…')).not.toBeNull();
    expect(screen.getByText(/Entre em Aparelhos conectados/)).not.toBeNull();
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
    // Durante a nova tentativa da consulta, a tela diz "Abrindo o Inbox…" em
    // vez de afirmar desconexão que ainda não foi confirmada. O que importa
    // segue igual: em nenhum momento o Inbox é liberado.
    expect(screen.queryByRole('heading', { name: 'Inbox real' })).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Conecte seu WhatsApp' }, { timeout: 4000 })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Inbox real' })).toBeNull();
  });

  it('uma falha depois de conectado não derruba o Inbox para a tela de conectar', async () => {
    // Era o defeito relatado: sair da aba e voltar mostrava "conecte o
    // WhatsApp". A sondagem de status roda a cada 8s, e uma única falha dela
    // bastava para trocar a tela inteira.
    invoke.mockResolvedValueOnce({ data: { state: 'connected', agentEnabled: true }, error: null })
      .mockResolvedValue({ data: null, error: new Error('oscilou') });
    const client = mount();
    expect(await screen.findByRole('heading', { name: 'Inbox real' })).not.toBeNull();

    // Força a sondagem seguinte, que falha. Sem isto o teste verificaria antes
    // de qualquer nova consulta e passaria sem exercitar nada.
    await act(async () => { await client.refetchQueries({ queryKey: ['whatsapp-connection'] }); });
    await waitFor(() => expect(invoke.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 4000 });

    expect(screen.getByRole('heading', { name: 'Inbox real' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Conecte seu WhatsApp' })).toBeNull();
  });

  it('a prévia local de pareamento mostra QR e instruções sem chamar a ponte', async () => {
    invoke.mockResolvedValue({ data: { state: 'disconnected', agentEnabled: false }, error: null });
    mount('/whatsapp?preview=pairing');
    expect(await screen.findByAltText('QR Code de demonstração para conectar seu WhatsApp')).not.toBeNull();
    expect(screen.getByText(/Entre em Aparelhos conectados/)).not.toBeNull();
    expect(invoke.mock.calls.every(call => call[1].body.action === 'status')).toBe(true);
  });
});
