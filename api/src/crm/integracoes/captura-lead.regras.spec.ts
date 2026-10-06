import { Readable } from 'node:stream';
import { HttpException } from '@nestjs/common';
import {
  chaveLimiteLead, ErroLead, erroLeadHttp, integracaoConfiavel, lerCorpoLead, lerLead, respostaLead,
} from './captura-lead.regras';

// Paridade com a Edge: o arquivo compartilhado entra por require (fora de rootDir; o ts-jest transforma).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const edge = require('../../../../supabase/functions/_shared/public-request') as {
  parseLead: (input: unknown, queryId?: string | null) => unknown;
  isTrustedIntegration: (headers: Headers, expected?: string) => Promise<boolean>;
  consumeLeadLimit: (client: { rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }, phone: string, secret: string) => Promise<void>;
  publicLeadResponse: (trusted: boolean, details?: Record<string, unknown>) => unknown;
};

type Saida = { ok: unknown } | { status: number; message: string };
function rodar(f: () => unknown): Saida {
  try {
    return { ok: f() };
  } catch (e) {
    const x = e as { status: number; message: string };
    return { status: x.status, message: x.message };
  }
}

const IMOVEL = '11111111-1111-4111-8111-111111111111';

describe('lerLead é o parseLead da Edge', () => {
  const casos: Array<[unknown, string | null]> = [
    [{ nome: 'Ana', telefone: '(11) 99999-1234' }, null],
    [{ first_name: 'Ana', last_name: 'Souza', celular: '+55 11 3333-4444', email: 'a@b.co' }, null],
    [{ phone: '5562981234567', imovel_interesse_id: IMOVEL.toUpperCase() }, IMOVEL],
    [{ nome: ' Ana ', telefone: '11999991234', tracking_data: { utm_source: 'meta', outro: 'x' }, utm_campaign: 'c1', gclid: 'g' }, null],
    [{ nome: 'Ana', telefone: '11999991234', mensagem: 'Oi\nquero ver', origem: 'lp', assunto: 'Visita' }, null],
    [{ telefone: '11999991234' }, null],
    [{ nome: 'A', telefone: '11999991234' }, null],
    [{ nome: 'Ana', telefone: '0999991234' }, null],
    [{ nome: 'Ana', telefone: {} }, null],
    [{ nome: 'Ana', telefone: '11999991234', email: 'invalido' }, null],
    [{ nome: 'Ana', telefone: '11999991234', imovel_id: 'nao-uuid' }, null],
    [{ nome: 'Ana', telefone: '11999991234', imovel_id: IMOVEL }, '22222222-2222-4222-8222-222222222222'],
    [{ nome: 'Ana', telefone: '11999991234', tracking_data: [] }, null],
    [{ nome: 'Ana\u0001', telefone: '11999991234' }, null],
    [{ nome: 'x'.repeat(121), telefone: '11999991234' }, null],
    [[], null],
    [null, null],
    ['texto', null],
  ];

  it.each(casos.map((c, i) => [i, ...c]))('caso %i', (_i, entrada, query) => {
    expect(rodar(() => lerLead(entrada, query as string | null))).toEqual(rodar(() => edge.parseLead(entrada, query as string | null)));
  });
});

describe('segredo da integração, chave do limite e resposta', () => {
  it('integracaoConfiavel decide como isTrustedIntegration', async () => {
    const esperado = 'segredo-de-teste';
    for (const recebido of [null, esperado, 'errado', '', 'x'.repeat(2000)]) {
      for (const config of [esperado, null]) {
        const headers = new Headers(recebido === null ? {} : { 'x-n8n-secret': recebido });
        let daEdge: Saida;
        try {
          daEdge = { ok: await edge.isTrustedIntegration(headers, config ?? undefined) };
        } catch (e) {
          daEdge = { status: (e as ErroLead).status, message: (e as Error).message };
        }
        expect(rodar(() => integracaoConfiavel(recebido, config))).toEqual(daEdge);
      }
    }
  });

  it('chave do limite = HMAC da Edge (os contadores seguem valendo na virada)', async () => {
    let enviado: unknown;
    await edge.consumeLeadLimit({ rpc: async (_n, a) => { enviado = a._subject_hash; return { data: true, error: null }; } }, '5511999991234', 'segredo');
    expect(chaveLimiteLead('segredo', '5511999991234')).toBe(enviado);
    expect(chaveLimiteLead('segredo', '5511999991234')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('visitante recebe só a confirmação; integração recebe os detalhes', () => {
    for (const confiavel of [true, false]) {
      expect(respostaLead(confiavel, { cliente_id: 'c' })).toEqual(edge.publicLeadResponse(confiavel, { cliente_id: 'c' }));
    }
  });

  it('erroLeadHttp: texto do ErroLead; o resto vira 500 genérico sem detalhe', () => {
    const conhecido = erroLeadHttp(new ErroLead(429, 'Muitas tentativas. Aguarde alguns minutos.'));
    expect([conhecido.getStatus(), conhecido.getResponse()]).toEqual([429, { success: false, error: 'Muitas tentativas. Aguarde alguns minutos.' }]);
    const interno = erroLeadHttp(new Error('duplicate key value violates unique constraint "x"'));
    expect([interno.getStatus(), interno.getResponse()]).toEqual([500, { success: false, error: 'Não foi possível receber seu contato. Tente novamente.' }]);
    const http = new HttpException({ x: 1 }, 418);
    expect(erroLeadHttp(http)).toBe(http);
  });
});

describe('lerCorpoLead (readPublicJson)', () => {
  function req(corpo: string | null, headers: Record<string, string> = {}, ja?: unknown) {
    const r = Readable.from(corpo === null ? [] : [Buffer.from(corpo)]) as Readable & { headers: Record<string, string>; body?: unknown; _body?: boolean };
    r.headers = headers;
    if (ja !== undefined) { r.body = ja; r._body = true; }
    return r as never;
  }
  const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroLead) => [e.status, e.message]);

  it('JSON já lido pelo Express passa direto; acima do teto é 413', async () => {
    expect(await lerCorpoLead(req(null, {}, { nome: 'Ana' }))).toEqual({ nome: 'Ana' });
    expect(await falha(lerCorpoLead(req(null, {}, { x: 'y'.repeat(20_000) })))).toEqual([413, 'Requisição muito grande.']);
    expect(await falha(lerCorpoLead(req(null, { 'content-length': '20000' }, {})))).toEqual([413, 'Requisição muito grande.']);
  });

  it('text/plain (ninguém leu): lê aqui com teto e UTF-8 estrito', async () => {
    expect(await lerCorpoLead(req('{"nome":"Ana"}'))).toEqual({ nome: 'Ana' });
    expect(await falha(lerCorpoLead(req('x'.repeat(16_385))))).toEqual([413, 'Requisição muito grande.']);
    expect(await falha(lerCorpoLead(req('nome=Ana')))).toEqual([400, 'Corpo inválido.']);
    expect(await falha(lerCorpoLead(req('')))).toEqual([400, 'Corpo inválido.']);
    const invalido = Readable.from([Buffer.from([0x7b, 0xff, 0x7d])]) as Readable & { headers: Record<string, string> };
    invalido.headers = {};
    expect(await falha(lerCorpoLead(invalido as never))).toEqual([400, 'Corpo inválido.']);
  });
});
