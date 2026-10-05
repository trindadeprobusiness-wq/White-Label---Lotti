import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../../prisma/tenant-db';
import { SalvarRepasseDto } from '../parceiros.dto';
import { traduzirErroBanco } from '../parceiros.erros';

export type PortalData = Record<string, unknown> & { teto_renovacoes: number | null };

/**
 * Portal do parceiro (T2, T3), no caminho do usuário.
 *
 * As três RPCs são SECURITY DEFINER e casam auth.uid() E lower(auth.jwt()->>'email') com
 * public.parceiros — por isso o TenantDb injeta as claims inteiras e nenhuma claim reduzida é montada
 * em lugar nenhum. Sem parceiro para o e-mail da sessão, elas levantam 42501 e o tradutor devolve
 * 403 parceiro_nao_vinculado.
 */
@Injectable()
export class PortalService {
  constructor(private readonly db: TenantDb) {}

  /**
   * Aceite + resumo + teto no MESMO run (contrato §6.4): hoje são três chamadas, a primeira
   * sequencial e as outras duas em paralelo. Juntas, deixa de existir o estado "aceite carimbado,
   * resumo falhou".
   */
  async painel(claims: SupabaseClaims): Promise<PortalData> {
    try {
      return await this.db.run(claims, async (tx) => {
        await tx.$queryRaw<Array<{ ok: boolean | null }>>(Prisma.sql`select public.parceiro_portal_registrar_aceite() as ok`);
        const resumo = await tx.$queryRaw<Array<{ resumo: Record<string, unknown> }>>(Prisma.sql`
          select public.parceiro_portal_resumo() as resumo`);
        const teto = await tx.$queryRaw<Array<{ teto: number | null }>>(Prisma.sql`
          select public.parceiro_portal_teto_renovacoes() as teto`);
        return { ...(resumo[0]?.resumo ?? {}), teto_renovacoes: teto[0]?.teto ?? null };
      });
    } catch (e) {
      traduzirErroBanco(e, { origem: 'portal' });
    }
  }

  async salvarRepasse(claims: SupabaseClaims, dto: SalvarRepasseDto): Promise<{ salvo: true }> {
    try {
      await this.db.run(claims, (tx) => tx.$queryRaw<Array<{ ok: boolean | null }>>(Prisma.sql`
        select public.parceiro_portal_salvar_repasse(${dto.documento}::text, ${dto.tipo_chave}::text, ${dto.chave}::text) as ok`));
      return { salvo: true };
    } catch (e) {
      traduzirErroBanco(e, { origem: 'portal' });
    }
  }
}
