import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AlterarLancamentoDto, CriarLancamentoDto, FiltroLancamentosDto } from './financeiro.dto';
import { LancamentosService, linhasDoLancamento } from './lancamentos.service';

const A = '11111111-1111-4111-8111-111111111111';
const CORRETOR = '55555555-5555-4555-8555-555555555555';
const claims = { sub: 'u1', role: 'authenticated' };
const BASELINE = ['id', 'corretor_id', 'tipo', 'categoria', 'descricao', 'valor', 'data', 'recorrente', 'contrato_id', 'imovel_id', 'comprovante_url', 'created_at', 'fatura_id'];

function montar(colunas = BASELINE, corretor: string | null = CORRETOR) {
  const tx = {
    $queryRaw: jest.fn(async (q: Prisma.Sql) => {
      if (q.text.includes('get_corretor_id()::text')) return [{ id: corretor }];
      if (q.text.includes('information_schema.columns')) return colunas.map((c) => ({ c }));
      if (q.text.includes('insert into')) return [{ linha: { id: A } }];
      return [];
    }),
    $executeRaw: jest.fn(async (_q: Prisma.Sql) => 1),
  };
  const db = { run: jest.fn(async (_c: unknown, w: (t: typeof tx) => unknown) => w(tx)) };
  return { tx, db, svc: new LancamentosService(db as never) };
}

const dto = <T extends object>(C: new () => T, d: Partial<T>): T => Object.assign(new C(), d);
const texto = (q: Prisma.Sql) => q.text.replace(/\s+/g, ' ').trim();
const consulta = (tx: { $queryRaw: jest.Mock }, trecho: string) =>
  tx.$queryRaw.mock.calls.map((c) => c[0] as Prisma.Sql).find((q) => q.text.includes(trecho))!;
const confereCasts = (tx: { $queryRaw: jest.Mock }) => {
  for (const [q] of tx.$queryRaw.mock.calls) expect((q as Prisma.Sql).text).not.toMatch(/\$\d+(?!\d|::)/);
};

async function erroDe(p: Promise<unknown>) {
  try { await p; } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() };
    throw e;
  }
  throw new Error('não lançou');
}

describe('linhasDoLancamento', () => {
  const base = { tipo: 'DESPESA', categoria: 'OUTROS', descricao: 'Conta', valor: 10, data: '2026-01-31' };

  it('não recorrente: 1 linha com os padrões do hook', () => {
    expect(linhasDoLancamento(dto(CriarLancamentoDto, base))).toEqual([
      { ...base, recorrente: false, data_competencia: '2026-01-31', status: 'pago', impacta_dre: true },
    ]);
  });

  it('recorrente: 12 linhas com (2/12)..(12/12) e fim de mês ajustado', () => {
    const l = linhasDoLancamento(dto(CriarLancamentoDto, { ...base, recorrente: true, status: 'pendente', impacta_dre: false }));
    expect(l).toHaveLength(12);
    expect(l[0].descricao).toBe('Conta');
    expect(l.slice(1).map((x) => x.descricao)).toEqual(Array.from({ length: 11 }, (_, i) => `Conta (${i + 2}/12)`));
    expect(l[1]).toMatchObject({ data: '2026-02-28', data_competencia: '2026-02-28', recorrente: true, status: 'pendente', impacta_dre: false });
    expect(l[11].data).toBe('2026-12-31');
  });
});

describe('LancamentosService', () => {
  it('GET: quatro filtros com ::text/::timestamptz e limit $n::int', async () => {
    const { tx, svc } = montar();
    await svc.listar(claims, dto(FiltroLancamentosDto, { tipo: 'RECEITA', de: '2026-01-01' }));
    const q = consulta(tx, 'from public.lancamentos_financeiros l');
    const t = texto(q);
    expect(t).toContain('where l.corretor_id = public.get_corretor_id()');
    expect(t).toContain('($1::text is null or l.tipo = $2::text)');
    expect(t).toContain('($3::text is null or l.categoria = $4::text)');
    expect(t).toContain('($5::timestamptz is null or l.data >= $6::timestamptz)');
    expect(t).toContain('($7::timestamptz is null or l.data <= $8::timestamptz)');
    expect(t).toContain('order by l.data desc, l.id limit $9::int');
    expect(q.values).toEqual(['RECEITA', 'RECEITA', null, null, '2026-01-01', '2026-01-01', null, null, 1000]);
    confereCasts(tx);
  });

  it('GET sem corretor → 403', async () => {
    const { svc } = montar(BASELINE, null);
    expect((await erroDe(svc.listar(claims, dto(FiltroLancamentosDto, {})))).status).toBe(403);
  });

  it('POST grava só as colunas que existem no banco (D1), num INSERT só', async () => {
    const { tx, svc } = montar();
    await svc.criar(claims, dto(CriarLancamentoDto, { tipo: 'DESPESA', categoria: 'OUTROS', descricao: 'x', valor: 1, data: '2026-01-01', status: 'pago' }));
    const q = consulta(tx, 'insert into');
    const t = texto(q);
    expect(t).toContain('insert into public.lancamentos_financeiros as x (corretor_id, tipo, categoria, descricao, valor, data, recorrente)');
    expect(t).not.toMatch(/status|impacta_dre|data_competencia/);
    expect(t).toContain('jsonb_array_elements($2::jsonb) with ordinality e(v, n)');
    expect(q.values[0]).toBe(CORRETOR);
    expect(JSON.parse(q.values[1] as string)).toEqual([{ tipo: 'DESPESA', categoria: 'OUTROS', descricao: 'x', valor: 1, data: '2026-01-01', recorrente: false }]);
    confereCasts(tx);
  });

  it('POST com a migration DRE aplicada grava status, impacta_dre e data_competencia', async () => {
    const { tx, svc } = montar([...BASELINE, 'data_competencia', 'status', 'impacta_dre']);
    await svc.criar(claims, dto(CriarLancamentoDto, { tipo: 'DESPESA', categoria: 'OUTROS', descricao: 'x', valor: 1, data: '2026-01-01' }));
    expect(texto(consulta(tx, 'insert into'))).toContain('(corretor_id, tipo, categoria, descricao, valor, data, data_competencia, recorrente, status, impacta_dre)');
  });

  it('PATCH vazio → 400 nada_para_atualizar; sem linha → 404', async () => {
    const { svc } = montar();
    expect(await erroDe(svc.alterar(claims, A, dto(AlterarLancamentoDto, {})))).toEqual({
      status: 400, body: { statusCode: 400, codigo: 'nada_para_atualizar', message: 'Nada para atualizar.' },
    });
    expect(await erroDe(svc.alterar(claims, A, dto(AlterarLancamentoDto, { descricao: 'y' })))).toEqual({
      status: 404, body: { statusCode: 404, codigo: 'lancamento_nao_encontrado', message: 'Lançamento não encontrado.' },
    });
  });

  it('DELETE por $executeRaw com ::uuid', async () => {
    const { tx, svc } = montar();
    await svc.excluir(claims, A);
    const q = tx.$executeRaw.mock.calls[0][0] as unknown as Prisma.Sql;
    expect(texto(q)).toBe('delete from public.lancamentos_financeiros where id = $1::uuid');
    expect(q.values).toEqual([A]);
  });
});
