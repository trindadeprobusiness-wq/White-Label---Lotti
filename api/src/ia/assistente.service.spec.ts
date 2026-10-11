import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AssistenteService, ERRO_DEMOROU, EventoAssistente } from './assistente.service';
import { AssistenteDto } from './ia.dto';

// Estes testes cobrem o tratamento de erro do provedor; o modelo reserva tem teste próprio (ia/reserva.spec.ts).
process.env.LOTTI_AI_FALLBACK_MODEL = 'off';

const CORRETOR = '55555555-5555-4555-8555-555555555555';
const USUARIO = '66666666-6666-4666-8666-666666666666';
const CONV = '77777777-7777-4777-8777-777777777777';
const RUN = '88888888-8888-4888-8888-888888888888';
const claims = { sub: USUARIO, role: 'authenticated' };

type Resposta = unknown | ((q: Prisma.Sql) => unknown);
type Regra = [RegExp, Resposta];

/** tx/prisma falsos: a resposta é escolhida pelo SQL (a primeira regra que casa). */
function sqlFalso(regras: Regra[]) {
  const responder = (q: Prisma.Sql) => {
    for (const [re, r] of regras) if (re.test(q.text)) return typeof r === 'function' ? (r as (q: Prisma.Sql) => unknown)(q) : r;
    return [];
  };
  return {
    $queryRaw: jest.fn(async (q: Prisma.Sql) => responder(q)),
    $executeRaw: jest.fn(async (q: Prisma.Sql) => {
      responder(q);
      return 1;
    }),
  };
}

function montar(o: { tx?: Regra[]; prisma?: Regra[] } = {}) {
  const tx = sqlFalso([
    ...(o.tx ?? []),
    [/get_corretor_id/, [{ id: CORRETOR }]],
    [/count\(\*\)::int as n from public\.ai_conversations/, [{ n: 1 }]],
    [/insert into public\.ai_conversations/, [{ id: CONV }]],
    [/insert into public\.ai_messages/, [{ id: '99999999-9999-4999-8999-999999999999' }]],
    [/from public\.ai_messages m/, [{ role: 'user', content: 'Quantos clientes?', tool_calls: null, tool_name: null }]],
    [/from public\.corretores/, [{ nome: 'Ana', creci: '123', creci_estado: 'GO' }]],
    [/from public\.clientes\) as clientes/, [{ clientes: 3, imoveis: 2, contratos: 0, alertas: 1, receita: 1500.5 }]],
  ]);
  const db = { run: jest.fn(async (_c: unknown, w: (t: typeof tx) => unknown) => w(tx)) };
  const prisma = sqlFalso([
    ...(o.prisma ?? []),
    [/ai_rate_limits/, [{ permitido: true }]],
    [/checar_cota/, [{ permitido: true, usado: 1, limite: 100, ilimitado: false, habilitado: true }]],
    [/insert into public\.ai_runs/, [{ id: RUN }]],
  ]);
  const ferramentas = { executar: jest.fn(async (..._a: unknown[]) => '[]') };
  const servico = new AssistenteService(db as never, prisma as never, ferramentas as never);
  const fetchImpl = jest.fn();
  servico.fetchImpl = fetchImpl as never;
  return { tx, db, prisma, ferramentas, servico, fetchImpl };
}

const corpo = (extra: Record<string, unknown> = {}): AssistenteDto => Object.assign(new AssistenteDto(), {
  message: 'Quantos clientes?', module: 'clients', intent: 'assistant.chat', trace_id: 'trace_teste_1', ...extra,
});

const sse = (...eventos: unknown[]) => new Response(
  eventos.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join(''),
  { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
);
const texto = (t: string) => ({ choices: [{ delta: { content: t } }] });
const chamada = (id: string, nome: string, args: unknown) => ({ choices: [{ delta: { tool_calls: [{ id, function: { name: nome, arguments: JSON.stringify(args) } }] } }] });

async function erroDe(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('não lançou');
}

const textos = (m: jest.Mock, re: RegExp) => (m.mock.calls as Array<[Prisma.Sql]>).map(([q]) => q).filter((q) => re.test(q.text));

describe('AssistenteService.preparar', () => {
  const ambiente = { ...process.env };
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'chave-falsa';
    delete process.env.LOTTI_AI_FAST_MODEL;
  });
  afterAll(() => {
    process.env = ambiente;
  });

  it('sem GEMINI_API_KEY → 503 antes de tocar no banco', async () => {
    process.env.GEMINI_API_KEY = ' ';
    const { servico, db, prisma } = montar();
    expect((await erroDe(servico.preparar(claims, corpo()))).status).toBe(503);
    expect(db.run).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('sem corretor → 403 e nenhum limite consumido', async () => {
    const { servico, prisma } = montar({ tx: [[/get_corretor_id/, [{ id: null }]]] });
    expect(await erroDe(servico.preparar(claims, corpo()))).toEqual({
      status: 403, body: { statusCode: 403, codigo: 'corretor_nao_identificado', message: 'Não foi possível identificar o corretor.' },
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('limite por minuto: 30 no ai_rate_limits pelo caminho privilegiado; negado → 429', async () => {
    const { servico, prisma } = montar({ prisma: [[/ai_rate_limits/, [{ permitido: false }]]] });
    expect(await erroDe(servico.preparar(claims, corpo()))).toEqual({
      status: 429, body: { statusCode: 429, codigo: 'limite_de_mensagens', message: 'Limite de mensagens excedido. Tente novamente em um minuto.' },
    });
    const [limite] = textos(prisma.$queryRaw, /ai_rate_limits/);
    expect(limite.text).toMatch(/values \(\$1::uuid, 1, now\(\)\)/);
    expect(limite.text).toMatch(/message_count <= \$2::int/);
    expect(limite.values).toEqual([CORRETOR, 30]);
  });

  it('banco fora no limitador: segue (como o limitador antigo da função)', async () => {
    const { servico } = montar({ prisma: [[/ai_rate_limits/, () => { throw new Error('x'); }]] });
    await expect(servico.preparar(claims, corpo())).resolves.toMatchObject({ conversationId: CONV });
  });

  it('cota ai_assistant_monthly: acabou → 402 com o limite; sem o recurso no plano → texto do plano', async () => {
    const cheia = montar({ prisma: [[/checar_cota/, [{ permitido: false, usado: 100, limite: 100, ilimitado: false, habilitado: true }]]] });
    expect(await erroDe(cheia.servico.preparar(claims, corpo()))).toEqual({
      status: 402,
      body: { statusCode: 402, codigo: 'PLAN_LIMIT_REACHED', message: 'Você atingiu o limite de 100 interações de IA deste mês.', recurso: 'ai_assistant_monthly', usado: 100, limite: 100 },
    });
    const [cota] = textos(cheia.prisma.$queryRaw, /checar_cota/);
    expect(cota.text).toMatch(/public\.checar_cota\(\$1::uuid, \$2::text\)/);
    expect(cota.values).toEqual([CORRETOR, 'ai_assistant_monthly']);

    const semPlano = montar({ prisma: [[/checar_cota/, [{ permitido: false, usado: 0, limite: 0, ilimitado: false, habilitado: false }]]] });
    expect((await erroDe(semPlano.servico.preparar(claims, corpo()))).body.message).toBe('Seu plano atual não inclui o Assistente Lotti.');
  });

  it('corpo inválido → 400 com o texto da função; conversa de fora → 404', async () => {
    const { servico } = montar();
    expect((await erroDe(servico.preparar(claims, corpo({ message: '  ' })))).body).toEqual({ statusCode: 400, codigo: 'pedido_invalido', message: 'Mensagem obrigatória' });
    expect((await erroDe(servico.preparar(claims, corpo({ conversation_id: 'abc' })))).status).toBe(404);
    const outra = montar({ tx: [[/count\(\*\)::int as n from public\.ai_conversations/, [{ n: 0 }]]] });
    expect((await erroDe(outra.servico.preparar(claims, corpo({ conversation_id: CONV })))).body.codigo).toBe('conversa_nao_encontrada');
  });

  it('caminho feliz: tudo no TenantDb com as claims; conversa nova, mensagem do usuário, histórico e contexto no prompt', async () => {
    const { servico, db, tx, prisma } = montar();
    const s = await servico.preparar(claims, corpo({ file_context: 'texto do PDF', entity_refs: [{ type: 'cliente', id: 'c1' }] }));
    expect(db.run.mock.calls.every(([c]) => c === claims)).toBe(true);
    const [conversa] = textos(tx.$queryRaw, /insert into public\.ai_conversations/);
    expect(conversa.values).toEqual([CORRETOR, 'gemini-3.1-flash-lite']);
    const [msg] = textos(tx.$queryRaw, /insert into public\.ai_messages/);
    expect(msg.text).toMatch(/\$1::uuid, \$2::text, \$3::text,\s+\$4::jsonb, \$5::text,\s+\$6::jsonb/);
    expect(msg.values.slice(0, 3)).toEqual([CONV, 'user', 'Quantos clientes?']);
    expect(JSON.parse(msg.values[5] as string)).toEqual({
      trace_id: 'trace_teste_1', module: 'clients', intent: 'assistant.chat', entity_refs: [{ type: 'cliente', id: 'c1' }], output_mode: 'text',
    });
    const [hist] = textos(tx.$queryRaw, /from public\.ai_messages m/);
    expect(hist.values).toEqual([CONV, 20]);

    expect(s).toMatchObject({ conversationId: CONV, novaConversa: true, corretorId: CORRETOR, runId: RUN, modelo: 'gemini-3.1-flash-lite' });
    expect(s.mensagens[0].role).toBe('system');
    expect(s.mensagens[0].content).toContain('- Corretor: Ana (CRECI 123/GO)');
    expect(s.mensagens[0].content).toContain('- Receita do mês: R$ 1.500,50');
    expect(s.mensagens[0].content).toContain('Regra do módulo: Não confunda homônimos.');
    expect(s.mensagens[0].content).toContain('<external_data kind="uploaded_document">\ntexto do PDF');
    expect(s.mensagens.slice(1)).toEqual([{ role: 'user', content: 'Quantos clientes?' }]);

    const [run] = textos(prisma.$queryRaw, /insert into public\.ai_runs/);
    expect(run.values).toEqual(['trace_teste_1', CORRETOR, USUARIO, 'clients', 'assistant.chat', 'gemini-3.1-flash-lite',
      'assistant.general@2026-10-11.2', 'text', 'Quantos clientes?'.length + 'texto do PDF'.length, false, JSON.stringify({ entity_count: 1 })]);
  });

  it('telemetria indisponível (tabela ausente) não derruba: runId null', async () => {
    const { servico } = montar({ prisma: [[/insert into public\.ai_runs/, () => { throw new Error('42P01'); }]] });
    expect((await servico.preparar(claims, corpo())).runId).toBeNull();
  });
});

describe('AssistenteService.transmitir', () => {
  const ambiente = { ...process.env };
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'chave-falsa';
    delete process.env.LOTTI_AI_FAST_MODEL;
  });
  afterAll(() => {
    process.env = ambiente;
  });

  async function rodar(m: ReturnType<typeof montar>, dto = corpo(), sinal?: AbortSignal) {
    const s = await m.servico.preparar(claims, dto);
    const eventos: EventoAssistente[] = [];
    await m.servico.transmitir(s, (e) => eventos.push(e), sinal);
    return eventos;
  }

  it('só texto: repassa os pedaços, grava a resposta, dá título, conta o uso e termina com done', async () => {
    const m = montar();
    m.fetchImpl.mockResolvedValueOnce(sse(texto('Você tem '), texto('**3** clientes.'), '[DONE]'));
    const eventos = await rodar(m);
    expect(eventos).toEqual([
      { type: 'text', content: 'Você tem ' },
      { type: 'text', content: '**3** clientes.' },
      { type: 'done', conversation_id: CONV, trace_id: 'trace_teste_1', prompt_version: 'assistant.general@2026-10-11.2' },
    ]);
    const [url, init] = m.fetchImpl.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer chave-falsa');
    const enviado = JSON.parse(init.body);
    expect(enviado).toMatchObject({ stream: true, model: 'gemini-3.1-flash-lite', reasoning_effort: 'none' });
    expect(enviado.tools.map((t: { function: { name: string } }) => t.function.name)).toContain('suggest_action');
    expect(enviado.messages[0].role).toBe('system');

    const gravadas = textos(m.tx.$queryRaw, /insert into public\.ai_messages/).map((q) => q.values.slice(1, 3));
    expect(gravadas).toEqual([['user', 'Quantos clientes?'], ['assistant', 'Você tem **3** clientes.']]);
    const [titulo] = textos(m.tx.$executeRaw, /update public\.ai_conversations/);
    expect(titulo.values).toEqual(['Você tem 3 clientes.', CONV]);
    const [uso] = textos(m.prisma.$executeRaw, /incrementar_uso/);
    expect(uso.values).toEqual([CORRETOR, 'ai_assistant_monthly', 1]);
    const [fim] = textos(m.prisma.$executeRaw, /update public\.ai_runs/);
    expect(fim.values[0]).toBe('completed');
  });

  it('conversa existente não troca o título', async () => {
    const m = montar();
    m.fetchImpl.mockResolvedValueOnce(sse(texto('Ok')));
    await rodar(m, corpo({ conversation_id: CONV }));
    expect(textos(m.tx.$queryRaw, /insert into public\.ai_conversations/)).toHaveLength(0);
    const [toque] = textos(m.tx.$executeRaw, /update public\.ai_conversations/);
    expect(toque.values).toEqual([null, CONV]);
  });

  it('ferramentas: executa com as claims, emite a ação proposta, grava tool_calls e respostas e volta ao modelo', async () => {
    const m = montar();
    const acao = { id: 'p1', action_type: 'create_alert', params: { mensagem: 'Ligar' }, description: 'Criar alerta', status: 'pending' };
    m.ferramentas.executar
      .mockResolvedValueOnce('[{"id":"c1"}]')
      .mockResolvedValueOnce(JSON.stringify({ type: 'action', action: acao }));
    m.fetchImpl
      .mockResolvedValueOnce(sse(chamada('call_1', 'search_clients', { query: 'Ana' }), chamada('call_2', 'suggest_action', { action_type: 'create_alert' })))
      .mockResolvedValueOnce(sse(texto('Preparei o alerta.')));
    const eventos = await rodar(m);
    expect(eventos.map((e) => e.type)).toEqual(['action', 'text', 'done']);
    expect(eventos[0]).toEqual({ type: 'action', action: acao });
    expect(m.ferramentas.executar.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['search_clients', { query: 'Ana' }],
      ['suggest_action', { action_type: 'create_alert' }],
    ]);
    expect((m.ferramentas.executar.mock.calls[0] as unknown[])[2]).toMatchObject({ claims, corretorId: CORRETOR, userId: USUARIO, runId: RUN });

    const gravadas = textos(m.tx.$queryRaw, /insert into public\.ai_messages/).map((q) => q.values);
    expect(gravadas[1].slice(1, 3)).toEqual(['assistant', '']);
    expect(JSON.parse(gravadas[1][3] as string)).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'search_clients', arguments: '{"query":"Ana"}' } },
      { id: 'call_2', type: 'function', function: { name: 'suggest_action', arguments: '{"action_type":"create_alert"}' } },
    ]);
    expect(gravadas[2].slice(1, 5)).toEqual(['tool', '[{"id":"c1"}]', null, 'call_1']);
    const segunda = JSON.parse(m.fetchImpl.mock.calls[1][1].body);
    expect(segunda.messages.slice(-3).map((x: { role: string; tool_call_id?: string }) => [x.role, x.tool_call_id])).toEqual([
      ['assistant', undefined], ['tool', 'call_1'], ['tool', 'call_2'],
    ]);
    const ferramentasRegistradas = textos(m.prisma.$executeRaw, /insert into public\.ai_tool_calls/).map((q) => q.values.slice(0, 4));
    expect(ferramentasRegistradas).toEqual([[RUN, 'search_clients', 'read', 'completed'], [RUN, 'suggest_action', 'proposal', 'completed']]);
  });

  it('chamadas fragmentadas com index (formato OpenAI) são remontadas', async () => {
    const m = montar();
    m.fetchImpl
      .mockResolvedValueOnce(sse(
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'get_funnel', arguments: '{"a"' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: '_stats', arguments: ':1}' } }] } }] },
      ))
      .mockResolvedValueOnce(sse(texto('ok')));
    await rodar(m);
    expect(m.ferramentas.executar.mock.calls[0].slice(0, 2)).toEqual(['get_funnel_stats', { a: 1 }]);
  });

  it('provedor com erro: evento de erro, sem done e sem contar uso', async () => {
    const m = montar();
    m.fetchImpl.mockResolvedValueOnce(new Response('falhou', { status: 500 }));
    expect(await rodar(m)).toEqual([{ type: 'error', error: 'Erro ao comunicar com IA' }]);
    expect(textos(m.prisma.$executeRaw, /incrementar_uso/)).toHaveLength(0);
    const [fim] = textos(m.prisma.$executeRaw, /update public\.ai_runs/);
    expect(fim.values[0]).toBe('failed');
    expect(fim.values).toContain('provider_500');
  });

  it('mais de 4 rodadas de ferramenta: bloqueia com o texto da função', async () => {
    const m = montar();
    m.fetchImpl.mockImplementation(async () => sse(chamada('c', 'get_funnel_stats', {})));
    const eventos = await rodar(m);
    expect(m.fetchImpl).toHaveBeenCalledTimes(4);
    expect(eventos).toEqual([{ type: 'error', error: 'A solicitação exigiu ações demais. Reformule o pedido em uma etapa por vez.' }]);
    const [fim] = textos(m.prisma.$executeRaw, /update public\.ai_runs/);
    expect(fim.values[0]).toBe('blocked');
  });

  it('Gemini parado sem mandar nada: refaz a rodada uma vez com o modelo reserva', async () => {
    process.env.LOTTI_AI_FALLBACK_MODEL = 'gemini-reserva';
    try {
      const m = montar();
      m.fetchImpl
        .mockRejectedValueOnce(new DOMException('tempo', 'TimeoutError'))
        .mockResolvedValueOnce(sse(texto('Você tem 3 clientes.')));
      const eventos = await rodar(m);
      expect(eventos.map((e) => e.type)).toEqual(['text', 'done']);
      expect(m.fetchImpl.mock.calls.map((c) => JSON.parse(c[1].body).model)).toEqual(['gemini-3.1-flash-lite', 'gemini-reserva']);
    } finally {
      process.env.LOTTI_AI_FALLBACK_MODEL = 'off';
    }
  });

  it('Gemini parado depois de já ter mandado texto: não refaz (duplicaria) e avisa em português', async () => {
    process.env.LOTTI_AI_FALLBACK_MODEL = 'gemini-reserva';
    try {
      const m = montar();
      // Primeiro pedaço chega; o seguinte estoura o tempo (o Response real troca o erro, então vai cru).
      let pedidos = 0;
      const corpoQuebrado = new ReadableStream<Uint8Array>({
        pull(c) {
          pedidos += 1;
          if (pedidos === 1) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(texto('Você tem '))}

`));
          else c.error(new DOMException('tempo', 'TimeoutError'));
        },
      });
      m.fetchImpl.mockResolvedValueOnce({ ok: true, status: 200, body: corpoQuebrado });
      expect(await rodar(m)).toEqual([{ type: 'text', content: 'Você tem ' }, { type: 'error', error: ERRO_DEMOROU }]);
      expect(m.fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      process.env.LOTTI_AI_FALLBACK_MODEL = 'off';
    }
  });

  it('modelo que não manda nada em primeiroPedacoMs é cortado e a rodada vai para o reserva', async () => {
    process.env.LOTTI_AI_FALLBACK_MODEL = 'gemini-reserva';
    try {
      const m = montar();
      m.servico.primeiroPedacoMs = 30;
      // Primeira chamada: conecta e não manda nada até ser cortada.
      m.fetchImpl.mockImplementationOnce((_u: string, init: RequestInit) => new Promise((_ok, falha) => {
        init.signal?.addEventListener('abort', () => falha(init.signal?.reason));
      }));
      m.fetchImpl.mockResolvedValueOnce(sse(texto('Pronto.')));
      const eventos = await rodar(m);
      expect(eventos.map((e) => e.type)).toEqual(['text', 'done']);
      expect(m.fetchImpl.mock.calls.map((c) => JSON.parse(c[1].body).model)).toEqual(['gemini-3.1-flash-lite', 'gemini-reserva']);
    } finally {
      process.env.LOTTI_AI_FALLBACK_MODEL = 'off';
    }
  });

  it('resposta que começa a chegar não é cortada pelo vigia', async () => {
    const m = montar();
    m.servico.primeiroPedacoMs = 30;
    let pedidos = 0;
    const devagar = new ReadableStream<Uint8Array>({
      async pull(c) {
        pedidos += 1;
        if (pedidos === 1) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(texto('Olá'))}

`));
        else if (pedidos === 2) { await new Promise((r) => setTimeout(r, 80)); c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(texto('!'))}

`)); }
        else c.close();
      },
    });
    m.fetchImpl.mockResolvedValueOnce({ ok: true, status: 200, body: devagar });
    const eventos = await rodar(m);
    expect(eventos.map((e) => e.type)).toEqual(['text', 'text', 'done']);
  });

  it('sem modelo reserva, o tempo esgotado chega em português', async () => {
    const m = montar();
    m.fetchImpl.mockRejectedValueOnce(new DOMException('tempo', 'TimeoutError'));
    expect(await rodar(m)).toEqual([{ type: 'error', error: ERRO_DEMOROU }]);
  });

  it('erro inesperado vira "Internal error"; navegador que fechou não recebe nada', async () => {
    const m = montar();
    m.fetchImpl.mockRejectedValueOnce(new TypeError('rede'));
    expect(await rodar(m)).toEqual([{ type: 'error', error: 'Internal error' }]);

    const n = montar();
    const controle = new AbortController();
    controle.abort();
    n.fetchImpl.mockRejectedValueOnce(new DOMException('abortado', 'AbortError'));
    expect(await rodar(n, corpo(), controle.signal)).toEqual([]);
  });
});
