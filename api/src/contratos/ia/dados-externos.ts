// Copiado de supabase/functions/_shared/ai/contracts.ts.
export const MAX_EXTERNAL_CONTEXT_LENGTH = 20_000;

export function escapePromptData(value: string): string {
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
