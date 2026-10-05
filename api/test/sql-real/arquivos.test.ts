// SQL real das rotas de arquivo (contrato 2026-10-05, Garage §3) contra um Postgres de verdade: PGlite com
// todas as migrations, RLS ligado e o TenantDb de produção. Confere a pergunta de dono do ArquivosRepo: a
// consulta §3 só devolve a key ao dono (RLS, as mesmas policies do PostgREST), tanto por documentos quanto
// pela union com contratos.arquivo_url e por ai_attachments.storage_path; claims inválidas são recusadas.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ArquivosRepo } from '../../src/arquivos/arquivos.repo';
import type { SupabaseClaims } from '../../src/prisma/tenant-db';
import { type BancoTeste, criarBanco } from './harness';

let banco: BancoTeste;
let repo: ArquivosRepo;

let keyDocA: string;
let keyContratoA: string;
let keyAnexoA: string;

before(async () => {
  banco = await criarBanco();
  repo = new ArquivosRepo(banco.db);

  const clienteA = (await banco.inserir('clientes', {
    corretor_id: banco.corretorA, nome: 'Cliente da A', telefone: '62981234567',
  })).id as string;

  keyDocA = `${banco.corretorA}/doc.pdf`;
  await banco.inserir('documentos', {
    corretor_id: banco.corretorA, nome: 'RG da A', tipo: 'RG', arquivo_path: keyDocA,
  });

  keyContratoA = `${banco.corretorA}/contratos/c.pdf`;
  await banco.inserir('contratos', {
    corretor_id: banco.corretorA, cliente_id: clienteA, tipo: 'COMPRA_VENDA', valor: 1000,
    data_inicio: '2026-01-01', conteudo: '', arquivo_url: keyContratoA,
  });

  // documento da B, para o isolamento.
  await banco.inserir('documentos', {
    corretor_id: banco.corretorB, nome: 'RG do B', tipo: 'RG', arquivo_path: `${banco.corretorB}/doc.pdf`,
  });

  // anexo de IA da A: conversa → mensagem → anexo (storage_path é a key).
  const conversa = (await banco.inserir('ai_conversations', { corretor_id: banco.corretorA }, { semGatilhos: true })).id as string;
  const mensagem = (await banco.inserir('ai_messages', { conversation_id: conversa, role: 'user', content: 'oi' }, { semGatilhos: true })).id as string;
  keyAnexoA = 'anexos/a.pdf';
  await banco.inserir('ai_attachments', {
    message_id: mensagem, file_name: 'a.pdf', file_type: 'application/pdf', file_size: 10, storage_path: keyAnexoA,
  }, { semGatilhos: true });
});

after(async () => {
  await banco?.fechar();
});

describe('ArquivosRepo: dono via TenantDb (§3)', () => {
  test('documento: o dono vê a key, a outra conta não', async () => {
    assert.equal(await repo.donoDocumento(banco.claimsA, keyDocA), true);
    assert.equal(await repo.donoDocumento(banco.claimsB, keyDocA), false);
  });

  test('a union libera pela arquivo_url do contrato do dono', async () => {
    assert.equal(await repo.donoDocumento(banco.claimsA, keyContratoA), true);
    assert.equal(await repo.donoDocumento(banco.claimsB, keyContratoA), false);
  });

  test('key que não existe em nenhuma das tabelas → false', async () => {
    assert.equal(await repo.donoDocumento(banco.claimsA, `${banco.corretorA}/inexistente.pdf`), false);
  });

  test('anexo de IA: só o dono da conversa vê o storage_path', async () => {
    assert.equal(await repo.donoAnexoIa(banco.claimsA, keyAnexoA), true);
    assert.equal(await repo.donoAnexoIa(banco.claimsB, keyAnexoA), false);
  });

  test('corretorId devolve o corretor de quem pede', async () => {
    assert.equal(await repo.corretorId(banco.claimsA), banco.corretorA);
    assert.equal(await repo.corretorId(banco.claimsB), banco.corretorB);
  });

  test('claims inválidas são recusadas pelo TenantDb', async () => {
    const claimsRuins = { sub: 'x', role: 'anon' } as unknown as SupabaseClaims;
    await assert.rejects(repo.donoDocumento(claimsRuins, keyDocA), /claims_invalidas/);
  });
});
