// Fotos de imóvel (ImoveisFotosService) e evento de conversão da venda (ImoveisVendaEventoService) com o SQL
// REAL: PGlite com todas as migrations, RLS ligado e o TenantDb de produção. Bloco B1 da virada: confere as
// regras de hoje (ordem, principal única, primeira foto principal), o isolamento entre contas pela policy
// "Corretor gerencia fotos de seus imoveis" e a fila webhook_logs, que o usuário não consegue gravar.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { CriarFotoDto } from '../../src/imoveis/imoveis-fotos.dto';
import { ImoveisFotosService } from '../../src/imoveis/imoveis-fotos.service';
import { ImoveisGestaoService } from '../../src/imoveis/imoveis-gestao.service';
import { ImoveisVendaEventoService } from '../../src/imoveis/imoveis-venda-evento.service';
import { type BancoTeste, capturarErroHttp, criarBanco } from './harness';

type Linha = Record<string, unknown>;

let banco: BancoTeste;
let fotos: ImoveisFotosService;
let gestao: ImoveisGestaoService;
let evento: ImoveisVendaEventoService;
let imovelA: string;
let imovelA2: string;
let imovelB: string;

const CHAVES_FOTO = ['arquivo_path', 'arquivo_url', 'created_at', 'id', 'imovel_id', 'ordem', 'principal'];
const URL = (n: string) => `https://api.exemplo/api/arquivos/publico/foto/${n}`;
const foto = (imovel: string, nome: string, principal?: boolean): CriarFotoDto =>
  ({ arquivo_path: `${imovel}/1700000000000_${nome}`, arquivo_url: URL(nome), ...(principal === undefined ? {} : { principal }) });

before(async () => {
  banco = await criarBanco();
  fotos = new ImoveisFotosService(banco.db);
  gestao = new ImoveisGestaoService(banco.db);
  evento = new ImoveisVendaEventoService(banco.db, banco.prisma as unknown as PrismaService);
  const imovel = async (corretor_id: string, titulo: string, semGatilhos = false) => (await banco.inserir('imoveis', {
    corretor_id, titulo, tipo: 'CASA', valor: 400000, endereco: 'Rua 1', cidade: 'Anápolis', proprietario_nome: 'Dono',
    tracking_data: { fbclid: `fb-${titulo}` },
  }, { semGatilhos })).id as string;
  imovelA = await imovel(banco.corretorA, 'Casa 1 da A');
  imovelA2 = await imovel(banco.corretorA, 'Casa 2 da A');
  imovelB = await imovel(banco.corretorB, 'Casa do B', true); // B não tem plano: a trava de cota recusaria
});
after(async () => { await banco?.fechar(); });

async function fotosNoBanco(imovel: string): Promise<Linha[]> {
  return banco.sqlSuperusuario<Linha>(
    'select id::text as id, ordem, principal from public.imovel_fotos where imovel_id = $1::uuid order by ordem, created_at, id', [imovel]);
}

describe('criar e listar', () => {
  test('primeira foto é principal com ordem 0; as seguintes recebem a próxima ordem e não são principais', async () => {
    const f1 = await fotos.criar(banco.claimsA, imovelA, foto(imovelA, 'sala.jpg'));
    assert.deepEqual(Object.keys(f1).sort(), CHAVES_FOTO);
    assert.deepEqual([f1.imovel_id, f1.ordem, f1.principal, f1.arquivo_url], [imovelA, 0, true, URL('sala.jpg')]);
    const f2 = await fotos.criar(banco.claimsA, imovelA, foto(imovelA, 'quarto.jpg'));
    const f3 = await fotos.criar(banco.claimsA, imovelA, foto(imovelA, 'cozinha.jpg', false));
    assert.deepEqual([f2.ordem, f2.principal, f3.ordem, f3.principal], [1, false, 2, false]);

    const lista = await fotos.listar(banco.claimsA, imovelA);
    assert.deepEqual(lista.map((f) => f.id), [f1.id, f2.id, f3.id]);
    assert.deepEqual(Object.keys(lista[0]).sort(), CHAVES_FOTO);
  });

  test('foto nova marcada como principal desmarca as outras: uma principal só', async () => {
    const f4 = await fotos.criar(banco.claimsA, imovelA, foto(imovelA, 'fachada.jpg', true));
    assert.equal(f4.principal, true);
    const principais = (await fotosNoBanco(imovelA)).filter((f) => f.principal === true).map((f) => f.id);
    assert.deepEqual(principais, [f4.id]);
  });

  test('isolamento: B não lista, não cria e não vê fotos do imóvel de A', async () => {
    assert.deepEqual(await fotos.listar(banco.claimsB, imovelA), []);
    const antes = (await fotosNoBanco(imovelA)).length;
    assert.deepEqual(await capturarErroHttp(fotos.criar(banco.claimsB, imovelA, foto(imovelA, 'invasao.jpg'))), {
      status: 404, corpo: { statusCode: 404, codigo: 'imovel_nao_encontrado', message: 'Imóvel não encontrado.' },
    });
    assert.equal((await fotosNoBanco(imovelA)).length, antes);
  });

  test('caminho que não começa pela pasta do imóvel responde 400 sem gravar', async () => {
    const r = await capturarErroHttp(fotos.criar(banco.claimsA, imovelA, foto(imovelA2, 'outra.jpg')));
    assert.equal(r.status, 400);
    assert.equal(r.corpo.codigo, 'caminho_invalido');
    assert.deepEqual(await fotosNoBanco(imovelA2), []);
  });
});

describe('reordenar e definirPrincipal', () => {
  test('grava ordem = posição; id de outro imóvel é ignorado', async () => {
    const outra = await fotos.criar(banco.claimsA, imovelA2, foto(imovelA2, 'x.jpg'));
    const ids = (await fotosNoBanco(imovelA)).map((f) => f.id as string);
    const invertidos = [...ids].reverse();
    assert.deepEqual(await fotos.reordenar(banco.claimsA, imovelA, { ids: [...invertidos, outra.id as string] }), { atualizadas: ids.length });
    assert.deepEqual((await fotosNoBanco(imovelA)).map((f) => [f.id, f.ordem]), invertidos.map((id, i) => [id, i]));
    assert.equal((await fotosNoBanco(imovelA2))[0].ordem, 0);
  });

  test('B não reordena as fotos de A', async () => {
    const antes = await fotosNoBanco(imovelA);
    const ids = antes.map((f) => f.id as string);
    assert.deepEqual(await fotos.reordenar(banco.claimsB, imovelA, { ids: [ids[1], ids[0]] }), { atualizadas: 0 });
    assert.deepEqual(await fotosNoBanco(imovelA), antes);
  });

  test('definirPrincipal deixa exatamente uma principal; foto de outro imóvel ou de outra conta → 404', async () => {
    const ids = (await fotosNoBanco(imovelA)).map((f) => f.id as string);
    const alvo = ids[ids.length - 1];
    assert.deepEqual(await fotos.definirPrincipal(banco.claimsA, imovelA, alvo), { imovel_id: imovelA, foto_id: alvo });
    assert.deepEqual((await fotosNoBanco(imovelA)).filter((f) => f.principal).map((f) => f.id), [alvo]);

    const daOutra = (await fotosNoBanco(imovelA2))[0].id as string;
    assert.equal((await capturarErroHttp(fotos.definirPrincipal(banco.claimsA, imovelA, daOutra))).status, 404);
    assert.deepEqual((await fotosNoBanco(imovelA)).filter((f) => f.principal).map((f) => f.id), [alvo]);
    assert.equal((await capturarErroHttp(fotos.definirPrincipal(banco.claimsB, imovelA, ids[0]))).status, 404);
    assert.deepEqual((await fotosNoBanco(imovelA)).filter((f) => f.principal).map((f) => f.id), [alvo]);
  });
});

describe('resumo e remover', () => {
  test('resumo traz imovel_id, arquivo_url e principal dos imóveis pedidos, na ordem de criação; B não vê os de A', async () => {
    await banco.inserir('imovel_fotos', {
      imovel_id: imovelA2, arquivo_path: `${imovelA2}/velha.jpg`, arquivo_url: URL('velha.jpg'), created_at: '2020-01-01T00:00:00Z',
    });
    const r = await fotos.resumo(banco.claimsA, { imovel_ids: [imovelA2, imovelB] });
    assert.deepEqual(r, [
      { imovel_id: imovelA2, arquivo_url: URL('velha.jpg'), principal: false },
      { imovel_id: imovelA2, arquivo_url: URL('x.jpg'), principal: true },
    ]);
    assert.deepEqual(await fotos.resumo(banco.claimsB, { imovel_ids: [imovelA, imovelA2] }), []);
  });

  test('remover apaga a foto de A; B recebe 404 e nada some', async () => {
    const [primeira] = await fotosNoBanco(imovelA2);
    const antes = (await fotosNoBanco(imovelA2)).length;
    assert.deepEqual(await capturarErroHttp(fotos.remover(banco.claimsB, primeira.id as string)), {
      status: 404,
      corpo: { statusCode: 404, codigo: 'foto_nao_encontrada', message: 'Nada foi apagado: a foto não existe ou você não tem permissão.' },
    });
    assert.equal((await fotosNoBanco(imovelA2)).length, antes);
    await fotos.remover(banco.claimsA, primeira.id as string);
    assert.equal((await fotosNoBanco(imovelA2)).length, antes - 1);
  });
});

describe('evento de conversão da venda (webhook_logs)', () => {
  const eventos = () => banco.sqlSuperusuario<{ provider: string; event_type: string; status: string; payload: Linha }>(
    'select provider, event_type, status, payload from public.webhook_logs order by processed_at, id');

  test('o usuário não grava webhook_logs direto (sem policy): era por isso que o evento se perdia', async () => {
    await assert.rejects(
      banco.db.run(banco.claimsA, (tx) => tx.$executeRaw(Prisma.sql`
        insert into public.webhook_logs (event_type, payload, status) values ('SALE_PURCHASE', '{}'::jsonb, 'PENDING')`)),
      (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && (e.meta as { code?: string }).code === '42501',
    );
    assert.deepEqual(await eventos(), []);
  });

  test('imóvel ainda não vendido responde 409 e não enfileira', async () => {
    const r = await capturarErroHttp(evento.enfileirar(banco.claimsA, imovelA, { valor: 1 }));
    assert.equal(r.status, 409);
    assert.equal(r.corpo.codigo, 'imovel_nao_vendido');
    assert.deepEqual(await eventos(), []);
  });

  test('depois da venda, enfileira UTMIFY/SALE_PURCHASE/PENDING com o payload montado do banco', async () => {
    const cliente = (await banco.inserir('clientes', {
      corretor_id: banco.corretorA, nome: 'Ana Maria Souza', telefone: '(62) 98111-0042', email: 'ana@exemplo.com',
      tracking_data: { fbclid: 'fb-cliente' },
    })).id as string;
    await gestao.registrarVenda(banco.claimsA, imovelA, { cliente_id: cliente });
    const r = await evento.enfileirar(banco.claimsA, imovelA, { valor: 510000, cliente_id: cliente });
    assert.equal(r.enfileirado, true);
    const [linha] = await eventos();
    assert.deepEqual([linha.provider, linha.event_type, linha.status], ['UTMIFY', 'SALE_PURCHASE', 'PENDING']);
    assert.deepEqual(linha.payload.customer, { first_name: 'Ana', last_name: 'Maria Souza', email: 'ana@exemplo.com', phone: '62981110042' });
    assert.deepEqual([linha.payload.value, linha.payload.currency, linha.payload.tracking], [510000, 'BRL', { fbclid: 'fb-cliente' }]);
    assert.deepEqual(linha.payload.metadata, { imovel_id: imovelA, imovel_titulo: 'Casa 1 da A', corretor_id: banco.corretorA });
  });

  test('isolamento: B não enfileira evento do imóvel de A (404) e cliente de outra conta vira comprador desconhecido', async () => {
    const antes = (await eventos()).length;
    assert.equal((await capturarErroHttp(evento.enfileirar(banco.claimsB, imovelA, {}))).status, 404);
    assert.equal((await eventos()).length, antes);

    const clienteB = (await banco.inserir('clientes', { corretor_id: banco.corretorB, nome: 'Cliente do B', telefone: '62991110077' })).id as string;
    const { id } = await evento.enfileirar(banco.claimsA, imovelA, { cliente_id: clienteB });
    assert.equal((await eventos()).length, antes + 1);
    const [ultimo] = await banco.sqlSuperusuario<{ payload: Linha }>('select payload from public.webhook_logs where id = $1::uuid', [id]);
    assert.deepEqual(ultimo.payload.customer, { first_name: 'Comprador', last_name: 'Desconhecido', email: '', phone: '' });
    assert.equal(ultimo.payload.value, 400000);
    assert.deepEqual(ultimo.payload.tracking, { fbclid: 'fb-Casa 1 da A' });
  });
});
