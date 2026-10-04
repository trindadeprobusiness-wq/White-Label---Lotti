import { Prisma } from '@prisma/client';
import { buildWhere, ImoveisService } from './imoveis.service';

describe('buildWhere', () => {
  it('sempre filtra imóveis ativos', () => {
    expect(buildWhere({})).toEqual({ ativo: true });
  });

  it('busca cidade e bairro sem diferenciar maiúsculas', () => {
    expect(buildWhere({ cidade: 'Anápolis', bairro: 'Jundiaí' })).toEqual({
      ativo: true,
      cidade: { contains: 'Anápolis', mode: 'insensitive' },
      bairro: { contains: 'Jundiaí', mode: 'insensitive' },
    });
  });

  it('venda também traz imóvel marcado como AMBOS; AMBOS não filtra', () => {
    expect(buildWhere({ finalidade: 'VENDA' }).finalidade).toEqual({ in: ['VENDA', 'AMBOS'] });
    expect(buildWhere({ finalidade: 'AMBOS' }).finalidade).toBeUndefined();
  });

  it('monta faixa de valor e mínimo de dormitórios', () => {
    expect(buildWhere({ valorMin: 200000, valorMax: 450000, dormitoriosMin: 2, tipo: 'APARTAMENTO' })).toEqual({
      ativo: true,
      tipo: 'APARTAMENTO',
      valor: { gte: 200000, lte: 450000 },
      dormitorios: { gte: 2 },
    });
  });
});

describe('ImoveisService.buscar', () => {
  it('consulta dentro do TenantDb, sem colunas do proprietário, e converte decimais', async () => {
    const findMany = jest.fn(async (_query: any) => [
      { id: 'i1', titulo: 'Apto Jundiaí', tipo: 'APARTAMENTO', finalidade: 'VENDA', valor: new Prisma.Decimal('350000.00'),
        cidade: 'Anápolis', bairro: 'Jundiaí', dormitorios: 3, suites: 1, garagem: 2, areaM2: new Prisma.Decimal('82.5') },
    ]);
    const tenantDb = { run: jest.fn(async (_claims: unknown, work: (tx: unknown) => unknown) => work({ imovel: { findMany } })) };
    const service = new ImoveisService(tenantDb as never);
    const claims = { sub: 'u1', role: 'authenticated' };

    const result = await service.buscar(claims, { cidade: 'Anápolis', limit: 5 });

    expect(tenantDb.run).toHaveBeenCalledWith(claims, expect.any(Function));
    const query = findMany.mock.calls[0][0];
    expect(query.take).toBe(5);
    expect(query.orderBy).toEqual({ valor: 'asc' });
    expect(Object.keys(query.select).sort()).toEqual(
      ['areaM2', 'bairro', 'cidade', 'dormitorios', 'finalidade', 'garagem', 'id', 'suites', 'tipo', 'titulo', 'valor'],
    );
    expect(result).toEqual([
      { id: 'i1', titulo: 'Apto Jundiaí', tipo: 'APARTAMENTO', finalidade: 'VENDA', valor: 350000,
        cidade: 'Anápolis', bairro: 'Jundiaí', dormitorios: 3, suites: 1, garagem: 2, areaM2: 82.5 },
    ]);
  });

  it('usa 20 resultados quando o limite não vem', async () => {
    const findMany = jest.fn(async (_query: any) => []);
    const tenantDb = { run: jest.fn(async (_c: unknown, work: (tx: unknown) => unknown) => work({ imovel: { findMany } })) };
    await new ImoveisService(tenantDb as never).buscar({ sub: 'u1', role: 'authenticated' }, {});
    expect(findMany.mock.calls[0][0].take).toBe(20);
  });
});
