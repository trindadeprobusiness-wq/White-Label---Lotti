import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { Answers } from './diagnostico';

/**
 * Caminho do dono do diagnóstico comercial e do limite público.
 *
 * Conferido em 0_init: commercial_diagnostics dá a authenticated só SELECT, UPDATE;
 * commercial_diagnostic_events só SELECT; consume_public_request_limit tem EXECUTE apenas para
 * service_role. Então a gravação pública roda fora do TenantDb, como as quatro chamadas independentes
 * da Edge Function de hoje: cada comando é seu próprio $queryRaw/$executeRaw, fora de transação.
 */
export interface LinhaDiagnostico {
  sessionId: string;
  name: string;
  phone: string;
  email: string | null;
  city: string | null;
  company: string | null;
  answers: Answers;
  attribution: Record<string, string>;
  scores: Record<string, unknown>;
  dominantProblem: string;
  secondaryProblems: string[];
  urgencyLabel: string;
  profileLabel: string;
  recommendedNextStep: string;
}

@Injectable()
export class DiagnosticoRepo {
  constructor(private readonly prisma: PrismaService) {}

  async consumirLimite(scope: string, chave: string, limite: number, segundos: number): Promise<boolean> {
    const r = await this.prisma.$queryRaw<Array<{ ok: boolean | null }>>(Prisma.sql`
      select public.consume_public_request_limit(${scope}::text, ${chave}::text, ${limite}::int, ${segundos}::int) as ok`);
    return r[0]?.ok === true;
  }

  async consumirLimiteDeLead(hash: string): Promise<boolean> {
    const r = await this.prisma.$queryRaw<Array<{ ok: boolean | null }>>(Prisma.sql`
      select public.consume_public_lead_limit(${hash}::text) as ok`);
    return r[0]?.ok === true;
  }

  registrarEvento(sessionId: string, event: string, step: string | null): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      insert into public.commercial_diagnostic_events (session_id, event, step)
      values (${sessionId}::uuid, ${event}::text, ${step}::text)`);
  }

  /** now() do banco em vez do relógio do processo (contrato §6.2). Melhor esforço. */
  marcarCtaClicado(sessionId: string): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      update public.commercial_diagnostics set cta_clicked_at = now() where session_id = ${sessionId}::uuid`);
  }

  gravar(d: LinhaDiagnostico): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      insert into public.commercial_diagnostics
        (session_id, name, phone, email, city, company, consent_at, answers, attribution, scores,
         dominant_problem, secondary_problems, urgency_label, profile_label, recommended_next_step)
      values (${d.sessionId}::uuid, ${d.name}::text, ${d.phone}::text, ${d.email}::text, ${d.city}::text,
              ${d.company}::text, now(), ${d.answers}::jsonb, ${d.attribution}::jsonb, ${d.scores}::jsonb,
              ${d.dominantProblem}::text, coalesce(${d.secondaryProblems}::text[], '{}'::text[]), ${d.urgencyLabel}::text,
              ${d.profileLabel}::text, ${d.recommendedNextStep}::text)`);
  }
}
