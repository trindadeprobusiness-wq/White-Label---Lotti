import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ClienteSql } from './cotas';
import { codigoDe } from './ia.erros';

// Porte de supabase/functions/_shared/ai/telemetry.ts. ai_runs/ai_tool_calls só aceitam escrita do
// service_role, então vai pelo PrismaService (fora de transação). Melhor esforço: nunca derruba a função.
// As tabelas vêm da migration do gateway (20260821002556), que não existe no banco de produção: aí tudo
// vira um aviso com o SQLSTATE e o run fica null, exatamente como na Edge Function.

const log = new Logger('IaTelemetria');

export interface InicioExecucao {
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

export async function iniciarExecucao(prisma: ClienteSql, e: InicioExecucao): Promise<string | null> {
  try {
    const linhas = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      insert into public.ai_runs (trace_id, corretor_id, user_id, module, intent, provider, model, prompt_version_id,
        output_mode, status, input_chars, confirmation_required, metadata)
      values (${e.traceId}::text, ${e.organizationId}::uuid, ${e.userId}::uuid, ${e.module}::text, ${e.intent}::text,
        'google', ${e.model}::text, ${e.promptVersion}::text, ${e.outputMode}::text, 'started', ${e.inputChars}::int,
        ${e.confirmationRequired}::boolean, ${JSON.stringify(e.metadata ?? {})}::jsonb)
      returning id::text as id`);
    return linhas[0]?.id ?? null;
  } catch (err) {
    log.warn(`telemetria de IA indisponível ${codigoDe(err)}`);
    return null;
  }
}

export interface FimExecucao {
  status: 'completed' | 'failed' | 'blocked';
  outputChars?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  latencyMs: number;
  errorCode?: string;
}

export async function finalizarExecucao(prisma: ClienteSql, runId: string | null, f: FimExecucao): Promise<void> {
  if (!runId) return;
  try {
    await prisma.$executeRaw(Prisma.sql`
      update public.ai_runs set status = ${f.status}::text, output_chars = ${f.outputChars ?? 0}::int,
        input_tokens = ${f.inputTokens ?? null}::int, output_tokens = ${f.outputTokens ?? null}::int,
        estimated_cost_usd = ${f.estimatedCostUsd ?? null}::numeric, latency_ms = ${f.latencyMs}::int,
        error_code = ${f.errorCode ?? null}::text, completed_at = now()
      where id = ${runId}::uuid`);
  } catch (err) {
    log.warn(`telemetria de IA (fim) falhou ${codigoDe(err)}`);
  }
}

export interface ChamadaFerramenta {
  toolName: string;
  toolKind: 'read' | 'proposal' | 'write';
  status: 'completed' | 'failed' | 'blocked';
  durationMs: number;
  entityRefs?: unknown[];
  errorCode?: string;
}

export async function registrarFerramenta(prisma: ClienteSql, runId: string | null, c: ChamadaFerramenta): Promise<void> {
  if (!runId) return;
  try {
    await prisma.$executeRaw(Prisma.sql`
      insert into public.ai_tool_calls (run_id, tool_name, tool_kind, status, entity_refs, duration_ms, error_code, completed_at)
      values (${runId}::uuid, ${c.toolName}::text, ${c.toolKind}::text, ${c.status}::text,
        ${JSON.stringify(c.entityRefs ?? [])}::jsonb, ${c.durationMs}::int, ${c.errorCode ?? null}::text, now())`);
  } catch (err) {
    log.warn(`telemetria de ferramenta falhou ${codigoDe(err)}`);
  }
}
