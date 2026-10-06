import { randomUUID } from 'node:crypto';

// Porte de supabase/functions/_shared/ai/contracts.ts (normalizeLottiAIRequest): mesmas regras e textos.

export const MODULOS_IA = [
  'assistant', 'attendance', 'clients', 'funnel', 'properties', 'proposals', 'contracts',
  'legal', 'rentals', 'finance', 'media', 'agenda', 'dashboard',
] as const;
export type ModuloIa = (typeof MODULOS_IA)[number];

export const MODOS_SAIDA_IA = ['text', 'structured', 'action_proposal'] as const;
export type ModoSaidaIa = (typeof MODOS_SAIDA_IA)[number];

export interface RefEntidade {
  type: string;
  id: string;
}

export interface PedidoIa {
  organizationId: string;
  userId: string;
  module: ModuloIa;
  intent: string;
  message: string;
  entityRefs: RefEntidade[];
  locale: 'pt-BR';
  timezone: string;
  outputMode: ModoSaidaIa;
  requiresConfirmation: boolean;
  traceId: string;
}

export const MAX_ENTRADA_IA = 4_000;
export const MAX_REFS_ENTIDADE = 10;
export const MAX_RODADAS_FERRAMENTA = 4;

export class PedidoIaInvalido extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PedidoIaInvalido';
  }
}

const ehRegistro = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const textoOpcional = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function refsDeEntidade(valor: unknown): RefEntidade[] {
  if (valor == null) return [];
  if (!Array.isArray(valor)) throw new PedidoIaInvalido('entity_refs deve ser uma lista');
  if (valor.length > MAX_REFS_ENTIDADE) throw new PedidoIaInvalido(`Máximo de ${MAX_REFS_ENTIDADE} entidades por solicitação`);
  return valor.map((item) => {
    if (!ehRegistro(item)) throw new PedidoIaInvalido('Referência de entidade inválida');
    const type = textoOpcional(item.type)?.slice(0, 40);
    const id = textoOpcional(item.id)?.slice(0, 128);
    if (!type || !id || !/^[a-zA-Z0-9_.:-]+$/.test(type)) throw new PedidoIaInvalido('Referência de entidade inválida');
    return { type, id };
  });
}

function traceId(valor: unknown): string {
  const candidato = textoOpcional(valor);
  if (candidato && /^[a-zA-Z0-9_-]{8,80}$/.test(candidato)) return candidato;
  return randomUUID();
}

/** Identidade e organização vêm só da sessão validada no servidor; homônimos do cliente são ignorados. */
export function normalizarPedidoIa(valor: unknown, autoridade: { organizationId: string; userId: string }): PedidoIa {
  if (!ehRegistro(valor)) throw new PedidoIaInvalido('Corpo da solicitação inválido');

  const message = textoOpcional(valor.message);
  if (!message) throw new PedidoIaInvalido('Mensagem obrigatória');

  const modulo = textoOpcional(valor.module) ?? 'assistant';
  if (!MODULOS_IA.includes(modulo as ModuloIa)) throw new PedidoIaInvalido('Módulo de IA inválido');

  const intent = textoOpcional(valor.intent) ?? 'general.answer';
  if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(intent)) throw new PedidoIaInvalido('Intenção de IA inválida');

  const saida = textoOpcional(valor.output_mode) ?? 'text';
  if (!MODOS_SAIDA_IA.includes(saida as ModoSaidaIa)) throw new PedidoIaInvalido('Modo de saída inválido');

  const timezone = textoOpcional(valor.timezone) ?? 'America/Sao_Paulo';
  if (timezone.length > 64 || !/^[A-Za-z_+\/-]+$/.test(timezone)) throw new PedidoIaInvalido('Fuso horário inválido');

  return {
    organizationId: autoridade.organizationId,
    userId: autoridade.userId,
    module: modulo as ModuloIa,
    intent,
    message: message.slice(0, MAX_ENTRADA_IA),
    entityRefs: refsDeEntidade(valor.entity_refs),
    locale: 'pt-BR',
    timezone,
    outputMode: saida as ModoSaidaIa,
    requiresConfirmation: valor.requires_confirmation === true,
    traceId: traceId(valor.trace_id),
  };
}
