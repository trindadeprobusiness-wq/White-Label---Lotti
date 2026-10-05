import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AnalisarContratoIaDto, GerarContratoIaDto } from './contratos-ia.dto';
import { ContratosIaService } from './contratos-ia.service';

const CORRETOR = '55555555-5555-4555-8555-555555555555';
const RESERVA = '77777777-7777-4777-8777-777777777777';
const claims = { sub: 'u1', role: 'authenticated' };

function montar(reserva: Record<string, unknown> = { allowed: true, reservation_id: RESERVA, used: 1, quota: 10 }) {
  const tx = { $queryRaw: jest.fn(async () => [{ id: CORRETOR }]) };
  const db = { run: jest.fn(async (_c: unknown, w: (t: typeof tx) => unknown) => w(tx)) };
  const prisma = { $queryRaw: jest.fn(async () => [reserva]), $executeRaw: jest.fn(async () => 1) };
  const servico = new ContratosIaService(db as never, prisma as never);
  const fetchImpl = jest.fn();
  servico.fetchImpl = fetchImpl as never;
  return { tx, db, prisma, servico, fetchImpl };
}

const finalizacoes = (prisma: { $executeRaw: jest.Mock }) =>
  prisma.$executeRaw.mock.calls.map(([q]) => {
    const s = q as Prisma.Sql;
    expect(s.text).toBe('select public.finish_contract_quota($1::uuid, $2::boolean)');
    return s.values;
  });

const respostaChat = (conteudo: unknown, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content: conteudo } }] }), { status });
const respostaConteudo = (texto: string, status = 200) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: texto }] } }] }), { status });

const pedido = (extra: Record<string, unknown> = {}): GerarContratoIaDto => Object.assign(new GerarContratoIaDto(), {
  tipo: 'Locação Residencial',
  cliente: { nome: 'Ana <b>Silva</b>' },
  imovel: { endereco: 'Rua 1', bairro: 'Centro', cidade: 'Anápolis' },
  detalhes: { valor: 1500, prazo_meses: 30, dia_vencimento: 10 },
  ...extra,
});
const arquivo = (modo?: 'central'): AnalisarContratoIaDto => Object.assign(new AnalisarContratoIaDto(), { fileBase64: 'QUJD', mimeType: 'application/pdf', modo });

async function erroDe(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('não lançou');
}

describe('ContratosIaService', () => {
  const ambiente = { ...process.env };
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'chave-falsa';
    delete process.env.LOTTI_AI_FAST_MODEL;
  });
  afterAll(() => {
    process.env = ambiente;
  });

  it('sem GEMINI_API_KEY → 503 e nenhuma reserva', async () => {
    process.env.GEMINI_API_KEY = '  ';
    const { prisma, servico, fetchImpl } = montar();
    expect(await erroDe(servico.gerar(claims, pedido()))).toEqual({
      status: 503, body: { statusCode: 503, codigo: 'ia_indisponivel', message: 'A IA de contratos está indisponível no momento.' },
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allowed=false → 402 com recurso, usado e limite, sem fetch', async () => {
    const { prisma, servico, fetchImpl } = montar({ allowed: false, reservation_id: null, used: 10, quota: 10 });
    expect(await erroDe(servico.analisar(claims, arquivo()))).toEqual({
      status: 402,
      body: { statusCode: 402, codigo: 'PLAN_LIMIT_REACHED', message: 'Limite mensal de operações com IA atingido.', recurso: 'ai_contracts_monthly', usado: 10, limite: 10 },
    });
    const reserva = (prisma.$queryRaw.mock.calls as unknown as Prisma.Sql[][])[0][0];
    expect(reserva.text.replace(/\s+/g, ' ').trim()).toBe(
      'select allowed, reservation_id::text as reservation_id, used, quota from public.reserve_contract_quota($1::uuid)');
    expect(reserva.values).toEqual([CORRETOR]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('gerar com sucesso: chat OpenAI-compatible, temperature 0.2, finish(true) uma vez; sem proprietario/corretor → 200 (D14)', async () => {
    const { prisma, servico, fetchImpl } = montar();
    fetchImpl.mockResolvedValueOnce(respostaChat('MINUTA PARA REVISÃO JURÍDICA'));
    const r = await servico.gerar(claims, pedido());
    expect(r).toEqual(expect.objectContaining({
      contrato: 'MINUTA PARA REVISÃO JURÍDICA', modelo_ia: 'gemini-2.5-flash', prompt_version: 'contracts.generation@2026-08-20.1',
    }));
    expect(typeof r.tempo_geracao_ms).toBe('number');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer chave-falsa');
    const corpo = JSON.parse(init.body);
    expect(corpo.temperature).toBe(0.2);
    expect(corpo.model).toBe('gemini-2.5-flash');
    expect(corpo.messages[0].content).toContain('MINUTA PARA REVISÃO JURÍDICA');
    expect(corpo.messages[1].content).toContain('<external_data kind="contract_request">');
    expect(corpo.messages[1].content).toContain('Nome: Ana bSilva/b');
    expect(corpo.messages[1].content).toContain('(mil, quinhentos reais)');
    expect(finalizacoes(prisma)).toEqual([[RESERVA, true]]);
  });

  it.each([[429, 429, 'ia_limite_requisicoes'], [402, 402, 'ia_sem_creditos'], [500, 502, 'ia_falhou']])(
    'provedor %i → %i %s e finish(false)', async (doProvedor, http, codigo) => {
      const { prisma, servico, fetchImpl } = montar();
      fetchImpl.mockResolvedValueOnce(new Response('{}', { status: doProvedor }));
      const r = await erroDe(servico.gerar(claims, pedido()));
      expect(r.status).toBe(http);
      expect(r.body.codigo).toBe(codigo);
      expect(finalizacoes(prisma)).toEqual([[RESERVA, false]]);
    });

  it('timeout/rede → 502 ia_falhou; resposta sem conteúdo → 502 ia_resposta_invalida; ambos liberam a cota', async () => {
    const { prisma, servico, fetchImpl } = montar();
    fetchImpl.mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    expect((await erroDe(servico.gerar(claims, pedido()))).body).toEqual({ statusCode: 502, codigo: 'ia_falhou', message: 'Erro ao gerar contrato. Tente novamente.' });
    fetchImpl.mockResolvedValueOnce(respostaChat(null));
    expect((await erroDe(servico.gerar(claims, pedido()))).body).toEqual({ statusCode: 502, codigo: 'ia_resposta_invalida', message: 'Resposta da IA inválida' });
    expect(finalizacoes(prisma)).toEqual([[RESERVA, false], [RESERVA, false]]);
  });

  it('pedido inválido → 400 pedido_invalido antes de reservar', async () => {
    const { prisma, servico } = montar();
    expect(await erroDe(servico.gerar(claims, pedido({ detalhes: { valor: '10' } })))).toEqual({
      status: 400, body: { statusCode: 400, codigo: 'pedido_invalido', message: 'Valor inválido' },
    });
    expect((await erroDe(servico.gerar(claims, pedido({ cliente: {} })))).body.message).toBe('Nome do cliente inválido');
    expect((await erroDe(servico.gerar(claims, pedido({ imovel: { endereco: 'x'.repeat(501) } })))).body.message).toBe('Endereço do imóvel inválido');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('erro no finish(true) só é logado: a resposta segue', async () => {
    const { prisma, servico, fetchImpl } = montar();
    prisma.$executeRaw.mockRejectedValueOnce(new Error('falhou'));
    fetchImpl.mockResolvedValueOnce(respostaChat('ok'));
    expect((await servico.gerar(claims, pedido())).contrato).toBe('ok');
    expect(finalizacoes(prisma)).toEqual([[RESERVA, true]]);
  });

  it('analisar: generateContent com ?key=, thinkingBudget 0 e modelo de LOTTI_AI_FAST_MODEL; extração sanitizada', async () => {
    process.env.LOTTI_AI_FAST_MODEL = 'gemini-teste';
    const { prisma, servico, fetchImpl } = montar();
    fetchImpl.mockResolvedValueOnce(respostaConteudo('```json\n{"valor_aluguel":"R$ 1.234,56","data_inicio":"21/08/2026"}\n```'));
    const r = await servico.analisar(claims, arquivo());
    expect(r.dados).toEqual(expect.objectContaining({ valor_aluguel: 1234.56, data_inicio: '2026-08-21' }));
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-teste:generateContent?key=chave-falsa');
    const corpo = JSON.parse(init.body);
    expect(corpo.generationConfig).toEqual({ response_mime_type: 'application/json', temperature: 0.1, thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 8192 });
    expect(corpo.contents[0].parts[1]).toEqual({ inline_data: { mime_type: 'application/pdf', data: 'QUJD' } });
    expect(corpo.contents[0].parts[0].text).toContain('Versão do prompt: contracts.extraction@2026-08-20.1');
    expect(finalizacoes(prisma)).toEqual([[RESERVA, true]]);
  });

  it("analisar central aceita 'OUTRO'; JSON ilegível → 502 ia_sem_estrutura; provedor não ok → 502 ia_falhou", async () => {
    const { prisma, servico, fetchImpl } = montar();
    fetchImpl.mockResolvedValueOnce(respostaConteudo('{"tipo":"outro"}'));
    expect(((await servico.analisar(claims, arquivo('central'))).dados as { tipo: string }).tipo).toBe('OUTRO');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).contents[0].parts[0].text).toContain('compra e venda, exclusividade de captação');
    fetchImpl.mockResolvedValueOnce(respostaConteudo('sem json'));
    expect((await erroDe(servico.analisar(claims, arquivo()))).body).toEqual({
      statusCode: 502, codigo: 'ia_sem_estrutura', message: 'A IA não conseguiu estruturar os dados do contrato',
    });
    fetchImpl.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    expect((await erroDe(servico.analisar(claims, arquivo()))).body.codigo).toBe('ia_falhou');
    expect(finalizacoes(prisma)).toEqual([[RESERVA, true], [RESERVA, false], [RESERVA, false]]);
  });

  it('corretor não identificado → 403 antes da chave', async () => {
    const { tx, prisma, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: null }] as never);
    expect((await erroDe(servico.analisar(claims, arquivo()))).status).toBe(403);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
