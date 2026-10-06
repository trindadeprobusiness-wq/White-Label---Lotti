import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { erroApi, traduzirErroBanco } from './imoveis.erros';
import { CriarFotoDto, LIMITE_FOTOS, LIMITE_LINHAS_RESUMO, OrdemFotosDto, ResumoFotosDto } from './imoveis-fotos.dto';

/** Linha de to_jsonb(public.imovel_fotos): as mesmas chaves e tipos do PostgREST. */
export type LinhaFoto = Record<string, unknown>;

/** Uma foto na miniatura da lista de imóveis (o select de hoje: imovel_id, arquivo_url, principal). */
export interface FotoResumo {
  imovel_id: string;
  arquivo_url: string;
  principal: boolean | null;
}

type Linhas<T> = Array<{ linha: T }>;

const SEM_PERMISSAO = 'Você não tem permissão para alterar as fotos deste imóvel.';
const imovelNaoEncontrado = () => erroApi(404, 'imovel_nao_encontrado', 'Imóvel não encontrado.');
const fotoNaoEncontrada = (message = 'Foto não encontrada.') => erroApi(404, 'foto_nao_encontrada', message);

/**
 * Linhas de public.imovel_fotos pela API, no lugar do supabase.from('imovel_fotos') do useImovelFotos e da
 * lista de imóveis. Tudo no TenantDb: a policy "Corretor gerencia fotos de seus imoveis" segue valendo.
 * O arquivo em si já vai e volta pelo módulo de arquivos (Garage); aqui só a linha.
 */
@Injectable()
export class ImoveisFotosService {
  constructor(private readonly db: TenantDb) {}

  /** Mesma ordem do front: ordem, depois created_at (as fotos antigas ficaram todas com ordem 0), depois id. */
  async listar(claims: SupabaseClaims, imovelId: string): Promise<LinhaFoto[]> {
    try {
      const linhas = await this.db.run(claims, (tx) => tx.$queryRaw<Linhas<LinhaFoto>>(Prisma.sql`
        select to_jsonb(f) as linha from public.imovel_fotos f
        where f.imovel_id = ${imovelId}::uuid
        order by f.ordem asc nulls last, f.created_at asc nulls last, f.id
        limit ${LIMITE_FOTOS}::int`));
      return linhas.map((l) => l.linha);
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  /**
   * Grava a linha de uma foto já enviada. Numa transação só, o que o front fazia em três chamadas:
   * próxima ordem (0 na primeira foto), desmarcar as outras se esta for a principal, e inserir.
   * A primeira foto do imóvel é principal mesmo sem pedir (regra de hoje).
   */
  async criar(claims: SupabaseClaims, imovelId: string, dto: CriarFotoDto): Promise<LinhaFoto> {
    // A key nasce como `<imovel_id>/<epoch>_<nome>`: uma linha deste imóvel não aponta para a pasta de outro.
    if (!dto.arquivo_path.startsWith(`${imovelId}/`)) {
      throw erroApi(400, 'caminho_invalido', 'O arquivo da foto não é deste imóvel.');
    }
    try {
      return await this.db.run(claims, async (tx) => {
        const imovel = await tx.$queryRaw<Array<{ ok: number }>>(Prisma.sql`
          select 1 as ok from public.imoveis where id = ${imovelId}::uuid`);
        if (imovel.length === 0) throw imovelNaoEncontrado();
        const proxima = await tx.$queryRaw<Array<{ ordem: number }>>(Prisma.sql`
          select (case when count(*) = 0 then 0 else coalesce(max(ordem), 0) + 1 end)::int as ordem
          from public.imovel_fotos where imovel_id = ${imovelId}::uuid`);
        const ordem = proxima[0]?.ordem ?? 0;
        const principal = dto.principal === true || ordem === 0;
        if (dto.principal === true) {
          await tx.$executeRaw(Prisma.sql`
            update public.imovel_fotos set principal = false where imovel_id = ${imovelId}::uuid`);
        }
        const linhas = await tx.$queryRaw<Linhas<LinhaFoto>>(Prisma.sql`
          insert into public.imovel_fotos as f (imovel_id, arquivo_url, arquivo_path, principal, ordem)
          values (${imovelId}::uuid, ${dto.arquivo_url}::text, ${dto.arquivo_path}::text, ${principal}::boolean, ${ordem}::int)
          returning to_jsonb(f) as linha`);
        return linhas[0].linha;
      });
    } catch (e) {
      traduzirErroBanco(e, { semPermissao: SEM_PERMISSAO });
    }
  }

  async remover(claims: SupabaseClaims, fotoId: string): Promise<void> {
    try {
      await this.db.run(claims, async (tx) => {
        const linhas = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          delete from public.imovel_fotos where id = ${fotoId}::uuid returning id`);
        if (linhas.length === 0) throw fotoNaoEncontrada('Nada foi apagado: a foto não existe ou você não tem permissão.');
      });
    } catch (e) {
      traduzirErroBanco(e, { semPermissao: SEM_PERMISSAO });
    }
  }

  /** `ordem` = posição na lista (0, 1, 2...), numa instrução só. Id de outro imóvel é ignorado. */
  async reordenar(claims: SupabaseClaims, imovelId: string, dto: OrdemFotosDto): Promise<{ atualizadas: number }> {
    try {
      const linhas = await this.db.run(claims, (tx) => tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        update public.imovel_fotos f set ordem = (o.n - 1)::int
        from unnest(${dto.ids}::uuid[]) with ordinality as o(id, n)
        where f.id = o.id and f.imovel_id = ${imovelId}::uuid
        returning f.id`));
      return { atualizadas: linhas.length };
    } catch (e) {
      traduzirErroBanco(e, { semPermissao: SEM_PERMISSAO });
    }
  }

  /** Principal única: marca esta e desmarca as outras do mesmo imóvel numa instrução só. */
  async definirPrincipal(claims: SupabaseClaims, imovelId: string, fotoId: string): Promise<{ imovel_id: string; foto_id: string }> {
    try {
      await this.db.run(claims, async (tx) => {
        const foto = await tx.$queryRaw<Array<{ ok: number }>>(Prisma.sql`
          select 1 as ok from public.imovel_fotos where id = ${fotoId}::uuid and imovel_id = ${imovelId}::uuid`);
        if (foto.length === 0) throw fotoNaoEncontrada();
        await tx.$executeRaw(Prisma.sql`
          update public.imovel_fotos set principal = (id = ${fotoId}::uuid) where imovel_id = ${imovelId}::uuid`);
      });
      return { imovel_id: imovelId, foto_id: fotoId };
    } catch (e) {
      traduzirErroBanco(e, { semPermissao: SEM_PERMISSAO });
    }
  }

  /** Fotos dos imóveis pedidos para as miniaturas da lista, na ordem de criação (o select de hoje). */
  async resumo(claims: SupabaseClaims, dto: ResumoFotosDto): Promise<FotoResumo[]> {
    try {
      const linhas = await this.db.run(claims, (tx) => tx.$queryRaw<Linhas<FotoResumo>>(Prisma.sql`
        select jsonb_build_object('imovel_id', f.imovel_id, 'arquivo_url', f.arquivo_url, 'principal', f.principal) as linha
        from public.imovel_fotos f
        where f.imovel_id = any(${dto.imovel_ids}::uuid[])
        order by f.created_at asc nulls last, f.id
        limit ${LIMITE_LINHAS_RESUMO}::int`));
      return linhas.map((l) => l.linha);
    } catch (e) {
      traduzirErroBanco(e);
    }
  }
}
