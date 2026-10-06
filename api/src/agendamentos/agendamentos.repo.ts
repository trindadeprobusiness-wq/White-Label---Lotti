import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Agendamento, FUSO_AGENDAMENTOS } from './agendamentos.config';

export type ResultadoAgendamento = { executou: true; resultado: number } | { executou: false; motivo: 'em_andamento' };

/**
 * Executa a instrução de um agendamento como dono do banco (o pg_cron rodava como postgres; as
 * funções são SECURITY DEFINER com EXECUTE só para service_role), numa transação com:
 *  - TimeZone = 'UTC' local (now()/CURRENT_DATE iguais aos do pg_cron do Supabase);
 *  - pg_try_advisory_xact_lock pelo nome: duas execuções do mesmo agendamento nunca se sobrepõem,
 *    nem entre réplicas nem com um processo antigo ainda vivo durante o deploy. Quem não pega a trava
 *    não roda (a outra já está fazendo o trabalho); a trava solta sozinha no fim da transação.
 */
@Injectable()
export class AgendamentosRepo {
  constructor(private readonly prisma: PrismaService) {}

  executar(a: Agendamento): Promise<ResultadoAgendamento> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`select set_config('TimeZone', ${FUSO_AGENDAMENTOS}::text, true)`);
      const trava = await tx.$queryRaw<Array<{ ok: boolean }>>(Prisma.sql`
        select pg_try_advisory_xact_lock(hashtextextended(${`agendamento:${a.nome}`}::text, 0)) as ok`);
      if (trava[0]?.ok !== true) return { executou: false, motivo: 'em_andamento' } as const;
      if (a.modo === 'valor') {
        const r = await tx.$queryRaw<Array<{ n: number | null }>>(a.sql);
        return { executou: true, resultado: Number(r[0]?.n ?? 0) } as const;
      }
      return { executou: true, resultado: await tx.$executeRaw(a.sql) } as const;
    }, { maxWait: 10_000, timeout: 120_000 });
  }
}
