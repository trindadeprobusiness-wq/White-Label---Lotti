import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface SupabaseClaims {
  sub: string;
  role: string;
  email?: string;
  [key: string]: unknown;
}

/**
 * Roda a consulta como o próprio usuário: mesmas claims que o PostgREST aplica,
 * papel `authenticated`, tudo dentro de uma transação. Assim as policies RLS e
 * get_corretor_id() continuam valendo enquanto a API substitui o Supabase.
 */
@Injectable()
export class TenantDb {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(claims: SupabaseClaims, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (!claims?.sub || claims.role !== 'authenticated') throw new Error('claims_invalidas');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
      await tx.$executeRawUnsafe('set local role authenticated');
      return work(tx);
    });
  }
}
