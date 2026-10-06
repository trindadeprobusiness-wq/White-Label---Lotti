import { chamarApi } from '@/lib/api';
import type { FachadaMetricas } from '@/types/fachada';
import { corpoJson, escolher, lerJson } from './http';

// Fachadas Inteligentes (placas com QR Code, leads e página pública) pela API
// Lotti. Só é chamado atrás de apiDisponivel(). As listas de chaves espelham os
// DTOs da API: chave fora delas dá 400, então o front só manda as aceitas.

export const CHAVES_CRIAR_FACHADA = [
  'imovel_id', 'tipo_negocio', 'template_id', 'cta_principal', 'modo_conversao',
  'mensagem_whatsapp', 'mensagem_contato', 'logo_url', 'foto_principal_url', 'ativo',
] as const;
/** Sem `imovel_id`: trocar o imóvel de uma placa já impressa mudaria o que o QR mostra sem mudar o QR. */
export const CHAVES_EDITAR_FACHADA = [
  'tipo_negocio', 'template_id', 'cta_principal', 'modo_conversao',
  'mensagem_whatsapp', 'mensagem_contato', 'logo_url', 'foto_principal_url', 'ativo',
] as const;
export const CHAVES_CRIAR_TEMPLATE = ['nome', 'categoria', 'config', 'padrao'] as const;

type Linha = Record<string, unknown>;

export interface MidiasImovel { foto_principal_url: string | null; fotos: number; videos: number }
export interface FachadaPublicaResposta {
  fachada: Linha;
  fotos: Array<{ id: string; arquivo_url: string; principal: boolean }>;
}

const id = (v: string) => encodeURIComponent(v);

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '');

/**
 * Chamada SEM sessão (landing do QR Code). Mesma base de src/lib/api.ts, sem
 * Authorization: `chamarApi` exige sessão do Supabase e lança "Sua sessão
 * expirou" quando não há — e na landing nunca há. Duplicado de propósito
 * enquanto src/lib/api.ts não é editável nesta onda.
 */
async function chamarApiPublica(caminho: string, init: RequestInit = {}): Promise<Response> {
  if (!API_URL) throw new Error('API Lotti indisponível no momento.');
  return fetch(`${API_URL}${caminho}`, init);
}

// ── Fachadas (F1–F4) ─────────────────────────────────────────────────────

export async function listarFachadasApi(): Promise<Linha[]> {
  return lerJson(await chamarApi('/api/fachadas'), 'Não foi possível carregar as fachadas.');
}

export async function criarFachadaApi(dados: object): Promise<Linha> {
  return lerJson(
    await chamarApi('/api/fachadas', corpoJson('POST', escolher(dados, CHAVES_CRIAR_FACHADA))),
    'Não foi possível criar a fachada.',
  );
}

export async function editarFachadaApi(fachadaId: string, dados: object): Promise<Linha> {
  return lerJson(
    await chamarApi(`/api/fachadas/${id(fachadaId)}`, corpoJson('PATCH', escolher(dados, CHAVES_EDITAR_FACHADA))),
    'Não foi possível atualizar a fachada.',
  );
}

export async function excluirFachadaApi(fachadaId: string): Promise<void> {
  await lerJson(await chamarApi(`/api/fachadas/${id(fachadaId)}`, corpoJson('DELETE')),
    'Não foi possível excluir a fachada.');
}

// ── Leads e métricas (F5–F7) ─────────────────────────────────────────────

export async function listarLeadsApi(fachadaId?: string): Promise<Linha[]> {
  const busca = fachadaId ? `?${new URLSearchParams({ fachada_id: fachadaId }).toString()}` : '';
  return lerJson(await chamarApi(`/api/fachadas/leads${busca}`), 'Não foi possível carregar os leads.');
}

/** Leads que ainda não viraram cliente (useLeadsPendentes do CRM): F5 com convertido=false. */
export async function listarLeadsPendentesApi(): Promise<Linha[]> {
  return lerJson(await chamarApi('/api/fachadas/leads?convertido=false'), 'Não foi possível carregar os leads.');
}

export async function excluirLeadApi(leadId: string): Promise<void> {
  await lerJson(await chamarApi(`/api/fachadas/leads/${id(leadId)}`, corpoJson('DELETE')),
    'Não foi possível excluir o lead.');
}

export async function obterMetricasApi(dias: number): Promise<FachadaMetricas> {
  const busca = new URLSearchParams({ dias: String(dias) }).toString();
  return lerJson(await chamarApi(`/api/fachadas/metricas?${busca}`), 'Não foi possível carregar as métricas.');
}

// ── Templates (F8–F11) ───────────────────────────────────────────────────

export async function listarTemplatesApi(escopo?: 'meus' | 'todos'): Promise<Linha[]> {
  const busca = escopo ? `?${new URLSearchParams({ escopo }).toString()}` : '';
  return lerJson(await chamarApi(`/api/fachadas/templates${busca}`), 'Não foi possível carregar os templates.');
}

export async function criarTemplateApi(dados: object): Promise<Linha> {
  return lerJson(
    await chamarApi('/api/fachadas/templates', corpoJson('POST', escolher(dados, CHAVES_CRIAR_TEMPLATE))),
    'Não foi possível salvar o template.',
  );
}

export async function excluirTemplateApi(templateId: string): Promise<void> {
  await lerJson(await chamarApi(`/api/fachadas/templates/${id(templateId)}`, corpoJson('DELETE')),
    'Não foi possível remover o template.');
}

/** F11 devolve 200 com corpo `null` quando não acha — não 404. */
export async function obterTemplatePorImagemApi(imagemUrl: string): Promise<Linha | null> {
  const busca = new URLSearchParams({ imagem_url: imagemUrl }).toString();
  return lerJson(await chamarApi(`/api/fachadas/templates/por-imagem?${busca}`),
    'Não foi possível carregar o template.');
}

// ── Mídias do imóvel (F12) ───────────────────────────────────────────────

export async function obterMidiasImovelApi(imovelId: string): Promise<MidiasImovel> {
  return lerJson(await chamarApi(`/api/fachadas/midias/${id(imovelId)}`),
    'Não foi possível carregar as mídias do imóvel.');
}

// ── Rotas públicas (P1–P3), sem sessão ───────────────────────────────────

export async function obterFachadaPublicaApi(fachadaId: string): Promise<FachadaPublicaResposta> {
  return lerJson(await chamarApiPublica(`/api/publico/fachadas/${id(fachadaId)}`),
    'Não foi possível carregar os dados. Tente novamente.');
}

export async function registrarEscaneamentoApi(fachadaId: string): Promise<void> {
  await lerJson(
    await chamarApiPublica(`/api/publico/fachadas/${id(fachadaId)}/escaneamentos`, { method: 'POST' }),
    'Não foi possível registrar o acesso.',
  );
}

export async function enviarLeadPublicoApi(
  fachadaId: string,
  dados: { nome: string; telefone: string; email?: string },
): Promise<{ registrado: true }> {
  return lerJson(
    await chamarApiPublica(`/api/publico/fachadas/${id(fachadaId)}/leads`,
      corpoJson('POST', escolher(dados, ['nome', 'telefone', 'email'] as const))),
    'Não foi possível enviar seus dados. Tente novamente.',
  );
}
