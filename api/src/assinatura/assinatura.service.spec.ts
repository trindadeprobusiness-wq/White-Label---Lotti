import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { AssinaturaService } from './assinatura.service';
import { CHAVES_COTA, LIMITE_LISTA } from './assinatura.dto';
import { traduzirErroAssinatura } from './assinatura.erros';

const claims = { sub: 'u1', role: 'authenticated' } as SupabaseClaims;
const CORRETOR = '11111111-1111-4111-8111-111111111111';

const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
const db = { run: jest.fn(async (_c: SupabaseClaims, w: (t: unknown) => unknown) => w(tx)) };
const servico = new AssinaturaService(db as unknown as TenantDb);

/** `.text` tem os parâmetros numerados; `.sql` troca tudo por `?` e não serve para conferir cast. */
const consulta = (i = 0) => tx.$queryRaw.mock.calls[i][0] as Prisma.Sql;

function erroDoBanco(code: string, message: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('x', {
    code: 'P2010', clientVersion: 'teste', meta: { code, message: `ERROR: ${message}` },
  });
}

async function corpoDoErro(p: Promise<unknown>): Promise<{ status: number; corpo: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), corpo: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('era esperado um HttpException');
}

beforeEach(() => {
  tx.$queryRaw.mockReset();
  tx.$executeRaw.mockReset();
  db.run.mockClear();
});

describe('AssinaturaService', () => {
  it('A1: to_jsonb com o plano embutido, uma linha só, e as claims chegam ao run', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: 'a', plan: { code: 'pro' } } }]);
    expect(await servico.atual(claims)).toEqual({ id: 'a', plan: { code: 'pro' } });
    const t = consulta().text;
    expect(t).toContain("to_jsonb(s) || jsonb_build_object('plan', to_jsonb(p))");
    expect(t).toContain('order by s.created_at desc, s.id limit 1');
    expect(db.run.mock.calls[0][0]).toBe(claims);
  });

  it('A1: sem assinatura visível devolve null', async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await servico.atual(claims)).toBeNull();
  });

  it('A2: três contagens com count(*)::int, período no fuso por parâmetro e nenhum filtro por corretor', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{
      period_start: '2026-10-01', period_end: '2026-10-31', contadores: [{ feature_key: 'ai_assistant_monthly' }],
      max_imoveis: 2, max_contratos_locacao: 1, max_fachadas: 0,
    }]);
    const uso = await servico.uso(claims);
    expect(uso).toEqual({
      period_start: '2026-10-01', period_end: '2026-10-31', contadores: [{ feature_key: 'ai_assistant_monthly' }],
      ativos: { max_imoveis: 2, max_contratos_locacao: 1, max_fachadas: 0 },
    });
    const sql = consulta();
    expect(sql.text).toContain("date_trunc('month', now() at time zone $1::text)");
    expect(sql.values).toEqual(['America/Sao_Paulo']);
    expect(sql.text.match(/count\(\*\)::int/g)).toHaveLength(3);
    // As contagens têm de ser do próprio corretor: as policies de leitura por organização são
    // permissivas e sem este filtro o consumo somaria dado de outra conta.
    expect(sql.text.match(/corretor_id = public\.get_corretor_id\(\)/g)).toHaveLength(3);
    expect(db.run.mock.calls[0][0]).toBe(claims);
  });

  it('A2: BILLING_USAGE_TIMEZONE troca o fuso', async () => {
    const antes = process.env.BILLING_USAGE_TIMEZONE;
    process.env.BILLING_USAGE_TIMEZONE = 'UTC';
    tx.$queryRaw.mockResolvedValueOnce([{ period_start: 'x', period_end: 'y', contadores: [], max_imoveis: 0, max_contratos_locacao: 0, max_fachadas: 0 }]);
    await servico.uso(claims);
    expect(consulta().values).toEqual(['UTC']);
    if (antes === undefined) delete process.env.BILLING_USAGE_TIMEZONE;
    else process.env.BILLING_USAGE_TIMEZONE = antes;
  });

  it('A3: só os addons ativos, com limit $n::int e LIMITE_LISTA nos valores', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { addon_code: 'extra_leads_50' } }]);
    expect(await servico.addons(claims)).toEqual([{ addon_code: 'extra_leads_50' }]);
    const sql = consulta();
    expect(sql.text).toContain('to_jsonb(a) as linha');
    expect(sql.text).toContain("a.status = 'active'");
    expect(sql.text).toContain('limit $1::int');
    expect(sql.values).toEqual([LIMITE_LISTA]);
  });

  it('A4: a função recebe public.get_corretor_id(), nunca um parâmetro do cliente', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ sem_limite: true }]);
    expect(await servico.contaAntiga(claims)).toEqual({ sem_limite: true });
    const sql = consulta();
    expect(sql.text).toContain('public.conta_antiga_sem_limite(public.get_corretor_id())');
    expect(sql.values).toEqual([]);
  });

  it('A4: sem corretor responde false (igual ao return false da função)', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ sem_limite: null }]);
    expect(await servico.contaAntiga(claims)).toEqual({ sem_limite: false });
  });

  it('A5: passa get_corretor_id() à checar_cota e devolve a cota crua', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: CORRETOR }])
      .mockResolvedValueOnce([{ linha: { permitido: true, usado: 3, limite: 10, ilimitado: false, habilitado: true } }]);
    expect(await servico.cota(claims, 'max_imoveis')).toEqual({
      permitido: true, usado: 3, limite: 10, ilimitado: false, habilitado: true,
    });
    const sql = consulta(1);
    expect(sql.text).toContain('public.checar_cota(public.get_corretor_id(), $1::text)');
    expect(sql.text).toContain('to_jsonb(c) as linha');
    expect(sql.values).toEqual(['max_imoveis']);
  });

  it('A5: ilimitado chega com limite null', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: CORRETOR }])
      .mockResolvedValueOnce([{ linha: { permitido: true, usado: 0, limite: null, ilimitado: true, habilitado: true } }]);
    expect(await servico.cota(claims, 'max_fachadas')).toEqual({
      permitido: true, usado: 0, limite: null, ilimitado: true, habilitado: true,
    });
  });

  it('A5: get_corretor_id() null responde 403 corretor_nao_identificado e não chama checar_cota', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: null }]);
    const r = await corpoDoErro(servico.cota(claims, 'max_imoveis'));
    expect(r.status).toBe(403);
    expect(r.corpo.codigo).toBe('corretor_nao_identificado');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('CHAVES_COTA cobre as chaves do front', () => {
    expect(CHAVES_COTA).toContain('max_imoveis');
    expect(CHAVES_COTA).toHaveLength(20);
  });
});

describe('traduzirErroAssinatura', () => {
  const traduz = (code: string, message: string, padrao?: string) =>
    corpoDoErro(Promise.reject(erroDoBanco(code, message)).catch((e) => traduzirErroAssinatura(e, padrao ? { padrao } : {})));

  it.each([
    ['perfil de onboarding não encontrado', 404, 'perfil_nao_encontrado'],
    ['onboarding não encontrado', 404, 'onboarding_nao_encontrado'],
    ['organização indisponível', 403, 'corretor_nao_identificado'],
    ['título, cidade e valor são obrigatórios', 422, 'dados_incompletos'],
    ['nome e telefone ou e-mail são obrigatórios', 422, 'dados_incompletos'],
    ['cliente inválido', 422, 'cliente_invalido'],
    ['imóvel inválido', 422, 'imovel_invalido'],
    ['pipeline não configurado', 422, 'pipeline_nao_configurado'],
    ['responsável inválido', 422, 'responsavel_invalido'],
    ['ação de onboarding inválida', 400, 'acao_invalida'],
    ['evento de onboarding inválido', 400, 'evento_invalido'],
    ['somente gestores podem convidar', 403, 'sem_permissao_convite'],
    ['e-mail inválido', 422, 'email_invalido'],
    ['papel inválido', 422, 'papel_invalido'],
    ['convite inválido ou expirado', 404, 'convite_invalido'],
    ['este convite pertence a outro e-mail', 403, 'convite_de_outro_email'],
  ])('P0001 %s vira %i %s', async (mensagem, status, codigo) => {
    const r = await traduz('P0001', mensagem as string);
    expect(r.status).toBe(status);
    expect(r.corpo.codigo).toBe(codigo);
    expect(typeof r.corpo.message).toBe('string');
  });

  it('PLAN_LIMIT_REACHED:max_imoveis vira 402 com recurso', async () => {
    const r = await traduz('P0001', 'PLAN_LIMIT_REACHED:max_imoveis');
    expect(r.status).toBe(402);
    expect(r.corpo).toMatchObject({ codigo: 'PLAN_LIMIT_REACHED', recurso: 'max_imoveis' });
    expect(r.corpo.message).toContain('Limite de imóveis atingido');
  });

  it('PLAN_LIMIT_REACHED de outro recurso usa o texto genérico', async () => {
    const r = await traduz('P0001', 'PLAN_LIMIT_REACHED:max_fachadas');
    expect(r.corpo).toMatchObject({ codigo: 'PLAN_LIMIT_REACHED', recurso: 'max_fachadas' });
    expect(r.corpo.message).toBe('Limite do plano atingido. Acesse Plano e Assinatura.');
  });

  it('forbidden vira 403', async () => {
    const r = await traduz('P0001', 'forbidden');
    expect(r.status).toBe(403);
    expect(r.corpo.codigo).toBe('forbidden');
  });

  it('P0001 fora da tabela vira 422 regra_do_banco sem o texto do Postgres', async () => {
    const r = await traduz('P0001', 'alguma regra nova do banco', 'Não foi possível salvar o onboarding.');
    expect(r.status).toBe(422);
    expect(r.corpo.codigo).toBe('regra_do_banco');
    expect(r.corpo.message).toBe('Não foi possível salvar o onboarding.');
    expect(JSON.stringify(r.corpo)).not.toContain('alguma regra nova do banco');
  });

  it.each([
    ['42501', 403, 'sem_permissao'],
    ['42883', 503, 'onboarding_indisponivel'],
    ['42P01', 503, 'onboarding_indisponivel'],
    ['42703', 503, 'onboarding_indisponivel'],
    ['23503', 422, 'referencia_invalida'],
    ['23001', 422, 'referencia_invalida'],
    ['23505', 409, 'registro_repetido'],
    ['22P02', 400, 'dados_invalidos'],
    ['23502', 400, 'dados_invalidos'],
    ['23514', 400, 'dados_invalidos'],
  ])('%s vira %i %s', async (code, status, codigo) => {
    const r = await traduz(code as string, 'texto do banco');
    expect(r.status).toBe(status);
    expect(r.corpo.codigo).toBe(codigo);
  });

  it('SQLSTATE desconhecido sobe como veio', () => {
    const e = erroDoBanco('XX000', 'pânico');
    expect(() => traduzirErroAssinatura(e)).toThrow(e);
  });

  it('erro que não é do banco sobe como veio', () => {
    const e = new Error('rede');
    expect(() => traduzirErroAssinatura(e)).toThrow(e);
  });
});
