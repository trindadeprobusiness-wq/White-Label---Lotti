import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { lerConfigAssinatura, LIMITE_LISTA, Linha, RespostaCota, UsoAssinatura } from './assinatura.dto';
import { erroApi, traduzirErroAssinatura } from './assinatura.erros';

export type { Linha } from './assinatura.dto';
type Tx = Prisma.TransactionClient;
type Linhas = Array<{ linha: Linha }>;

interface LinhaUso {
  period_start: string;
  period_end: string;
  contadores: Linha[];
  max_imoveis: number;
  max_contratos_locacao: number;
  max_fachadas: number;
}

const semCorretor = () => erroApi(403, 'corretor_nao_identificado', 'Não foi possível identificar a sua conta. Entre novamente.');

/**
 * Leitura de assinatura, consumo e cota. Nenhuma rota de escrita: subscriptions, usage_counters e
 * subscription_addons só mudam por webhook ou admin, e a trava real continua no gatilho do banco.
 */
@Injectable()
export class AssinaturaService {
  constructor(private readonly db: TenantDb) {}

  /** Erro do banco é traduzido fora do run: dentro dele a transação já está abortada. */
  private async rodar<T>(claims: SupabaseClaims, trabalho: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.run(claims, trabalho);
    } catch (e) {
      traduzirErroAssinatura(e);
    }
  }

  /** A1: quem filtra é a policy subscriptions_org_read, como no PostgREST. */
  async atual(claims: SupabaseClaims): Promise<Linha | null> {
    const linhas = await this.rodar(claims, (tx) => tx.$queryRaw<Linhas>(Prisma.sql`
      select to_jsonb(s) || jsonb_build_object('plan', to_jsonb(p)) as linha
      from public.subscriptions s
      left join public.plans p on p.id = s.plan_id
      order by s.created_at desc, s.id limit 1`));
    return linhas[0]?.linha ?? null;
  }

  /**
   * A2: as quatro consultas de hoje numa só, com o período calculado no servidor.
   * As três contagens filtram por get_corretor_id() — como o `.eq('corretor_id', ...)` de hoje e como
   * checar_cota. Sem o filtro, as policies PERMISSIVAS de leitura por organização
   * (`routine organization: properties read` e a de contratos) fariam o consumo de um membro somar os
   * imóveis e contratos do corretor dono da organização.
   */
  async uso(claims: SupabaseClaims): Promise<UsoAssinatura> {
    const { fusoUso } = lerConfigAssinatura();
    const linhas = await this.rodar(claims, (tx) => tx.$queryRaw<LinhaUso[]>(Prisma.sql`
      with periodo as (
        select date_trunc('month', now() at time zone ${fusoUso}::text)::date as inicio
      )
      select to_char((select inicio from periodo), 'YYYY-MM-DD') as period_start,
             to_char(((select inicio from periodo) + interval '1 month - 1 day')::date, 'YYYY-MM-DD') as period_end,
             coalesce((select jsonb_agg(to_jsonb(u) order by u.feature_key, u.id)
                         from public.usage_counters u
                        where u.period_start = (select inicio from periodo)), '[]'::jsonb) as contadores,
             (select count(*)::int from public.imoveis i
               where i.corretor_id = public.get_corretor_id() and i.ativo is true) as max_imoveis,
             (select count(*)::int from public.contratos c
               where c.corretor_id = public.get_corretor_id()
                 and c.tipo in ('LOCACAO_RESIDENCIAL','LOCACAO_COMERCIAL') and c.status = 'ATIVO') as max_contratos_locacao,
             (select count(*)::int from public.fachadas f
               where f.corretor_id = public.get_corretor_id() and f.ativo is true) as max_fachadas`));
    const l = linhas[0];
    return {
      period_start: l.period_start,
      period_end: l.period_end,
      contadores: l.contadores,
      ativos: {
        max_imoveis: l.max_imoveis,
        max_contratos_locacao: l.max_contratos_locacao,
        max_fachadas: l.max_fachadas,
      },
    };
  }

  /** A3 */
  async addons(claims: SupabaseClaims): Promise<Linha[]> {
    const linhas = await this.rodar(claims, (tx) => tx.$queryRaw<Linhas>(Prisma.sql`
      select to_jsonb(a) as linha from public.subscription_addons a
      where a.status = 'active' order by a.addon_code, a.id limit ${LIMITE_LISTA}::int`));
    return linhas.map((l) => l.linha);
  }

  /** A4: sem corretor a função devolve false, e a rota repete esse false. */
  async contaAntiga(claims: SupabaseClaims): Promise<{ sem_limite: boolean }> {
    const linhas = await this.rodar(claims, (tx) => tx.$queryRaw<Array<{ sem_limite: boolean }>>(Prisma.sql`
      select coalesce(public.conta_antiga_sem_limite(public.get_corretor_id()), false) as sem_limite`));
    return { sem_limite: linhas[0]?.sem_limite === true };
  }

  /** A5: leitura autoritativa da cota. Não incrementa, não reserva e não afrouxa nada. */
  async cota(claims: SupabaseClaims, chave: string): Promise<RespostaCota> {
    return this.rodar(claims, async (tx) => {
      const corretor = await tx.$queryRaw<Array<{ id: string | null }>>(Prisma.sql`select public.get_corretor_id()::text as id`);
      if (!corretor[0]?.id) throw semCorretor();
      const linhas = await tx.$queryRaw<Linhas>(Prisma.sql`
        select to_jsonb(c) as linha
        from public.checar_cota(public.get_corretor_id(), ${chave}::text) c`);
      const linha = linhas[0]?.linha;
      if (!linha) throw semCorretor();
      return {
        permitido: linha.permitido === true,
        usado: Number(linha.usado ?? 0),
        limite: linha.limite === null || linha.limite === undefined ? null : Number(linha.limite),
        ilimitado: linha.ilimitado === true,
        habilitado: linha.habilitado === true,
      };
    });
  }
}
