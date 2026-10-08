// Porte de supabase/functions/diagnostic/ai.test.ts, mais o caminho feliz e a privacidade do prompt.
import { buildSummary } from './motor/engine';
import type { Answers } from './motor/types';
import { enriquecerResumo, pedidoGemini, PROMPT_SISTEMA, validarSaida } from './diagnostico-crescimento.ia';

const answers: Answers = {
  name: 'Ana Teste', contact: 'ana@example.test', company: 'Empresa Teste', city: 'Goiânia',
  segment: 'real_estate', bottleneck: 'follow_up', goal: 'Organizar o follow-up dos leads',
};
const fallback = buildSummary(answers);
const reserva = (permitido: boolean) => ({ reservarIa: jest.fn(async () => permitido) });
const respostaIa = (conteudo: unknown, status = 200) => new Response(JSON.stringify({
  choices: [{ message: { content: typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo) } }],
}), { status });

describe('diagnostic AI fallback', () => {
  it('uses the deterministic rule summary while AI is disabled', async () => {
    const repo = reserva(true);
    const request = jest.fn();
    await expect(enriquecerResumo(repo, 'session', answers, fallback, { enabled: false, request })).resolves.toEqual(fallback);
    expect(request).not.toHaveBeenCalled();
    expect(repo.reservarIa).not.toHaveBeenCalled();
  });

  it('uses the deterministic rule summary when the AI budget is exhausted', async () => {
    const repo = reserva(false);
    const request = jest.fn();
    await expect(enriquecerResumo(repo, 'session', answers, fallback, { enabled: true, request })).resolves.toEqual(fallback);
    expect(request).not.toHaveBeenCalled();
  });

  it('continues with rules when the AI provider is unavailable', async () => {
    const repo = reserva(true);
    const request = jest.fn(async () => { throw new Error('provider unavailable'); });
    await expect(enriquecerResumo(repo, 'session', answers, fallback, { enabled: true, request })).resolves.toEqual(fallback);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('IA do diagnóstico na API', () => {
  it('resposta válida troca só resumo e gargalos; mensagem e próximo passo continuam das regras', async () => {
    const repo = reserva(true);
    const request = jest.fn(async () => respostaIa({
      summary: 'A operação perde oportunidades no retorno aos leads.', primary_bottleneck: 'service',
      secondary_bottleneck: null, recommended_next_step: 'nurture',
    }));
    const r = await enriquecerResumo(repo, 'sessao-1', answers, fallback, { enabled: true, dailyLimit: 7, request });
    expect(r).toEqual({
      ...fallback, summary: 'A operação perde oportunidades no retorno aos leads.', primary_bottleneck: 'service',
      secondary_bottleneck: null, source: 'ai',
    });
    expect(repo.reservarIa).toHaveBeenCalledWith('sessao-1', 7);
  });

  it('mesmo corpo da Edge e sem nome, contato, empresa ou cidade no prompt', async () => {
    const request = jest.fn(async (_corpo: Record<string, unknown>, _politica: unknown) => respostaIa('{}'));
    await enriquecerResumo(reserva(true), 's', answers, fallback, { enabled: true, request });
    const [corpo, politica] = request.mock.calls[0];
    expect(politica).toEqual({ timeoutMs: 8000, retries: 0 });
    expect(corpo).toMatchObject({ max_tokens: 700, temperature: 0.2, response_format: { type: 'json_object' } });
    const mensagens = corpo.messages as Array<{ role: string; content: string }>;
    expect(mensagens[0]).toEqual({ role: 'system', content: PROMPT_SISTEMA });
    expect(mensagens[1].content.startsWith('<external_data kind="diagnostic_answers">')).toBe(true);
    for (const pessoal of ['Ana Teste', 'ana@example.test', 'Empresa Teste', 'Goiânia']) expect(mensagens[1].content).not.toContain(pessoal);
    expect(mensagens[1].content).toContain('follow_up');
  });

  it('JSON fora do schema, HTTP de erro ou chave extra caem nas regras', async () => {
    for (const resposta of [
      respostaIa('não é json'),
      respostaIa({ summary: 'curto', primary_bottleneck: 'service', secondary_bottleneck: null, recommended_next_step: 'nurture' }),
      respostaIa({ summary: 'x'.repeat(30), primary_bottleneck: 'service', secondary_bottleneck: null, recommended_next_step: 'nurture', extra: 1 }),
      respostaIa({}, 503),
    ]) {
      await expect(enriquecerResumo(reserva(true), 's', answers, fallback, { enabled: true, request: async () => resposta }))
        .resolves.toEqual(fallback);
    }
  });

  it('validarSaida segue o outputSchema strict da Edge', () => {
    const ok = { summary: 'x'.repeat(20), primary_bottleneck: 'cost', secondary_bottleneck: 'process', recommended_next_step: 'strategy_call' };
    expect(validarSaida(ok)).toEqual(ok);
    expect(validarSaida({ ...ok, summary: 'x'.repeat(1401) })).toBeNull();
    expect(validarSaida({ ...ok, primary_bottleneck: 'outro' })).toBeNull();
    expect(validarSaida({ ...ok, secondary_bottleneck: undefined })).toBeNull();
    expect(validarSaida({ ...ok, recommended_next_step: 'call' })).toBeNull();
    expect(validarSaida([ok])).toBeNull();
  });

  it('sem GEMINI_API_KEY o pedido falha antes de qualquer rede', async () => {
    const salvo = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const rede = jest.spyOn(globalThis, 'fetch');
    try {
      await expect(pedidoGemini({}, { timeoutMs: 8000, retries: 0 })).rejects.toThrow('GEMINI_API_KEY not configured');
      expect(rede).not.toHaveBeenCalled();
    } finally {
      rede.mockRestore();
      if (salvo !== undefined) process.env.GEMINI_API_KEY = salvo;
    }
  });
});
