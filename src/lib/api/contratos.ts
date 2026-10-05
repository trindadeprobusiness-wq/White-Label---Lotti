import { format } from 'date-fns';
import { chamarApi } from '@/lib/api';
import { corpoJson, escolher, lerJson } from './http';
import { listarClientesApi } from './crm';
import { listarImoveisApi } from './imoveis';

// Contratos, documentos e IA de contratos pela API Lotti (fase 4, módulo contratos).
// Só é chamado atrás de apiDisponivel(). corretor_id nunca vai no corpo: o escolher descarta.

type Linha = Record<string, unknown>;

export const CHAVES_CRIAR_CONTRATO = ['tipo', 'cliente_id', 'imovel_id', 'valor', 'data_inicio', 'data_fim', 'prazo_meses', 'dia_vencimento', 'indice_reajuste', 'conteudo', 'status', 'observacoes', 'arquivo_url', 'taxa_administracao_percentual', 'multa_atraso_percentual', 'juros_mora_diario_percentual', 'dia_vencimento_aluguel', 'dia_repasse_proprietario'] as const;
export const CHAVES_LOCACAO = ['tipo', 'cliente_id', 'imovel_id', 'valor', 'data_inicio', 'dia_vencimento', 'conteudo', 'arquivo_url', 'multa_atraso_percentual', 'juros_mora_diario_percentual'] as const;
export const CHAVES_ALTERAR_CONTRATO = ['status', 'arquivo_url', 'observacoes', 'data_fim'] as const;
export const CHAVES_CRIAR_DOCUMENTO = ['nome', 'tipo', 'arquivo_path', 'arquivo_url', 'cliente_id', 'imovel_id', 'data_validade', 'observacoes'] as const;
export const CHAVES_ALTERAR_DOCUMENTO = ['nome', 'tipo', 'cliente_id', 'imovel_id', 'data_validade', 'observacoes', 'validado'] as const;

const ERRO_LISTAR = 'Não foi possível carregar os contratos.';
const ERRO_SALVAR = 'Erro ao salvar contrato.';

const rotaContrato = (id: string) => `/api/contratos/${encodeURIComponent(id)}`;
const rotaDocumento = (id: string) => `/api/documentos/${encodeURIComponent(id)}`;

export async function listarContratosApi(): Promise<Linha[]> {
  return lerJson(await chamarApi('/api/contratos'), ERRO_LISTAR);
}

export async function listarContratosCentralApi(): Promise<Linha[]> {
  return lerJson(await chamarApi('/api/contratos/central'), ERRO_LISTAR);
}

export async function listarContratosLocacaoApi(tipo = 'LOCACAO_RESIDENCIAL'): Promise<Linha[]> {
  return lerJson(await chamarApi(`/api/contratos/locacao?tipo=${encodeURIComponent(tipo)}`), ERRO_LISTAR);
}

export async function listarContratosDosClientesApi(ids: string[]): Promise<Linha[]> {
  if (ids.length === 0) return [];
  return lerJson(
    await chamarApi('/api/contratos/por-clientes', corpoJson('POST', { cliente_ids: ids })),
    'Não foi possível verificar os contratos dos clientes.',
  );
}

export async function criarContratoApi(dados: object): Promise<Linha> {
  return lerJson(await chamarApi('/api/contratos', corpoJson('POST', escolher(dados, CHAVES_CRIAR_CONTRATO))), ERRO_SALVAR);
}

export async function criarLocacaoApi(
  dados: object,
  primeiraFatura: { data_vencimento: string; mes_referencia: string },
): Promise<{ contrato: Linha; fatura: Linha }> {
  const corpo = { ...escolher(dados, CHAVES_LOCACAO), primeira_fatura: primeiraFatura };
  return lerJson(await chamarApi('/api/contratos/locacao', corpoJson('POST', corpo)), ERRO_SALVAR);
}

export async function editarLocacaoApi(id: string, dados: object): Promise<{ contrato: Linha; faturas_emitidas: string[] }> {
  return lerJson(await chamarApi(`${rotaContrato(id)}/locacao`, corpoJson('PATCH', escolher(dados, CHAVES_LOCACAO))), ERRO_SALVAR);
}

export async function alterarContratoApi(id: string, dados: object): Promise<Linha> {
  return lerJson(
    await chamarApi(rotaContrato(id), corpoJson('PATCH', escolher(dados, CHAVES_ALTERAR_CONTRATO))),
    'Não foi possível alterar o contrato.',
  );
}

export async function removerContratoApi(id: string): Promise<void> {
  return lerJson(await chamarApi(rotaContrato(id), corpoJson('DELETE')), 'Não foi possível excluir o contrato.');
}

export async function listarDocumentosApi(): Promise<Linha[]> {
  return lerJson(await chamarApi('/api/documentos'), 'Não foi possível carregar os documentos.');
}

export async function criarDocumentoApi(dados: object): Promise<Linha> {
  return lerJson(
    await chamarApi('/api/documentos', corpoJson('POST', escolher(dados, CHAVES_CRIAR_DOCUMENTO))),
    'Não foi possível salvar o documento.',
  );
}

export async function alterarDocumentoApi(id: string, dados: object): Promise<Linha> {
  return lerJson(
    await chamarApi(rotaDocumento(id), corpoJson('PATCH', escolher(dados, CHAVES_ALTERAR_DOCUMENTO))),
    'Não foi possível atualizar o documento.',
  );
}

export async function removerDocumentoApi(id: string): Promise<void> {
  return lerJson(await chamarApi(rotaDocumento(id), corpoJson('DELETE')), 'Não foi possível excluir o documento.');
}

export async function gerarContratoIaApi(
  corpo: object,
): Promise<{ contrato: string; modelo_ia: string; prompt_version: string; tempo_geracao_ms: number }> {
  return lerJson(await chamarApi('/api/contratos/ia/gerar', corpoJson('POST', corpo)), 'Erro ao gerar contrato.');
}

export async function analisarContratoIaApi(corpo: { fileBase64: string; mimeType: string; modo?: 'central' }): Promise<unknown> {
  const json = await lerJson<{ dados: unknown }>(
    await chamarApi('/api/contratos/ia/analisar', corpoJson('POST', corpo)),
    'Erro interno ao analisar contrato',
  );
  return json.dados;
}

// --- Selects de apoio das telas (imóveis e clientes do módulo 2) ---

const ordenarPor = <T extends Record<string, unknown>>(linhas: T[], campo: string) =>
  [...linhas].sort((a, b) => String(a[campo] ?? '').localeCompare(String(b[campo] ?? ''), 'pt-BR'));

const recortar = (linha: Record<string, unknown>, colunas: readonly string[]) =>
  Object.fromEntries(colunas.map((c) => [c, linha[c] ?? null])) as Record<string, unknown>;

/** Imóveis com só as colunas pedidas, ordenados por título como o `.order('titulo')` de hoje. */
export async function opcoesImoveisApi<T = Record<string, unknown>>(colunas: readonly string[], soAtivos = false): Promise<T[]> {
  const linhas = await listarImoveisApi();
  const filtradas = soAtivos ? linhas.filter((l) => l.ativo === true) : linhas;
  return ordenarPor(filtradas.map((l) => recortar(l, colunas)), 'titulo') as unknown as T[];
}

/** Clientes com só as colunas pedidas, ordenados por nome como o `.order('nome')` de hoje. */
export async function opcoesClientesApi<T = Record<string, unknown>>(colunas: readonly string[]): Promise<T[]> {
  const linhas = await listarClientesApi();
  return ordenarPor(linhas.map((l) => recortar(l, colunas)), 'nome') as unknown as T[];
}

/**
 * Primeira fatura de uma locação nova, a partir do vencimento que a tela já calcula
 * (Date local à meia-noite). Vai como `yyyy-MM-dd` local, sem passar por UTC: o
 * `toISOString()` de hoje deslocava o dia no fuso de São Paulo. O status
 * ATRASADO/PENDENTE é decidido pelo servidor.
 */
export function primeiraFaturaLocacao(vencimento: Date): { data_vencimento: string; mes_referencia: string } {
  return { data_vencimento: format(vencimento, 'yyyy-MM-dd'), mes_referencia: format(vencimento, 'MM/yyyy') };
}

/** `data_inicio` só com a data (a rota recusa hora); o banco já fazia esse corte no ::date. */
export const somenteData = (valor: unknown) => (typeof valor === 'string' ? valor.slice(0, 10) : valor);
