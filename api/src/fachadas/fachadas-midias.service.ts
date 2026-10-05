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
   * ATENÇÃO: public.videos existe em produção e NÃO está no baseline do Prisma (contrato §1.6 e §7.2.3).
   * Em produção a consulta funciona; o teste de SQL real cria uma cópia mínima da tabela antes de exercitar.
   */
  async obter(claims: SupabaseClaims, imovelId: string): Promise<Midias> {
    const linhas = await rodar(this.db, claims, (tx) => tx.$queryRaw<Midias[]>(Prisma.sql`
      select (select arquivo_url from public.imovel_fotos
                where imovel_id = ${imovelId}::uuid
                order by principal desc, ordem asc nulls last, id limit 1) as foto_principal_url,
             (select count(*)::int from public.imovel_fotos where imovel_id = ${imovelId}::uuid) as fotos,
             (select count(*)::int from public.videos where imovel_id = ${imovelId}::uuid) as videos`));
    const r = linhas[0];
    return { foto_principal_url: r.foto_principal_url ?? null, fotos: Number(r.fotos), videos: Number(r.videos) };
  }
}
