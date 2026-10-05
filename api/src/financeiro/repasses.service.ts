import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { LIMITE_LISTA } from './financeiro.dto';
import { erroApi, Linha, traduzirErroBanco } from './financeiro.erros';

type Tx = Prisma.TransactionClient;

/** Repasses ao proprietário (contrato §1.3.D), no TenantDb. */
@Injectable()
export class RepassesService {
  constructor(private readonly db: TenantDb) {}

  async listar(claims: SupabaseClaims): Promise<Linha[]> {
    const linhas = await this.rodar(claims, (tx) => tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
      select to_jsonb(r) || jsonb_build_object('contratos',
               (select jsonb_build_object('imoveis', (select jsonb_build_object('titulo', i.titulo) from public.imoveis i where i.id = c.imovel_id))
                  from public.contratos c where c.id = r.contrato_id)) as linha
        from public.repasses_proprietario r
       order by r.data_prevista asc, r.id
       limit ${LIMITE_LISTA}::int`));
    return linhas.map((l) => l.linha);
  }

  /** D8: confirmar também grava data_transferencia (sem sobrescrever a que já existe). */
  confirmar(claims: SupabaseClaims, id: string): Promise<Linha> {
    return this.rodar(claims, async (tx) => {
      const linhas = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        update public.repasses_proprietario r
           set status = 'CONFIRMADO', data_transferencia = coalesce(r.data_transferencia, current_date)
         where r.id = ${id}::uuid
        returning to_jsonb(r) as linha`);
      if (linhas.length === 0) throw erroApi(404, 'repasse_nao_encontrado', 'Repasse não encontrado.');
      return linhas[0].linha;
    });
  }

  private async rodar<T>(claims: SupabaseClaims, work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.run(claims, work);
    } catch (e) {
      traduzirErroBanco(e);
    }
  }
}
