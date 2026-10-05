import { HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { erroPg, traduzirErroBanco } from './imoveis.erros';
import { ImoveisGestaoService } from './imoveis-gestao.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const claims = { sub: 'u1', role: 'authenticated' };

function erroBanco(code: string, message: string) {
  return new Prisma.PrismaClientKnownRequestError('x', { code: 'P2010', clientVersion: 'teste', meta: { code, message } });
}

async function falha(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return e;
    throw e;
  }
  throw new Error('deveria ter falhado');
}

function montar() {
  const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
  const db = { run: jest.fn(async (_c: unknown, w: (t: unknown) => unknown) => w(tx)) };
  const service = new ImoveisGestaoService(db as never);
  const sql = (i: number) => tx.$queryRaw.mock.calls[i][0] as Prisma.Sql;
  return { tx, db, service, sql };
}

const NOVO = {
  titulo: 'Casa no Jundiaí',
  tipo: 'CASA' as const,
  valor: 450000,
  endereco: 'Rua 1, 10',
  cidade: 'Anápolis',
  proprietario_nome: '',
};

describe('imoveis.erros', () => {
  it('lê SQLSTATE, mensagem sem prefixo e DETAIL, também com o servidor em português', () => {
    expect(erroPg(erroBanco('P0001', `ERRO:  duplicate_client_phone\nDETALHE:  ${A}`))).toEqual({
      sqlstate: 'P0001', mensagem: 'duplicate_client_phone', detalhe: A, bruto: `ERRO:  duplicate_client_phone\nDETALHE:  ${A}`,
    });
    expect(erroPg(new Error('x'))).toBeNull();
  });

  it('erro que não é do banco, ou SQLSTATE sem tradução, sobe como veio', () => {
    const comum = new Error('rede');
    expect(() => traduzirErroBanco(comum)).toThrow(comum);
    const desconhecido = erroBanco('XX000', 'ERROR: internal');
    expect(() => traduzirErroBanco(desconhecido)).toThrow(desconhecido);
  });

  it('dados inválidos viram 400 em português, sem repassar o texto do Postgres', () => {
    try {
      traduzirErroBanco(erroBanco('22P02', 'ERROR: invalid input value for enum tipo_imovel: "RURAL"'));
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(400);
      expect((e as HttpException).getResponse()).toEqual({
        statusCode: 400, codigo: 'dados_invalidos', message: 'Dados inválidos. Confira os campos e tente de novo.',
      });
    }
    expect.assertions(2);
  });

  it('HttpException lançada dentro do run passa intacta', () => {
    const http = new HttpException({ codigo: 'x' }, 404);
    expect(() => traduzirErroBanco(http)).toThrow(http);
  });
});

describe('ImoveisGestaoService.listar', () => {
  it('lista pelo TenantDb com to_jsonb, ordem do front com desempate por id e teto de 1000', async () => {
    const { tx, db, service, sql } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: A, proprietario_nome: 'Ana' } }, { linha: { id: B } }]);

    const out = await service.listar(claims);

    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    expect(sql(0).text).toMatch(/select to_jsonb\(i\) as linha from public\.imoveis i/);
    expect(sql(0).text).toMatch(/order by i\.created_at desc nulls first, i\.id/);
    expect(sql(0).text).toMatch(/limit \$1::int/);
    expect(sql(0).text).not.toMatch(/ativo|status_venda|corretor_id/);
    expect(sql(0).values).toEqual([1000]);
    expect(out).toEqual([{ id: A, proprietario_nome: 'Ana' }, { id: B }]);
  });
});

describe('ImoveisGestaoService.obter', () => {
  it('busca por id com cast uuid', async () => {
    const { tx, db, service, sql } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: A } }]);

    expect(await service.obter(claims, A)).toEqual({ id: A });
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    expect(sql(0).text).toMatch(/select to_jsonb\(i\) as linha from public\.imoveis i where i\.id = \$1::uuid/);
    expect(sql(0).values).toEqual([A]);
  });

  it('sem linha responde 404 imovel_nao_encontrado', async () => {
    const { tx, service } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    const e = await falha(service.obter(claims, A));
    expect(e.getStatus()).toBe(404);
    expect(e.getResponse()).toEqual({ statusCode: 404, codigo: 'imovel_nao_encontrado', message: 'Imóvel não encontrado.' });
  });
});

describe('ImoveisGestaoService.listarClientesInteressados', () => {
  it('junta vínculo e cliente numa consulta só, com a ordem e o teto da lista', async () => {
    const { tx, db, service, sql } = montar();
    const cliente = { id: B, nome: 'Bia', telefone: '(62) 91111-0002', status_funil: 'QUALIFICACAO' };
    tx.$queryRaw.mockResolvedValueOnce([{ linha: cliente }]);

    expect(await service.listarClientesInteressados(claims, A)).toEqual([cliente]);
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    const texto = sql(0).text;
    expect(texto).toMatch(/jsonb_build_object\('id', c\.id, 'nome', c\.nome, 'telefone', c\.telefone, 'status_funil', c\.status_funil\) as linha/);
    expect(texto).toMatch(/from public\.cliente_imovel ci\s+join public\.clientes c on c\.id = ci\.cliente_id/);
    expect(texto).toMatch(/where ci\.imovel_id = \$1::uuid/);
    expect(texto).toMatch(/order by c\.created_at desc nulls first, c\.id/);
    expect(texto).toMatch(/limit \$2::int/);
    expect(sql(0).values).toEqual([A, 1000]);
  });

  it('imóvel sem vínculo devolve lista vazia', async () => {
    const { tx, service } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await service.listarClientesInteressados(claims, A)).toEqual([]);
  });
});

describe('ImoveisGestaoService.criar', () => {
  it('resolve o corretor no servidor e grava só as colunas presentes', async () => {
    const { tx, db, service, sql } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: C }]).mockResolvedValueOnce([{ linha: { id: A, corretor_id: C } }]);
    const dto = { ...NOVO, bairro: null, finalidade: undefined, corretor_id: B, status_venda: 'VENDIDO' };

    const out = await service.criar(claims, dto as never);

    expect(out).toEqual({ id: A, corretor_id: C });
    expect(db.run).toHaveBeenCalledTimes(1);
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    expect(sql(0).text).toMatch(/select public\.get_corretor_id\(\)::text as id/);
    const texto = sql(1).text;
    expect(texto).toMatch(
      /insert into public\.imoveis as i \(corretor_id, titulo, tipo, valor, endereco, bairro, cidade, proprietario_nome\)/,
    );
    expect(texto).toMatch(/select \$1::uuid, r\.titulo, r\.tipo, r\.valor, r\.endereco, r\.bairro, r\.cidade, r\.proprietario_nome/);
    expect(texto).toMatch(/from jsonb_populate_record\(null::public\.imoveis, \$2::jsonb\) r/);
    expect(texto).toMatch(/returning to_jsonb\(i\) as linha/);
    expect(sql(1).values[0]).toBe(C);
    expect(JSON.parse(sql(1).values[1] as string)).toEqual({
      titulo: 'Casa no Jundiaí', tipo: 'CASA', valor: 450000, endereco: 'Rua 1, 10', bairro: null, cidade: 'Anápolis', proprietario_nome: '',
    });
  });

  it('sem corretor identificado responde 403 e não insere', async () => {
    const { tx, service } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: null }]);
    const e = await falha(service.criar(claims, NOVO));
    expect(e.getStatus()).toBe(403);
    expect(e.getResponse()).toEqual({
      statusCode: 403, codigo: 'corretor_nao_identificado', message: 'Não foi possível identificar o corretor.',
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('cota de imóveis vira 402 com texto em português e o recurso', async () => {
    const { tx, service } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: C }]).mockRejectedValueOnce(erroBanco('P0001', 'ERROR: PLAN_LIMIT_REACHED:max_imoveis'));
    const e = await falha(service.criar(claims, NOVO));
    expect(e.getStatus()).toBe(402);
    expect(e.getResponse()).toEqual({
      statusCode: 402,
      codigo: 'PLAN_LIMIT_REACHED',
      message: 'Limite de imóveis atingido. Acesse Plano e Assinatura para liberar mais imóveis.',
      recurso: 'max_imoveis',
    });
  });

  it('RLS recusando o insert vira 403 com o texto de cadastro', async () => {
    const { tx, service } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: C }])
      .mockRejectedValueOnce(erroBanco('42501', 'ERROR: new row violates row-level security policy for table "imoveis"'));
    const e = await falha(service.criar(claims, NOVO));
    expect(e.getStatus()).toBe(403);
    expect(e.getResponse()).toEqual({
      statusCode: 403, codigo: 'sem_permissao', message: 'Você não tem permissão para cadastrar imóveis nesta conta.',
    });
  });
});

describe('ImoveisGestaoService.atualizar', () => {
  it('update parcial só com as colunas presentes e permitidas', async () => {
    const { tx, db, service, sql } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: A, anunciado: true } }]);
    const dto = { titulo: 'Novo título', anunciado: true, bairro: null, valor: undefined, ativo: false, descricao: 'x' };

    expect(await service.atualizar(claims, A, dto as never)).toEqual({ id: A, anunciado: true });
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    expect(sql(0).text).toMatch(
      /update public\.imoveis t set \(titulo, bairro, anunciado\) = \(select r\.titulo, r\.bairro, r\.anunciado from jsonb_populate_record\(null::public\.imoveis, \$1::jsonb\) r\)/,
    );
    expect(sql(0).text).toMatch(/where t\.id = \$2::uuid returning to_jsonb\(t\) as linha/);
    expect(JSON.parse(sql(0).values[0] as string)).toEqual({ titulo: 'Novo título', bairro: null, anunciado: true });
    expect(sql(0).values[1]).toBe(A);
  });

  it('funciona com uma coluna só (switch anunciado)', async () => {
    const { tx, service, sql } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: A } }]);
    await service.atualizar(claims, A, { anunciado: false });
    expect(sql(0).text).toMatch(/set \(anunciado\) = \(select r\.anunciado from/);
  });

  it('zero linhas responde 404', async () => {
    const { tx, service } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    const e = await falha(service.atualizar(claims, A, { titulo: 'X' }));
    expect(e.getStatus()).toBe(404);
    expect(e.getResponse()).toEqual({ statusCode: 404, codigo: 'imovel_nao_encontrado', message: 'Imóvel não encontrado.' });
  });

  it('corpo sem coluna responde 400 sem tocar no banco', async () => {
    const { tx, service } = montar();
    const e = await falha(service.atualizar(claims, A, { titulo: undefined }));
    expect(e.getStatus()).toBe(400);
    expect(e.getResponse()).toEqual({ statusCode: 400, codigo: 'nada_para_atualizar', message: 'Nada para atualizar.' });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('RLS recusando vira 403 com o texto de alteração', async () => {
    const { tx, service } = montar();
    tx.$queryRaw.mockRejectedValueOnce(erroBanco('42501', 'ERROR: new row violates row-level security policy'));
    const e = await falha(service.atualizar(claims, A, { titulo: 'X' }));
    expect(e.getResponse()).toEqual({
      statusCode: 403, codigo: 'sem_permissao', message: 'Você não tem permissão para alterar este imóvel.',
    });
  });
});

describe('ImoveisGestaoService.remover', () => {
  it('apaga por id e confere a linha apagada', async () => {
    const { tx, db, service, sql } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: A }]);
    await expect(service.remover(claims, A)).resolves.toBeUndefined();
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    expect(sql(0).text).toMatch(/delete from public\.imoveis where id = \$1::uuid returning id/);
    expect(sql(0).values).toEqual([A]);
  });

  it('zero linhas responde 404 dizendo que nada foi apagado', async () => {
    const { tx, service } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    const e = await falha(service.remover(claims, A));
    expect(e.getStatus()).toBe(404);
    expect(e.getResponse()).toEqual({
      statusCode: 404, codigo: 'imovel_nao_encontrado', message: 'Nada foi apagado: o imóvel não existe ou você não tem permissão.',
    });
  });

  it('contrato vinculado vira 409 com sqlstate 23503 e a palavra contratos', async () => {
    const { tx, service } = montar();
    tx.$queryRaw.mockRejectedValueOnce(erroBanco('23503',
      'ERROR: update or delete on table "imoveis" violates foreign key constraint "contratos_imovel_id_fkey" on table "contratos"'));
    const e = await falha(service.remover(claims, A));
    expect(e.getStatus()).toBe(409);
    expect(e.getResponse()).toEqual({
      statusCode: 409, codigo: 'imovel_com_contrato', message: 'Existem contratos vinculados a este imóvel.', sqlstate: '23503',
    });
  });

  it('no Postgres 18 o RESTRICT de contratos chega como 23001 e também vira 409 com sqlstate 23503', async () => {
    const { tx, service } = montar();
    tx.$queryRaw.mockRejectedValueOnce(erroBanco('23001',
      'ERROR: update or delete on table "imoveis" violates RESTRICT setting of foreign key constraint "contratos_imovel_id_fkey" on table "contratos"\nDETAIL: Key is referenced from table "contratos".'));
    const e = await falha(service.remover(claims, A));
    expect(e.getStatus()).toBe(409);
    expect(e.getResponse()).toEqual({
      statusCode: 409, codigo: 'imovel_com_contrato', message: 'Existem contratos vinculados a este imóvel.', sqlstate: '23503',
    });
  });

  it('outra FK vira 422 referencia_invalida', async () => {
    const { tx, service } = montar();
    tx.$queryRaw.mockRejectedValueOnce(erroBanco('23503', 'ERROR: violates foreign key constraint "x" on table "y"'));
    const e = await falha(service.remover(claims, A));
    expect(e.getStatus()).toBe(422);
    expect((e.getResponse() as { codigo: string }).codigo).toBe('referencia_invalida');
  });
});

describe('ImoveisGestaoService.registrarVenda', () => {
  let aviso: jest.SpyInstance;
  beforeEach(() => { aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); });
  afterEach(() => aviso.mockRestore());

  it('grava o imóvel num run e o cliente num segundo run, sem savepoint', async () => {
    const { tx, db, service, sql } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: A }]).mockResolvedValueOnce([{ id: B }]);

    const out = await service.registrarVenda(claims, A, { cliente_id: B });

    expect(out).toEqual({ imovel_id: A, status_venda: 'VENDIDO', cliente_atualizado: true });
    expect(db.run).toHaveBeenCalledTimes(2);
    expect(db.run.mock.calls[0][0]).toBe(claims);
    expect(db.run.mock.calls[1][0]).toBe(claims);
    expect(sql(0).text).toMatch(/update public\.imoveis set status_venda = 'VENDIDO' where id = \$1::uuid returning id/);
    expect(sql(0).values).toEqual([A]);
    expect(sql(1).text).toMatch(/update public\.clientes set status_funil = 'FECHADO_GANHO' where id = \$1::uuid returning id/);
    expect(sql(1).values).toEqual([B]);
    for (const [q] of tx.$queryRaw.mock.calls) expect((q as Prisma.Sql).text).not.toMatch(/savepoint/i);
  });

  it('falha do cliente não desfaz a venda: responde cliente_atualizado false e loga só o SQLSTATE', async () => {
    const { tx, db, service } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: A }])
      .mockRejectedValueOnce(erroBanco('22P02', 'ERROR: invalid input value for enum status_funil: "Sem etapa"'));

    const out = await service.registrarVenda(claims, A, { cliente_id: B });

    expect(out).toEqual({ imovel_id: A, status_venda: 'VENDIDO', cliente_atualizado: false });
    expect(db.run).toHaveBeenCalledTimes(2);
    expect(aviso).toHaveBeenCalledWith('venda sem cliente atualizado: 22P02');
  });

  it('erro que não é do banco no cliente também é engolido e loga só o nome', async () => {
    const { tx, service } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: A }]).mockRejectedValueOnce(new TypeError('Bia (62) 91111-0002'));
    const out = await service.registrarVenda(claims, A, { cliente_id: B });
    expect(out.cliente_atualizado).toBe(false);
    expect(aviso).toHaveBeenCalledWith('venda sem cliente atualizado: TypeError');
  });

  it('cliente sem linha atualizada responde cliente_atualizado false', async () => {
    const { tx, service } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: A }]).mockResolvedValueOnce([]);
    expect(await service.registrarVenda(claims, A, { cliente_id: B })).toEqual({
      imovel_id: A, status_venda: 'VENDIDO', cliente_atualizado: false,
    });
  });

  it('imóvel inexistente responde 404 e não toca no cliente', async () => {
    const { tx, db, service } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    const e = await falha(service.registrarVenda(claims, A, { cliente_id: B }));
    expect(e.getStatus()).toBe(404);
    expect(e.getResponse()).toEqual({ statusCode: 404, codigo: 'imovel_nao_encontrado', message: 'Imóvel não encontrado.' });
    expect(db.run).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('erro do banco no imóvel sobe traduzido e não toca no cliente', async () => {
    const { tx, db, service } = montar();
    tx.$queryRaw.mockRejectedValueOnce(erroBanco('42501', 'ERROR: permission denied'));
    const e = await falha(service.registrarVenda(claims, A, { cliente_id: B }));
    expect(e.getResponse()).toEqual({
      statusCode: 403, codigo: 'sem_permissao', message: 'Você não tem permissão para alterar este imóvel.',
    });
    expect(db.run).toHaveBeenCalledTimes(1);
  });

  it('sem cliente_id roda um run só', async () => {
    const { tx, db, service } = montar();
    tx.$queryRaw.mockResolvedValue([{ id: A }]);
    const esperado = { imovel_id: A, status_venda: 'VENDIDO', cliente_atualizado: false };
    expect(await service.registrarVenda(claims, A, {})).toEqual(esperado);
    expect(await service.registrarVenda(claims, A, { cliente_id: null })).toEqual(esperado);
    expect(db.run).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(aviso).not.toHaveBeenCalled();
  });
});
