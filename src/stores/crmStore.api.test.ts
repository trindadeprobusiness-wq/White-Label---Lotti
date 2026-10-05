import { beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true, chamarApi: vi.fn(), listarAlertasApi: vi.fn(), marcarAlertasLidosApi: vi.fn() }));
vi.mock('@/lib/api/crm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/crm')>()), // mantém CHAVES_*
  criarClienteApi: vi.fn(), buscarCandidatosApi: vi.fn(), removerClienteApi: vi.fn(),
  definirImovelDeInteresseApi: vi.fn(), listarClientesApi: vi.fn().mockResolvedValue([]),
  atualizarClienteApi: vi.fn(), moverClienteNoFunilApi: vi.fn(),
  registrarHistoricoApi: vi.fn(), listarHistoricoApi: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/api/imoveis', () => ({ listarImoveisApi: vi.fn().mockResolvedValue([]) }));

import * as crmApi from '@/lib/api/crm';
import { listarImoveisApi } from '@/lib/api/imoveis';
import { ErroApi } from '@/lib/api/http';
import { useCRMStore } from './crmStore';

const api = vi.mocked(crmApi);
const ANA = '11111111-1111-4111-8111-111111111111';
const NOVO = '22222222-2222-4222-8222-222222222222';
const IMOVEL = '33333333-3333-4333-8333-333333333333';
const novo = {
  nome: 'Ana', telefone: '(62) 91111-0002', email: '', tipo_interesse: 'COMPRA' as const,
  status_funil: 'QUALIFICACAO' as const, ultimo_contato: '2026-09-28T12:00:00Z', observacoes: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listarClientesApi.mockResolvedValue([]);
  api.listarHistoricoApi.mockResolvedValue([]);
  vi.mocked(listarImoveisApi).mockResolvedValue([]);
  useCRMStore.setState({ clientes: [], imoveis: [], historico: [] });
});

describe('crmStore com a API Lotti', () => {
  it('addCliente cria pela API, só com as chaves do DTO e sem corretor_id', async () => {
    api.criarClienteApi.mockResolvedValue({ status: 'created', cliente_id: NOVO });
    const comExtras = { ...novo, corretor_id: 'x', documentos: [] } as unknown as typeof novo;
    await expect(useCRMStore.getState().addCliente(comExtras)).resolves.toEqual({ status: 'created', id: NOVO });
    expect(api.criarClienteApi).toHaveBeenCalledWith(novo);
    expect(api.listarClientesApi).toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('addCliente com duplicate devolve os candidatos sem toast', async () => {
    api.criarClienteApi.mockResolvedValue({ status: 'duplicate', candidatos: [{ id: ANA, nome: 'Ana Souza', motivo: 'telefone' }] });
    await expect(useCRMStore.getState().addCliente(novo))
      .resolves.toEqual({ status: 'duplicate', candidatos: [{ id: ANA, nome: 'Ana Souza', motivo: 'telefone' }] });
    expect(toast).not.toHaveBeenCalled();
  });

  it('409 duplicate_client_phone procura o dono pela API de candidatos', async () => {
    api.criarClienteApi.mockRejectedValue(new ErroApi(409, 'duplicate_client_phone', 'duplicate_client_phone', ANA));
    api.buscarCandidatosApi.mockResolvedValue([{ id: ANA, nome: 'Ana Souza', motivo: 'telefone' }]);
    await expect(useCRMStore.getState().addCliente(novo))
      .resolves.toEqual({ status: 'duplicate', candidatos: [{ id: ANA, nome: 'Ana Souza', motivo: 'telefone' }] });
    expect(api.buscarCandidatosApi).toHaveBeenCalledWith({ telefone: novo.telefone });
    expect(toast).not.toHaveBeenCalled();
  });

  it('sem resposta da busca, o id do erro ainda abre o cadastro', async () => {
    api.atualizarClienteApi.mockRejectedValue(new ErroApi(409, 'duplicate_client_phone', 'duplicate_client_phone', ANA));
    api.buscarCandidatosApi.mockRejectedValue(new ErroApi(400, null, 'Telefone inválido.'));
    await expect(useCRMStore.getState().updateCliente(NOVO, { telefone: '62911110002' }))
      .resolves.toEqual({ status: 'duplicate', candidatos: [{ id: ANA, nome: '', motivo: 'telefone' }] });
  });

  it('invalid_name mostra o texto próprio no toast', async () => {
    api.criarClienteApi.mockRejectedValue(new ErroApi(422, 'invalid_name', 'invalid_name'));
    await expect(useCRMStore.getState().addCliente(novo)).resolves.toEqual({ status: 'error' });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Informe o nome do cliente.' }));
  });

  it('updateCliente manda só as colunas editáveis', async () => {
    api.atualizarClienteApi.mockResolvedValue({ id: NOVO });
    const dados = { nome: 'Ana', telefone: '1', email: 'a@b.c', tipo_interesse: 'COMPRA', observacoes: '', status_funil: 'DOCUMENTACAO', documentos: [] };
    await expect(useCRMStore.getState().updateCliente(NOVO, dados as never)).resolves.toEqual({ status: 'updated', id: NOVO });
    expect(api.atualizarClienteApi).toHaveBeenCalledWith(NOVO, { nome: 'Ana', telefone: '1', email: 'a@b.c', tipo_interesse: 'COMPRA', observacoes: '' });
  });

  it('removeCliente com contrato devolve o ErroApi com code 23503', async () => {
    const erro = new ErroApi(409, 'cliente_com_contrato', 'Existem contratos vinculados a este cliente.', null, '23503');
    api.removerClienteApi.mockRejectedValue(erro);
    const r = await useCRMStore.getState().removeCliente(ANA);
    expect(r).toEqual({ success: false, error: erro });
    expect((r.error as ErroApi).code).toBe('23503');
    expect(/contratos/.test((r.error as ErroApi).message)).toBe(true);
  });

  it('removeCliente com sucesso relê a lista', async () => {
    api.removerClienteApi.mockResolvedValue(undefined);
    await expect(useCRMStore.getState().removeCliente(ANA)).resolves.toEqual({ success: true });
    expect(api.listarClientesApi).toHaveBeenCalled();
  });

  it("vincularClienteImovel com 'none' remove o vínculo (imovel_id null), sem toast", async () => {
    api.definirImovelDeInteresseApi.mockResolvedValue({ cliente_id: 'x', imovel_id: null });
    await useCRMStore.getState().vincularClienteImovel('x', 'none');
    expect(api.definirImovelDeInteresseApi).toHaveBeenCalledWith('x', null);
    expect(toast).not.toHaveBeenCalled();

    await useCRMStore.getState().vincularClienteImovel(ANA, IMOVEL);
    expect(api.definirImovelDeInteresseApi).toHaveBeenLastCalledWith(ANA, IMOVEL);
  });

  it('fetchClientes e fetchImoveis montam o mesmo formato do Supabase', async () => {
    api.listarClientesApi.mockResolvedValue([{ id: ANA, nome: 'Ana', cliente_imovel: [{ imovel_id: IMOVEL }] }]);
    vi.mocked(listarImoveisApi).mockResolvedValue([{ id: IMOVEL, titulo: 'Casa' }]);
    await useCRMStore.getState().fetchClientes();
    await useCRMStore.getState().fetchImoveis();
    const [cliente] = useCRMStore.getState().clientes;
    expect(cliente).toMatchObject({ id: ANA, documentos: [], imoveis_interesse: [IMOVEL] });
    expect(useCRMStore.getState().imoveis[0]).toMatchObject({ id: IMOVEL, clientes_interessados: [] });
  });

  it('updateClienteStatus reverte o otimista quando a API falha', async () => {
    useCRMStore.setState({ clientes: [{ id: ANA, status_funil: 'QUALIFICACAO' }] as never });
    api.moverClienteNoFunilApi.mockRejectedValue(new ErroApi(400, 'dados_invalidos', 'Dados inválidos. Confira os campos e tente de novo.'));
    await useCRMStore.getState().updateClienteStatus(ANA, 'DOCUMENTACAO');
    expect(api.moverClienteNoFunilApi).toHaveBeenCalledWith(ANA, 'DOCUMENTACAO');
    expect(useCRMStore.getState().clientes[0].status_funil).toBe('QUALIFICACAO');
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Erro ao mover cliente no funil' }));
  });

  it('addHistorico grava pela API sem data_contato e relê o histórico do cliente', async () => {
    api.registrarHistoricoApi.mockResolvedValue({});
    await useCRMStore.getState().addHistorico({ cliente_id: ANA, tipo: 'LIGACAO', descricao: 'Ligou', data: 'x' } as never);
    expect(api.registrarHistoricoApi).toHaveBeenCalledWith(ANA, { tipo: 'TELEFONE', direcao: 'OUT', conteudo: 'Ligou', metadata: { tipo_ui: 'LIGACAO' } });
    expect(api.listarHistoricoApi).toHaveBeenCalledWith(ANA);
  });
});
