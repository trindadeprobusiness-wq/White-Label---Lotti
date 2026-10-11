// SQL real da Central Comercial pela API (back office): tabelas no banco da Lotti, RLS por dono.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CentralComercialService } from '../../src/central-comercial/central-comercial.service';
import { criarBanco } from './harness';

test('Central Comercial: grava, lista, atualiza, faz upsert da projeção e isola as contas', async () => {
  const b = await criarBanco();
  try {
    const s = new CentralComercialService(b.db);
    const [lead] = await s.inserir(b.claimsA, 'central_comercial_leads', { nome_empresa: 'Padaria Sol', cidade: 'Anápolis', owner_id: b.contaB.userId, id: 'x' });
    assert.equal(lead.owner_id, b.contaA.userId, 'o dono vem do token, não do corpo');
    assert.equal(lead.status_contato, 'novo', 'colunas omitidas ficam com o padrão do banco');
    await s.inserir(b.claimsA, 'central_comercial_leads', [{ nome_empresa: 'Oficina Lua' }, { nome_empresa: 'Mercado Sol' }]);
    const lista = await s.listar(b.claimsA, 'central_comercial_leads', { ordem: 'nome_empresa', asc: true });
    assert.deepEqual(lista.map((l) => l.nome_empresa), ['Mercado Sol', 'Oficina Lua', 'Padaria Sol']);
    assert.deepEqual(await s.listar(b.claimsB, 'central_comercial_leads', {}), [], 'a outra conta não vê nada');

    const [atual] = await s.atualizar(b.claimsA, 'central_comercial_leads', { id: String(lead.id) }, { status_contato: 'qualificado', owner_id: b.contaB.userId });
    assert.equal(atual.status_contato, 'qualificado');
    assert.equal(atual.owner_id, b.contaA.userId);
    assert.deepEqual(await s.atualizar(b.claimsB, 'central_comercial_leads', { id: String(lead.id) }, { status_contato: 'novo' }), [], 'B não altera o lead de A');

    await s.inserir(b.claimsA, 'central_comercial_interacoes', { lead_id: lead.id, tipo: 'ligacao', resultado: 'interessado' });
    const [venda] = await s.inserir(b.claimsA, 'central_comercial_vendas', { lead_id: lead.id, valor_contratado: 800 });
    await s.inserir(b.claimsA, 'central_comercial_recebimentos', [{ venda_id: venda.id, valor: 400 }, { venda_id: venda.id, valor: 400 }]);
    assert.equal((await s.listar(b.claimsA, 'central_comercial_recebimentos', { filtros: { venda_id: String(venda.id) } })).length, 2);

    await s.inserir(b.claimsA, 'central_comercial_projecao_config', { ligacoes_dia: 40 }, true);
    await s.inserir(b.claimsA, 'central_comercial_projecao_config', { ligacoes_dia: 50 }, true);
    const config = await s.listar(b.claimsA, 'central_comercial_projecao_config', {});
    assert.equal(config.length, 1);
    assert.equal(config[0].ligacoes_dia, 50);

    await assert.rejects(s.listar(b.claimsA, 'clientes', {}), /tabela_invalida/);
    await assert.rejects(s.listar(b.claimsA, 'central_comercial_leads', { filtros: { 'x;drop': '1' } }), /filtro_invalido/);
  } finally { await b.fechar(); }
});
