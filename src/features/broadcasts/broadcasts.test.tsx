// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CampaignWithCounts } from './api';
import { campaignSummary, progress } from './labels';
import { draftIssues } from './draft';

const { api } = vi.hoisted(() => ({
  api: {
    campaigns: [] as unknown[],
    online: true,
    preview: { eligible: 2, overLimit: 0, excluded: { outside_window: 5, opted_out: 1 }, samples: [{ contact: 'Paula Souza', text: 'Oi, Paula! Temos novidades.' }] },
    saved: [] as unknown[],
    activated: [] as string[],
    detail: null as unknown,
    controlled: [] as string[],
  },
}));
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    listCampaigns: async () => api.campaigns,
    automationOnline: async () => api.online,
    previewCampaign: async () => api.preview,
    saveCampaign: async (draft: unknown) => { api.saved.push(draft); return 'campanha-1'; },
    activateCampaign: async (id: string) => { api.activated.push(id); return { status: 'running', total: 2 }; },
    getCampaign: async () => { if (!api.detail) throw new actual.BroadcastError('forbidden'); return api.detail; },
    controlCampaign: async (_id: string, action: string) => { api.controlled.push(action); return 'paused'; },
  };
});
vi.mock('@/hooks/crm/useCrm', () => ({
  useEtapas: () => ({ data: [{ id: 'etapa-visita', nome: 'Visita' }], isError: false, isPending: false }),
}));

import BroadcastsPage from './BroadcastsPage';
import BroadcastRoute from './BroadcastDetails';

afterEach(() => {
  Object.assign(api, { campaigns: [], online: true, saved: [], activated: [], detail: null, controlled: [] });
  cleanup();
});

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/automacoes" element={<BroadcastsPage />} />
        <Route path="/automacoes/:id" element={<BroadcastRoute />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>);
}

const campaign = (change: Partial<CampaignWithCounts> = {}): CampaignWithCounts => ({
  id: 'c1', name: 'Lançamento Jardins', status: 'running', body: 'Oi, {{nome}}!', stage_ids: [], starts_at: null,
  interval_seconds: 60, max_recipients: 100, reply_policy: 'preserve', total: 10, excluded: {},
  created_at: '2026-09-27T12:00:00Z', updated_at: '2026-09-27T12:00:00Z', started_at: '2026-09-27T12:00:00Z', finished_at: null,
  counts: { sent: 4, pending: 5, skipped: 1 }, ...change,
});

describe('resumo das campanhas', () => {
  it('mostra o andamento e o resultado em português', () => {
    expect(campaignSummary(campaign())).toBe('4 de 10 enviadas');
    expect(progress(campaign())).toBe(50);
    expect(campaignSummary(campaign({ status: 'completed', counts: { sent: 9, skipped: 1 } }))).toBe('9 enviadas, 1 não enviada');
    expect(campaignSummary(campaign({ status: 'completed', total: 0, counts: {} }))).toBe('Ninguém podia receber no início');
  });

  it('valida o rascunho antes de ir ao servidor', () => {
    const base = { name: 'Teste', body: 'Oi {{nome}}', stageIds: [], startsAt: null, intervalSeconds: 60, maxRecipients: 100, replyPolicy: 'preserve' as const };
    expect(draftIssues(base)).toEqual([]);
    expect(draftIssues({ ...base, body: 'Oi {{cpf}}' })).toEqual(['Variável que não existe: {{cpf}}. Use {{nome}} ou {{corretor}}.']);
    expect(draftIssues({ ...base, startsAt: '2020-01-01T00:00:00Z' })).toHaveLength(1);
    expect(draftIssues({ ...base, maxRecipients: 500 })).toHaveLength(1);
  });
});

describe('lista de disparos', () => {
  it('sem campanhas convida a criar a primeira e explica a regra das 24 horas', async () => {
    renderAt('/automacoes');
    expect(await screen.findByText('Nenhum disparo ainda')).toBeTruthy();
    expect(screen.getByText('Só recebe quem mandou mensagem nas últimas 24 horas.')).toBeTruthy();
  });

  it('lista as campanhas com estado e avisa quando o envio automático está desligado', async () => {
    api.campaigns = [campaign()];
    api.online = false;
    renderAt('/automacoes');
    const row = await screen.findByRole('button', { name: /Lançamento Jardins/ });
    expect(within(row).getByText('Enviando')).toBeTruthy();
    expect(within(row).getByText('4 de 10 enviadas')).toBeTruthy();
    expect(await screen.findByText(/O envio automático ainda não está liberado/)).toBeTruthy();
  });
});

describe('criar disparo', () => {
  it('mostra quem recebe, bloqueia o modelo da Meta e ativa agora', async () => {
    renderAt('/automacoes/novo');
    expect(await screen.findByText('contatos recebem', { exact: false })).toBeTruthy();
    expect(screen.getByText('5 fora: não mandou mensagem nas últimas 24 horas')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /2\. Mensagem/ }));
    expect(screen.getByText('Indisponível: exige a API oficial do WhatsApp.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Nome do disparo/), { target: { value: 'Lançamento Jardins' } });
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'Oi, {{nome}}! Temos novidades.' } });

    fireEvent.click(screen.getByRole('button', { name: /3\. Envio/ }));
    expect((screen.getByRole('button', { name: /Por evento/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /IA atende/ }));

    fireEvent.click(screen.getByRole('button', { name: /4\. Revisar/ }));
    expect(await screen.findByText('Oi, Paula! Temos novidades.')).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: /Enviar agora/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /Enviar agora/ }));
    await waitFor(() => expect(api.activated).toEqual(['campanha-1']));
    expect(api.saved[0]).toMatchObject({ name: 'Lançamento Jardins', body: 'Oi, {{nome}}! Temos novidades.', replyPolicy: 'ai', startsAt: null });
  });

  it('variável desconhecida impede ativar', async () => {
    renderAt('/automacoes/novo');
    fireEvent.click(await screen.findByRole('button', { name: /2\. Mensagem/ }));
    fireEvent.change(screen.getByLabelText(/Nome do disparo/), { target: { value: 'Teste' } });
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'Seu CPF {{cpf}}' } });
    fireEvent.click(screen.getByRole('button', { name: /4\. Revisar/ }));
    expect(screen.getByText(/Variável que não existe: \{\{cpf\}\}/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Enviar agora/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('acompanhar disparo', () => {
  it('mostra o resultado por contato e permite pausar', async () => {
    api.detail = {
      campaign: campaign({ excluded: { outside_window: 3 } }),
      deliveries: [
        { id: 'd1', status: 'sent', reason: null, scheduled_at: '2026-09-27T12:00:00Z', updated_at: '2026-09-27T12:00:05Z', contact: 'Paula Souza' },
        { id: 'd2', status: 'skipped', reason: 'conversation_moved', scheduled_at: '2026-09-27T12:01:00Z', updated_at: '2026-09-27T12:01:00Z', contact: 'Marcos Lima' },
      ],
      events: [{ id: 'e1', kind: 'started', actor_label: 'Rafael', created_at: '2026-09-27T12:00:00Z', detail: {} }],
    };
    renderAt('/automacoes/c1');
    expect(await screen.findByText('Paula Souza')).toBeTruthy();
    expect(screen.getByText('Conversou depois do agendamento')).toBeTruthy();
    expect(screen.getByText('3 · Não mandou mensagem nas últimas 24 horas')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Pausar/ }));
    await waitFor(() => expect(api.controlled).toEqual(['pause']));
  });

  it('rascunho salvo abre no criador', async () => {
    api.detail = { campaign: campaign({ status: 'draft', total: 0, started_at: null }), deliveries: [], events: [] };
    renderAt('/automacoes/c1');
    expect(await screen.findByRole('heading', { name: 'Editar disparo' })).toBeTruthy();
  });
});
