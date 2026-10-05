import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Catálogo público (plans, plan_entitlements, pricing_campaigns): o TenantDb recusa claims que não
 * sejam `authenticated`, então estas três rotas rodam com o papel `anon` e RLS ligado — a mesma
 * visibilidade que o PostgREST anônimo já dá hoje.
 */
@Injectable()
export class CatalogoRepo {
  constructor(private readonly prisma: PrismaService) {}

  async comoAnon<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      // Constante, sem interpolação: a única chamada Unsafe do módulo, igual à do TenantDb.
      await tx.$executeRawUnsafe('set local role anon');
      return work(tx);
    });
  }
}
