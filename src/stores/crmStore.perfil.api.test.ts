import { beforeEach, describe, expect, it, vi } from 'vitest';

// Com a API ligada (login próprio) não existe sessão do Supabase: qualquer acesso
// ao cliente do Supabase aqui é bug. O mock vazio faz esse acesso estourar.
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true, chamarApi: vi.fn(), listarAlertasApi: vi.fn(), marcarAlertasLidosApi: vi.fn() }));
vi.mock('@/lib/api/perfil', () => ({ obterPerfilApi: vi.fn(), atualizarCorretorApi: vi.fn() }));
vi.mock('@/lib/api/crm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/crm')>()),
  listarHistoricoApi: vi.fn(), listarHistoricoGeralApi: vi.fn(),
}));

import * as crmApi from '@/lib/api/crm';
import * as perfilApi from '@/lib/api/perfil';
import { corretorIdDaContaApi, useCRMStore } from './crmStore';

const perfil = vi.mocked(perfilApi);
const crm = vi.mocked(crmApi);
const PROPRIO = '11111111-1111-4111-8111-111111111111';
const DONO = '22222222-2222-4222-8222-222222222222';
const linha = { id: PROPRIO, nome: 'Ana', creci: '123', creci_estado: 'GO', email: 'ana@x.com', telefone: '(62) 9', preferencias: { tema: 'light', notificacoes: { novo_cliente: true } } };

beforeEach(() => {
  vi.clearAllMocks();
  useCRMStore.getState().limparDadosDaSessao();
});

describe('crmStore — perfil do corretor pela API', () => {
  it('fetchCorretor lê /api/perfil/corretor: guarda a linha, as preferências e o corretor da conta', async () => {
    // Membro de equipe: o próprio perfil é um, a conta em uso (get_corretor_id) é a do dono.
    perfil.obterPerfilApi.mockResolvedValue({ corretor: linha, corretor_id: DONO });
    await useCRMStore.getState().fetchCorretor();
    const estado = useCRMStore.getState();
    expect(estado.corretor?.id).toBe(PROPRIO);
    expect(estado.corretorContaId).toBe(DONO);
    expect(estado.preferencias.tema).toBe('light');
    expect(estado.preferencias.notificacoes.novo_cliente).toBe(true);
    expect(estado.preferencias.notificacoes.followup_atrasado).toBe(true);
  });

  it('sem linha de corretor: corretor nulo e preferências padrão', async () => {
    perfil.obterPerfilApi.mockResolvedValue({ corretor: null, corretor_id: null });
    await useCRMStore.getState().fetchCorretor();
    expect(useCRMStore.getState().corretor).toBeNull();
    expect(useCRMStore.getState().corretorContaId).toBeNull();
  });

  it('updateCorretor manda o PATCH e aplica a linha que volta', async () => {
    perfil.obterPerfilApi.mockResolvedValue({ corretor: linha, corretor_id: PROPRIO });
    await useCRMStore.getState().fetchCorretor();
    perfil.atualizarCorretorApi.mockResolvedValue({ ...linha, nome: 'Ana Souza', updated_at: 'agora' });
    await useCRMStore.getState().updateCorretor({ nome: 'Ana Souza' });
    expect(perfil.atualizarCorretorApi).toHaveBeenCalledWith({ nome: 'Ana Souza' });
    expect(useCRMStore.getState().corretor?.nome).toBe('Ana Souza');
    expect(toast).not.toHaveBeenCalled();
  });

  it('updateCorretor com erro da API avisa e mantém o perfil', async () => {
    perfil.obterPerfilApi.mockResolvedValue({ corretor: linha, corretor_id: PROPRIO });
    await useCRMStore.getState().fetchCorretor();
    perfil.atualizarCorretorApi.mockRejectedValue(new Error('Email inválido'));
    await useCRMStore.getState().updateCorretor({ email: 'x' });
    expect(useCRMStore.getState().corretor?.email).toBe('ana@x.com');
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Erro ao salvar configurações' }));
  });

  it('limparDadosDaSessao zera o corretor da conta (troca de usuário no navegador)', async () => {
    perfil.obterPerfilApi.mockResolvedValue({ corretor: linha, corretor_id: DONO });
    await useCRMStore.getState().fetchCorretor();
    useCRMStore.getState().limparDadosDaSessao();
    expect(useCRMStore.getState().corretorContaId).toBeNull();
  });
});

describe('corretorIdDaContaApi (no lugar do rpc get_corretor_id)', () => {
  it('usa o que o perfil já carregou, sem nova chamada', async () => {
    useCRMStore.setState({ corretorContaId: DONO });
    await expect(corretorIdDaContaApi()).resolves.toBe(DONO);
    expect(perfil.obterPerfilApi).not.toHaveBeenCalled();
  });

  it('perfil ainda não carregado: busca uma vez e guarda', async () => {
    perfil.obterPerfilApi.mockResolvedValue({ corretor: linha, corretor_id: DONO });
    await expect(corretorIdDaContaApi()).resolves.toBe(DONO);
    await expect(corretorIdDaContaApi()).resolves.toBe(DONO);
    expect(perfil.obterPerfilApi).toHaveBeenCalledTimes(1);
  });

  it('conta sem vínculo ativo (suspensa): lança com texto para o usuário', async () => {
    perfil.obterPerfilApi.mockResolvedValue({ corretor: linha, corretor_id: null });
    await expect(corretorIdDaContaApi()).rejects.toThrow('Não foi possível identificar sua conta');
  });
});

describe('crmStore — histórico pela API', () => {
  it('sem cliente usa a timeline geral; com cliente, a do cliente', async () => {
    crm.listarHistoricoGeralApi.mockResolvedValue([{ id: 'h1' }]);
    await useCRMStore.getState().fetchHistorico();
    expect(crm.listarHistoricoGeralApi).toHaveBeenCalledTimes(1);
    expect(useCRMStore.getState().historico).toEqual([{ id: 'h1' }]);

    crm.listarHistoricoApi.mockResolvedValue([{ id: 'h2' }]);
    await useCRMStore.getState().fetchHistorico(PROPRIO);
    expect(crm.listarHistoricoApi).toHaveBeenCalledWith(PROPRIO);
    expect(useCRMStore.getState().historico).toEqual([{ id: 'h2' }]);
  });
});
