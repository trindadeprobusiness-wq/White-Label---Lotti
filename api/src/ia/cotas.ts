import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { codigoDe } from './ia.erros';

/**
 * Caminho privilegiado da IA (o que as Edge Functions faziam com o cliente service_role): cota do plano,
 * contador de uso e limite por minuto. Roda no PrismaService, fora de transação, com o papel da conexão
 * da API. O corretorId vem SEMPRE do get_corretor_id() resolvido antes no TenantDb com as claims.
 */
export interface ClienteSql {
  $queryRaw<T = unknown>(consulta: Prisma.Sql): Promise<T>;
  $executeRaw(consulta: Prisma.Sql): Promise<number>;
}

export const COTA_ASSISTENTE = 'ai_assistant_monthly';

export interface ResultadoCota {
  permitido: boolean;
  usado: number;
  limite: number | null;
  ilimitado: boolean;
  habilitado: boolean;
}

const NEGADO: ResultadoCota = { permitido: false, usado: 0, limite: 0, ilimitado: false, habilitado: false };
const log = new Logger('IaCota');

/** checarCota de _shared/cotas.ts: erro de banco devolve NEGADO (na dúvida, não se gasta inferência). */
export async function checarCota(prisma: ClienteSql, corretorId: string, recurso: string): Promise<ResultadoCota> {
  try {
    const linhas = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      select permitido, usado, limite, ilimitado, habilitado from public.checar_cota(${corretorId}::uuid, ${recurso}::text)`);
    const r = linhas[0];
    if (!r) return NEGADO;
    return {
      permitido: r.permitido === true,
      usado: Number(r.usado ?? 0),
      limite: r.limite === null || r.limite === undefined ? null : Number(r.limite),
      ilimitado: r.ilimitado === true,
      habilitado: r.habilitado === true,
    };
  } catch (e) {
    log.error(`checar_cota(${recurso}) falhou ${codigoDe(e)}`);
    return NEGADO;
  }
}

/** registrarUso: nunca lança — contabilidade não derruba o atendimento que já aconteceu. */
export async function registrarUso(prisma: ClienteSql, corretorId: string, recurso: string, quantidade = 1): Promise<void> {
  try {
    await prisma.$executeRaw(Prisma.sql`select public.incrementar_uso(${corretorId}::uuid, ${recurso}::text, ${quantidade}::int)`);
  } catch (e) {
    log.error(`incrementar_uso(${recurso}) falhou ${codigoDe(e)}`);
  }
}

/**
 * Limite por minuto em public.ai_rate_limits, numa instrução só. É a lógica de consumir_rate_limit_ia
 * (migration do gateway, que não existe no banco de produção): conta a tentativa e permite enquanto
 * message_count <= limite na janela de 1 minuto. 'erro' = o banco falhou; quem chama decide.
 */
export async function consumirLimiteIa(prisma: ClienteSql, corretorId: string, limite: number): Promise<'permitido' | 'negado' | 'erro'> {
  try {
    const linhas = await prisma.$queryRaw<Array<{ permitido: boolean }>>(Prisma.sql`
      insert into public.ai_rate_limits as r (corretor_id, message_count, window_start)
      values (${corretorId}::uuid, 1, now())
      on conflict (corretor_id) do update set
        message_count = case when coalesce(r.window_start, '-infinity'::timestamptz) <= now() - interval '1 minute'
          then 1 else coalesce(r.message_count, 0) + 1 end,
        window_start = case when coalesce(r.window_start, '-infinity'::timestamptz) <= now() - interval '1 minute'
          then now() else r.window_start end
      returning (message_count <= ${limite}::int) as permitido`);
    return linhas[0]?.permitido === true ? 'permitido' : 'negado';
  } catch (e) {
    log.warn(`limite de IA indisponível ${codigoDe(e)}`);
    return 'erro';
  }
}
