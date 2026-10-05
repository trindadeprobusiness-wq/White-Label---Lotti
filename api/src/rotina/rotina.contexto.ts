import { Prisma } from '@prisma/client';
import { ERROS } from './rotina.erros';

export type Linha = Record<string, unknown>;
export type Tx = Prisma.TransactionClient;

export interface ContextoRotina {
  membership: Linha & { organization_id: string; user_id: string; role: string };
  organization: Linha & { id: string; timezone: string };
}

/** Membership ativa do usuário (substitui requireRoutineUser). Roda dentro do TenantDb. */
export async function buscarContexto(tx: Tx, sub: string): Promise<ContextoRotina | null> {
  const linhas = await tx.$queryRaw<ContextoRotina[]>(Prisma.sql`
    select to_jsonb(m) as membership, to_jsonb(o) as organization
    from public.routine_memberships m
    join public.routine_organizations o on o.id = m.organization_id
    where m.user_id = ${sub}::uuid and m.status = 'active'
    limit 1`);
  return linhas[0] ?? null;
}

export async function exigirContexto(tx: Tx, sub: string): Promise<ContextoRotina> {
  const ctx = await buscarContexto(tx, sub);
  if (!ctx) throw ERROS.semRotina();
  return ctx;
}
