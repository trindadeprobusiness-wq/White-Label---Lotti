import { randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { resolverCredencial } from './asaas-credencial';
import { cifrar } from './asaas-crypto';
import { AsaasNaoConectado } from './asaas-http';

const CORRETOR = '55555555-5555-4555-8555-555555555555';
const CHAVE = randomBytes(32).toString('hex');

function servicoCom(linhas: unknown[]) {
  const tx = { $queryRaw: jest.fn(async (_q: Prisma.Sql) => linhas) };
  return { tx, servico: { run: jest.fn(async (w: (t: typeof tx) => unknown) => w(tx)) } };
}

describe('resolverCredencial (sem chave global, D5)', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.ASAAS_TOKEN_ENCRYPTION_KEY = CHAVE;
    // Prova de que nenhuma variável de chave global é lida.
    process.env.ASAAS_API_KEY = '$aact_chave_global_que_nao_pode_ser_usada';
    process.env.ASAAS_PERMITIR_CHAVE_GLOBAL = 'true';
  });
  afterEach(() => { process.env = { ...env }; });

  it('usa a chave cifrada da própria conexão, pelo ServicoDb', async () => {
    const { tx, servico } = servicoCom([{ id: 'c1', ambiente: 'sandbox', status: 'conectada', herdada_do_ambiente: false, api_key_ciphertext: cifrar('$aact_minha', CHAVE) }]);
    expect(await resolverCredencial(servico as never, CORRETOR)).toEqual({ apiKey: '$aact_minha', ambiente: 'sandbox', conexaoId: 'c1' });
    const q = tx.$queryRaw.mock.calls[0][0];
    expect(q.text).toContain('left join public.asaas_conexao_segredos s on s.conexao_id = c.id');
    expect(q.text).toContain('where c.corretor_id = $1::uuid');
    expect(q.values).toEqual([CORRETOR]);
  });

  it.each([
    ['sem conexão', [], 'Este corretor ainda não conectou uma conta Asaas.'],
    ['status invalida', [{ id: 'c', ambiente: 'producao', status: 'invalida', herdada_do_ambiente: false, api_key_ciphertext: 'v1.x' }], 'A chave da Asaas foi recusada. Conecte a conta novamente com uma chave válida.'],
    ['ciphertext ilegível', [{ id: 'c', ambiente: 'producao', status: 'conectada', herdada_do_ambiente: false, api_key_ciphertext: 'v1.lixo' }], 'A chave da Asaas guardada está ilegível. Conecte a conta novamente.'],
    ['herdada sem ciphertext NÃO usa ASAAS_API_KEY', [{ id: 'c', ambiente: 'producao', status: 'conectada', herdada_do_ambiente: true, api_key_ciphertext: null }], 'A conta Asaas herdada não está mais configurada no servidor. Conecte a chave da sua conta.'],
    ['sem ciphertext e sem herança', [{ id: 'c', ambiente: 'producao', status: 'conectada', herdada_do_ambiente: false, api_key_ciphertext: null }], 'Este corretor ainda não conectou uma conta Asaas.'],
  ])('%s → AsaasNaoConectado', async (_nome, linhas, mensagem) => {
    const { servico } = servicoCom(linhas);
    const e = await resolverCredencial(servico as never, CORRETOR).catch((x) => x);
    expect(e).toBeInstanceOf(AsaasNaoConectado);
    expect(e.message).toBe(mensagem);
  });

  it('sem ASAAS_TOKEN_ENCRYPTION_KEY → 503 antes de abrir o banco', async () => {
    delete process.env.ASAAS_TOKEN_ENCRYPTION_KEY;
    const { servico } = servicoCom([]);
    const e = await resolverCredencial(servico as never, CORRETOR).catch((x) => x);
    expect(e).toBeInstanceOf(HttpException);
    expect(e.getStatus()).toBe(503);
    expect(e.getResponse()).toEqual({ statusCode: 503, codigo: 'asaas_nao_configurado', message: 'Integração com a Asaas indisponível no momento.' });
    expect(servico.run).not.toHaveBeenCalled();
  });

  it('chave de cifra mal formada → mesmo 503', async () => {
    process.env.ASAAS_TOKEN_ENCRYPTION_KEY = 'curta';
    const { servico } = servicoCom([]);
    const e = await resolverCredencial(servico as never, CORRETOR).catch((x) => x);
    expect(e.getStatus()).toBe(503);
  });
});
