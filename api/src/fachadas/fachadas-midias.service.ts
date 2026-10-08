import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { rodar } from './fachadas.service';

export interface Midias {
  foto_principal_url: string | null;
  fotos: number;
  videos: number;
}

@Injectable()
export class FachadasMidiasService {
  constructor(private readonly db: TenantDb) {}

  /**
   * F12: uma chamada no lugar das três de hoje (FachadaCard). A ordenação unifica as duas regras de
   * "foto principal" que FachadaCard e FachadaPreview usavam (contrato §6.7).
   *
   * public.videos não está no baseline do Prisma e hoje não existe em nenhum dos dois bancos (relatório 30
   * do Codex): sem a tabela, a contagem é zero em vez de 500 (42P01). O teste de SQL real cobre os dois casos.
   */
  async obter(claims: SupabaseClaims, imovelId: string): Promise<Midias> {
    const linhas = await rodar(this.db, claims, async (tx) => {
      const [tabela] = await tx.$queryRaw<Array<{ existe: boolean }>>(
        Prisma.sql`select to_regclass('public.videos') is not null as existe`);
      const videos = tabela?.existe
        ? Prisma.sql`(select count(*)::int from public.videos where imovel_id = ${imovelId}::uuid)`
        : Prisma.sql`0`;
      return tx.$queryRaw<Midias[]>(Prisma.sql`
      select (select arquivo_url from public.imovel_fotos
                where imovel_id = ${imovelId}::uuid
                order by principal desc, ordem asc nulls last, id limit 1) as foto_principal_url,
             (select count(*)::int from public.imovel_fotos where imovel_id = ${imovelId}::uuid) as fotos,
             ${videos} as videos`);
    });
    const r = linhas[0];
    return { foto_principal_url: r.foto_principal_url ?? null, fotos: Number(r.fotos), videos: Number(r.videos) };
  }
}
