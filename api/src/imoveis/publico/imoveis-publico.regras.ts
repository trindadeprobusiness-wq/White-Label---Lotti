import { HttpException } from '@nestjs/common';

/**
 * Regras puras das Edge Functions public-imoveis e imovel-detalhe (porte fiel, sem banco).
 *
 * A validação é manual, não um DTO: o ValidationPipe global usa forbidNonWhitelisted e recusaria
 * qualquer parâmetro extra que o site mande (utm_*, cache-buster "_="), coisa que a Edge ignorava.
 * Os textos e status são os de supabase/functions/_shared/public-request.ts e das duas funções.
 */

/** Erro no formato das Edge Functions públicas: `{ error }` com o status. */
export const erroVitrine = (status: number, error: string): HttpException => new HttpException({ error }, status);

export const MSG_FALHA_CARGA = 'Não foi possível carregar os dados.';
export const MSG_FALHA_GENERICA = 'Não foi possível carregar os dados. Tente novamente.';
export const MSG_ID_OBRIGATORIO = 'Parâmetro "id" é obrigatório';
export const MSG_NAO_DISPONIVEL = 'Imóvel não encontrado ou não disponível';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Consulta = Record<string, unknown>;

/** O que URLSearchParams.get devolveria: o primeiro valor em texto, ou null. */
export function parametro(consulta: Consulta, nome: string): string | null {
  const v = consulta?.[nome];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : null;
  return null;
}

/** publicInteger de _shared/public-request.ts. */
export function inteiroPublico(raw: string | null, padrao: number, min: number, max: number): number {
  const valor = raw === null ? padrao : Number(raw);
  if (!Number.isSafeInteger(valor) || valor < min || valor > max) throw erroVitrine(400, 'Parâmetro numérico inválido.');
  return valor;
}

export type Finalidade = 'venda' | 'aluguel';

export interface FiltrosVitrine {
  /** Só 'venda' ou 'aluguel' filtram; qualquer outro valor de `tipo` é ignorado, como na Edge. */
  tipo: Finalidade | null;
  limit: number;
  offset: number;
  bairro: string | null;
  precoMin: number | null;
  precoMax: number | null;
  quartosMin: number | null;
  /** Em maiúsculas. Valor fora do enum não casa com nada (na Edge virava 500 do PostgREST). */
  tipoImovel: string | null;
}

/** Validação de public-imoveis, na mesma ordem da Edge (o primeiro erro vence). */
export function lerFiltrosVitrine(consulta: Consulta): FiltrosVitrine {
  const tipoBruto = parametro(consulta, 'tipo')?.toLowerCase();
  const limit = inteiroPublico(parametro(consulta, 'limit'), 12, 1, 20);
  const offset = inteiroPublico(parametro(consulta, 'offset'), 0, 0, 10000);
  const bairro = parametro(consulta, 'bairro');
  const precoMin = parametro(consulta, 'preco_min');
  const precoMax = parametro(consulta, 'preco_max');
  const quartosMin = parametro(consulta, 'quartos_min');
  const tipoImovel = parametro(consulta, 'tipo_imovel');

  if (bairro && bairro.length > 120) throw erroVitrine(400, 'Bairro inválido.');
  for (const valor of [precoMin, precoMax, quartosMin]) {
    if (valor !== null && (!valor.trim() || !Number.isFinite(Number(valor)) || Number(valor) < 0 || Number(valor) > 1e12)) {
      throw erroVitrine(400, 'Filtro inválido.');
    }
  }
  if (quartosMin !== null && !Number.isInteger(Number(quartosMin))) throw erroVitrine(400, 'Filtro inválido.');
  if (precoMin !== null && precoMax !== null && Number(precoMin) > Number(precoMax)) throw erroVitrine(400, 'Faixa de preço inválida.');

  return {
    tipo: tipoBruto === 'venda' || tipoBruto === 'aluguel' ? tipoBruto : null,
    limit,
    offset,
    // Os `if (x)` da Edge: texto vazio não filtra.
    bairro: bairro || null,
    precoMin: precoMin ? Number(precoMin) : null,
    precoMax: precoMax ? Number(precoMax) : null,
    quartosMin: quartosMin ? Number(quartosMin) : null,
    tipoImovel: tipoImovel ? tipoImovel.toUpperCase() : null,
  };
}

/** id do imovel-detalhe: obrigatório e no formato UUID (qualquer versão). */
export function lerIdDetalhe(consulta: Consulta): string {
  const id = parametro(consulta, 'id');
  if (!id || !UUID_PATTERN.test(id)) throw erroVitrine(400, MSG_ID_OBRIGATORIO);
  return id;
}

export interface FotoBruta {
  id?: string;
  arquivo_url: string;
  ordem: number | null;
  principal: boolean | null;
}

/** Ordem da Edge: (ordem || 0) crescente, estável; a principal é a marcada ou a primeira. */
function organizarFotos(fotos: FotoBruta[] | null | undefined): { fotos: FotoBruta[]; principal: FotoBruta | undefined } {
  const ordenadas = (fotos ?? []).slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  return { fotos: ordenadas, principal: ordenadas.find((f) => f.principal) || ordenadas[0] };
}

/** descricaoCurta de public-imoveis: nunca devolve "undefined...". */
export function descricaoCurta(curta: string | null, longa: string | null): string {
  if (curta) return curta;
  if (!longa) return '';
  return longa.length > 120 ? `${longa.substring(0, 120)}...` : longa;
}

export interface LinhaVitrine {
  id: string;
  titulo: string;
  tipo: string;
  valor: number | string;
  area_m2: number | string | null;
  dormitorios: number | null;
  banheiros: number | null;
  garagem: number | null;
  endereco: string;
  bairro: string | null;
  cidade: string;
  estado: string | null;
  descricao: string | null;
  descricao_curta: string | null;
  created_at: string;
  imovel_fotos: FotoBruta[];
  /** Finalidades declaradas pelas fachadas ativas do imóvel. */
  venda: boolean;
  aluguel: boolean;
}

/** Normalização de public-imoveis (o contrato que o site consome). */
export function normalizarVitrine(linha: LinhaVitrine, tipo: Finalidade | null) {
  const { fotos, principal } = organizarFotos(linha.imovel_fotos);
  const tipoNegocio: Finalidade = tipo ?? (linha.venda ? 'venda' : 'aluguel');
  return {
    id: linha.id,
    titulo: linha.titulo,
    tipo_imovel: linha.tipo,
    tipo_negocio: tipoNegocio,
    valor: Number(linha.valor),
    area_m2: Number(linha.area_m2) || 0,
    dormitorios: linha.dormitorios || 0,
    banheiros: linha.banheiros || 0,
    garagem: linha.garagem || 0,
    endereco: linha.endereco,
    bairro: linha.bairro,
    cidade: linha.cidade,
    estado: linha.estado,
    descricao: linha.descricao,
    descricao_curta: descricaoCurta(linha.descricao_curta, linha.descricao),
    foto_principal: principal?.arquivo_url || null,
    fotos: fotos.map((f) => f.arquivo_url),
    created_at: linha.created_at,
  };
}

export interface LinhaDetalhe extends Omit<LinhaVitrine, 'venda' | 'aluguel'> {
  cep: string | null;
  status_venda: string;
  finalidade: string;
}

export interface LinhaSimilar {
  id: string;
  titulo: string;
  tipo: string;
  valor: number | string;
  area_m2: number | string | null;
  dormitorios: number | null;
  garagem: number | null;
  bairro: string | null;
  cidade: string;
  estado: string | null;
  finalidade: string;
  imovel_fotos: FotoBruta[];
}

const negocioDaFinalidade = (finalidade: string): Finalidade => (finalidade === 'LOCACAO' ? 'aluguel' : 'venda');

/** Normalização de imovel-detalhe. */
export function normalizarDetalhe(imovel: LinhaDetalhe, similares: LinhaSimilar[]) {
  const { fotos, principal } = organizarFotos(imovel.imovel_fotos);
  return {
    data: {
      id: imovel.id,
      titulo: imovel.titulo,
      tipo_imovel: imovel.tipo,
      tipo_negocio: negocioDaFinalidade(imovel.finalidade),
      valor: Number(imovel.valor),
      area_m2: Number(imovel.area_m2) || 0,
      dormitorios: imovel.dormitorios || 0,
      banheiros: imovel.banheiros || 0,
      garagem: imovel.garagem || 0,
      endereco: imovel.endereco,
      bairro: imovel.bairro,
      cidade: imovel.cidade,
      estado: imovel.estado,
      cep: imovel.cep,
      descricao: imovel.descricao,
      // A Edge fazia `curta || (descricao?.substring(0, 120) + '...')`, que sem descrição virava a
      // string "undefined...". Mesmo formato, sem esse texto.
      descricao_curta: imovel.descricao_curta || (imovel.descricao ? `${imovel.descricao.substring(0, 120)}...` : ''),
      foto_principal: principal?.arquivo_url || null,
      fotos: fotos.map((f) => f.arquivo_url),
      created_at: imovel.created_at,
    },
    similares: similares.map((s) => {
      const organizadas = organizarFotos(s.imovel_fotos);
      return {
        id: s.id,
        titulo: s.titulo,
        tipo_imovel: s.tipo,
        tipo_negocio: negocioDaFinalidade(s.finalidade),
        valor: Number(s.valor),
        area_m2: Number(s.area_m2) || 0,
        dormitorios: s.dormitorios || 0,
        garagem: s.garagem || 0,
        bairro: s.bairro,
        cidade: s.cidade,
        foto_principal: organizadas.principal?.arquivo_url || null,
      };
    }),
  };
}
