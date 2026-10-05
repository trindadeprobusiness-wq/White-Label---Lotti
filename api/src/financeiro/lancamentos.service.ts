import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { somarMeses } from './asaas/asaas-regras';
import {
  AlterarLancamentoDto, COLUNAS_EDICAO_LANCAMENTO, COLUNAS_LANCAMENTO, CriarLancamentoDto, FiltroLancamentosDto, LIMITE_LISTA,
} from './financeiro.dto';
import { erroApi, exigirCorretor, Linha, traduzirErroBanco } from './financeiro.erros';

type Tx = Prisma.TransactionClient;
type LinhaNova = Record<string, unknown>;

/** Colunas descartadas por não existirem no banco: logadas uma vez por processo (D1). */
const colunasAusentesLogadas = new Set<string>();

/**
 * Porte de useFinanceiro.addLancamento: linha 1 com os padrões e, se recorrente, mais 11 meses
 * com '(n/12)' na descrição. A recorrência passa para o servidor (D1b).
 */
export function linhasDoLancamento(dto: CriarLancamentoDto): LinhaNova[] {
  const base: LinhaNova = {};
  for (const c of COLUNAS_LANCAMENTO) {
    const v = (dto as unknown as Record<string, unknown>)[c];
    if (v !== undefined) base[c] = v;
  }
  const primeira: LinhaNova = {
    ...base,
    recorrente: dto.recorrente ?? false,
    data_competencia: dto.data_competencia || dto.data,
    status: dto.status || 'pago',
    impacta_dre: dto.impacta_dre ?? true,
  };
  const linhas = [primeira];
  if (dto.recorrente) {
    for (let i = 1; i < 12; i++) {
      const data = somarMeses(dto.data, i);
      linhas.push({ ...primeira, data, data_competencia: data, recorrente: true, descricao: `${dto.descricao} (${i + 1}/12)` });
    }
  }
  return linhas;
}

@Injectable()
export class LancamentosService {
  private readonly logger = new Logger(LancamentosService.name);

  constructor(private readonly db: TenantDb) {}

  listar(claims: SupabaseClaims, filtro: FiltroLancamentosDto): Promise<Linha[]> {
    return this.rodar(claims, async (tx) => {
      await exigirCorretor(tx);
      const tipo = filtro.tipo ?? null;
      const categoria = filtro.categoria ?? null;
      const de = filtro.de ?? null;
      const ate = filtro.ate ?? null;
      const linhas = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        select to_jsonb(l) as linha from public.lancamentos_financeiros l
         where l.corretor_id = public.get_corretor_id()
           and (${tipo}::text is null or l.tipo = ${tipo}::text)
           and (${categoria}::text is null or l.categoria = ${categoria}::text)
           and (${de}::timestamptz is null or l.data >= ${de}::timestamptz)
           and (${ate}::timestamptz is null or l.data <= ${ate}::timestamptz)
         order by l.data desc, l.id
         limit ${LIMITE_LISTA}::int`);
      return linhas.map((l) => l.linha);
    });
  }

  criar(claims: SupabaseClaims, dto: CriarLancamentoDto): Promise<Linha[]> {
    return this.rodar(claims, async (tx) => {
      const corretorId = await exigirCorretor(tx);
      const linhas = linhasDoLancamento(dto);
      const existentes = await this.colunasDoBanco(tx);
      const usadas = new Set(linhas.flatMap((l) => Object.keys(l)));
      const cols = COLUNAS_LANCAMENTO.filter((c) => usadas.has(c) && existentes.has(c));
      for (const c of usadas) {
        if (!existentes.has(c) && !colunasAusentesLogadas.has(c)) {
          colunasAusentesLogadas.add(c);
          this.logger.warn({ codigo: 'coluna_ausente', coluna: c });
        }
      }
      const json = JSON.stringify(linhas.map((l) => Object.fromEntries(cols.filter((c) => c in l).map((c) => [c, l[c]]))));
      const alvo = Prisma.raw(cols.join(', '));
      const origem = Prisma.raw(cols.map((c) => `r.${c}`).join(', '));
      const inseridas = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        insert into public.lancamentos_financeiros as x (corretor_id, ${alvo})
        select ${corretorId}::uuid, ${origem}
          from jsonb_array_elements(${json}::jsonb) with ordinality e(v, n)
          cross join lateral jsonb_populate_record(null::public.lancamentos_financeiros, e.v) r
         order by e.n
        returning to_jsonb(x) as linha`);
      return inseridas.map((l) => l.linha);
    });
  }

  alterar(claims: SupabaseClaims, id: string, dto: AlterarLancamentoDto): Promise<Linha> {
    return this.rodar(claims, async (tx) => {
      const cols = COLUNAS_EDICAO_LANCAMENTO.filter((c) => (dto as unknown as Record<string, unknown>)[c] !== undefined);
      if (cols.length === 0) throw erroApi(400, 'nada_para_atualizar', 'Nada para atualizar.');
      const json = JSON.stringify(Object.fromEntries(cols.map((c) => [c, (dto as unknown as Record<string, unknown>)[c]])));
      const alvo = Prisma.raw(cols.join(', '));
      const origem = Prisma.raw(cols.map((c) => `r.${c}`).join(', '));
      const linhas = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        update public.lancamentos_financeiros t
           set (${alvo}) = (select ${origem} from jsonb_populate_record(null::public.lancamentos_financeiros, ${json}::jsonb) r)
         where t.id = ${id}::uuid returning to_jsonb(t) as linha`);
      if (linhas.length === 0) throw erroApi(404, 'lancamento_nao_encontrado', 'Lançamento não encontrado.');
      return linhas[0].linha;
    });
  }

  async excluir(claims: SupabaseClaims, id: string): Promise<void> {
    // 0 linhas também é sucesso (paridade: o supabase-js não acusa DELETE sem alvo).
    await this.rodar(claims, (tx) => tx.$executeRaw(Prisma.sql`delete from public.lancamentos_financeiros where id = ${id}::uuid`));
  }

  private async colunasDoBanco(tx: Tx): Promise<Set<string>> {
    const linhas = await tx.$queryRaw<Array<{ c: string }>>(Prisma.sql`
      select column_name::text as c from information_schema.columns
       where table_schema = 'public' and table_name = 'lancamentos_financeiros'`);
    return new Set(linhas.map((l) => l.c));
  }

  /** Erro do banco é traduzido fora do run: dentro dele a transação já está abortada (25P02). */
  private async rodar<T>(claims: SupabaseClaims, work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.run(claims, work);
    } catch (e) {
      traduzirErroBanco(e);
    }
  }
}
