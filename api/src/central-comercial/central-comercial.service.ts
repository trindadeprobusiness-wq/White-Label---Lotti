import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';

/**
 * Central Comercial (back office): as telas leem e gravam as 7 tabelas central_comercial_* pela API.
 * Sempre como o usuário logado (TenantDb + RLS owner_id = auth.uid()); o owner_id do corpo é ignorado e
 * vem do token. Tabela e coluna só da lista abaixo/do catálogo do banco: nada do corpo vira SQL cru.
 */
export const TABELAS = [
  'central_comercial_leads', 'central_comercial_interacoes', 'central_comercial_roteiros', 'central_comercial_vendas',
  'central_comercial_recebimentos', 'central_comercial_despesas', 'central_comercial_projecao_config',
] as const;
export type Tabela = (typeof TABELAS)[number];

const PROTEGIDAS = new Set(['id', 'owner_id', 'created_at']);
type Linha = Record<string, unknown>;
const ident = (nome: string) => Prisma.raw(`"${nome.replace(/"/g, '')}"`);

export function tabelaValida(nome: string): Tabela {
  if (!(TABELAS as readonly string[]).includes(nome)) throw new BadRequestException('tabela_invalida');
  return nome as Tabela;
}

@Injectable()
export class CentralComercialService {
  private colunasCache = new Map<string, Set<string>>();
  constructor(private readonly db: TenantDb) {}

  private async colunas(tx: Prisma.TransactionClient, tabela: Tabela): Promise<Set<string>> {
    const hit = this.colunasCache.get(tabela);
    if (hit) return hit;
    const rows = await tx.$queryRaw<Array<{ c: string }>>`
      select column_name as c from information_schema.columns where table_schema = 'public' and table_name = ${tabela}`;
    const set = new Set(rows.map((r) => r.c));
    this.colunasCache.set(tabela, set);
    return set;
  }

  /** Filtros de igualdade (eq) só em colunas reais. */
  private async onde(tx: Prisma.TransactionClient, tabela: Tabela, filtros: Record<string, string>) {
    const cols = await this.colunas(tx, tabela);
    const partes = Object.entries(filtros).filter(([c]) => cols.has(c)).map(([c, v]) => Prisma.sql`${ident(c)}::text = ${String(v)}`);
    if (Object.keys(filtros).some((c) => !cols.has(c))) throw new BadRequestException('filtro_invalido');
    return partes.length ? Prisma.sql`where ${Prisma.join(partes, ' and ')}` : Prisma.empty;
  }

  async listar(claims: SupabaseClaims, nome: string, opcoes: { ordem?: string; asc?: boolean; filtros?: Record<string, string> }) {
    const tabela = tabelaValida(nome);
    return this.db.run(claims, async (tx) => {
      const cols = await this.colunas(tx, tabela);
      const ordem = opcoes.ordem && cols.has(opcoes.ordem) ? Prisma.sql`order by ${ident(opcoes.ordem)} ${Prisma.raw(opcoes.asc === false ? 'desc' : 'asc')} nulls last` : Prisma.empty;
      const where = await this.onde(tx, tabela, opcoes.filtros ?? {});
      const rows = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        select to_jsonb(t) as linha from public.${ident(tabela)} t ${where} ${ordem} limit 5000`);
      return rows.map((r) => r.linha);
    });
  }

  /** Insere uma ou várias linhas (ou atualiza, com `upsert`, pela chave primária). Devolve as gravadas. */
  async inserir(claims: SupabaseClaims, nome: string, corpo: Linha | Linha[], upsert = false) {
    const tabela = tabelaValida(nome);
    const linhas = (Array.isArray(corpo) ? corpo : [corpo]).slice(0, 1000);
    if (!linhas.length) return [] as Linha[];
    return this.db.run(claims, async (tx) => {
      const cols = await this.colunas(tx, tabela);
      const saida: Linha[] = [];
      for (const bruta of linhas) {
        if (!bruta || typeof bruta !== 'object') throw new BadRequestException('linha_invalida');
        const dados: Linha = { ...bruta, owner_id: claims.sub };
        const nomes = Object.keys(dados).filter((c) => cols.has(c) && (c === 'owner_id' || !PROTEGIDAS.has(c)));
        const lista = Prisma.join(nomes.map(ident), ', ');
        const conflito = upsert
          ? Prisma.sql`on conflict (owner_id) do update set ${Prisma.join(nomes.filter((c) => c !== 'owner_id').map((c) => Prisma.sql`${ident(c)} = excluded.${ident(c)}`), ', ')}`
          : Prisma.empty;
        const rows = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
          insert into public.${ident(tabela)} (${lista})
          select ${lista} from jsonb_populate_record(null::public.${ident(tabela)}, ${JSON.stringify(Object.fromEntries(nomes.map((c) => [c, dados[c]])))}::jsonb)
          ${conflito}
          returning to_jsonb(${ident(tabela)}.*) as linha`);
        saida.push(...rows.map((r) => r.linha));
      }
      return saida;
    });
  }

  /** Atualiza as linhas que casam com os filtros (na prática, por id). */
  async atualizar(claims: SupabaseClaims, nome: string, filtros: Record<string, string>, patch: Linha) {
    const tabela = tabelaValida(nome);
    if (!Object.keys(filtros).length) throw new BadRequestException('filtro_obrigatorio');
    return this.db.run(claims, async (tx) => {
      const cols = await this.colunas(tx, tabela);
      const nomes = Object.keys(patch ?? {}).filter((c) => cols.has(c) && !PROTEGIDAS.has(c));
      if (!nomes.length) throw new BadRequestException('nada_para_atualizar');
      const where = await this.onde(tx, tabela, filtros);
      const lista = Prisma.join(nomes.map(ident), ', ');
      const rows = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        update public.${ident(tabela)} t set (${lista}) = (select ${lista} from jsonb_populate_record(null::public.${ident(tabela)}, ${JSON.stringify(Object.fromEntries(nomes.map((c) => [c, patch[c]])))}::jsonb))
        ${where} returning to_jsonb(t) as linha`);
      return rows.map((r) => r.linha);
    });
  }
}
