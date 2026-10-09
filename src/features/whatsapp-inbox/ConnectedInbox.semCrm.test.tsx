// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import ConnectedInbox from './ConnectedInbox';

// Com VITE_CRM_ENABLED=false (o desligamento documentado da flag) a pílula volta a ser o status do
// cadastro (clientes.status_funil), sem menu de mover: o Funil, nesse caso, também é o status.
vi.mock('@/lib/flags', () => ({ FLAGS: { crm: false, oauthMicrosoft: false } }));

const dados: Record<string, unknown[]> = {};
function consulta(tabela: string) {
  const b: Record<string, unknown> = {
    select: () => b, order: () => b, limit: () => b, eq: () => b, is: () => b, in: () => b, update: () => b,
    single: () => Promise.resolve({ data: (dados[tabela] ?? [])[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: dados[tabela] ?? [], error: null, count: (dados[tabela] ?? []).length }).then(resolve),
  };
  return b;
}
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (t: string) => consulta(t),
    rpc: () => Promise.resolve({ data: true, error: null }),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: null }) }) },
  },
}));

afterEach(() => { cleanup(); for (const k of Object.keys(dados)) delete dados[k]; });

const conversa = (extra: Record<string, unknown>) => ({ id: 'c1', phone: '5511999990000', mode: 'ai', status: 'open', updated_at: new Date().toISOString(), qualification: {}, last_error: null, contact_name: 'Neves', ...extra });
function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><ConnectedInbox connected /></QueryClientProvider></MemoryRouter>);
}

it('CRM desligado: a pílula mostra o status do cadastro, sem menu de mover', async () => {
  dados.lotti_agent_conversations = [conversa({ cliente_id: 'cliente-1' })];
  dados.clientes = [{ id: 'cliente-1', nome: 'Neves', email: null, telefone: '5511999990000', created_at: '2026-09-20T12:00:00Z', status_funil: 'VISITA_PROPOSTA', tipo_interesse: 'AMBOS' }];
  montar();
  await waitFor(() => expect(screen.getByTestId('conversation-stage-pill').textContent).toContain('Visita/Proposta'));
  expect(screen.getByTestId('conversation-stage-pill').tagName).toBe('SPAN');
});

it('CRM desligado: cliente sem status mostra "Sem etapa definida"; conversa sem cliente, "Sem cliente vinculado"', async () => {
  dados.lotti_agent_conversations = [conversa({ cliente_id: 'cliente-1' })];
  dados.clientes = [{ id: 'cliente-1', nome: 'Neves', email: null, telefone: '5511999990000', created_at: '2026-09-20T12:00:00Z', status_funil: null, tipo_interesse: 'AMBOS' }];
  montar();
  await waitFor(() => expect(screen.getByTestId('conversation-stage-pill').textContent).toContain('Sem etapa definida'));
  cleanup();
  dados.lotti_agent_conversations = [conversa({ cliente_id: null })];
  montar();
  await waitFor(() => expect(screen.getByTestId('conversation-stage-pill').textContent).toContain('Sem cliente vinculado'));
});
