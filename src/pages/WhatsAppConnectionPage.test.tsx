// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WhatsAppConnectionPage from './WhatsAppConnectionPage';

const { invoke, rpc, channel } = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), channel: { company_name: 'Lotti Imóveis' } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke }, rpc, from: () => ({ select: () => ({ eq: () => ({ is: () => ({ maybeSingle: () => Promise.resolve({ data: channel, error: null }) }) }) }) }) } }));

beforeEach(() => invoke.mockResolvedValue({ data: { state: 'connected', agentEnabled: true, phone: '556281149611' }, error: null }));
afterEach(cleanup);

it('permite editar o nome da empresa para o número conectado', async () => {
  rpc.mockResolvedValue({ data: true, error: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><WhatsAppConnectionPage /></QueryClientProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Editar empresa' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome da empresa' }), { target: { value: 'Outra Imobiliária' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar empresa' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('lotti_channel_set_company_name', { p_phone: '556281149611', p_name: 'Outra Imobiliária' }));
});

it('mantém uma página de Conexão acessível quando o número já está conectado', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><WhatsAppConnectionPage /></QueryClientProvider></MemoryRouter>);

  expect(screen.getByRole('heading', { name: 'Conexão' })).not.toBeNull();
  expect(await screen.findByText('Conectado')).not.toBeNull();
  expect(screen.getByText('+55 (62) 8114-9611')).not.toBeNull();
  expect(screen.queryByText(/WABA ID:/)).toBeNull();
  expect(screen.queryByText(/Phone ID:/)).toBeNull();
  expect(screen.getByRole('heading', { name: 'Teste de envio' })).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Desconectar' })).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Enviar “Olá, tudo bem?”' })).not.toBeNull();
  expect(screen.getByRole('textbox', { name: 'Telefone para teste' })).not.toBeNull();
  expect(screen.queryByRole('link', { name: 'Abrir Inbox' })).toBeNull();
  expect(screen.getByTestId('connection-panels').className).not.toContain('lg:grid-cols-2');
  expect(screen.getByTestId('connection-panels').className).toContain('space-y-4');
  expect(screen.getByTestId('status-details').className).toContain('space-y-4');
  expect(screen.getByTestId('status-details').className).not.toContain('sm:grid-cols');
  expect(screen.getByTestId('connection-page').className).toContain('-mb-16');
});

it('envia a mensagem de teste em português para o telefone informado', async () => {
  invoke.mockImplementation((_name, options) => Promise.resolve(options?.body?.action === 'start'
    ? { data: { sendStatus: 'sent', conversationId: 'conversation-1' }, error: null }
    : { data: { state: 'connected', agentEnabled: true, phone: '556281149611' }, error: null }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><WhatsAppConnectionPage /></QueryClientProvider></MemoryRouter>);

  fireEvent.change(await screen.findByRole('textbox', { name: 'Telefone para teste' }), { target: { value: '5562999999999' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar “Olá, tudo bem?”' }));

  await waitFor(() => expect(invoke).toHaveBeenCalledWith('lotti-whatsapp', { body: expect.objectContaining({
    action: 'start', phone: '5562999999999', text: 'Olá, tudo bem?',
  }) }));
  expect(await screen.findByText('Mensagem de teste enviada.')).not.toBeNull();
});

it('não usa o mesmo número conectado como destino do teste', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><WhatsAppConnectionPage /></QueryClientProvider></MemoryRouter>);
  fireEvent.change(await screen.findByRole('textbox', { name: 'Telefone para teste' }), { target: { value: '+55 (62) 8114-9611' } });
  expect((screen.getByRole('button', { name: 'Enviar “Olá, tudo bem?”' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/outro número/i)).not.toBeNull();
});

it('não informa sucesso quando o serviço só confirma que o envio está em andamento', async () => {
  invoke.mockImplementation((_name, options) => Promise.resolve(options?.body?.action === 'start'
    ? { data: { sendStatus: 'sending' }, error: null }
    : { data: { state: 'connected', agentEnabled: false, phone: '556281149611' }, error: null }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><WhatsAppConnectionPage /></QueryClientProvider></MemoryRouter>);
  fireEvent.change(await screen.findByRole('textbox', { name: 'Telefone para teste' }), { target: { value: '5562999999999' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar “Olá, tudo bem?”' }));
  expect(await screen.findByText(/ainda não foi confirmado/i)).not.toBeNull();
  expect(screen.queryByText('Mensagem de teste enviada.')).toBeNull();
});

it('oferece uma prévia local dos dados exibidos após a conexão', async () => {
  invoke.mockResolvedValue({ data: { state: 'disconnected', agentEnabled: false }, error: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter initialEntries={['/whatsapp/conexao?preview=connected']}><QueryClientProvider client={client}><WhatsAppConnectionPage /></QueryClientProvider></MemoryRouter>);

  expect(await screen.findByText('Conectado')).not.toBeNull();
  expect(screen.getByText('+55 (62) 8114-9611')).not.toBeNull();
  expect(screen.getByText(/Conectado em:/)).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Desconectar' })).not.toBeNull();
});

it('oferece a reconexão na página Conexão sem depender do Inbox', async () => {
  invoke.mockResolvedValue({ data: { state: 'disconnected', agentEnabled: false }, error: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><WhatsAppConnectionPage /></QueryClientProvider></MemoryRouter>);

  expect(await screen.findByText('Desconectado')).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Desconectar' })).toBeNull();
  expect(await screen.findByText('Preparando QR Code…')).not.toBeNull();
  expect(screen.getByText(/WhatsApp → Configurações → Aparelhos conectados/)).not.toBeNull();
  expect(screen.queryByRole('link', { name: 'Abrir Inbox' })).toBeNull();
  // Sem número conectado, só status e QR: o teste de envio aparece depois de conectar.
  expect(screen.queryByRole('heading', { name: 'Teste de envio' })).toBeNull();
});

it('falha de consulta não oferece pareamento como se estivesse desconectado', async () => {
  invoke.mockResolvedValue({ data: null, error: new Error('status_unavailable') });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><WhatsAppConnectionPage /></QueryClientProvider></MemoryRouter>);

  expect(await screen.findByText('Indisponível', {}, { timeout: 3000 })).not.toBeNull();
  expect(screen.getByText(/estado anterior não foi confirmado/i)).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Conectar WhatsApp' })).toBeNull();
  expect(screen.queryByText('Desconectado')).toBeNull();
});

it('desconecta pelo servidor apenas após confirmação', async () => {
  let connected = true;
  invoke.mockImplementation((_name, options) => {
    if (options?.body?.action === 'disconnect') connected = false;
    return Promise.resolve({ data: { state: connected ? 'connected' : 'disconnected', agentEnabled: false }, error: null });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><WhatsAppConnectionPage /></QueryClientProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Desconectar' }));
  expect(invoke).not.toHaveBeenCalledWith('lotti-whatsapp', { body: { action: 'disconnect' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Desconectar' }).at(-1)!);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('lotti-whatsapp', { body: { action: 'disconnect' } }));
  expect(await screen.findByText('Desconectado')).not.toBeNull();
});
