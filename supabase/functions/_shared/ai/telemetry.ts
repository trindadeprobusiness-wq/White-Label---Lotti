// A tipagem do client varia conforme os tipos gerados de cada projeto. Esta
// interface mínima mantém o módulo compartilhado sem importar service_role.
// deno-lint-ignore no-explicit-any
type SupabaseAdmin = { from(table: string): any };

export interface AIRunStart {
  traceId: string;
  organizationId: string;
  userId: string;
  module: string;
  intent: string;
  model: string;
  promptVersion: string;
  outputMode: string;
  inputChars: number;
  confirmationRequired: boolean;
  metadata?: Record<string, unknown>;
}

function codeOf(error: unknown): string {
  if (typeof error === "object" && error && "code" in error) return String(error.code);
  return "unknown";
}

/** Telemetria é best-effort durante o rollout: nunca derruba a função de negócio. */
export async function startAIRun(admin: SupabaseAdmin, input: AIRunStart): Promise<string | null> {
  const { data, error } = await admin.from("ai_runs").insert({
    trace_id: input.traceId,
    corretor_id: input.organizationId,
    user_id: input.userId,
    module: input.module,
    intent: input.intent,
    provider: "google",
    model: input.model,
    prompt_version_id: input.promptVersion,
    output_mode: input.outputMode,
    status: "started",
    input_chars: input.inputChars,
    confirmation_required: input.confirmationRequired,
    metadata: input.metadata ?? {},
  }).select("id").maybeSingle();

  if (error || !data?.id) {
    console.warn("AI telemetry unavailable:", codeOf(error));
    return null;
  }
  return data.id as string;
}

export async function finishAIRun(
  admin: SupabaseAdmin,
  runId: string | null,
  input: {
    status: "completed" | "failed" | "blocked";
    outputChars?: number;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
    latencyMs: number;
    errorCode?: string;
  },
): Promise<void> {
  if (!runId) return;
  const { error } = await admin.from("ai_runs").update({
    status: input.status,
    output_chars: input.outputChars ?? 0,
    input_tokens: input.inputTokens ?? null,
    output_tokens: input.outputTokens ?? null,
    estimated_cost_usd: input.estimatedCostUsd ?? null,
    latency_ms: input.latencyMs,
    error_code: input.errorCode ?? null,
    completed_at: new Date().toISOString(),
  }).eq("id", runId);
  if (error) console.warn("AI telemetry completion failed:", codeOf(error));
}

export async function recordAIToolCall(
  admin: SupabaseAdmin,
  runId: string | null,
  input: {
    toolName: string;
    toolKind: "read" | "proposal" | "write";
    status: "completed" | "failed" | "blocked";
    durationMs: number;
    entityRefs?: unknown[];
    errorCode?: string;
  },
): Promise<void> {
  if (!runId) return;
  const { error } = await admin.from("ai_tool_calls").insert({
    run_id: runId,
    tool_name: input.toolName,
    tool_kind: input.toolKind,
    status: input.status,
    entity_refs: input.entityRefs ?? [],
    duration_ms: input.durationMs,
    error_code: input.errorCode ?? null,
    completed_at: new Date().toISOString(),
  });
  if (error) console.warn("AI tool telemetry failed:", codeOf(error));
}
