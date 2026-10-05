import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CriarFachadaDto, EditarFachadaDto } from './fachadas.dto';
import { FachadasService, montarCampos, presentes } from './fachadas.service';

const FACHADA = '11111111-1111-4111-8111-111111111111';
const IMOVEL = '22222222-2222-4222-8222-222222222222';
const CORRETOR = '55555555-5555-4555-8555-555555555555';
const claims = { sub: 'u1', role: 'authenticated' };

export function montar() {
  const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
  const db = { run: jest.fn(async (_c: unknown, w: (t: typeof tx) => unknown) => w(tx)) };
  return { tx, db };
}

export type TxFalso = ReturnType<typeof montar>['tx'];
export const sql = (tx: TxFalso, i: number) => tx.$queryRaw.mock.calls[i][0] as Prisma.Sql;
export const texto = (tx: TxFalso, i: number) => sql(tx, i).text.replace(/\s+/g, ' ').trim();

/** Nenhum $n sem cast explícito em nenhuma consulta do módulo (contrato §0.2). */
export function confereCasts(tx: TxFalso): void {
  for (const [q] of [...tx.$queryRaw.mock.calls, ...tx.$executeRaw.mock.calls]) {
    expect((q as Prisma.Sql).text).not.toMatch(/\$\d+(?!\d|::)/);
  }
}

export async function erroDe(p: Promise<unknown> | (() => unknown)): Promise<{ status: number; corpo: Record<string, unknown> }> {
  try {
    await (typeof p === 'function' ? Promise.resolve().then(p) : p);
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), corpo: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('não lançou');
}

export const dto = <T extends object>(Classe: new () => T, dados: Partial<T>): T => Object.assign(new Classe(), dados);

const criar = (extra: Partial<CriarFachadaDto> = {}) => dto(CriarFachadaDto, {
  imovel_id: IMOVEL, tipo_negocio: 'VENDA', template_id: 'venda-classica', cta_principal: 'WHATSAPP',
  modo_conversao: false, ...extra,
});

describe('presentes e montarCampos', () => {
  it('presentes só mantém as colunas da constante que estão definidas', () => {
    expect(presentes({ a: 1, b: undefined, c: null, d: 9 }, ['a', 'b', 'c'] as const)).toEqual(['a', 'c']);
  });

  it('montarCampos usa só os nomes da constante e manda os valores num JSON', () => {
    const { json, alvo, origem } = montarCampos({ ativo: false, logo_url: null }, ['ativo', 'logo_url']);
    expect(json).toBe('{"ativo":false,"logo_url":null}');
    expect(alvo.text ?? String(alvo)).toContain('ativo, logo_url');
    expect(origem.text ?? String(origem)).toContain('r.ativo, r.logo_url');
  });
});

describe('FachadasService F1 listar', () => {
  it('to_jsonb com embeds de imóvel e corretor, created_at desc com desempate por id e teto 1000', async () => {
    const { tx, db } = montar();
    const servico = new FachadasService(db as never);
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: FACHADA } }]);
    expect(await servico.listar(claims)).toEqual([{ id: FACHADA }]);
    const t = texto(tx, 0);
    expect(t).toContain('select to_jsonb(f) || jsonb_build_object(');
    expect(t).toContain("'imovel', (select jsonb_build_object('titulo', i.titulo, 'tipo', i.tipo, 'valor', i.valor,");
    expect(t).toContain("'corretor', (select jsonb_build_object('nome', c.nome, 'telefone', c.telefone, 'email', c.email,");
    expect(t).toContain('from public.fachadas f order by f.created_at desc, f.id limit $1::int');
    expect(sql(tx, 0).values).toEqual([1000]);
    confereCasts(tx);
  });

  it('não filtra por corretor no SQL: quem decide é o RLS', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await new FachadasService(db as never).listar(claims);
    expect(texto(tx, 0)).not.toContain('get_corretor_id');
    expect(texto(tx, 0)).not.toMatch(/where f\./);
  });

  it('o embed traz exatamente as colunas de hoje, nem uma a mais', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await new FachadasService(db as never).listar(claims);
    const t = texto(tx, 0);
    for (const c of ['titulo', 'tipo', 'valor', 'area_m2', 'dormitorios', 'garagem', 'endereco', 'bairro', 'cidade', 'descricao']) {
      expect(t).toContain(`'${c}', i.${c}`);
    }
    for (const c of ['nome', 'telefone', 'email', 'creci', 'foto_url', 'razao_social']) expect(t).toContain(`'${c}', c.${c}`);
    // Colunas que o embed autenticado NÃO tem (são só da rota pública).
    expect(t).not.toContain('i.banheiros');
    expect(t).not.toContain('i.estado');
  });
});

describe('FachadasService F2 criar', () => {
  it('resolve corretor, resolve a foto principal e insere por jsonb_populate_record', async () => {
    const { tx, db } = montar();
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: CORRETOR }])
      .mockResolvedValueOnce([{ ok: true }])
      .mockResolvedValueOnce([{ arquivo_url: 'https://host/foto.jpg' }])
      .mockResolvedValueOnce([{ linha: { id: FACHADA } }]);
    expect(await new FachadasService(db as never).criar(claims, criar())).toEqual({ id: FACHADA });

    expect(texto(tx, 0)).toBe('select public.get_corretor_id()::text as id');
    // O imóvel da placa tem de ser visível para quem cria: o RLS de INSERT em fachadas confere só o corretor.
    expect(texto(tx, 1)).toBe('select true as ok from public.imoveis where id = $1::uuid limit 1');
    expect(sql(tx, 1).values).toEqual([IMOVEL]);
    expect(texto(tx, 2)).toBe(
      'select arquivo_url from public.imovel_fotos where imovel_id = $1::uuid order by principal desc, ordem asc nulls last, id limit 1',
    );
    expect(sql(tx, 2).values).toEqual([IMOVEL]);

    const t = texto(tx, 3);
    expect(t).toContain('insert into public.fachadas as x (corretor_id, foto_principal_url, imovel_id, tipo_negocio, template_id, cta_principal, modo_conversao)');
    expect(t).toContain('select $1::uuid, $2::text, r.imovel_id, r.tipo_negocio, r.template_id, r.cta_principal, r.modo_conversao');
    expect(t).toContain('from jsonb_populate_record(null::public.fachadas, $3::jsonb) r returning to_jsonb(x) as linha');
    expect(sql(tx, 3).values[0]).toBe(CORRETOR);
    expect(sql(tx, 3).values[1]).toBe('https://host/foto.jpg');
    confereCasts(tx);
  });

  it('sem foto no imóvel grava null', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: CORRETOR }]).mockResolvedValueOnce([{ ok: true }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([{ linha: {} }]);
    await new FachadasService(db as never).criar(claims, criar());
    expect(sql(tx, 3).values[1]).toBeNull();
  });

  it('com foto_principal_url no corpo não consulta imovel_fotos', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: CORRETOR }]).mockResolvedValueOnce([{ ok: true }])
      .mockResolvedValueOnce([{ linha: {} }]);
    await new FachadasService(db as never).criar(claims, criar({ foto_principal_url: 'https://host/escolhida.jpg' }));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(texto(tx, 2)).toContain('insert into public.fachadas');
    expect(sql(tx, 2).values[1]).toBe('https://host/escolhida.jpg');
    // foto_principal_url entra fixo, nunca pelo alvo do jsonb_populate_record.
    expect(texto(tx, 2)).toContain('(corretor_id, foto_principal_url, imovel_id,');
    expect(texto(tx, 2)).not.toContain('r.foto_principal_url');
  });

  it('a API nunca manda id: o insert não cita a coluna id', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: CORRETOR }]).mockResolvedValueOnce([{ ok: true }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([{ linha: {} }]);
    await new FachadasService(db as never).criar(claims, criar());
    expect(texto(tx, 3)).not.toMatch(/\(\s*id\b|,\s*id\s*[,)]/);
    expect(JSON.parse(sql(tx, 3).values[2] as string)).not.toHaveProperty('id');
  });

  it('o corretor vem de get_corretor_id(); null dá 403 corretor_nao_identificado', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: null }]);
    expect(await erroDe(new FachadasService(db as never).criar(claims, criar()))).toEqual({
      status: 403,
      corpo: { statusCode: 403, codigo: 'corretor_nao_identificado', message: 'Não foi possível identificar o corretor.' },
    });
  });

  it('chave undefined não entra no alvo; null entra e grava NULL', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: CORRETOR }]).mockResolvedValueOnce([{ ok: true }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([{ linha: {} }]);
    const corpo = criar({ mensagem_whatsapp: undefined, logo_url: null as unknown as string });
    await new FachadasService(db as never).criar(claims, corpo);
    const t = texto(tx, 3);
    expect(t).not.toContain('mensagem_whatsapp');
    expect(t).toContain('logo_url');
    expect(JSON.parse(sql(tx, 3).values[2] as string).logo_url).toBeNull();
  });

  it('imóvel que o RLS não mostra dá 422 referencia_invalida e NADA é inserido', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: CORRETOR }]).mockResolvedValueOnce([]);
    expect(await erroDe(new FachadasService(db as never).criar(claims, criar()))).toEqual({
      status: 422,
      corpo: {
        statusCode: 422,
        codigo: 'referencia_invalida',
        message: 'Este imóvel não está disponível para a sua conta. Recarregue a página e tente de novo.',
      },
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.calls.map((c) => (c[0] as Prisma.Sql).text).join(' ')).not.toContain('insert into');
  });
});

describe('FachadasService F3 editar', () => {
  it('update com as colunas presentes e retorno da linha', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: FACHADA, ativo: false } }]);
    const r = await new FachadasService(db as never).editar(claims, FACHADA, dto(EditarFachadaDto, { cta_principal: 'AGENDAR_VISITA', ativo: false }));
    expect(r).toEqual({ id: FACHADA, ativo: false });
    const t = texto(tx, 0);
    expect(t).toContain('update public.fachadas t set (cta_principal, ativo) = (select r.cta_principal, r.ativo from jsonb_populate_record(null::public.fachadas, $1::jsonb) r)');
    expect(t).toContain('where t.id = $2::uuid returning to_jsonb(t) as linha');
    expect(sql(tx, 0).values).toEqual(['{"cta_principal":"AGENDAR_VISITA","ativo":false}', FACHADA]);
    confereCasts(tx);
  });

  it('corpo vazio dá 400 nada_para_atualizar sem tocar o banco', async () => {
    const { tx, db } = montar();
    expect(await erroDe(() => new FachadasService(db as never).editar(claims, FACHADA, dto(EditarFachadaDto, {})))).toEqual({
      status: 400, corpo: { statusCode: 400, codigo: 'nada_para_atualizar', message: 'Nada para atualizar.' },
    });
    expect(db.run).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('sem linha (fachada de outro corretor) dá 404 nao_encontrado', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await erroDe(new FachadasService(db as never).editar(claims, FACHADA, dto(EditarFachadaDto, { ativo: true })))).toMatchObject({
      status: 404, corpo: { codigo: 'nao_encontrado', message: 'Fachada não encontrada.' },
    });
  });

  it('imovel_id nunca é coluna de escrita em F3', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: {} }]);
    const corpo = Object.assign(dto(EditarFachadaDto, { ativo: true }), { imovel_id: IMOVEL });
    await new FachadasService(db as never).editar(claims, FACHADA, corpo);
    expect(texto(tx, 0)).not.toContain('imovel_id');
    expect(JSON.parse(sql(tx, 0).values[0] as string)).toEqual({ ativo: true });
  });
});

describe('FachadasService F4 remover', () => {
  it('delete por id com returning e 204 (sem corpo)', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: FACHADA }]);
    expect(await new FachadasService(db as never).remover(claims, FACHADA)).toBeUndefined();
    expect(texto(tx, 0)).toBe('delete from public.fachadas where id = $1::uuid returning id::text as id');
    expect(sql(tx, 0).values).toEqual([FACHADA]);
    confereCasts(tx);
  });

  it('sem linha dá 404 nao_encontrado', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await erroDe(new FachadasService(db as never).remover(claims, FACHADA))).toMatchObject({
      status: 404, corpo: { codigo: 'nao_encontrado' },
    });
  });
});

describe('o erro do banco é traduzido fora do run', () => {
  it('PLAN_LIMIT_REACHED no insert vira 402', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: CORRETOR }]).mockResolvedValueOnce([{ ok: true }])
      .mockResolvedValueOnce([]).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('x', {
        code: 'P2010', clientVersion: 't', meta: { code: 'P0001', message: 'ERROR: PLAN_LIMIT_REACHED:max_fachadas' },
      }),
    );
    expect(await erroDe(new FachadasService(db as never).criar(claims, criar()))).toMatchObject({
      status: 402, corpo: { codigo: 'PLAN_LIMIT_REACHED', recurso: 'max_fachadas' },
    });
  });

  it('42501 numa rota autenticada vira 403, nunca 404', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('x', {
      code: 'P2010', clientVersion: 't', meta: { code: '42501', message: 'ERROR: permission denied' },
    }));
    expect(await erroDe(new FachadasService(db as never).listar(claims))).toMatchObject({
      status: 403, corpo: { codigo: 'sem_permissao' },
    });
  });
});
