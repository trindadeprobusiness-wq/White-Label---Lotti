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

// Mesma leitura de VITE_API_URL do src/lib/api.ts (a base das rotas públicas, que não levam token).
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '');

/**
 * URL pública de captura de lead do imóvel: o "webhook" que o corretor cola em landing page, Meta Ads
 * ou PerfectPay. Substitui `${VITE_SUPABASE_URL}/functions/v1/lead-capture?imovel_id=` (mesmo corpo,
 * mesma resposta, sem login).
 */
export function urlCapturaLeadApi(imovelId: string): string {
  return `${BASE}/api/publico/leads?imovel_id=${encodeURIComponent(imovelId)}`;
}

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

/** Evento de conversão (UTMify) na fila do servidor, depois da venda. O payload é montado no servidor. */
export async function registrarEventoVendaApi(
  id: string,
  dados: { valor?: number; cliente_id?: string | null },
): Promise<{ enfileirado: true; id: string }> {
  return lerJson(
    await chamarApi(`${rota(id)}/venda/evento`, corpoJson('POST', dados)),
    'Não foi possível enfileirar o evento de conversão.',
  );
}

// ── Fotos (linhas de imovel_fotos; o arquivo vai e volta por src/lib/api/arquivos.ts) ──────────

/** Linha de public.imovel_fotos como o PostgREST entrega. */
export type FotoImovelApi = {
  id: string;
  imovel_id: string;
  arquivo_url: string;
  arquivo_path: string;
  principal: boolean | null;
  ordem: number | null;
  created_at: string | null;
};

export type FotoResumoApi = { imovel_id: string; arquivo_url: string; principal: boolean | null };

/** Teto de ids por pedido de miniaturas (o mesmo do DTO). */
const LOTE_RESUMO = 1000;

export async function listarFotosImovelApi(imovelId: string): Promise<FotoImovelApi[]> {
  return lerJson(await chamarApi(`${rota(imovelId)}/fotos`), 'Não foi possível carregar as fotos.');
}

/** Grava a linha da foto já enviada. O servidor decide a ordem e a principal (a primeira foto é principal). */
export async function criarFotoImovelApi(
  imovelId: string,
  dados: { arquivo_url: string; arquivo_path: string; principal?: boolean },
): Promise<FotoImovelApi> {
  return lerJson(await chamarApi(`${rota(imovelId)}/fotos`, corpoJson('POST', dados)), 'Não foi possível salvar a foto.');
}

export async function removerFotoImovelApi(fotoId: string): Promise<void> {
  return lerJson(
    await chamarApi(`/api/imoveis/fotos/${encodeURIComponent(fotoId)}`, corpoJson('DELETE')),
    'Não foi possível remover a foto.',
  );
}

export async function reordenarFotosImovelApi(imovelId: string, ids: string[]): Promise<{ atualizadas: number }> {
  return lerJson(
    await chamarApi(`${rota(imovelId)}/fotos/ordem`, corpoJson('PATCH', { ids })),
    'Não foi possível salvar a nova ordem das fotos.',
  );
}

export async function definirFotoPrincipalApi(imovelId: string, fotoId: string): Promise<{ imovel_id: string; foto_id: string }> {
  return lerJson(
    await chamarApi(`${rota(imovelId)}/fotos/${encodeURIComponent(fotoId)}/principal`, corpoJson('PATCH')),
    'Não foi possível definir a foto principal.',
  );
}

/** Fotos dos imóveis da lista (miniaturas), na ordem de criação. Lotes de até 1000 imóveis. */
export async function resumoFotosImoveisApi(imovelIds: string[]): Promise<FotoResumoApi[]> {
  const saida: FotoResumoApi[] = [];
  for (let i = 0; i < imovelIds.length; i += LOTE_RESUMO) {
    const lote = imovelIds.slice(i, i + LOTE_RESUMO);
    saida.push(...await lerJson<FotoResumoApi[]>(
      await chamarApi('/api/imoveis/fotos/resumo', corpoJson('POST', { imovel_ids: lote })),
      'Não foi possível carregar as fotos dos imóveis.',
    ));
  }
  return saida;
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
