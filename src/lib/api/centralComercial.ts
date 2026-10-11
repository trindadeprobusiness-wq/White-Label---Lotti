import { chamarApi } from '@/lib/api';
import { corpoJson, lerJson } from '@/lib/api/http';

/**
 * Cliente da Central Comercial (back office) pela API Lotti (/api/central-comercial/:tabela).
 * Imita só o pedaço do supabase-js que as três telas usavam — from().select().order().eq(),
 * maybeSingle(), insert().select().single(), update().eq(), upsert() — para as telas mudarem pouco.
 * Sempre devolve { data, error } como antes.
 */
type Resultado<T> = { data: T | null; error: Error | null };
type Linha = Record<string, unknown>;

class Consulta<T = unknown> implements PromiseLike<Resultado<T>> {
  private filtros: Record<string, string> = {};
  private ordem?: { coluna: string; asc: boolean };
  private unico: 'single' | 'maybe' | null = null;
  constructor(private readonly tabela: string, private readonly op: 'select' | 'insert' | 'update' | 'upsert', private readonly corpo?: Linha | Linha[]) {}

  select(_colunas?: string) { return this; }
  order(coluna: string, opcoes?: { ascending?: boolean }) { this.ordem = { coluna, asc: opcoes?.ascending !== false }; return this; }
  eq(coluna: string, valor: unknown) { this.filtros[coluna] = String(valor); return this; }
  single() { this.unico = 'single'; return this; }
  maybeSingle() { this.unico = 'maybe'; return this; }

  private query() {
    const p = new URLSearchParams();
    for (const [c, v] of Object.entries(this.filtros)) p.set(`eq.${c}`, v);
    if (this.ordem) { p.set('ordem', this.ordem.coluna); p.set('asc', String(this.ordem.asc)); }
    const s = p.toString();
    return s ? `?${s}` : '';
  }

  private async executar(): Promise<Resultado<T>> {
    try {
      const rota = `/api/central-comercial/${encodeURIComponent(this.tabela)}`;
      let linhas: Linha[];
      if (this.op === 'select') linhas = await lerJson<Linha[]>(await chamarApi(`${rota}${this.query()}`), 'Não foi possível carregar.');
      else if (this.op === 'update') linhas = await lerJson<Linha[]>(await chamarApi(`${rota}${this.query()}`, corpoJson('PATCH', { patch: this.corpo })), 'Não foi possível salvar.');
      else linhas = await lerJson<Linha[]>(await chamarApi(rota, corpoJson('POST', { linhas: Array.isArray(this.corpo) ? this.corpo : [this.corpo], upsert: this.op === 'upsert' })), 'Não foi possível salvar.');
      if (this.unico) {
        if (this.unico === 'single' && linhas.length !== 1) throw new Error('Registro não encontrado.');
        return { data: (linhas[0] ?? null) as T, error: null };
      }
      return { data: linhas as T, error: null };
    } catch (e) {
      return { data: null, error: e instanceof Error ? e : new Error('Não foi possível salvar.') };
    }
  }

  then<A = Resultado<T>, B = never>(ok?: ((v: Resultado<T>) => A | PromiseLike<A>) | null, falha?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return this.executar().then(ok, falha);
  }
}

export const centralComercial = {
  from(tabela: string) {
    return {
      select: (colunas?: string) => new Consulta(tabela, 'select').select(colunas),
      insert: (linhas: Linha | Linha[]) => new Consulta(tabela, 'insert', linhas),
      upsert: (linha: Linha) => new Consulta(tabela, 'upsert', linha),
      update: (patch: Linha) => new Consulta(tabela, 'update', patch),
    };
  },
};
