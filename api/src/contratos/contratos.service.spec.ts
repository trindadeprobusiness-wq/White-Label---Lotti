import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AlterarContratoDto, ContratosDosClientesDto, CriarContratoDto, CriarLocacaoDto, EditarLocacaoDto, ListarLocacaoDto } from './contratos.dto';
import { traduzirErroBanco } from './contratos.erros';
import { ContratosService } from './contratos.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const CORRETOR = '55555555-5555-4555-8555-555555555555';
const claims = { sub: 'u1', role: 'authenticated' };

function montar() {
  const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
  const db = { run: jest.fn(async (_c: unknown, w: (t: typeof tx) => unknown) => w(tx)) };
  return { tx, db, servico: new ContratosService(db as never) };
}

const sql = (tx: { $queryRaw: jest.Mock }, i: number) => tx.$queryRaw.mock.calls[i][0] as Prisma.Sql;
const texto = (tx: { $queryRaw: jest.Mock }, i: number) => sql(tx, i).text.replace(/\s+/g, ' ').trim();
function confereCasts(tx: { $queryRaw: jest.Mock }) {
  for (const [q] of tx.$queryRaw.mock.calls) expect((q as Prisma.Sql).text).not.toMatch(/\$\d+(?!\d|::)/);
}
const erroBanco = (code: string, message: string) =>
  new Prisma.PrismaClientKnownRequestError('x', { code: 'P2010', clientVersion: 'teste', meta: { code, message } });

async function erroDe(p: Promise<unknown> | (() => unknown)): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await (typeof p === 'function' ? Promise.resolve().then(p) : p);
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('não lançou');
}
const dto = <T extends object>(Classe: new () => T, dados: Partial<T>): T => Object.assign(new Classe(), dados);

const locacao = { cliente_id: A, imovel_id: B, valor: 1500, data_inicio: '2026-10-01', dia_vencimento: 10, conteudo: '{}' };

describe('ContratosService: listagens', () => {
  it('listar: to_jsonb, created_at desc com desempate por id e teto 1000', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: A } }]);
    expect(await servico.listar(claims)).toEqual([{ id: A }]);
    expect(texto(tx, 0)).toBe('select to_jsonb(c) as linha from public.contratos c order by c.created_at desc, c.id limit $1::int');
    expect(sql(tx, 0).values).toEqual([1000]);
  });

  it('central: embeds com case e data_fim asc nulls last', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await servico.listarCentral(claims);
    const t = texto(tx, 0);
    expect(t).toContain("'imoveis', case when i.id is null then null else jsonb_build_object('titulo', i.titulo) end");
    expect(t).toContain('order by c.data_fim asc nulls last, c.id limit $1::int');
    confereCasts(tx);
  });

  it('locação: filtra por tipo com cast do enum; padrão LOCACAO_RESIDENCIAL', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValue([]);
    await servico.listarLocacao(claims, dto(ListarLocacaoDto, {}));
    expect(texto(tx, 0)).toContain('where c.tipo = $1::public.tipo_contrato');
    expect(sql(tx, 0).values).toEqual(['LOCACAO_RESIDENCIAL', 1000]);
    await servico.listarLocacao(claims, dto(ListarLocacaoDto, { tipo: 'LOCACAO_COMERCIAL' }));
    expect(sql(tx, 1).values[0]).toBe('LOCACAO_COMERCIAL');
    confereCasts(tx);
  });

  it('por-clientes: any($n::uuid[])', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await servico.listarDosClientes(claims, dto(ContratosDosClientesDto, { cliente_ids: [A, B] }));
    expect(texto(tx, 0)).toContain('where c.cliente_id = any($1::uuid[])');
    expect(sql(tx, 0).values).toEqual([[A, B], 1000]);
  });
});

describe('ContratosService: criar', () => {
  it('corretor, pertencimento e insert por jsonb_populate_record, sem campos de IA', async () => {
    const { tx, db, servico } = montar();
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: CORRETOR }])
      .mockResolvedValueOnce([{ n: 1 }])
      .mockResolvedValueOnce([{ n: 1 }])
      .mockResolvedValueOnce([{ linha: { id: C, status: 'RASCUNHO' } }]);
    const corpo = dto(CriarContratoDto, { tipo: 'COMPRA_VENDA', cliente_id: A, imovel_id: B, valor: 10, data_inicio: '2026-01-01', conteudo: '' });
    Object.assign(corpo, { versao: 1, modelo_ia: 'x', tempo_geracao_ms: 3 });
    expect(await servico.criar(claims, corpo)).toEqual({ id: C, status: 'RASCUNHO' });
    expect(db.run).toHaveBeenCalledTimes(1);
    expect(texto(tx, 0)).toBe('select public.get_corretor_id()::text as id');
    expect(texto(tx, 1)).toBe('select count(*)::int as n from public.clientes where id = $1::uuid');
    expect(texto(tx, 2)).toBe('select count(*)::int as n from public.imoveis where id = $1::uuid');
    const t = texto(tx, 3);
    expect(t).toContain('insert into public.contratos as x (corretor_id, tipo, cliente_id, imovel_id, valor, data_inicio, conteudo)');
    expect(t).toContain('from jsonb_populate_record(null::public.contratos, $2::jsonb) r returning to_jsonb(x) as linha');
    const json = JSON.parse(sql(tx, 3).values[1] as string);
    expect(json).not.toHaveProperty('versao');
    expect(json).not.toHaveProperty('modelo_ia');
    expect(json).not.toHaveProperty('tempo_geracao_ms');
    confereCasts(tx);
  });

  it('corretor null → 403; cliente invisível → 422', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: null }]);
    const corpo = dto(CriarContratoDto, { tipo: 'COMPRA_VENDA', cliente_id: A, valor: 1, data_inicio: '2026-01-01', conteudo: '' });
    expect(await erroDe(servico.criar(claims, corpo))).toEqual({
      status: 403, body: { statusCode: 403, codigo: 'corretor_nao_identificado', message: 'Não foi possível identificar o corretor.' },
    });
    tx.$queryRaw.mockResolvedValueOnce([{ id: CORRETOR }]).mockResolvedValueOnce([{ n: 0 }]);
    expect((await erroDe(servico.criar(claims, corpo))).body.codigo).toBe('cliente_invalido');
  });
});

describe('ContratosService: locação', () => {
  it('contrato ATIVO e fatura no mesmo run, com casts e regra de atraso em São Paulo', async () => {
    const { tx, db, servico } = montar();
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: CORRETOR }])
      .mockResolvedValueOnce([{ n: 1 }])
      .mockResolvedValueOnce([{ n: 1 }])
      .mockResolvedValueOnce([{ linha: { id: C, status: 'ATIVO' } }])
      .mockResolvedValueOnce([{ linha: { id: A, status: 'PENDENTE' } }]);
    const r = await servico.criarLocacao(claims, dto(CriarLocacaoDto, { ...locacao, primeira_fatura: { data_vencimento: '2026-11-10', mes_referencia: '11/2026' } }));
    expect(r).toEqual({ contrato: { id: C, status: 'ATIVO' }, fatura: { id: A, status: 'PENDENTE' } });
    expect(db.run).toHaveBeenCalledTimes(1);
    expect(texto(tx, 3)).toContain("insert into public.contratos as x (corretor_id, status, tipo, cliente_id");
    expect(texto(tx, 3)).toContain("select $1::uuid, 'ATIVO', r.tipo");
    expect(JSON.parse(sql(tx, 3).values[1] as string).tipo).toBe('LOCACAO_RESIDENCIAL');
    expect(JSON.parse(sql(tx, 3).values[1] as string)).not.toHaveProperty('primeira_fatura');
    const f = texto(tx, 4);
    expect(f).toContain('$5::numeric');
    expect(f).toContain('$6::date');
    expect(f).toContain("case when $7::date <= (now() at time zone 'America/Sao_Paulo')::date then 'ATRASADO' else 'PENDENTE' end");
    expect(sql(tx, 4).values).toEqual([C, A, B, CORRETOR, 1500, '2026-11-10', '2026-11-10', '11/2026']);
    confereCasts(tx);
  });

  it('editar: for update, updated_at = now(), diaMudou false quando o dia é o mesmo, emitidas só com external_id', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw
      .mockResolvedValueOnce([{ linha: { id: C, dia_vencimento: 10 } }])
      .mockResolvedValueOnce([{ n: 1 }])
      .mockResolvedValueOnce([{ n: 1 }])
      .mockResolvedValueOnce([{ linha: { id: C } }])
      .mockResolvedValueOnce([{ id: A, external_id: 'pay_1' }, { id: B, external_id: null }]);
    const r = await servico.editarLocacao(claims, C, dto(EditarLocacaoDto, locacao));
    expect(r).toEqual({ contrato: { id: C }, faturas_emitidas: [A] });
    expect(texto(tx, 0)).toBe('select to_jsonb(c) as linha from public.contratos c where c.id = $1::uuid for update');
    expect(texto(tx, 3)).toContain("status = 'ATIVO', updated_at = now()");
    const s = texto(tx, 4);
    expect(s).toContain("where f.contrato_id = $4::uuid and f.status in ('PENDENTE', 'ATRASADO')");
    expect(sql(tx, 4).values).toEqual([1500, false, 10, C]);
    confereCasts(tx);
  });

  it('editar: dia diferente manda true; contrato inexistente → 404', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw
      .mockResolvedValueOnce([{ linha: { id: C, dia_vencimento: 5 } }])
      .mockResolvedValueOnce([{ n: 1 }]).mockResolvedValueOnce([{ n: 1 }])
      .mockResolvedValueOnce([{ linha: { id: C } }]).mockResolvedValueOnce([]);
    await servico.editarLocacao(claims, C, dto(EditarLocacaoDto, locacao));
    expect(sql(tx, 4).values[1]).toBe(true);
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect((await erroDe(servico.editarLocacao(claims, C, dto(EditarLocacaoDto, locacao)))).status).toBe(404);
  });
});

describe('ContratosService: alterar e remover', () => {
  it('sem campos → 400 nada_para_atualizar sem abrir run', async () => {
    const { db, servico } = montar();
    expect(await erroDe(() => servico.alterar(claims, C, dto(AlterarContratoDto, {})))).toEqual({
      status: 400, body: { statusCode: 400, codigo: 'nada_para_atualizar', message: 'Nada para atualizar.' },
    });
    expect(db.run).not.toHaveBeenCalled();
  });

  it('update com updated_at = now(); zero linhas → 404', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: C } }]);
    await servico.alterar(claims, C, dto(AlterarContratoDto, { status: 'ENCERRADO', data_fim: null }));
    expect(texto(tx, 0)).toContain('update public.contratos t set (status, data_fim) =');
    expect(texto(tx, 0)).toContain('updated_at = now() where t.id = $2::uuid');
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect((await erroDe(servico.alterar(claims, C, dto(AlterarContratoDto, { status: 'ENCERRADO' })))).body.codigo).toBe('contrato_nao_encontrado');
  });

  it('delete sem linha → 404', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect((await erroDe(servico.remover(claims, C))).status).toBe(404);
    expect(texto(tx, 0)).toBe('delete from public.contratos where id = $1::uuid returning id::text as id');
  });

  it('P0001 PLAN_LIMIT_REACHED:max_contratos_locacao do banco → 402 com recurso', async () => {
    const { db, servico } = montar();
    db.run.mockRejectedValueOnce(erroBanco('P0001', 'ERROR: PLAN_LIMIT_REACHED:max_contratos_locacao'));
    expect(await erroDe(servico.alterar(claims, C, dto(AlterarContratoDto, { status: 'ATIVO' })))).toEqual({
      status: 402,
      body: {
        statusCode: 402, codigo: 'PLAN_LIMIT_REACHED', recurso: 'max_contratos_locacao',
        message: 'Limite de contratos de locação atingido. Acesse Plano e Assinatura para liberar mais contratos.',
      },
    });
  });
});

describe('tradutor de erros', () => {
  it('outro recurso → mensagem genérica; 42501 → 403 com o texto de contratos', async () => {
    expect(await erroDe(() => traduzirErroBanco(erroBanco('P0001', 'ERROR: PLAN_LIMIT_REACHED:max_imoveis')))).toEqual({
      status: 402, body: { statusCode: 402, codigo: 'PLAN_LIMIT_REACHED', recurso: 'max_imoveis', message: 'Limite do plano atingido. Acesse Plano e Assinatura.' },
    });
    const { db, servico } = montar();
    db.run.mockRejectedValueOnce(erroBanco('42501', 'ERROR: new row violates row-level security policy'));
    expect((await erroDe(servico.listar(claims))).body.message).toBe('Você não tem permissão para alterar contratos desta conta.');
  });
});
