import { HttpException } from '@nestjs/common';

/**
 * Regras puras das Edge Functions crm-upsert-lead, crm-buscar-imoveis e crm-anexar-historico (n8n).
 *
 * O n8n manda o que o modelo preencheu (número como texto, campo extra, null em campo desconhecido),
 * e as Edge Functions não validavam tipo nenhum. Por isso nada de DTO com forbidNonWhitelisted aqui:
 * os campos conhecidos são lidos à mão e o resto é ignorado, como antes.
 */

export type Corpo = Record<string, unknown>;

/** Respostas de erro nos dois formatos que as funções usavam. */
export const erroSimples = (status: number, error: string): HttpException => new HttpException({ error }, status);
export const erroN8n = (status: number, error: string): HttpException => new HttpException({ success: false, error }, status);

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MSG_FALHA_INTERNA = 'Não foi possível concluir a operação.';

export function corpoObjeto(corpo: unknown): Corpo {
  return corpo && typeof corpo === 'object' && !Array.isArray(corpo) ? (corpo as Corpo) : {};
}

/** Texto do n8n: string como veio, número vira texto; null/objeto = ausente. */
export function textoN8n(valor: unknown): string | undefined {
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return undefined;
}

/** O que URLSearchParams.get devolveria: o primeiro valor em texto, ou null. */
export function parametro(consulta: Record<string, unknown>, nome: string): string | null {
  const v = consulta?.[nome];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : null;
  return null;
}

/**
 * status_funil é ENUM: 'PROPOSTA' e 'PERDIDO' não existem. quente → VISITA_PROPOSTA,
 * descartado → FECHADO_PERDIDO, o resto → QUALIFICACAO.
 */
export function statusDoLead(classificacao: unknown): 'VISITA_PROPOSTA' | 'FECHADO_PERDIDO' | 'QUALIFICACAO' {
  if (classificacao === 'quente') return 'VISITA_PROPOSTA';
  if (classificacao === 'descartado') return 'FECHADO_PERDIDO';
  return 'QUALIFICACAO';
}

/** tipo_interesse é ENUM (COMPRA | LOCACAO | AMBOS); ALUGUEL e PROPRIETARIO, que o n8n manda, são traduzidos. */
const INTERESSE: Record<string, 'COMPRA' | 'LOCACAO' | 'AMBOS'> = {
  COMPRA: 'COMPRA', LOCACAO: 'LOCACAO', ALUGUEL: 'LOCACAO', AMBOS: 'AMBOS', PROPRIETARIO: 'AMBOS',
};
export function interesseDoLead(tipo: unknown): 'COMPRA' | 'LOCACAO' | 'AMBOS' {
  return INTERESSE[String(tipo ?? '').toUpperCase()] ?? 'AMBOS';
}

/**
 * tracking_data do lead: classificação e faixa de valor não são colunas de clientes e ficam no jsonb
 * (é de onde a view v_leads_whatsapp lê a classificação). tracking_data do payload por cima.
 * Chave com undefined some no JSON, como no supabase-js.
 */
export function trackingDoLead(p: Corpo): Record<string, unknown> {
  const extra = p.tracking_data && typeof p.tracking_data === 'object' && !Array.isArray(p.tracking_data)
    ? (p.tracking_data as Record<string, unknown>) : {};
  return {
    origem: 'whatsapp',
    canal: 'evolution_api',
    classificacao: p.classificacao,
    faixa_valor_min: p.faixa_valor_min,
    faixa_valor_max: p.faixa_valor_max,
    forma_pagamento: p.forma_pagamento,
    tempo_decisao: p.tempo_decisao,
    ...extra,
  };
}

export interface FiltrosBusca {
  corretorId: string | null;
  /** Finalidades aceitas (VENDA → VENDA/AMBOS; ALUGUEL ou LOCACAO → LOCACAO/AMBOS); null = todas. */
  finalidades: string[] | null;
  /** Tipo do imóvel (APARTAMENTO, CASA...), em maiúsculas. */
  categoria: string | null;
  valorMin: number | null;
  valorMax: number | null;
  dormitorios: number | null;
  cidade: string | null;
  limit: number;
}

const numero = (raw: string | null): number => Number(raw || 0);

/**
 * Parâmetros de crm-buscar-imoveis. A Edge filtrava colunas que public.imoveis não tem (`status`,
 * `categoria`, e selecionava `url_website` e `fotos`), então respondia erro em toda chamada. Aqui os
 * mesmos parâmetros caem nas colunas reais: tipo → finalidade, categoria → tipo, DISPONIVEL → status_venda.
 */
export function lerFiltrosBusca(consulta: Record<string, unknown>): FiltrosBusca {
  const tipo = parametro(consulta, 'tipo')?.trim().toUpperCase() || null;
  const categoria = parametro(consulta, 'categoria')?.trim().toUpperCase() || null;
  const valorMin = numero(parametro(consulta, 'valor_min'));
  const valorMax = numero(parametro(consulta, 'valor_max'));
  const dormitorios = numero(parametro(consulta, 'dormitorios'));
  const cidade = parametro(consulta, 'cidade') || null;
  const limiteBruto = Number(parametro(consulta, 'limit') || 5);
  const limit = Number.isFinite(limiteBruto) ? Math.max(0, Math.min(Math.trunc(limiteBruto), 20)) : 5;
  const finalidades = tipo === 'VENDA' ? ['VENDA', 'AMBOS'] : tipo === 'ALUGUEL' || tipo === 'LOCACAO' ? ['LOCACAO', 'AMBOS'] : null;
  return {
    corretorId: parametro(consulta, 'corretor_id') || null,
    finalidades,
    categoria,
    // `x > 0` da Edge: NaN, zero e negativo não filtram.
    valorMin: valorMin > 0 ? valorMin : null,
    valorMax: valorMax > 0 ? valorMax : null,
    dormitorios: dormitorios > 0 ? Math.trunc(dormitorios) : null,
    cidade,
    limit,
  };
}
