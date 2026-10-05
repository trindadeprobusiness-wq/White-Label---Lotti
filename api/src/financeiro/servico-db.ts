import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Equivalente ao cliente service_role das Edge Functions: transação com o papel service_role
 * (BYPASSRLS) e claims só com role, sem sub. auth.uid() fica NULL, como no Supabase, e os gatilhos
 * gravam ator 'system'. Use só nos casos da tabela do contrato §0.2.
 */
@Injectable()
export class ServicoDb {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('request.jwt.claims', ${JSON.stringify({ role: 'service_role' })}, true)`;
      await tx.$executeRawUnsafe('set local role service_role');
      return work(tx);
    });
  }
}
