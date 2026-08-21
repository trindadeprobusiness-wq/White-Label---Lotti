export const LOTTI_AI_MODULES = [
  "assistant",
  "attendance",
  "clients",
  "funnel",
  "properties",
  "proposals",
  "contracts",
  "legal",
  "rentals",
  "finance",
  "media",
  "agenda",
  "dashboard",
] as const;

export type LottiAIModule = (typeof LOTTI_AI_MODULES)[number];

export const LOTTI_AI_OUTPUT_MODES = ["text", "structured", "action_proposal"] as const;
export type LottiAIOutputMode = (typeof LOTTI_AI_OUTPUT_MODES)[number];

export interface LottiAIEntityRef {
  type: string;
  id: string;
}

export interface LottiAIRequest {
  organizationId: string;
  userId: string;
  module: LottiAIModule;
  intent: string;
  message: string;
  entityRefs: LottiAIEntityRef[];
  locale: "pt-BR";
  timezone: string;
  outputMode: LottiAIOutputMode;
  requiresConfirmation: boolean;
  traceId: string;
}

export interface AuthoritativeAIContext {
  organizationId: string;
  userId: string;
}

export const MAX_AI_INPUT_LENGTH = 4_000;
export const MAX_EXTERNAL_CONTEXT_LENGTH = 20_000;
export const MAX_AI_ENTITY_REFS = 10;
export const MAX_AI_TOOL_ROUNDS = 4;

export class LottiAIRequestError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "LottiAIRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeEntityRefs(value: unknown): LottiAIEntityRef[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new LottiAIRequestError("entity_refs deve ser uma lista");
  if (value.length > MAX_AI_ENTITY_REFS) {
    throw new LottiAIRequestError(`Máximo de ${MAX_AI_ENTITY_REFS} entidades por solicitação`);
  }

  return value.map((item) => {
    if (!isRecord(item)) throw new LottiAIRequestError("Referência de entidade inválida");
    const type = optionalString(item.type)?.slice(0, 40);
    const id = optionalString(item.id)?.slice(0, 128);
    if (!type || !id || !/^[a-zA-Z0-9_.:-]+$/.test(type)) {
      throw new LottiAIRequestError("Referência de entidade inválida");
    }
    return { type, id };
  });
}

function normalizeTraceId(value: unknown): string {
  const candidate = optionalString(value);
  if (candidate && /^[a-zA-Z0-9_-]{8,80}$/.test(candidate)) return candidate;
  return crypto.randomUUID();
}

/**
 * Constrói o contrato do gateway. Identidade e organização vêm exclusivamente
 * da sessão validada no servidor; valores homônimos enviados pelo cliente são ignorados.
 */
export function normalizeLottiAIRequest(
  value: unknown,
  authoritative: AuthoritativeAIContext,
): LottiAIRequest {
  if (!isRecord(value)) throw new LottiAIRequestError("Corpo da solicitação inválido");

  const message = optionalString(value.message);
  if (!message) throw new LottiAIRequestError("Mensagem obrigatória");

  const moduleCandidate = optionalString(value.module) ?? "assistant";
  if (!LOTTI_AI_MODULES.includes(moduleCandidate as LottiAIModule)) {
    throw new LottiAIRequestError("Módulo de IA inválido");
  }

  const intent = optionalString(value.intent) ?? "general.answer";
  if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(intent)) {
    throw new LottiAIRequestError("Intenção de IA inválida");
  }

  const outputCandidate = optionalString(value.output_mode) ?? "text";
  if (!LOTTI_AI_OUTPUT_MODES.includes(outputCandidate as LottiAIOutputMode)) {
    throw new LottiAIRequestError("Modo de saída inválido");
  }

  const timezone = optionalString(value.timezone) ?? "America/Sao_Paulo";
  if (timezone.length > 64 || !/^[A-Za-z_+\/-]+$/.test(timezone)) {
    throw new LottiAIRequestError("Fuso horário inválido");
  }

  return {
    organizationId: authoritative.organizationId,
    userId: authoritative.userId,
    module: moduleCandidate as LottiAIModule,
    intent,
    message: message.slice(0, MAX_AI_INPUT_LENGTH),
    entityRefs: normalizeEntityRefs(value.entity_refs),
    locale: "pt-BR",
    timezone,
    outputMode: outputCandidate as LottiAIOutputMode,
    requiresConfirmation: value.requires_confirmation === true,
    traceId: normalizeTraceId(value.trace_id),
  };
}

function escapePromptData(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Conteúdo importado vira dado delimitado, nunca uma nova camada de instrução. */
export function externalDataBlock(label: string, value: string, max = MAX_EXTERNAL_CONTEXT_LENGTH): string {
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "data";
  const truncated = value.slice(0, max);
  return [
    `<external_data kind="${safeLabel}">`,
    escapePromptData(truncated),
    "</external_data>",
  ].join("\n");
}
