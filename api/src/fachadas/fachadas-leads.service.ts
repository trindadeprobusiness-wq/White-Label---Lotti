import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { LIMITE_LISTA, ListarLeadsDto } from './fachadas.dto';
import { ERROS } from './fachadas.erros';
import { Linha, Linhas, rodar } from './fachadas.service';

@Injectable()
export class FachadasLeadsService {
  constructor(private readonly db: TenantDb) {}

  /**
   * F5: fachada_id ausente anula o filtro (é o `if (fachadaId) query.eq(...)` de hoje, em SQL).
   * `convertido=false` é a lista de leads pendentes do CRM (o `.eq('convertido', false)` de lá).
   */
  async listar(claims: SupabaseClaims, q: ListarLeadsDto): Promise<Linha[]> {
    const fachadaId = q.fachada_id ?? null;
    const convertido = q.convertido ?? null;
    const linhas = await rodar(this.db, claims, (tx) => tx.$queryRaw<Linhas>(Prisma.sql`
      select to_jsonb(l) as linha
        from public.fachada_leads l
       where (${fachadaId}::uuid is null or l.fachada_id = ${fachadaId}::uuid)
         and (${convertido}::boolean is null or l.convertido = ${convertido}::boolean)
       order by l.created_at desc, l.id
       limit ${LIMITE_LISTA}::int`));
    return linhas.map((l) => l.linha);
  }

  /** F6: o gatilho trg_dec_leads decrementa fachadas.total_leads, como hoje. */
  async remover(claims: SupabaseClaims, id: string): Promise<void> {
    await rodar(this.db, claims, async (tx) => {
      const linhas = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        delete from public.fachada_leads where id = ${id}::uuid returning id::text as id`);
      if (linhas.length === 0) throw ERROS.leadNaoEncontrado();
    });
  }
}
