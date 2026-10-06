import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ImoveisFotosService } from './imoveis-fotos.service';
import { ImoveisVendaEventoService, montarPayloadVenda } from './imoveis-venda-evento.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const claims = { sub: 'u1', role: 'authenticated' };
const URL_FOTO = 'https://api.exemplo/api/arquivos/publico/foto/x.jpg';

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
  const prisma = { $queryRaw: jest.fn() };
  const service = new ImoveisFotosService(db as never);
  const evento = new ImoveisVendaEventoService(db as never, prisma as never);
  const sql = (i: number) => tx.$queryRaw.mock.calls[i][0] as Prisma.Sql;
  const exec = (i: number) => tx.$executeRaw.mock.calls[i][0] as Prisma.Sql;
  return { tx, db, prisma, service, evento, sql, exec };
}

describe('ImoveisFotosService.listar', () => {
  it('ordem, created_at e id, com o teto, pelo TenantDb', async () => {
    const { tx, db, service, sql } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: C } }]);
    expect(await service.listar(claims, A)).toEqual([{ id: C }]);
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    expect(sql(0).text).toMatch(/select to_jsonb\(f\) as linha from public\.imovel_fotos f\s+where f\.imovel_id = \$1::uuid/);
    expect(sql(0).text).toMatch(/order by f\.ordem asc nulls last, f\.created_at asc nulls last, f\.id\s+limit \$2::int/);
    expect(sql(0).values).toEqual([A, 1000]);
  });
});

describe('ImoveisFotosService.criar', () => {
  const corpo = { arquivo_path: `${A}/1_casa.jpg`, arquivo_url: URL_FOTO };

  it('primeira foto: ordem 0 e principal sem pedir, sem desmarcar ninguém', async () => {
    const { tx, service, sql } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ ok: 1 }]).mockResolvedValueOnce([{ ordem: 0 }]).mockResolvedValueOnce([{ linha: { id: C } }]);
    expect(await service.criar(claims, A, corpo)).toEqual({ id: C });
    expect(sql(1).text).toMatch(/case when count\(\*\) = 0 then 0 else coalesce\(max\(ordem\), 0\) \+ 1 end/);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(sql(2).text).toMatch(/insert into public\.imovel_fotos as f \(imovel_id, arquivo_url, arquivo_path, principal, ordem\)/);
    expect(sql(2).values).toEqual([A, URL_FOTO, `${A}/1_casa.jpg`, true, 0]);
  });

  it('foto seguinte: próxima ordem e não principal', async () => {
    const { tx, service, sql } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ ok: 1 }]).mockResolvedValueOnce([{ ordem: 3 }]).mockResolvedValueOnce([{ linha: { id: C } }]);
    await service.criar(claims, A, corpo);
    expect(sql(2).values).toEqual([A, URL_FOTO, `${A}/1_casa.jpg`, false, 3]);
  });

  it('principal pedida desmarca as outras do imóvel antes de inserir', async () => {
    const { tx, service, sql, exec } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ ok: 1 }]).mockResolvedValueOnce([{ ordem: 2 }]).mockResolvedValueOnce([{ linha: { id: C } }]);
    await service.criar(claims, A, { ...corpo, principal: true });
    expect(exec(0).text).toMatch(/update public\.imovel_fotos set principal = false where imovel_id = \$1::uuid/);
    expect(sql(2).values).toEqual([A, URL_FOTO, `${A}/1_casa.jpg`, true, 2]);
  });

  it('caminho de outra pasta responde 400 sem tocar no banco', async () => {
    const { db, service } = montar();
    const e = await falha(service.criar(claims, A, { ...corpo, arquivo_path: `${B}/1_casa.jpg` }));
    expect(e.getStatus()).toBe(400);
    expect((e.getResponse() as { codigo: string }).codigo).toBe('caminho_invalido');
    expect(db.run).not.toHaveBeenCalled();
  });

  it('imóvel que a conta não vê responde 404; RLS recusando vira 403', async () => {
    const um = montar();
    um.tx.$queryRaw.mockResolvedValueOnce([]);
    expect((await falha(um.service.criar(claims, A, corpo))).getStatus()).toBe(404);
    const dois = montar();
    dois.tx.$queryRaw.mockResolvedValueOnce([{ ok: 1 }]).mockResolvedValueOnce([{ ordem: 0 }])
      .mockRejectedValueOnce(erroBanco('42501', 'ERROR: new row violates row-level security policy for table "imovel_fotos"'));
    const e = await falha(dois.service.criar(claims, A, corpo));
    expect(e.getResponse()).toEqual({
      statusCode: 403, codigo: 'sem_permissao', message: 'Você não tem permissão para alterar as fotos deste imóvel.',
    });
  });
});

describe('ImoveisFotosService.remover, reordenar, definirPrincipal e resumo', () => {
  it('remover apaga por id; zero linhas vira 404', async () => {
    const { tx, service, sql } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: C }]).mockResolvedValueOnce([]);
    await expect(service.remover(claims, C)).resolves.toBeUndefined();
    expect(sql(0).text).toMatch(/delete from public\.imovel_fotos where id = \$1::uuid returning id/);
    const e = await falha(service.remover(claims, C));
    expect(e.getStatus()).toBe(404);
    expect((e.getResponse() as { codigo: string }).codigo).toBe('foto_nao_encontrada');
  });

  it('reordenar grava a posição numa instrução, só nas fotos do imóvel', async () => {
    const { tx, service, sql } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: C }, { id: B }]);
    expect(await service.reordenar(claims, A, { ids: [C, B] })).toEqual({ atualizadas: 2 });
    expect(sql(0).text).toMatch(/update public\.imovel_fotos f set ordem = \(o\.n - 1\)::int\s+from unnest\(\$1::uuid\[\]\) with ordinality as o\(id, n\)/);
    expect(sql(0).text).toMatch(/where f\.id = o\.id and f\.imovel_id = \$2::uuid/);
    expect(sql(0).values).toEqual([[C, B], A]);
  });

  it('definirPrincipal confere a foto no imóvel e troca a principal numa instrução', async () => {
    const { tx, service, exec } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ ok: 1 }]);
    expect(await service.definirPrincipal(claims, A, C)).toEqual({ imovel_id: A, foto_id: C });
    expect(exec(0).text).toMatch(/update public\.imovel_fotos set principal = \(id = \$1::uuid\) where imovel_id = \$2::uuid/);
    expect(exec(0).values).toEqual([C, A]);
  });

  it('definirPrincipal com foto de outro imóvel responde 404 sem desmarcar nada', async () => {
    const { tx, service } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect((await falha(service.definirPrincipal(claims, A, C))).getStatus()).toBe(404);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('resumo devolve imovel_id, arquivo_url e principal na ordem de criação', async () => {
    const { tx, service, sql } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { imovel_id: A, arquivo_url: URL_FOTO, principal: true } }]);
    expect(await service.resumo(claims, { imovel_ids: [A, B] })).toEqual([{ imovel_id: A, arquivo_url: URL_FOTO, principal: true }]);
    expect(sql(0).text).toMatch(/where f\.imovel_id = any\(\$1::uuid\[\]\)\s+order by f\.created_at asc nulls last, f\.id\s+limit \$2::int/);
    expect(sql(0).values).toEqual([[A, B], 10000]);
  });
});

describe('ImoveisVendaEventoService', () => {
  const imovel = { id: A, titulo: 'Casa', corretor_id: B, valor: 450000, status_venda: 'VENDIDO', tracking_data: { fbclid: 'i' } };
  const cliente = { nome: 'Ana Maria Souza', email: 'ana@x.com', telefone: '(62) 99999-0001', tracking_data: { fbclid: 'c' } };

  it('payload igual ao do front: nome partido, telefone só dígitos, tracking do cliente antes do imóvel', () => {
    expect(montarPayloadVenda(imovel, cliente, 500000, 1_700_000_000_123)).toEqual({
      event_name: 'Purchase',
      event_time: 1_700_000_000,
      event_id: `venda_${A}_1700000000123`,
      value: 500000,
      currency: 'BRL',
      customer: { first_name: 'Ana', last_name: 'Maria Souza', email: 'ana@x.com', phone: '62999990001' },
      tracking: { fbclid: 'c' },
      metadata: { imovel_id: A, imovel_titulo: 'Casa', corretor_id: B },
    });
  });

  it('sem cliente e sem valor: comprador desconhecido, valor do imóvel e tracking do imóvel', () => {
    const p = montarPayloadVenda(imovel, null, undefined, 1000);
    expect(p.customer).toEqual({ first_name: 'Comprador', last_name: 'Desconhecido', email: '', phone: '' });
    expect(p.value).toBe(450000);
    expect(p.tracking).toEqual({ fbclid: 'i' });
  });

  it('lê pelo TenantDb e grava na fila pelo PrismaService', async () => {
    const { tx, db, prisma, evento } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: imovel }]).mockResolvedValueOnce([{ linha: cliente }]);
    prisma.$queryRaw.mockResolvedValueOnce([{ id: C }]);
    expect(await evento.enfileirar(claims, A, { valor: 1, cliente_id: B })).toEqual({ enfileirado: true, id: C });
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    const insert = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(insert.text).toMatch(/insert into public\.webhook_logs \(provider, event_type, payload, status\)\s+values \('UTMIFY', 'SALE_PURCHASE', \$1::jsonb, 'PENDING'\)/);
    expect(JSON.parse(insert.values[0] as string)).toMatchObject({ value: 1, customer: { first_name: 'Ana' } });
  });

  it('imóvel não vendido responde 409 e não grava; imóvel invisível responde 404', async () => {
    const um = montar();
    um.tx.$queryRaw.mockResolvedValueOnce([{ linha: { ...imovel, status_venda: 'DISPONIVEL' } }]);
    const e = await falha(um.evento.enfileirar(claims, A, {}));
    expect(e.getStatus()).toBe(409);
    expect(um.prisma.$queryRaw).not.toHaveBeenCalled();
    const dois = montar();
    dois.tx.$queryRaw.mockResolvedValueOnce([]);
    expect((await falha(dois.evento.enfileirar(claims, A, {}))).getStatus()).toBe(404);
    expect(dois.prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
