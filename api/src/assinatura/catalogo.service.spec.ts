import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LIMITE_CAMPANHA, LIMITE_LISTA } from './assinatura.dto';
import { CatalogoRepo } from './catalogo.repo';
import { CatalogoService } from './catalogo.service';

const tx = { $queryRaw: jest.fn(), $executeRawUnsafe: jest.fn() };
const repo = { comoAnon: jest.fn(async (w: (t: unknown) => unknown) => w(tx)) };
const db = { run: jest.fn() };
const servico = new CatalogoService(repo as unknown as CatalogoRepo);

const consulta = () => tx.$queryRaw.mock.calls[0][0] as Prisma.Sql;

beforeEach(() => {
  tx.$queryRaw.mockReset();
  tx.$executeRawUnsafe.mockReset();
  repo.comoAnon.mockClear();
  db.run.mockClear();
});

describe('CatalogoService (rotas públicas)', () => {
  it('C1: só planos ativos, ordenado por display_order e id, com LIMITE_LISTA', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { code: 'pro' } }]);
    expect(await servico.listarPlanos()).toEqual([{ code: 'pro' }]);
    const sql = consulta();
    expect(sql.text).toContain('to_jsonb(p) as linha');
    expect(sql.text).toContain('p.active is true');
    expect(sql.text).toContain('order by p.display_order, p.id limit $1::int');
    expect(sql.values).toEqual([LIMITE_LISTA]);
    expect(repo.comoAnon).toHaveBeenCalledTimes(1);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('C2: sem filtro, com LIMITE_LISTA', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { feature_key: 'max_imoveis' } }]);
    expect(await servico.listarEntitlements()).toEqual([{ feature_key: 'max_imoveis' }]);
    const sql = consulta();
    expect(sql.text).toContain('to_jsonb(e) as linha');
    expect(sql.text).not.toContain('where');
    expect(sql.values).toEqual([LIMITE_LISTA]);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('C3: zero campanhas ativas devolve null', async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await servico.campanhaAtiva()).toBeNull();
    expect(consulta().values).toEqual([LIMITE_CAMPANHA]);
  });

  it('C3: uma campanha devolve a linha', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { name: 'fundadores' } }]);
    expect(await servico.campanhaAtiva()).toEqual({ name: 'fundadores' });
  });

  it('C3: duas campanhas ativas viram 409 campanha_ambigua', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { name: 'a' } }, { linha: { name: 'b' } }]);
    expect.assertions(3);
    try {
      await servico.campanhaAtiva();
    } catch (e) {
      const erro = e as HttpException;
      expect(erro.getStatus()).toBe(409);
      const corpo = erro.getResponse() as Record<string, unknown>;
      expect(corpo.codigo).toBe('campanha_ambigua');
      expect(corpo.message).toBe('Há mais de uma campanha ativa. Avise o suporte.');
    }
  });

  it('as três rotas nunca usam o TenantDb', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await servico.listarPlanos();
    await servico.listarEntitlements();
    await servico.campanhaAtiva();
    expect(repo.comoAnon).toHaveBeenCalledTimes(3);
    expect(db.run).not.toHaveBeenCalled();
  });
});

describe('CatalogoRepo', () => {
  it('roda `set local role anon` antes do trabalho, dentro da transação', async () => {
    const ordem: string[] = [];
    const cliente = {
      $executeRawUnsafe: jest.fn(async (sql: string) => { ordem.push(sql); return 0; }),
      $queryRaw: jest.fn(async () => { ordem.push('select'); return []; }),
    };
    const prisma = { $transaction: jest.fn(async (w: (t: unknown) => unknown) => w(cliente)) };
    const real = new CatalogoRepo(prisma as never);
    await real.comoAnon((t) => (t as unknown as typeof cliente).$queryRaw());
    expect(ordem).toEqual(['set local role anon', 'select']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
