import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConcluirTarefaDto, CriarOportunidadeDto, CriarTarefaDto, ExcluirOportunidadesDto, MoverOportunidadeDto, SalvarEtapasDto } from './crm-funil.dto';
import { CrmFunilService } from './crm-funil.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const CORRETOR = '55555555-5555-4555-8555-555555555555';
const TOKEN = '2026-10-04T12:34:56.123456+00:00';
const claims = { sub: 'u1', role: 'authenticated' };

function montar() {
  const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
  const db = { run: jest.fn(async (_c: unknown, w: (t: typeof tx) => unknown) => w(tx)) };
  return { tx, db, servico: new CrmFunilService(db as never) };
}

const sql = (tx: { $queryRaw: jest.Mock }, i: number) => tx.$queryRaw.mock.calls[i][0] as Prisma.Sql;
/** O texto vem quebrado em linhas; compara com espaços normalizados. */
const texto = (tx: { $queryRaw: jest.Mock }, i: number) => sql(tx, i).text.replace(/\s+/g, ' ').trim();

/** Todo parâmetro ($n) leva cast explícito. */
function confereCasts(tx: { $queryRaw: jest.Mock }) {
  for (const [q] of tx.$queryRaw.mock.calls) expect((q as Prisma.Sql).text).not.toMatch(/\$\d+(?!\d|::)/);
}

function erroBanco(code: string, message: string) {
  return new Prisma.PrismaClientKnownRequestError('x', { code: 'P2010', clientVersion: 'teste', meta: { code, message } });
}

async function erroDe(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('não lançou');
}

/** Igual ao ValidationPipe com transform: instância do DTO, propriedades ausentes ficam undefined. */
const dto = <T extends object>(Classe: new () => T, dados: Partial<T>): T => Object.assign(new Classe(), dados);

describe('CrmFunilService: listagens', () => {
  it('etapas: só ativas, por ordem, nome e id, com teto de lista', async () => {
    const { tx, db, servico } = montar();
    const linha = { id: A, nome: 'Novo lead', ordem: 1, cor: 'slate', tipo: 'ABERTA', ativo: true, created_at: TOKEN };
    tx.$queryRaw.mockResolvedValueOnce([{ linha }]);
    expect(await servico.listarEtapas(claims)).toEqual([linha]);
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    expect(texto(tx, 0)).toBe(
      'select to_jsonb(e) as linha from public.crm_etapas e where e.ativo = true order by e.ordem, e.nome, e.id limit $1::int',
    );
    expect(sql(tx, 0).values).toEqual([1000]);
    confereCasts(tx);
  });

  it('oportunidades: to_jsonb com clientes e imoveis embutidos, por ordem e id, sem mexer no updated_at', async () => {
    const { tx, db, servico } = montar();
    const linha = { id: A, etapa_id: B, valor_estimado: 450000.5, updated_at: TOKEN, clientes: { nome: 'Ana', telefone: '(62) 91111-0002' }, imoveis: null };
    tx.$queryRaw.mockResolvedValueOnce([{ linha }]);
    const out = await servico.listarOportunidades(claims);
    expect(out).toEqual([linha]);
    expect(out[0].updated_at).toBe(TOKEN);
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    const t = texto(tx, 0);
    expect(t).toContain('select to_jsonb(o) || jsonb_build_object(');
    expect(t).toContain("'clientes', (select jsonb_build_object('nome', c.nome, 'telefone', c.telefone) from public.clientes c where c.id = o.cliente_id)");
    expect(t).toContain("'imoveis', (select jsonb_build_object('titulo', i.titulo) from public.imoveis i where i.id = o.imovel_id)");
    expect(t).toContain('from public.crm_oportunidades o order by o.ordem, o.id limit $1::int');
    expect(sql(tx, 0).values).toEqual([1000]);
    confereCasts(tx);
  });

  it('tarefas: to_jsonb com o nome do cliente, data prevista com nulos no fim e id', async () => {
    const { tx, db, servico } = montar();
    const linha = { id: A, titulo: 'Ligar', concluida: false, clientes: { nome: 'Ana' } };
    tx.$queryRaw.mockResolvedValueOnce([{ linha }]);
    expect(await servico.listarTarefas(claims)).toEqual([linha]);
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    const t = texto(tx, 0);
    expect(t).toContain("select to_jsonb(t) || jsonb_build_object('clientes', (select jsonb_build_object('nome', c.nome) from public.clientes c where c.id = t.cliente_id)) as linha");
    expect(t).toContain('from public.crm_tarefas t order by t.data_prevista asc nulls last, t.id limit $1::int');
    expect(sql(tx, 0).values).toEqual([1000]);
    confereCasts(tx);
  });

  it('erro que não é do banco sobe como veio', async () => {
    const { tx, servico } = montar();
    const rede = new Error('rede');
    tx.$queryRaw.mockRejectedValueOnce(rede);
    await expect(servico.listarEtapas(claims)).rejects.toBe(rede);
  });
});

describe('CrmFunilService.salvarEtapas', () => {
  const corpo = () => dto(SalvarEtapasDto, {
    etapas: [
      { id: A, nome: 'Novo lead', cor: 'slate', tipo: 'ABERTA', ordem: 1 },
      { id: B, nome: 'Ganho', cor: 'green', tipo: 'GANHO', ordem: 2 },
    ],
  });

  it('faz um update por etapa num run só e conta só as linhas que mudaram', async () => {
    const { tx, db, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: A }]).mockResolvedValueOnce([]);
    expect(await servico.salvarEtapas(claims, corpo())).toEqual({ atualizadas: 1 });
    expect(db.run).toHaveBeenCalledTimes(1);
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(texto(tx, 0)).toBe(
      'update public.crm_etapas set nome = $1::text, cor = $2::text, tipo = $3::text, ordem = $4::int where id = $5::uuid returning id',
    );
    expect(sql(tx, 0).values).toEqual(['Novo lead', 'slate', 'ABERTA', 1, A]);
    expect(sql(tx, 1).values).toEqual(['Ganho', 'green', 'GANHO', 2, B]);
    confereCasts(tx);
  });

  it('nome repetido (23505) vira 409 com texto próprio', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: A }]).mockRejectedValueOnce(
      erroBanco('23505', 'ERROR: duplicate key value violates unique constraint "uq_crm_etapas_corretor_nome"\nDETAIL: Key (corretor_id, nome)=(x, Ganho) already exists.'),
    );
    const { status, body } = await erroDe(servico.salvarEtapas(claims, corpo()));
    expect(status).toBe(409);
    expect(body).toEqual({ statusCode: 409, codigo: 'registro_repetido', message: 'Já existe uma etapa com este nome.' });
  });
});

describe('CrmFunilService.excluirOportunidades', () => {
  it('apaga com any(uuid[]) e devolve quantas sumiram', async () => {
    const { tx, db, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: A }, { id: B }]);
    expect(await servico.excluirOportunidades(claims, dto(ExcluirOportunidadesDto, { ids: [A, B, C] }))).toEqual({ excluidas: 2 });
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    expect(texto(tx, 0)).toBe('delete from public.crm_oportunidades where id = any($1::uuid[]) returning id');
    expect(sql(tx, 0).values).toEqual([[A, B, C]]);
    confereCasts(tx);
  });

  it('nenhuma linha apagada é sucesso', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await servico.excluirOportunidades(claims, dto(ExcluirOportunidadesDto, { ids: [A] }))).toEqual({ excluidas: 0 });
  });
});

describe('CrmFunilService.moverOportunidade', () => {
  const corpo = () => dto(MoverOportunidadeDto, { etapa_id: B, ordem: 3, updated_at: TOKEN });

  it('confere a etapa e move com o token de concorrência como texto, em ::timestamptz', async () => {
    const { tx, db, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]).mockResolvedValueOnce([{ id: A }]);
    expect(await servico.moverOportunidade(claims, A, corpo())).toEqual({ id: A });
    expect(db.run).toHaveBeenCalledTimes(1);
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    expect(texto(tx, 0)).toBe('select 1 from public.crm_etapas where id = $1::uuid');
    expect(sql(tx, 0).values).toEqual([B]);
    expect(texto(tx, 1)).toBe(
      'update public.crm_oportunidades set etapa_id = $1::uuid, ordem = $2::int where id = $3::uuid and updated_at = $4::timestamptz returning id',
    );
    expect(sql(tx, 1).values).toEqual([B, 3, A, TOKEN]);
    expect(typeof sql(tx, 1).values[3]).toBe('string');
    confereCasts(tx);
  });

  it('etapa invisível ou inexistente: 422 etapa_invalida, sem update', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    const { status, body } = await erroDe(servico.moverOportunidade(claims, A, corpo()));
    expect(status).toBe(422);
    expect(body).toEqual({
      statusCode: 422, codigo: 'etapa_invalida', message: 'A etapa do pipeline não existe mais. Recarregue a página e tente de novo.',
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('nenhuma linha no update: 409 CONFLITO', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]).mockResolvedValueOnce([]);
    const { status, body } = await erroDe(servico.moverOportunidade(claims, A, corpo()));
    expect(status).toBe(409);
    expect(body).toEqual({ statusCode: 409, codigo: 'CONFLITO', message: 'Este negócio foi movido em outro lugar.' });
  });

  it('token mal formado (22007) vira 400 dados_invalidos', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }])
      .mockRejectedValueOnce(erroBanco('22007', 'ERROR: invalid input syntax for type timestamp with time zone: "x"'));
    const { status, body } = await erroDe(servico.moverOportunidade(claims, A, dto(MoverOportunidadeDto, { etapa_id: B, ordem: 0, updated_at: 'x' })));
    expect(status).toBe(400);
    expect(body.codigo).toBe('dados_invalidos');
  });
});

describe('CrmFunilService.criarOportunidade', () => {
  it('get_corretor_id nulo: 403 corretor_nao_identificado e nada mais roda', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: null }]);
    const { status, body } = await erroDe(servico.criarOportunidade(claims, dto(CriarOportunidadeDto, { etapa_id: B, titulo: 'Casa' })));
    expect(status).toBe(403);
    expect(body).toEqual({ statusCode: 403, codigo: 'corretor_nao_identificado', message: 'Não foi possível identificar o corretor.' });
    expect(texto(tx, 0)).toBe('select public.get_corretor_id()::text as id');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('etapa que a conta não enxerga: 422 etapa_invalida', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: CORRETOR }]).mockResolvedValueOnce([]);
    const { status, body } = await erroDe(servico.criarOportunidade(claims, dto(CriarOportunidadeDto, { etapa_id: B, titulo: 'Casa' })));
    expect(status).toBe(422);
    expect(body.codigo).toBe('etapa_invalida');
    expect(texto(tx, 1)).toBe('select 1 from public.crm_etapas where id = $1::uuid');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('cliente de outra conta: 422 cliente_invalido', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: CORRETOR }]).mockResolvedValueOnce([{ '?column?': 1 }]).mockResolvedValueOnce([]);
    const { status, body } = await erroDe(servico.criarOportunidade(claims, dto(CriarOportunidadeDto, { etapa_id: B, titulo: 'Casa', cliente_id: C })));
    expect(status).toBe(422);
    expect(body).toEqual({ statusCode: 422, codigo: 'cliente_invalido', message: 'Cliente não encontrado nesta conta.' });
    expect(texto(tx, 2)).toBe('select 1 from public.clientes where id = $1::uuid and corretor_id = $2::uuid');
    expect(sql(tx, 2).values).toEqual([C, CORRETOR]);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('imóvel de outra conta: 422 imovel_invalido', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: CORRETOR }]).mockResolvedValueOnce([{ '?column?': 1 }]).mockResolvedValueOnce([]);
    const { status, body } = await erroDe(servico.criarOportunidade(claims, dto(CriarOportunidadeDto, { etapa_id: B, titulo: 'Casa', imovel_id: D })));
    expect(status).toBe(422);
    expect(body).toEqual({ statusCode: 422, codigo: 'imovel_invalido', message: 'Imóvel não encontrado nesta conta.' });
    expect(texto(tx, 2)).toBe('select 1 from public.imoveis where id = $1::uuid and corretor_id = $2::uuid');
    expect(sql(tx, 2).values).toEqual([D, CORRETOR]);
  });

  it('grava com o corretor resolvido no servidor e só as colunas presentes (null mantido)', async () => {
    const { tx, db, servico } = montar();
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: CORRETOR }])
      .mockResolvedValueOnce([{ '?column?': 1 }])
      .mockResolvedValueOnce([{ '?column?': 1 }])
      .mockResolvedValueOnce([{ id: A }]);
    const corpo = dto(CriarOportunidadeDto, { etapa_id: B, titulo: 'Casa no Jundiaí', cliente_id: C, imovel_id: null, valor_estimado: 450000.5 });
    expect(await servico.criarOportunidade(claims, corpo)).toEqual({ id: A });
    expect(db.run).toHaveBeenCalledTimes(1);
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4); // imovel_id null não é conferido
    expect(texto(tx, 3)).toBe(
      'insert into public.crm_oportunidades as o (corretor_id, etapa_id, titulo, cliente_id, imovel_id, valor_estimado) '
      + 'select $1::uuid, r.etapa_id, r.titulo, r.cliente_id, r.imovel_id, r.valor_estimado '
      + 'from jsonb_populate_record(null::public.crm_oportunidades, $2::jsonb) r returning o.id',
    );
    const [corretor, json] = sql(tx, 3).values as [string, string];
    expect(corretor).toBe(CORRETOR);
    expect(JSON.parse(json)).toEqual({ etapa_id: B, titulo: 'Casa no Jundiaí', cliente_id: C, imovel_id: null, valor_estimado: 450000.5 });
    expect(json).not.toContain('corretor_id');
    confereCasts(tx);
  });
});

describe('CrmFunilService.criarTarefa', () => {
  it('get_corretor_id nulo: 403', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: null }]);
    const { status, body } = await erroDe(servico.criarTarefa(claims, dto(CriarTarefaDto, { titulo: 'Ligar' })));
    expect(status).toBe(403);
    expect(body.codigo).toBe('corretor_nao_identificado');
  });

  it('negócio de outra conta: 422 oportunidade_invalida', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: CORRETOR }]).mockResolvedValueOnce([]);
    const { status, body } = await erroDe(servico.criarTarefa(claims, dto(CriarTarefaDto, { titulo: 'Ligar', oportunidade_id: A })));
    expect(status).toBe(422);
    expect(body).toEqual({ statusCode: 422, codigo: 'oportunidade_invalida', message: 'Negócio não encontrado nesta conta.' });
    expect(texto(tx, 1)).toBe('select 1 from public.crm_oportunidades where id = $1::uuid and corretor_id = $2::uuid');
    expect(sql(tx, 1).values).toEqual([A, CORRETOR]);
  });

  it('cliente de outra conta: 422 cliente_invalido', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: CORRETOR }]).mockResolvedValueOnce([]);
    const { status, body } = await erroDe(servico.criarTarefa(claims, dto(CriarTarefaDto, { titulo: 'Ligar', cliente_id: C })));
    expect(status).toBe(422);
    expect(body.codigo).toBe('cliente_invalido');
    expect(texto(tx, 1)).toBe('select 1 from public.clientes where id = $1::uuid and corretor_id = $2::uuid');
  });

  it('grava com o corretor do servidor e devolve a linha to_jsonb', async () => {
    const { tx, db, servico } = montar();
    const linha = { id: D, corretor_id: CORRETOR, titulo: 'Ligar', tipo: 'LIGACAO', concluida: false };
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: CORRETOR }])
      .mockResolvedValueOnce([{ '?column?': 1 }])
      .mockResolvedValueOnce([{ linha }]);
    const corpo = dto(CriarTarefaDto, { titulo: 'Ligar', tipo: 'LIGACAO', oportunidade_id: A });
    expect(await servico.criarTarefa(claims, corpo)).toEqual(linha);
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    expect(texto(tx, 2)).toBe(
      'insert into public.crm_tarefas as x (corretor_id, titulo, tipo, oportunidade_id) '
      + 'select $1::uuid, r.titulo, r.tipo, r.oportunidade_id '
      + 'from jsonb_populate_record(null::public.crm_tarefas, $2::jsonb) r returning to_jsonb(x) as linha',
    );
    const [corretor, json] = sql(tx, 2).values as [string, string];
    expect(corretor).toBe(CORRETOR);
    expect(JSON.parse(json)).toEqual({ titulo: 'Ligar', tipo: 'LIGACAO', oportunidade_id: A });
    confereCasts(tx);
  });
});

describe('CrmFunilService.concluirTarefa', () => {
  it('marca com o relógio do servidor e devolve a linha', async () => {
    const { tx, db, servico } = montar();
    const linha = { id: A, concluida: true, concluida_em: TOKEN };
    tx.$queryRaw.mockResolvedValueOnce([{ linha }]);
    expect(await servico.concluirTarefa(claims, A, dto(ConcluirTarefaDto, { concluida: true }))).toEqual(linha);
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    expect(texto(tx, 0)).toBe(
      'update public.crm_tarefas t set concluida = $1::boolean, concluida_em = case when $2::boolean then now() else null end '
      + 'where t.id = $3::uuid returning to_jsonb(t) as linha',
    );
    expect(sql(tx, 0).values).toEqual([true, true, A]);
    confereCasts(tx);
  });

  it('nenhuma linha: 404 tarefa_nao_encontrada', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    const { status, body } = await erroDe(servico.concluirTarefa(claims, A, dto(ConcluirTarefaDto, { concluida: false })));
    expect(status).toBe(404);
    expect(body).toEqual({ statusCode: 404, codigo: 'tarefa_nao_encontrada', message: 'Tarefa não encontrada.' });
  });

  it('erro de RLS (42501) vira 403 sem_permissao', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockRejectedValueOnce(erroBanco('42501', 'ERROR: new row violates row-level security policy for table "crm_tarefas"'));
    const { status, body } = await erroDe(servico.concluirTarefa(claims, A, dto(ConcluirTarefaDto, { concluida: true })));
    expect(status).toBe(403);
    expect(body.codigo).toBe('sem_permissao');
  });
});
