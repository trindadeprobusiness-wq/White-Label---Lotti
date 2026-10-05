import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AtribuirDto, CliqueDto } from '../parceiros.dto';
import { ParceirosPublicoRepo } from './parceiros-publico.repo';
import { ParceirosPublicoService } from './parceiros-publico.service';

const SLUG = 'parceiro-teste';
const VISITANTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OUTRO_VISITANTE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER = '11111111-1111-4111-8111-111111111111';
const LINK = '22222222-2222-4222-8222-222222222222';
const PARCEIRO = '33333333-3333-4333-8333-333333333333';
const ATRIBUICAO = '44444444-4444-4444-8444-444444444444';
const CORRETOR = '55555555-5555-4555-8555-555555555555';
const claims = { sub: USER, role: 'authenticated', email: 'cliente@x.com' };

function montar() {
  const prisma = { $queryRaw: jest.fn(), $executeRaw: jest.fn(async () => 1) };
  const repo = new ParceirosPublicoRepo(prisma as never);
  const servico = new ParceirosPublicoService(repo);
  return { prisma, repo, servico };
}

const dto = <T extends object>(Classe: new () => T, dados: Partial<T>): T => Object.assign(new Classe(), dados);
const clique = (extra: Partial<CliqueDto> = {}) => dto(CliqueDto, { slug: SLUG, visitante_id: VISITANTE, ...extra });
const sql = (m: jest.Mock, i: number) => m.mock.calls[i][0] as Prisma.Sql;
const texto = (m: jest.Mock, i: number) => sql(m, i).text.replace(/\s+/g, ' ').trim();
const LINHA_LINK = { link_id: LINK, parceiro_id: PARCEIRO, nome: 'Parceira Ana', janela_atribuicao_dias: 90 };

const VARIAVEIS = ['PARCEIRO_ORIGENS_PERMITIDAS', 'IP_HASH_SALT'];
const salvas: Record<string, string | undefined> = {};
beforeAll(() => { for (const v of VARIAVEIS) { salvas[v] = process.env[v]; delete process.env[v]; } });
afterAll(() => { for (const v of VARIAVEIS) { if (salvas[v] === undefined) delete process.env[v]; else process.env[v] = salvas[v]; } });
afterEach(() => { for (const v of VARIAVEIS) delete process.env[v]; });

async function erroDe(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), ...(e.getResponse() as Record<string, unknown>) };
    throw e;
  }
  throw new Error('não lançou');
}

describe('P1 clique', () => {
  it('a resolução exige link ativo, não revogado e parceiro ativo', async () => {
    const { prisma, servico } = montar();
    prisma.$queryRaw.mockResolvedValueOnce([LINHA_LINK]);
    await servico.registrarClique(clique(), {});
    const t = texto(prisma.$queryRaw, 0);
    expect(t).toContain('l.ativo');
    expect(t).toContain('l.revogado_em is null');
    expect(t).toContain("p.status = 'ativo'");
    expect(sql(prisma.$queryRaw, 0).values).toEqual([SLUG]);
  });

  it('sem linha devolve { ok: false } e não insere nada', async () => {
    const { prisma, servico } = montar();
    prisma.$queryRaw.mockResolvedValueOnce([]);
    expect(await servico.registrarClique(clique(), {})).toEqual({ ok: false });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('a atribuição usa on conflict do nothing, make_interval e a janela da coluna', async () => {
    const { prisma, servico } = montar();
    prisma.$queryRaw.mockResolvedValueOnce([LINHA_LINK]);
    await servico.registrarClique(clique(), {});
    const t = texto(prisma.$executeRaw, 1);
    expect(t).toContain('on conflict (visitante_id) do nothing');
    expect(t).toContain('make_interval(days =>');
    expect(sql(prisma.$executeRaw, 1).values).toEqual([PARCEIRO, LINK, VISITANTE, 90, 90]);

    prisma.$queryRaw.mockResolvedValueOnce([{ ...LINHA_LINK, janela_atribuicao_dias: 30 }]);
    await servico.registrarClique(clique(), {});
    expect(sql(prisma.$executeRaw, 3).values).toEqual([PARCEIRO, LINK, VISITANTE, 30, 30]);
  });

  it('o clique guarda utm limpo, user agent e referer truncados', async () => {
    process.env.IP_HASH_SALT = 'salt-de-teste';
    const { prisma, servico } = montar();
    prisma.$queryRaw.mockResolvedValueOnce([LINHA_LINK]);
    await servico.registrarClique(clique({ utm: { utm_source: 'google', is_admin: 'true' }, referer: 'https://lp' }), {
      'user-agent': 'a'.repeat(500), 'x-forwarded-for': '198.51.100.7, 10.0.0.1',
    });
    const valores = sql(prisma.$executeRaw, 0).values;
    expect(valores[0]).toBe(LINK);
    expect(valores[3]).toMatch(/^[0-9a-f]{64}$/);
    expect(valores[4]).toBe('a'.repeat(400));
    expect(valores[5]).toBe('https://lp');
    expect(valores[6]).toEqual({ utm_source: 'google' });
  });

  it('sem IP_HASH_SALT o ip_hash vai null', async () => {
    const { prisma, servico } = montar();
    prisma.$queryRaw.mockResolvedValueOnce([LINHA_LINK]);
    await servico.registrarClique(clique(), { 'x-forwarded-for': '198.51.100.7' });
    expect(sql(prisma.$executeRaw, 0).values[3]).toBeNull();
  });

  it('erro no clique ou na atribuição não impede a resposta ok', async () => {
    const { prisma, servico } = montar();
    prisma.$queryRaw.mockResolvedValueOnce([LINHA_LINK]);
    prisma.$executeRaw.mockRejectedValueOnce(new Error('clique')).mockRejectedValueOnce(new Error('atribuicao'));
    expect(await servico.registrarClique(clique(), {})).toEqual({ ok: true, parceiro_nome: 'Parceira Ana' });
  });

  it('a resposta tem só ok e parceiro_nome', async () => {
    const { prisma, servico } = montar();
    prisma.$queryRaw.mockResolvedValueOnce([LINHA_LINK]);
    const r = await servico.registrarClique(clique(), {});
    expect(Object.keys(r).sort()).toEqual(['ok', 'parceiro_nome']);
  });

  it('Origin fora da lista dá 403; lista vazia aceita', async () => {
    process.env.PARCEIRO_ORIGENS_PERMITIDAS = 'https://lotti.com.br, https://app.lotti.com.br';
    const { prisma, servico } = montar();
    expect(await erroDe(servico.registrarClique(clique(), { origin: 'https://mal.com' }))).toMatchObject({
      status: 403, codigo: 'origem_nao_permitida',
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    prisma.$queryRaw.mockResolvedValueOnce([LINHA_LINK]);
    expect(await servico.registrarClique(clique(), { origin: 'https://lotti.com.br' })).toMatchObject({ ok: true });

    delete process.env.PARCEIRO_ORIGENS_PERMITIDAS;
    const outro = montar();
    outro.prisma.$queryRaw.mockResolvedValueOnce([LINHA_LINK]);
    expect(await outro.servico.registrarClique(clique(), { origin: 'https://mal.com' })).toMatchObject({ ok: true });
  });
});

describe('T1 atribuição', () => {
  const pendente = {
    id: ATRIBUICAO, expira_em: new Date(Date.now() + 86_400_000), status: 'pendente', user_id: null,
    parceiro_id: PARCEIRO, nome: 'Parceira Ana', parceiro_status: 'ativo',
    parceiro_email: 'parceiro@x.com', parceiro_user_id: null,
  };
  const atribuir = dto(AtribuirDto, { visitante_id: VISITANTE });

  it('já atribuído devolve ja_atribuido sem update', async () => {
    const { prisma, servico } = montar();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: ATRIBUICAO }]);
    expect(await servico.reivindicarAtribuicao(claims, atribuir)).toEqual({ ok: true, ja_atribuido: true });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(sql(prisma.$queryRaw, 0).values).toEqual([USER]);
  });

  it('converte com user_id de claims.sub, ignorando o corpo', async () => {
    const { prisma, servico } = montar();
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([pendente])
      .mockResolvedValueOnce([{ id: CORRETOR, email: 'cliente@x.com' }])
      .mockResolvedValueOnce([{ id: ATRIBUICAO }]);
    const r = await servico.reivindicarAtribuicao(claims, dto(AtribuirDto, { visitante_id: OUTRO_VISITANTE }));
    expect(r).toEqual({ ok: true, parceiro_nome: 'Parceira Ana' });
    const update = sql(prisma.$queryRaw, 3);
    expect(update.text.replace(/\s+/g, ' ')).toContain("and status = 'pendente' and user_id is null");
    expect(update.values).toEqual([USER, CORRETOR, ATRIBUICAO]);
    expect(sql(prisma.$queryRaw, 1).values).toEqual([OUTRO_VISITANTE]);
  });

  it('sem atribuição, de outro dono ou não pendente devolve { ok: false }', async () => {
    for (const linhas of [[], [{ ...pendente, user_id: 'outro' }], [{ ...pendente, status: 'convertida' }]]) {
      const { prisma, servico } = montar();
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce(linhas);
      expect(await servico.reivindicarAtribuicao(claims, atribuir)).toEqual({ ok: false });
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    }
  });

  it('cada motivo de invalidez grava invalidada com o motivo', async () => {
    const casos: Array<[Record<string, unknown>, string]> = [
      [{ parceiro_status: 'suspenso' }, 'parceiro com status "suspenso"'],
      [{ expira_em: new Date('2020-01-01T00:00:00Z') }, 'janela de atribuição expirada'],
      [{ parceiro_user_id: USER }, 'autoindicação: o parceiro é o próprio usuário'],
      [{ parceiro_email: 'cliente@x.com' }, 'autoindicação: mesmo e-mail do parceiro'],
    ];
    for (const [extra, motivo] of casos) {
      const { prisma, servico } = montar();
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ ...pendente, ...extra }])
        .mockResolvedValueOnce([{ id: CORRETOR, email: 'cliente@x.com' }]);
      expect(await servico.reivindicarAtribuicao(claims, atribuir)).toEqual({ ok: false });
      expect(texto(prisma.$executeRaw, 0)).toContain("status = 'invalidada'");
      expect(sql(prisma.$executeRaw, 0).values).toEqual([motivo, ATRIBUICAO]);
    }
  });

  it('conversão sem linha afetada devolve { ok: false }', async () => {
    const { prisma, servico } = montar();
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([pendente])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    expect(await servico.reivindicarAtribuicao(claims, atribuir)).toEqual({ ok: false });
  });

  it('erro inesperado nunca quebra o login', async () => {
    const { prisma, servico } = montar();
    prisma.$queryRaw.mockRejectedValueOnce(new Error('banco fora'));
    expect(await servico.reivindicarAtribuicao(claims, atribuir)).toEqual({ ok: false });
  });
});
