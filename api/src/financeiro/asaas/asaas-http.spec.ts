import { AsaasError, AsaasHttp, baseUrlPara, descricaoErroAsaas } from './asaas-http';

function resposta(status: number, corpo: unknown) {
  return new Response(corpo === undefined ? '' : JSON.stringify(corpo), { status });
}

describe('AsaasHttp', () => {
  const antes = process.env.ASAAS_BASE_URL;
  afterEach(() => {
    if (antes === undefined) delete process.env.ASAAS_BASE_URL;
    else process.env.ASAAS_BASE_URL = antes;
  });

  it('envia access_token, Content-Type e User-Agent Lotti/1.0, com corpo JSON e timeout', async () => {
    const f = jest.fn(async () => resposta(200, { ok: 1 }));
    const http = new AsaasHttp('https://api-sandbox.asaas.com/v3', 'chave-x', f as unknown as typeof fetch);
    expect(await http.post('/payments', { a: 1 })).toEqual({ ok: 1 });
    const [url, init] = (f.mock.calls[0] as unknown) as [string, RequestInit];
    expect(url).toBe('https://api-sandbox.asaas.com/v3/payments');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ access_token: 'chave-x', 'Content-Type': 'application/json', 'User-Agent': 'Lotti/1.0' });
    expect(init.body).toBe('{"a":1}');
    expect(init.signal).toBeDefined();
  });

  it('não-2xx vira AsaasError com status e descricao, sem o corpo na mensagem', async () => {
    const f = jest.fn(async () => resposta(400, { errors: [{ description: 'CPF inválido' }] }));
    const http = new AsaasHttp('https://x', 'k', f as unknown as typeof fetch);
    const e = (await http.get('/customers').catch((x: unknown) => x)) as AsaasError;
    expect(e).toBeInstanceOf(AsaasError);
    expect(e.status).toBe(400);
    expect(e.descricao).toBe('CPF inválido');
    expect(e.message).toBe('Asaas API 400');
  });

  it('timeout vira AsaasError 504 com texto em português', async () => {
    const f = jest.fn(async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; });
    const e = (await new AsaasHttp('https://x', 'k', f as unknown as typeof fetch).get('/x').catch((x: unknown) => x)) as AsaasError;
    expect(e).toBeInstanceOf(AsaasError);
    expect(e.status).toBe(504);
    expect(e.descricao).toBe('O Asaas não respondeu a tempo.');
  });

  it('baseUrlPara: sandbox fixo; produção aceita ASAAS_BASE_URL', () => {
    process.env.ASAAS_BASE_URL = 'https://mock.local/v3/';
    expect(baseUrlPara('sandbox')).toBe('https://api-sandbox.asaas.com/v3');
    expect(baseUrlPara('producao')).toBe('https://mock.local/v3');
    delete process.env.ASAAS_BASE_URL;
    expect(baseUrlPara('producao')).toBe('https://api.asaas.com/v3');
  });

  it('descricaoErroAsaas aceita formas diferentes', () => {
    expect(descricaoErroAsaas({ errors: [{ description: 'Chave inválida' }] })).toBe('Chave inválida');
    expect(descricaoErroAsaas({ message: 'Sem permissão' })).toBe('Sem permissão');
    expect(descricaoErroAsaas(null)).toBeNull();
  });
});
