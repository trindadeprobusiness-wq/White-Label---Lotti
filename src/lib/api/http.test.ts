import { describe, expect, it } from 'vitest';
import { ErroApi, comoResultado, corpoJson, escolher, lerErroApi, lerJson } from './http';

const CLIENTE = '11111111-1111-4111-8111-111111111111';

const resposta = (status: number, corpo?: unknown) =>
  new Response(corpo === undefined ? null : JSON.stringify(corpo), { status });

describe('lerErroApi', () => {
  it('código do banco vira a message, com details e code preenchidos', async () => {
    const e = await lerErroApi(resposta(409, {
      statusCode: 409, codigo: 'duplicate_client_phone', message: 'Este telefone já é de outro cliente do CRM.', detalhe: CLIENTE,
    }), 'padrão');
    expect(e).toBeInstanceOf(ErroApi);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('duplicate_client_phone');
    expect(e.codigo).toBe('duplicate_client_phone');
    expect(e.details).toBe(CLIENTE);
    expect(e.status).toBe(409);

    const contrato = await lerErroApi(resposta(409, {
      statusCode: 409, codigo: 'cliente_com_contrato', message: 'Existem contratos vinculados a este cliente.', sqlstate: '23503',
    }), 'padrão');
    expect(contrato.code).toBe('23503');
    expect(contrato.message).toBe('Existem contratos vinculados a este cliente.');

    const conflito = await lerErroApi(resposta(409, { statusCode: 409, codigo: 'CONFLITO', message: 'Este negócio foi movido em outro lugar.' }), 'padrão');
    expect(conflito.message).toBe('CONFLITO');
  });

  it('400 com lista de mensagens: junta, tira o caminho do campo e as repetições', async () => {
    const lista = await lerErroApi(resposta(400, {
      statusCode: 400, message: ['Informe o título do imóvel.', 'Informe o título do imóvel.', 'Informe a cidade.'], error: 'Bad Request',
    }), 'padrão');
    expect(lista.message).toBe('Informe o título do imóvel. Informe a cidade.');
    expect(lista.codigo).toBeNull();

    const item = await lerErroApi(resposta(400, { statusCode: 400, message: ['etapas.0.Informe o nome da etapa.'] }), 'padrão');
    expect(item.message).toBe('Informe o nome da etapa.');
  });

  it('500 usa o texto padrão, mesmo com corpo', async () => {
    const e = await lerErroApi(resposta(500, { statusCode: 500, message: 'Internal server error' }), 'Não foi possível salvar.');
    expect(e.message).toBe('Não foi possível salvar.');
    const semCorpo = await lerErroApi(new Response('texto solto', { status: 502 }), 'Falhou.');
    expect(semCorpo.message).toBe('Falhou.');
  });

  it('mensagem em português da API passa como veio', async () => {
    const e = await lerErroApi(resposta(402, {
      statusCode: 402, codigo: 'PLAN_LIMIT_REACHED', recurso: 'max_imoveis',
      message: 'Limite de imóveis atingido. Acesse Plano e Assinatura para liberar mais imóveis.',
    }), 'padrão');
    expect(e.message).toBe('Limite de imóveis atingido. Acesse Plano e Assinatura para liberar mais imóveis.');
    expect(e.status).toBe(402);
  });
});

describe('lerJson', () => {
  it('204 devolve undefined', async () => {
    await expect(lerJson(resposta(204), 'padrão')).resolves.toBeUndefined();
  });
  it('2xx devolve o corpo e erro lança ErroApi', async () => {
    await expect(lerJson(resposta(200, { id: CLIENTE }), 'padrão')).resolves.toEqual({ id: CLIENTE });
    await expect(lerJson(resposta(404, { codigo: 'cliente_nao_encontrado', message: 'Cliente não encontrado.' }), 'padrão'))
      .rejects.toMatchObject({ status: 404, message: 'Cliente não encontrado.' });
  });
});

describe('ajudantes', () => {
  it('escolher descarta chaves fora da lista e undefined, e mantém null', () => {
    const fonte = { nome: 'Ana', email: null, cpf: undefined, corretor_id: 'x', id: 'y' };
    expect(escolher(fonte, ['nome', 'email', 'cpf'] as const)).toEqual({ nome: 'Ana', email: null });
  });
  it('corpoJson monta método, cabeçalho e corpo', () => {
    expect(corpoJson('PATCH', { a: 1 })).toEqual({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
    expect(corpoJson('DELETE').body).toBeUndefined();
  });
  it('comoResultado devolve { data, error } como o supabase-js', async () => {
    await expect(comoResultado(Promise.resolve(1))).resolves.toEqual({ data: 1, error: null });
    const erro = new ErroApi(422, 'invalid_name', 'invalid_name');
    await expect(comoResultado(Promise.reject(erro))).resolves.toEqual({ data: null, error: erro });
  });
});
