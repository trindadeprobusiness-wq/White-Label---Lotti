import { Prisma } from '@prisma/client';

/**
 * Caminho privilegiado da cota de IA: reserve/finish_contract_quota só têm EXECUTE para service_role,
 * e o TenantDb roda como `authenticated` (D16). ÚNICO uso de PrismaService no módulo: fora de transação,
 * com o papel da conexão da API (dono das funções). O corretorId vem SEMPRE do get_corretor_id() resolvido
 * antes no TenantDb com as claims, nunca do corpo.
 */
export interface ClienteCota {
  $queryRaw<T = unknown>(consulta: Prisma.Sql): Promise<T>;
  $executeRaw(consulta: Prisma.Sql): Promise<number>;
}

export interface Reserva {
  allowed: boolean;
  reservation_id: string | null;
  used: number;
  quota: number | null;
}

export async function reservarCota(prisma: ClienteCota, corretorId: string): Promise<Reserva> {
  const linhas = await prisma.$queryRaw<Reserva[]>(Prisma.sql`
    select allowed, reservation_id::text as reservation_id, used, quota from public.reserve_contract_quota(${corretorId}::uuid)`);
  return linhas[0];
}

/** finish é void: $executeRaw (o $queryRaw falharia ao desserializar void). */
export function finalizarCota(prisma: ClienteCota, id: string, ok: boolean): Promise<number> {
  return prisma.$executeRaw(Prisma.sql`select public.finish_contract_quota(${id}::uuid, ${ok}::boolean)`);
}
