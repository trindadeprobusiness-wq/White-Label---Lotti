import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ComandoDto } from '../rotina.dto';
import { findCandidate, RotinaComandoService, URL_GEMINI } from './rotina-comando.service';

const USER = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const IMOVEL = '33333333-3333-4333-8333-333333333333';
const claims = { sub: USER, role: 'authenticated' };
const salvas = { chave: process.env.GEMINI_API_KEY, modelo: process.env.LOTTI_AI_FAST_MODEL };

function resposta(conteudo: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(conteudo) } }] }), { status });
}

function montar(respostas: Array<Response | Error>) {
  const tx = { $queryRaw: jest.fn() };
  tx.$queryRaw
    .mockResolvedValueOnce([{ membership: { organization_id: 'org' }, organization: {} }])
    .mockResolvedValueOnce([{ id: CLIENTE, nome: 'José Álvares' }])
    .mockResolvedValueOnce([{ id: IMOVEL, titulo: 'Apto Florença', bairro: 'Centro', cidade: 'Goiânia', endereco: 'Rua 1' }]);
  const db = { run: jest.fn(async (_c: unknown, w: (t: typeof tx) => unknown) => w(tx)) };
  const fila = [...respostas];
  const fetcher = jest.fn(async () => {
    const r = fila.shift();
    if (!r) throw new Error('sem resposta');
    if (r instanceof Error) throw r;
    return r;
  });
  const servico = new RotinaComandoService(db as never, fetcher as unknown as typeof fetch);
  (servico as unknown as { esperar: () => Promise<void> }).esperar = async () => undefined;
  return { tx, db, fetcher, servico };
}

const comando = (command = 'visita com jose alvares amanhã às 10h no apto florença') => Object.assign(new ComandoDto(), { command });

async function erroDe(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('não lançou');
}

beforeEach(() => { process.env.GEMINI_API_KEY = 'chave-teste'; delete process.env.LOTTI_AI_FAST_MODEL; });
afterAll(() => {
  if (salvas.chave === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = salvas.chave;
  if (salvas.modelo === undefined) delete process.env.LOTTI_AI_FAST_MODEL; else process.env.LOTTI_AI_FAST_MODEL = salvas.modelo;
});

describe('RotinaComandoService', () => {
  it('sem GEMINI_API_KEY → 503 ia_nao_configurada sem SQL', async () => {
    delete process.env.GEMINI_API_KEY;
    const { db, fetcher, servico } = montar([]);
    const { status, body } = await erroDe(servico.interpretar(claims, comando()));
    expect(status).toBe(503);
    expect(body.codigo).toBe('ia_nao_configurada');
    expect(db.run).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('proposta com cliente e imóvel casados por nome normalizado; leitura pelo TenantDb', async () => {
    const { tx, fetcher, servico } = montar([resposta({
      kind: 'event', title: 'Visita', activity_type: 'visita_imovel', start_at: '2026-11-10T10:00:00-03:00', end_at: '2026-11-10T11:00:00-03:00',
      client_query: 'jose alvares', property_query: 'florença', reminder_minutes: 30, priority: 'high', missing_fields: [],
    })]);
    const { proposal } = await servico.interpretar(claims, comando());
    expect(proposal).toEqual({
      kind: 'event', title: 'Visita', activity_type: 'visita_imovel', start_at: '2026-11-10T13:00:00.000Z', end_at: '2026-11-10T14:00:00.000Z',
      due_at: null, client_query: 'jose alvares', client_id: CLIENTE, property_query: 'florença', property_id: IMOVEL, location: 'Rua 1',
      assigned_to: USER, reminder_minutes: 30, priority: 'high', missing_fields: [], requires_confirmation: true, conflicts: [], interpretation_source: 'ai',
    });
    expect((tx.$queryRaw.mock.calls[1][0] as Prisma.Sql).text.replace(/\s+/g, ' ').trim()).toBe('select id::text as id, nome from public.clientes order by nome limit $1::int');
    expect((tx.$queryRaw.mock.calls[2][0] as Prisma.Sql).values).toEqual([120]);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_GEMINI);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer chave-teste');
    const corpo = JSON.parse(String(init.body));
    expect(corpo).toMatchObject({ model: 'gemini-3.8-flash', temperature: 0.1, response_format: { type: 'json_object' } });
    expect(corpo.messages[1].content).toContain('Clientes disponíveis (id não deve sair no texto): José Álvares.');
  });

  it('tipo desconhecido vira outro; task sem datas; uma retentativa em 503', async () => {
    const { fetcher, servico } = montar([new Response('ocupado', { status: 503 }), resposta({ kind: 'x', activity_type: 'inventado', title: '' })]);
    const { proposal } = await servico.interpretar(claims, comando('organizar papéis'));
    expect(proposal).toMatchObject({ kind: 'task', activity_type: 'outro', title: 'Nova tarefa', priority: 'medium', client_id: null });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('evento com fim ≤ início → 500 comando_falhou; resposta não-JSON também', async () => {
    const a = montar([resposta({ kind: 'event', start_at: '2026-11-10T11:00:00Z', end_at: '2026-11-10T10:00:00Z' })]);
    expect((await erroDe(a.servico.interpretar(claims, comando()))).body).toEqual({ statusCode: 500, codigo: 'comando_falhou', message: 'Não consegui interpretar agora.' });
    const b = montar([new Response(JSON.stringify({ choices: [{ message: { content: 'não é json' } }] }), { status: 200 })]);
    expect((await erroDe(b.servico.interpretar(claims, comando()))).status).toBe(500);
  });

  it('sem membership → 403', async () => {
    const { tx, servico } = montar([]);
    tx.$queryRaw.mockReset().mockResolvedValueOnce([]);
    expect((await erroDe(servico.interpretar(claims, comando()))).body.codigo).toBe('routine_membership_required');
  });

  it('findCandidate: exato antes de parcial, sem acento e sem caixa', () => {
    const lista = [{ id: '1', label: 'Ana Paula' }, { id: '2', label: 'Ana' }];
    expect(findCandidate('ANA', lista)?.id).toBe('2');
    expect(findCandidate('paula', lista)?.id).toBe('1');
    expect(findCandidate(null, lista)).toBeNull();
    expect(findCandidate('Zé', lista)).toBeNull();
  });
});
