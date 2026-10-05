import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LIMITE_CAMPANHA, LIMITE_LISTA, Linha } from './assinatura.dto';
import { erroApi, traduzirErroAssinatura } from './assinatura.erros';
import { CatalogoRepo } from './catalogo.repo';

type Linhas = Array<{ linha: Linha }>;

@Injectable()
export class CatalogoService {
  constructor(private readonly repo: CatalogoRepo) {}

  private async rodar<T>(trabalho: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.repo.comoAnon(trabalho);
    } catch (e) {
      traduzirErroAssinatura(e);
    }
  }

  /** C1: o filtro `active` é o que o front faz hoje; plans_read_all devolve tudo. */
  async listarPlanos(): Promise<Linha[]> {
    const linhas = await this.rodar((tx) => tx.$queryRaw<Linhas>(Prisma.sql`
      select to_jsonb(p) as linha from public.plans p
      where p.active is true order by p.display_order, p.id limit ${LIMITE_LISTA}::int`));
    return linhas.map((l) => l.linha);
  }

  /** C2: sem filtro; o front junta por plan_id. */
  async listarEntitlements(): Promise<Linha[]> {
    const linhas = await this.rodar((tx) => tx.$queryRaw<Linhas>(Prisma.sql`
      select to_jsonb(e) as linha from public.plan_entitlements e
      order by e.display_order, e.id limit ${LIMITE_LISTA}::int`));
    return linhas.map((l) => l.linha);
  }

  /** C3: duas ou mais campanhas ativas viram erro explícito (hoje o maybeSingle quebra calado). */
  async campanhaAtiva(): Promise<Linha | null> {
    const linhas = await this.rodar((tx) => tx.$queryRaw<Linhas>(Prisma.sql`
      select to_jsonb(c) as linha from public.pricing_campaigns c
      where c.active is true order by c.created_at desc, c.id limit ${LIMITE_CAMPANHA}::int`));
    if (linhas.length === 0) return null;
    if (linhas.length > 1) throw erroApi(409, 'campanha_ambigua', 'Há mais de uma campanha ativa. Avise o suporte.');
    return linhas[0].linha;
  }
}
