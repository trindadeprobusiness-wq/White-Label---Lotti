import { chamarApi } from '@/lib/api';
import { corpoJson, lerJson } from './http';

// Imóveis pela API Lotti (fase 4, módulo 2). Só é chamado atrás de apiDisponivel().

/** Linha de public.imoveis como o PostgREST entrega (inclui proprietario_*: rota de gestão). */
export type LinhaImovel = Record<string, unknown> & { id: string };

export type ClienteInteressado = { id: string; nome: string; telefone: string; status_funil: string };

export type DadosImovelApi = {
  titulo: string;
  tipo: string;
  finalidade?: string;
  valor: number;
  area_m2?: number | null;
  dormitorios?: number | null;
  garagem?: number | null;
  suites?: number | null;
  banheiros?: number | null;
  endereco: string;
  bairro?: string | null;
  cidade: string;
  proprietario_nome: string;
  ativo?: boolean;
};

export type AlteracaoImovelApi = Partial<Omit<DadosImovelApi, 'ativo'>> & { anunciado?: boolean };

const rota = (id: string) => `/api/imoveis/${encodeURIComponent(id)}`;

export async function listarImoveisApi(): Promise<LinhaImovel[]> {
  return lerJson(await chamarApi('/api/imoveis'), 'Não foi possível carregar os imóveis.');
}

export async function obterImovelApi(id: string): Promise<LinhaImovel> {
  return lerJson(await chamarApi(rota(id)), 'Imóvel não encontrado.');
}

export async function listarClientesInteressadosApi(imovelId: string): Promise<ClienteInteressado[]> {
  return lerJson(await chamarApi(`${rota(imovelId)}/clientes-interessados`), 'Não foi possível carregar os clientes interessados.');
}

export async function criarImovelApi(dados: DadosImovelApi): Promise<LinhaImovel> {
  return lerJson(await chamarApi('/api/imoveis', corpoJson('POST', dados)), 'Não foi possível cadastrar o imóvel.');
}

export async function atualizarImovelApi(id: string, dados: AlteracaoImovelApi): Promise<LinhaImovel> {
  return lerJson(await chamarApi(rota(id), corpoJson('PATCH', dados)), 'Não foi possível atualizar o imóvel.');
}

export async function removerImovelApi(id: string): Promise<void> {
  return lerJson(await chamarApi(rota(id), corpoJson('DELETE')), 'Não foi possível excluir o imóvel.');
}

export async function registrarVendaImovelApi(
  id: string,
  clienteId: string | null,
): Promise<{ imovel_id: string; status_venda: 'VENDIDO'; cliente_atualizado: boolean }> {
  return lerJson(
    await chamarApi(`${rota(id)}/venda`, corpoJson('POST', { cliente_id: clienteId })),
    'Não foi possível registrar a venda.',
  );
}
