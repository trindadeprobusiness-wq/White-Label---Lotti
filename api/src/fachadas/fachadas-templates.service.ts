import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { CriarTemplateDto, LIMITE_LISTA, ListarTemplatesDto, PorImagemDto } from './fachadas.dto';
import { ERROS } from './fachadas.erros';
import { Linha, Linhas, rodar } from './fachadas.service';

export const ESCOPO_PADRAO = 'todos';

@Injectable()
export class FachadasTemplatesService {
  constructor(private readonly db: TenantDb) {}

  /** F8: escopo=meus é o .eq('corretor_id', ...) de hoje; escopo=todos cai no RLS (os do corretor + os padrão). */
  async listar(claims: SupabaseClaims, q: ListarTemplatesDto): Promise<Linha[]> {
    const escopo = q.escopo ?? ESCOPO_PADRAO;
    const linhas = await rodar(this.db, claims, (tx) => tx.$queryRaw<Linhas>(Prisma.sql`
      select to_jsonb(t) as linha
        from public.fachada_templates t
       where (${escopo}::text = 'todos' or t.corretor_id = public.get_corretor_id())
       order by t.created_at desc, t.id
       limit ${LIMITE_LISTA}::int`));
    return linhas.map((l) => l.linha);
  }

  /** F9: o corretor sai de get_corretor_id() no servidor; config é jsonb livre (o front monta a forma). */
  criar(claims: SupabaseClaims, dto: CriarTemplateDto): Promise<Linha> {
    const config = JSON.stringify(dto.config);
    const padrao = dto.padrao ?? false;
    return rodar(this.db, claims, async (tx) => {
      const linhas = await tx.$queryRaw<Linhas>(Prisma.sql`
        insert into public.fachada_templates as x (corretor_id, nome, categoria, config, padrao)
        select public.get_corretor_id(), ${dto.nome}::text, ${dto.categoria}::text, ${config}::jsonb, ${padrao}::boolean
        returning to_jsonb(x) as linha`);
      return linhas[0].linha;
    });
  }

  /** F10: template padrão (corretor_id is null) é visível mas não apagável — o RLS não casa e dá o mesmo 404. */
  async remover(claims: SupabaseClaims, id: string): Promise<void> {
    await rodar(this.db, claims, async (tx) => {
      const linhas = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        delete from public.fachada_templates where id = ${id}::uuid returning id::text as id`);
      if (linhas.length === 0) throw ERROS.templateNaoEncontrado();
    });
  }

  /** F11: sem linha → 200 com corpo null, não 404 (o maybeSingle() de hoje devolve data: null). */
  async porImagem(claims: SupabaseClaims, q: PorImagemDto): Promise<Linha | null> {
    const linhas = await rodar(this.db, claims, (tx) => tx.$queryRaw<Linhas>(Prisma.sql`
      select to_jsonb(t) as linha
        from public.fachada_templates t
       where t.config->>'imagem_url' = ${q.imagem_url}::text
       order by t.created_at desc, t.id
       limit 1`));
    return linhas[0]?.linha ?? null;
  }
}
