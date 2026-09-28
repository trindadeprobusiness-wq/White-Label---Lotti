// @vitest-environment jsdom
/**
 * Auditoria SCRUM-6/15/16 — becos sem saída e perda de dados no wizard.
 *
 * Cada teste cobre um fluxo que travava ou perdia dado na main 052327d e foi
 * corrigido nesta branch. Ver docs/jira/onboarding.md para a análise completa.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoOnboarding } from '@/lib/onboarding/contexto';

const { toast, onboarding, store } = vi.hoisted(() => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  onboarding: { atual: null as unknown as Record<string, unknown> },
  store: { atual: null as unknown as Record<string, unknown> },
}));

vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/useOnboarding', () => ({ useOnboarding: () => onboarding.atual }));
vi.mock('@/stores/crmStore', () => ({ useCRMStore: () => store.atual }));
vi.mock('@/components/onboarding/OnboardingAssistant', () => ({ OnboardingAssistant: () => null }));
vi.mock('@/components/configuracoes/AsaasConnectionPanel', () => ({ AsaasConnectionPanel: () => null }));

import Onboarding from './Onboarding';

function contexto(parcial: Partial<ContextoOnboarding> = {}): ContextoOnboarding {
  return {
    profileId: 'perfil-1',
    organizationId: 'org-1',
    persona: null,
    objetivo: null,
    etapaAtual: 'boas_vindas',
    etapasConcluidas: [],
    etapasPuladas: [],
    concluidoEm: null,
    dispensadoEm: null,
    organizacao: { id: 'org-1', nome: 'Operação Teste', nomeComercial: null, tipo: 'individual' },
    papel: 'proprietario',
    userId: 'user-1',
    membros: [{ userId: 'user-1', nome: 'Pessoa Teste', papel: 'proprietario' }],
    assinatura: null,
    checklistMinimizado: false,
    checklistDispensadoEm: null,
    toursConcluidos: [],
    toursDispensados: [],
    metadata: {},
    evidencias: {
      perfilCompleto: false, totalImoveisReais: 0, totalClientesReais: 0, totalOportunidadesReais: 0,
      totalTarefasReais: 0, calendarioConectado: false, whatsappConfigurado: false, totalConvites: 0,
      iaUsada: false, totalRegistrosDemo: 0,
    },
    ...parcial,
  };
}

function mutacao() {
  return { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(null) };
}

function montarOnboarding(ctx: ContextoOnboarding) {
  onboarding.atual = {
    contexto: ctx,
    carregando: false,
    erro: null,
    disponivel: true,
    recarregar: vi.fn().mockResolvedValue(undefined),
    salvar: mutacao(),
    executarAcao: mutacao(),
    atualizarPerfilProfissional: mutacao(),
    atualizarOrganizacao: mutacao(),
    registrarEvento: vi.fn().mockResolvedValue(undefined),
    criarConvite: mutacao(),
    aceitarConvite: mutacao(),
    salvarChecklist: mutacao(),
    salvarTour: vi.fn(),
  };
  return onboarding.atual as {
    salvar: ReturnType<typeof mutacao>;
    atualizarPerfilProfissional: ReturnType<typeof mutacao>;
  };
}

function montarStore(corretor: Record<string, unknown> | null) {
  store.atual = {
    corretor,
    clientes: [],
    imoveis: [],
    fetchCorretor: vi.fn().mockResolvedValue(undefined),
    fetchClientes: vi.fn().mockResolvedValue(undefined),
    fetchImoveis: vi.fn().mockResolvedValue(undefined),
  };
}

// `void concluirEtapa()` / `void pularEtapa()` deixam a rejeição sem dono.
// Capturamos aqui para que o teste falhe por asserção legível, e não por
// "Unhandled Rejection" global do Vitest.
let rejeicoesSemTratamento: unknown[] = [];
let ouvintesOriginais: NodeJS.UnhandledRejectionListener[] = [];
const capturar = (motivo: unknown) => { rejeicoesSemTratamento.push(motivo); };

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  rejeicoesSemTratamento = [];
  ouvintesOriginais = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', capturar);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  process.removeListener('unhandledRejection', capturar);
  for (const ouvinte of ouvintesOriginais) process.on('unhandledRejection', ouvinte);
});

const esperarRejeicoes = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('onboarding — falha ao salvar não pode virar clique sem resposta (SCRUM-16)', () => {
  it('"Configurar minha operação" mostra erro quando salvar_onboarding falha (Onboarding.tsx:453)', async () => {
    const hooks = montarOnboarding(contexto());
    montarStore({ nome: 'Pessoa Teste', telefone: '11900000000' });
    hooks.salvar.mutateAsync.mockRejectedValue(new Error('Failed to fetch'));

    render(<MemoryRouter initialEntries={['/onboarding']}><Onboarding /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Configurar minha operação/ }));
    await esperarRejeicoes();

    expect(hooks.salvar.mutateAsync).toHaveBeenCalled();
    expect(rejeicoesSemTratamento).toEqual([]);
    expect(toast.error).toHaveBeenCalled();
  });

  it('"Pular por agora" mostra erro quando salvar_onboarding falha (Onboarding.tsx:471)', async () => {
    const hooks = montarOnboarding(contexto({ persona: 'corretor_autonomo', etapaAtual: 'asaas' }));
    montarStore({ nome: 'Pessoa Teste', telefone: '11900000000' });
    hooks.salvar.mutateAsync.mockRejectedValue(new Error('Failed to fetch'));

    render(<MemoryRouter initialEntries={['/onboarding?etapa=asaas']}><Onboarding /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Pular por agora' }));
    await esperarRejeicoes();

    expect(hooks.salvar.mutateAsync).toHaveBeenCalled();
    expect(rejeicoesSemTratamento).toEqual([]);
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('onboarding — retomada não pode apagar dado já cadastrado (SCRUM-15)', () => {
  it('salvar o perfil preserva o CRECI existente do corretor (Onboarding.tsx:150-151 e :254)', async () => {
    // Conta legada (bootstrap marca como concluída em "conclusao"). O botão
    // "Continuar configurando" da conclusão leva a /onboarding?etapa=perfil.
    const hooks = montarOnboarding(contexto({
      persona: 'corretor_autonomo',
      etapaAtual: 'conclusao',
      concluidoEm: '2026-08-21T00:00:00Z',
      metadata: { legacy_account: true },
    }));
    montarStore({ nome: 'Pessoa Teste', telefone: '11900000000', creci: '12345-F', creci_estado: 'SP' });

    render(<MemoryRouter initialEntries={['/onboarding?etapa=perfil']}><Onboarding /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Cidade'), { target: { value: 'Campinas' } });
    fireEvent.click(screen.getByRole('button', { name: /Salvar perfil/ }));

    await waitFor(() => expect(hooks.atualizarPerfilProfissional.mutateAsync).toHaveBeenCalled());
    expect(hooks.atualizarPerfilProfissional.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ creci: '12345-F' }),
    );
  });

  it('pré-preenche nome e telefone mesmo quando o corretor carrega depois do contexto (Onboarding.tsx:145-155)', async () => {
    // Caminho real de conta nova: o OnboardingGate já deixou o contexto no
    // cache do React Query e redirecionou antes do DataLoader buscar o
    // corretor. O contexto chega na 1ª renderização; o corretor, depois.
    montarOnboarding(contexto({ persona: 'corretor_autonomo', etapaAtual: 'perfil' }));
    montarStore(null);

    // Elemento novo a cada render: com a mesma referência o React pula o update.
    const arvore = () => <MemoryRouter initialEntries={['/onboarding?etapa=perfil']}><Onboarding /></MemoryRouter>;
    const { rerender } = render(arvore());

    montarStore({ nome: 'Pessoa Teste', telefone: '11900000000', creci: 'PENDENTE' });
    rerender(arvore());

    await waitFor(() => expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Pessoa Teste'));
    expect((screen.getByLabelText('Telefone') as HTMLInputElement).value).toBe('11900000000');
  });
});
