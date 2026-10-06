import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Answers, scoreDiagnostic } from './diagnostico';
import { DiagnosticoRepo } from './diagnostico.repo';
import { DiagnosticoService } from './diagnostico.service';

// O arquivo compartilhado das Edge Functions fica fora de rootDir: entra por require, que o tsc não
// adiciona ao programa (senão daria TS6059) e o ts-jest transforma em runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const compartilhado = require('../../../../supabase/functions/_shared/commercial-diagnostic') as {
  scoreDiagnostic: typeof scoreDiagnostic;
};

const SESSAO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RESPOSTAS: Record<string, unknown> = {
  profile: 'Imobiliária',
  team: '6–15',
  sources: ['Indicação', 'Anúncios pagos'],
  acquisition: 'Os dois',
  leads: '101–250',
  properties: '51–100',
  ad_spend: 'R$ 3–10 mil',
  response: 'Às vezes demora ou fica sem resposta',
  followup: 'Muitos contatos ficam sem retorno',
  tools: ['Planilhas', 'WhatsApp'],
  gaps: ['Poucos leads', 'Demora no atendimento'],
  priority: 'Responder e converter melhor',
  timing: 'Agora',
  decision: 'Eu decido',
};

function montar() {
  const prisma = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
  prisma.$queryRaw.mockResolvedValue([{ ok: true }]);
  prisma.$executeRaw.mockResolvedValue(1);
  const repo = new DiagnosticoRepo(prisma as never);
  return { prisma, repo, servico: new DiagnosticoService(repo) };
}

const sql = (m: jest.Mock, i = 0) => m.mock.calls[i][0] as Prisma.Sql;
const texto = (m: jest.Mock, i = 0) => sql(m, i).text.replace(/\s+/g, ' ').trim();

function erroBanco(code: string, message: string) {
  return new Prisma.PrismaClientKnownRequestError('x', { code: 'P2010', clientVersion: 'teste', meta: { code, message } });
}

async function erroDe(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), ...(e.getResponse() as Record<string, unknown>) };
    throw e;
  }
  throw new Error('não lançou');
}

const submit = (extra: Record<string, unknown> = {}) => ({
  action: 'submit', session_id: SESSAO, consent: true, name: 'Ana Souza', phone: '11999999999',
  answers: RESPOSTAS, ...extra,
});

const salvo = process.env.PUBLIC_RATE_LIMIT_SECRET;
beforeEach(() => { process.env.PUBLIC_RATE_LIMIT_SECRET = 'segredo-de-teste'; });
afterAll(() => {
  if (salvo === undefined) delete process.env.PUBLIC_RATE_LIMIT_SECRET;
  else process.env.PUBLIC_RATE_LIMIT_SECRET = salvo;
});

describe('paridade do porte', () => {
  it('scoreDiagnostic do porte é igual ao do arquivo compartilhado', () => {
    const respostas = RESPOSTAS as Answers;
    expect(scoreDiagnostic(respostas)).toEqual(compartilhado.scoreDiagnostic(respostas));
  });
});

describe('D1 submit', () => {
  it('grava a linha, os eventos e devolve o resultado', async () => {
    const { prisma, servico } = montar();
    const r = await servico.receber(submit());
    expect(r.success).toBe(true);
    expect(r.result?.dominant_problem).toBe(scoreDiagnostic(RESPOSTAS as Answers).dominant_problem);
    expect(texto(prisma.$executeRaw, 0)).toContain('insert into public.commercial_diagnostics');
    expect(sql(prisma.$executeRaw, 0).values[2]).toBe('5511999999999');
    expect(sql(prisma.$executeRaw, 1).values).toEqual([SESSAO, 'diagnostic_completed', null]);
  });

  it('formulário sem e-mail, cidade e empresa (o front manda "") passa, como na Edge; e-mail preenchido errado não', async () => {
    const { prisma, servico } = montar();
    const r = await servico.receber(submit({ email: '', city: '', company: '', attribution: { landing_page: 'x' } }));
    expect(r.success).toBe(true);
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(await erroDe(servico.receber(submit({ email: 'sem-arroba' })))).toMatchObject({ status: 400 });
  });

  it('telefone com 55 também grava 55 + local', async () => {
    const { prisma, servico } = montar();
    await servico.receber(submit({ phone: '+55 (11) 99999-9999' }));
    expect(sql(prisma.$executeRaw, 0).values[2]).toBe('5511999999999');
  });

  it('telefone inválido dá 400 contato_invalido e não grava', async () => {
    const { prisma, servico } = montar();
    expect(await erroDe(servico.receber(submit({ phone: '1234' })))).toMatchObject({ status: 400, codigo: 'contato_invalido' });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('consent false dá 400 e não grava', async () => {
    const { prisma, servico } = montar();
    expect(await erroDe(servico.receber(submit({ consent: false })))).toMatchObject({
      status: 400, codigo: 'consentimento_ausente',
    });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('answers manipuladas dão 400 respostas_invalidas e nenhum insert', async () => {
    const { prisma, servico } = montar();
    const r = await erroDe(servico.receber(submit({ answers: { ...RESPOSTAS, profile: 'Administrador' } })));
    expect(r).toMatchObject({ status: 400, codigo: 'respostas_invalidas' });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('attribution fora da allowlist é descartada', async () => {
    const { prisma, servico } = montar();
    await servico.receber(submit({ attribution: { utm_source: 'google', is_admin: 'true', referrer: 'x'.repeat(400) } }));
    expect(sql(prisma.$executeRaw, 0).values[7]).toEqual({ utm_source: 'google' });
  });

  it('23505 de session_id é engolido e os eventos de conclusão não são inseridos', async () => {
    const { prisma, servico } = montar();
    prisma.$executeRaw.mockRejectedValueOnce(erroBanco('23505', 'ERROR: duplicate key value violates unique constraint "commercial_diagnostics_session_id_key"'));
    expect(await servico.receber(submit())).toMatchObject({ success: true });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('commercial_fit_score >= 60 insere qualified_lead', async () => {
    const { prisma, servico } = montar();
    const r = await servico.receber(submit());
    expect(r.result!.commercial_fit_score).toBeGreaterThanOrEqual(60);
    expect(sql(prisma.$executeRaw, 2).values).toEqual([SESSAO, 'qualified_lead', null]);
  });

  it('limite de lead negado dá 429 e com erro dá 503', async () => {
    const negado = montar();
    negado.prisma.$queryRaw.mockResolvedValue([{ ok: false }]);
    expect(await erroDe(negado.servico.receber(submit()))).toMatchObject({ status: 429, codigo: 'muitas_tentativas' });

    const quebrado = montar();
    quebrado.prisma.$queryRaw.mockRejectedValue(erroBanco('42P01', 'ERROR: relation does not exist'));
    expect(await erroDe(quebrado.servico.receber(submit()))).toMatchObject({
      status: 503, codigo: 'diagnostico_nao_configurado',
    });
  });

  it('sem PUBLIC_RATE_LIMIT_SECRET responde 503', async () => {
    delete process.env.PUBLIC_RATE_LIMIT_SECRET;
    const { servico } = montar();
    expect(await erroDe(servico.receber(submit()))).toMatchObject({ status: 503, codigo: 'diagnostico_nao_configurado' });
  });
});

describe('D1 event', () => {
  it('grava o evento com o escopo e o teto de hoje', async () => {
    const { prisma, servico } = montar();
    expect(await servico.receber({ action: 'event', session_id: SESSAO, event: 'profile_selected', step: 'profile' }))
      .toEqual({ success: true });
    const limite = sql(prisma.$queryRaw, 0);
    expect(limite.text).toContain('public.consume_public_request_limit');
    expect(limite.values[0]).toBe('commercial-diagnostic-event');
    expect(limite.values[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(limite.values.slice(2)).toEqual([50, 3600]);
    expect(sql(prisma.$executeRaw, 0).values).toEqual([SESSAO, 'profile_selected', 'profile']);
  });

  it('step desconhecido dá 400 evento_invalido', async () => {
    const { servico } = montar();
    expect(await erroDe(servico.receber({ action: 'event', session_id: SESSAO, event: 'cta_clicked', step: 'xpto' })))
      .toMatchObject({ status: 400, codigo: 'evento_invalido' });
  });

  it('cta_clicked carimba cta_clicked_at com now()', async () => {
    const { prisma, servico } = montar();
    await servico.receber({ action: 'event', session_id: SESSAO, event: 'cta_clicked' });
    expect(texto(prisma.$executeRaw, 1)).toContain('set cta_clicked_at = now()');
  });

  it('limite negado dá 429', async () => {
    const { prisma, servico } = montar();
    prisma.$queryRaw.mockResolvedValue([{ ok: false }]);
    expect(await erroDe(servico.receber({ action: 'event', session_id: SESSAO, event: 'cta_clicked' })))
      .toMatchObject({ status: 429, codigo: 'muitas_tentativas' });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('evento fora da lista e action inválida dão 400', async () => {
    const { servico } = montar();
    expect(await erroDe(servico.receber({ action: 'event', session_id: SESSAO, event: 'qualified_lead' })))
      .toMatchObject({ status: 400, codigo: 'dados_invalidos' });
    expect(await erroDe(servico.receber({ action: 'outra', session_id: SESSAO })))
      .toMatchObject({ status: 400, codigo: 'acao_invalida' });
  });
});
