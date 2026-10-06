// Bloco B4 da virada com o SQL REAL (PGlite com todas as migrations): vitrine pública (public-imoveis e
// imovel-detalhe), captura pública de lead (lead-capture) e as integrações do n8n (crm-*), pelo caminho do
// dono que a API usa no lugar do service_role. Confere a regra de publicação pela fachada, a allowlist de
// colunas, o limite por telefone, o lead sem dono, o isolamento entre as contas A e B e os formatos de
// resposta das Edge Functions. Nenhuma rede; os segredos são de teste e só vivem durante o arquivo.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { CapturaLeadRepo } from '../../src/crm/integracoes/captura-lead.repo';
import { CapturaLeadService } from '../../src/crm/integracoes/captura-lead.service';
import { CrmN8nRepo } from '../../src/crm/integracoes/crm-n8n.repo';
import { CrmN8nService } from '../../src/crm/integracoes/crm-n8n.service';
import { ImoveisPublicoRepo } from '../../src/imoveis/publico/imoveis-publico.repo';
import { ImoveisPublicoService } from '../../src/imoveis/publico/imoveis-publico.service';
import { type BancoTeste, capturarErroHttp, criarBanco } from './harness';

type Linha = Record<string, unknown>;

let banco: BancoTeste;
let vitrine: ImoveisPublicoService;
let captura: CapturaLeadService;
let n8n: CrmN8nService;

const SEGREDO_N8N = 'segredo-do-n8n-de-teste';
const VARS = ['N8N_SHARED_SECRET', 'PUBLIC_RATE_LIMIT_SECRET'] as const;
const salvas: Record<string, string | undefined> = {};
const TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00:00$/;
const CHAVES_VITRINE = ['area_m2', 'bairro', 'banheiros', 'cidade', 'created_at', 'descricao', 'descricao_curta', 'dormitorios', 'endereco',
  'estado', 'foto_principal', 'fotos', 'garagem', 'id', 'tipo_imovel', 'tipo_negocio', 'titulo', 'valor'];

let casaVendaA: string; // fachada VENDA ativa, anunciado
let aptoAluguelA: string; // fachada ALUGUEL ativa
let ambosB: string; // conta B, fachadas VENDA e TEMPORADA
let semFachadaA: string; // anunciado, sem fachada
let fachadaInativaA: string; // só fachada inativa
let vendidoA: string; // fachada ativa, VENDIDO

const umaLinha = async <T = Linha>(sql: string, params: unknown[] = []): Promise<T> => (await banco.sqlSuperusuario<T>(sql, params))[0];
const contar = async (sql: string, params: unknown[] = []) => Number((await umaLinha<{ n: number }>(sql, params)).n);

async function imovel(corretor: string, dados: Linha, criadoEm: string): Promise<string> {
  return (await banco.inserir('imoveis', {
    corretor_id: corretor, tipo: 'CASA', endereco: 'Rua Pública, 1', cidade: 'Anápolis', estado: 'GO', proprietario_nome: 'Dono Secreto',
    proprietario_cpf: '123.456.789-09', proprietario_telefone: '62999990000', proprietario_email: 'dono@segredo.local',
    created_at: criadoEm, ...dados,
  }, { semGatilhos: true })).id as string;
}
const fachada = (corretor: string, imovelId: string, tipo: string, ativo = true) =>
  banco.inserir('fachadas', { corretor_id: corretor, imovel_id: imovelId, tipo_negocio: tipo, ativo }, { semGatilhos: true });
const foto = (imovelId: string, nome: string, ordem: number, principal = false) =>
  banco.inserir('imovel_fotos', { imovel_id: imovelId, arquivo_path: `${imovelId}/${nome}`, arquivo_url: `https://cdn/${nome}`, ordem, principal });

before(async () => {
  for (const v of VARS) salvas[v] = process.env[v];
  process.env.N8N_SHARED_SECRET = SEGREDO_N8N;
  process.env.PUBLIC_RATE_LIMIT_SECRET = 'segredo-do-limite-de-teste';
  banco = await criarBanco();
  const prisma = banco.prisma as unknown as PrismaService;
  vitrine = new ImoveisPublicoService(new ImoveisPublicoRepo(prisma));
  captura = new CapturaLeadService(new CapturaLeadRepo(prisma));
  n8n = new CrmN8nService(new CrmN8nRepo(prisma));

  casaVendaA = await imovel(banco.corretorA, {
    titulo: 'Casa no Centro', valor: 500000, area_m2: 120.5, dormitorios: 3, banheiros: 2, garagem: 2, bairro: 'Centro',
    descricao: 'Casa ampla com quintal', anunciado: true, cep: '75000-000', finalidade: 'VENDA',
  }, '2026-10-01T10:00:00Z');
  aptoAluguelA = await imovel(banco.corretorA, {
    titulo: 'Apto Jundiaí', tipo: 'APARTAMENTO', valor: 450000, dormitorios: 2, bairro: 'Jundiaí', anunciado: true, finalidade: 'LOCACAO',
  }, '2026-10-02T10:00:00Z');
  ambosB = await imovel(banco.corretorB, {
    titulo: 'Casa do B', valor: 600000, dormitorios: 4, bairro: 'Centro', anunciado: true, finalidade: 'AMBOS', descricao: 'x'.repeat(130),
  }, '2026-10-03T10:00:00Z');
  semFachadaA = await imovel(banco.corretorA, { titulo: 'Sem fachada', valor: 480000, anunciado: true }, '2026-10-04T10:00:00Z');
  fachadaInativaA = await imovel(banco.corretorA, { titulo: 'Fachada pausada', valor: 490000 }, '2026-10-05T10:00:00Z');
  vendidoA = await imovel(banco.corretorA, { titulo: 'Já vendido', valor: 510000, status_venda: 'VENDIDO', anunciado: true }, '2026-10-06T09:00:00Z');

  await fachada(banco.corretorA, casaVendaA, 'VENDA');
  await fachada(banco.corretorA, aptoAluguelA, 'ALUGUEL');
  await fachada(banco.corretorB, ambosB, 'VENDA');
  await fachada(banco.corretorB, ambosB, 'TEMPORADA');
  await fachada(banco.corretorA, fachadaInativaA, 'VENDA', false);
  await fachada(banco.corretorA, vendidoA, 'VENDA');
  await foto(casaVendaA, 'b.jpg', 2);
  await foto(casaVendaA, 'a.jpg', 1, true);
  await foto(casaVendaA, 'z.jpg', 0);
});

after(async () => {
  await banco?.fechar();
  for (const v of VARS) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v];
  }
});

describe('vitrine pública (public-imoveis)', () => {
  test('só imóvel com fachada ATIVA, ativo e DISPONIVEL; mais novo primeiro; total contado antes da página', async () => {
    const r = await vitrine.listar({});
    assert.deepEqual(r.data.map((i) => i.id), [ambosB, aptoAluguelA, casaVendaA]);
    assert.deepEqual([r.total, r.limit, r.offset], [3, 12, 0]);
    const pagina = await vitrine.listar({ limit: '1', offset: '1' });
    assert.deepEqual([pagina.data.map((i) => i.id), pagina.total], [[aptoAluguelA], 3]);
    const alem = await vitrine.listar({ offset: '50' });
    assert.deepEqual([alem.data, alem.total], [[], 3]);
  });

  test('formato do site, sem nenhuma coluna do proprietário', async () => {
    const r = await vitrine.listar({ tipo: 'venda', bairro: 'centro' });
    const casa = r.data.find((i) => i.id === casaVendaA)!;
    assert.deepEqual(Object.keys(casa).sort(), CHAVES_VITRINE);
    assert.deepEqual({ ...casa, created_at: undefined }, {
      id: casaVendaA, titulo: 'Casa no Centro', tipo_imovel: 'CASA', tipo_negocio: 'venda', valor: 500000, area_m2: 120.5, dormitorios: 3,
      banheiros: 2, garagem: 2, endereco: 'Rua Pública, 1', bairro: 'Centro', cidade: 'Anápolis', estado: 'GO',
      descricao: 'Casa ampla com quintal', descricao_curta: 'Casa ampla com quintal', foto_principal: 'https://cdn/a.jpg',
      fotos: ['https://cdn/z.jpg', 'https://cdn/a.jpg', 'https://cdn/b.jpg'], created_at: undefined,
    });
    assert.match(String(casa.created_at), TIMESTAMPTZ);
    assert.doesNotMatch(JSON.stringify(r), /Dono Secreto|123\.456|dono@segredo|62999990000/);
  });

  test('finalidade vem da fachada: ALUGUEL/TEMPORADA são locação; imóvel com as duas aparece nos dois filtros', async () => {
    const venda = await vitrine.listar({ tipo: 'VENDA' });
    assert.deepEqual(venda.data.map((i) => [i.id, i.tipo_negocio]), [[ambosB, 'venda'], [casaVendaA, 'venda']]);
    const aluguel = await vitrine.listar({ tipo: 'aluguel' });
    assert.deepEqual(aluguel.data.map((i) => [i.id, i.tipo_negocio]), [[ambosB, 'aluguel'], [aptoAluguelA, 'aluguel']]);
    // Sem filtro, quem tem fachada de venda aparece como venda.
    const todos = await vitrine.listar({ tipo: 'qualquer' });
    assert.equal(todos.data.find((i) => i.id === ambosB)!.tipo_negocio, 'venda');
    assert.equal(todos.data.find((i) => i.id === aptoAluguelA)!.tipo_negocio, 'aluguel');
  });

  test('filtros de preço, quartos e tipo do imóvel; tipo fora do enum não casa (e não dá 500)', async () => {
    assert.deepEqual((await vitrine.listar({ preco_min: '460000', preco_max: '550000' })).data.map((i) => i.id), [casaVendaA]);
    assert.deepEqual((await vitrine.listar({ quartos_min: '4' })).data.map((i) => i.id), [ambosB]);
    assert.deepEqual((await vitrine.listar({ tipo_imovel: 'apartamento' })).data.map((i) => i.id), [aptoAluguelA]);
    assert.deepEqual(await vitrine.listar({ tipo_imovel: 'COBERTURA' }), { data: [], total: 0, limit: 12, offset: 0 });
    assert.equal((await vitrine.listar({ bairro: 'Centro' })).data.find((i) => i.id === ambosB)!.descricao_curta, `${'x'.repeat(120)}...`);
  });

  test('erros de filtro no formato { error }', async () => {
    assert.deepEqual(await capturarErroHttp(vitrine.listar({ preco_min: '9', preco_max: '1' })), { status: 400, corpo: { error: 'Faixa de preço inválida.' } });
  });
});

describe('detalhe público (imovel-detalhe)', () => {
  test('imóvel anunciado com fotos e similares de qualquer conta na faixa de ±30%', async () => {
    const r = await vitrine.detalhe({ id: casaVendaA });
    assert.equal(r.data.id, casaVendaA);
    assert.deepEqual([r.data.cep, r.data.tipo_negocio, r.data.foto_principal, r.data.descricao_curta],
      ['75000-000', 'venda', 'https://cdn/a.jpg', 'Casa ampla com quintal...']);
    assert.doesNotMatch(JSON.stringify(r), /Dono Secreto|123\.456|dono@segredo|proprietario/);
    // 500000 ± 30% = 350000..650000, só anunciados e DISPONIVEL (o vendido e o não anunciado ficam de fora).
    assert.deepEqual(r.similares.map((s) => s.id).sort(), [ambosB, aptoAluguelA, semFachadaA].sort());
    const apto = r.similares.find((s) => s.id === aptoAluguelA)!;
    assert.deepEqual(Object.keys(apto).sort(), ['area_m2', 'bairro', 'cidade', 'dormitorios', 'foto_principal', 'garagem', 'id', 'tipo_imovel', 'tipo_negocio', 'titulo', 'valor']);
    assert.equal(apto.tipo_negocio, 'aluguel');
  });

  test('não anunciado, vendido ou inexistente → 404 da Edge', async () => {
    for (const id of [fachadaInativaA, vendidoA, '99999999-9999-4999-8999-999999999999']) {
      assert.deepEqual(await capturarErroHttp(vitrine.detalhe({ id })), { status: 404, corpo: { error: 'Imóvel não encontrado ou não disponível' } });
    }
  });
});

describe('captura pública de lead (lead-capture)', () => {
  const entrada = (corpo: unknown, opcoes: { segredo?: string | null; imovel?: string | null } = {}) => ({
    segredo: opcoes.segredo ?? null, imovelIdDaQuery: opcoes.imovel ?? null, lerCorpo: async () => corpo,
  });

  test('com o imóvel do link: cliente da conta dona, vínculo, alerta e resposta genérica ao visitante', async () => {
    const r = await captura.capturar(entrada({ nome: 'Visitante Um', telefone: '(62) 98111-0001', email: 'um@teste.local', utm_source: 'meta' }, { imovel: casaVendaA }));
    assert.deepEqual(r, { success: true, message: 'Recebemos seu contato! Em breve alguém falará com você.' });
    const cliente = await umaLinha<Linha>(`select id::text as id, corretor_id::text as corretor, nome, telefone, email, status_funil::text as status,
      tipo_interesse::text as interesse, tracking_data from public.clientes where telefone = '5562981110001'`);
    assert.deepEqual([cliente.corretor, cliente.nome, cliente.email, cliente.status, cliente.interesse], [banco.corretorA, 'Visitante Um', 'um@teste.local', 'QUALIFICACAO', 'AMBOS']);
    assert.deepEqual((cliente.tracking_data as Linha).utm_source, 'meta');
    assert.equal((cliente.tracking_data as Linha).origem, 'landing_page');
    assert.equal(await contar('select count(*)::int as n from public.cliente_imovel where cliente_id = $1::uuid and imovel_id = $2::uuid', [cliente.id, casaVendaA]), 1);
    const alerta = await umaLinha<Linha>(`select tipo::text as tipo, mensagem, metadata from public.alertas where cliente_id = $1::uuid`, [cliente.id]);
    assert.equal(alerta.tipo, 'GERAL');
    assert.equal(alerta.mensagem, 'NOVO lead do site: Visitante Um (5562981110001) — direto');
    assert.equal((alerta.metadata as Linha).lead_type, 'new');
  });

  test('retorno anônimo não troca nome nem e-mail; integração recebe cliente_id e is_new', async () => {
    const r = await captura.capturar(entrada({ nome: 'Outro Nome', telefone: '62981110001', email: 'outro@teste.local' }, { imovel: casaVendaA, segredo: SEGREDO_N8N }));
    const cliente = await umaLinha<Linha>(`select id::text as id, nome, email, tracking_data from public.clientes where telefone = '5562981110001'`);
    assert.deepEqual(r, { success: true, message: 'Recebemos seu contato! Em breve alguém falará com você.', cliente_id: cliente.id, is_new: false, qualificar_com_ia: false });
    assert.deepEqual([cliente.nome, cliente.email], ['Visitante Um', 'um@teste.local']);
    assert.equal(((cliente.tracking_data as Linha).ultimo_retorno as Linha).email_informado, 'outro@teste.local');
    assert.equal(await contar(`select count(*)::int as n from public.cliente_imovel where cliente_id = $1::uuid`, [cliente.id]), 1);
    // A integração consultou a cota (conta A sem a feature): o aviso de plano sai uma vez por mês.
    await captura.capturar(entrada({ nome: 'Outro Nome', telefone: '62981110001' }, { imovel: casaVendaA, segredo: SEGREDO_N8N }));
    assert.equal(await contar(`select count(*)::int as n from public.alertas where corretor_id = $1::uuid and entidade_tipo = 'plano'`, [banco.corretorA]), 1);
  });

  test('sem imóvel e com duas contas: lead guardado sem dono, 200 igual para o visitante', async () => {
    const antes = await contar('select count(*)::int as n from public.clientes');
    const r = await captura.capturar(entrada({ nome: 'Sem Dono', telefone: '62981110002', mensagem: 'Oi' }));
    assert.deepEqual(r, { success: true, message: 'Recebemos seu contato! Em breve alguém falará com você.' });
    const orfao = await umaLinha<Linha>(`select nome, telefone, mensagem, motivo from public.leads_sem_destino where telefone = '5562981110002'`);
    assert.deepEqual(orfao, { nome: 'Sem Dono', telefone: '5562981110002', mensagem: 'Oi', motivo: 'multiplos_corretores_sem_imovel_id' });
    assert.equal(await contar('select count(*)::int as n from public.clientes'), antes);
  });

  test('limite por telefone: 5 em 10 minutos; o sexto é 429 e não grava', async () => {
    for (let i = 0; i < 5; i += 1) await captura.capturar(entrada({ nome: 'Insistente', telefone: '62981110003' }, { imovel: aptoAluguelA }));
    const alertas = await contar('select count(*)::int as n from public.alertas');
    assert.deepEqual(await capturarErroHttp(captura.capturar(entrada({ nome: 'Insistente', telefone: '62981110003' }, { imovel: aptoAluguelA }))),
      { status: 429, corpo: { success: false, error: 'Muitas tentativas. Aguarde alguns minutos.' } });
    assert.equal(await contar('select count(*)::int as n from public.alertas'), alertas);
    // A chave guardada é o HMAC, nunca o telefone.
    assert.equal(await contar(`select count(*)::int as n from public.public_request_limits where subject_hash like '%62981110003%'`), 0);
  });

  test('imóvel inexistente → 400 sem gravar', async () => {
    assert.deepEqual(await capturarErroHttp(captura.capturar(entrada({ nome: 'Ana', telefone: '62981110004' }, { imovel: '99999999-9999-4999-8999-999999999999' }))),
      { status: 400, corpo: { success: false, error: 'Imóvel inválido.' } });
    assert.equal(await contar(`select count(*)::int as n from public.clientes where telefone = '5562981110004'`), 0);
  });
});

describe('integrações do n8n (crm-*)', () => {
  test('crm-upsert-lead: corretor obrigatório com duas contas; cliente novo na conta informada', async () => {
    assert.deepEqual(await capturarErroHttp(n8n.upsertLead({ telefone: '62981110010' })),
      { status: 400, corpo: { error: 'Há mais de um corretor cadastrado: informe corretor_id no payload.' } });
    const r = await n8n.upsertLead({
      telefone: '62981110010', corretor_id: banco.corretorB, nome: 'Lead do B', tipo_interesse: 'ALUGUEL', classificacao: 'quente',
      faixa_valor_max: 3000, imovel_interesse: ambosB, observacoes: 'quer 3 quartos',
    });
    const cliente = await umaLinha<Linha>(`select id::text as id, corretor_id::text as corretor, nome, tipo_interesse::text as interesse,
      status_funil::text as status, observacoes, tracking_data from public.clientes where id = $1::uuid`, [r.cliente_id]);
    assert.deepEqual(r, { success: true, cliente_id: cliente.id, classificacao: 'quente' });
    assert.deepEqual([cliente.corretor, cliente.nome, cliente.interesse, cliente.status, cliente.observacoes],
      [banco.corretorB, 'Lead do B', 'LOCACAO', 'VISITA_PROPOSTA', 'quer 3 quartos']);
    assert.deepEqual(cliente.tracking_data, { origem: 'whatsapp', canal: 'evolution_api', classificacao: 'quente', faixa_valor_max: 3000 });
    assert.equal(await contar('select count(*)::int as n from public.cliente_imovel where cliente_id = $1::uuid and imovel_id = $2::uuid', [cliente.id, ambosB]), 1);
    assert.equal(await contar(`select count(*)::int as n from public.alertas where cliente_id = $1::uuid and tipo = 'FOLLOWUP'`, [cliente.id]), 1);
  });

  test('crm-upsert-lead: mesmo telefone em outra grafia atualiza o mesmo cliente; imóvel de outra conta não é vinculado', async () => {
    const primeiro = await umaLinha<{ id: string }>(`select id::text as id from public.clientes where telefone = '62981110010'`);
    const r = await n8n.upsertLead({
      telefone: '+55 (62) 98111-0010', corretor_id: banco.corretorB, classificacao: 'descartado', tracking_data: { etapa: 'fim' }, imovel_interesse: casaVendaA,
    });
    assert.equal(r.cliente_id, primeiro.id);
    const cliente = await umaLinha<Linha>(`select nome, status_funil::text as status, observacoes, tracking_data from public.clientes where id = $1::uuid`, [primeiro.id]);
    // Nome e observações ficam (não vieram); status muda; tracking soma.
    assert.deepEqual([cliente.nome, cliente.status, cliente.observacoes], ['Lead do B', 'FECHADO_PERDIDO', 'quer 3 quartos']);
    assert.deepEqual(cliente.tracking_data, { origem: 'whatsapp', canal: 'evolution_api', classificacao: 'descartado', faixa_valor_max: 3000, etapa: 'fim' });
    assert.equal(await contar('select count(*)::int as n from public.cliente_imovel where cliente_id = $1::uuid and imovel_id = $2::uuid', [primeiro.id, casaVendaA]), 0);
    // A conta A, com o mesmo número, ganha um cliente próprio: dedupe sempre dentro da conta.
    const deA = await n8n.upsertLead({ telefone: '62981110010', corretor_id: banco.corretorA });
    assert.notEqual(deA.cliente_id, primeiro.id);
  });

  test('crm-buscar-imoveis: só a conta pedida, DISPONIVEL e ativo, com as colunas reais', async () => {
    const r = await n8n.buscarImoveis({ corretor_id: banco.corretorA, tipo: 'VENDA', limit: '10' });
    assert.equal(r.success, true);
    const ids = r.imoveis.map((i) => i.id);
    assert.ok(ids.includes(casaVendaA) && ids.includes(semFachadaA) && ids.includes(fachadaInativaA));
    assert.ok(!ids.includes(aptoAluguelA) && !ids.includes(vendidoA) && !ids.includes(ambosB));
    assert.equal(r.total, ids.length);
    const casa = r.imoveis.find((i) => i.id === casaVendaA)!;
    assert.deepEqual(Object.keys(casa).sort(), ['bairro', 'categoria', 'cidade', 'dormitorios', 'fotos', 'id', 'tipo', 'titulo', 'url_website', 'valor']);
    assert.deepEqual([casa.tipo, casa.categoria, casa.valor, casa.url_website, casa.fotos], ['VENDA', 'CASA', 500000, null, ['https://cdn/z.jpg', 'https://cdn/a.jpg', 'https://cdn/b.jpg']]);
    const aluguel = await n8n.buscarImoveis({ corretor_id: banco.corretorA, tipo: 'ALUGUEL', categoria: 'apartamento', dormitorios: '2', cidade: 'anáp' });
    assert.deepEqual(aluguel.imoveis.map((i) => [i.id, i.tipo]), [[aptoAluguelA, 'ALUGUEL']]);
    const deB = await n8n.buscarImoveis({ corretor_id: banco.corretorB, valor_min: '550000' });
    assert.deepEqual(deB.imoveis.map((i) => [i.id, i.tipo]), [[ambosB, 'AMBOS']]);
    assert.deepEqual(await capturarErroHttp(n8n.buscarImoveis({ corretor_id: '99999999-9999-4999-8999-999999999999' })),
      { status: 400, corpo: { success: false, error: 'corretor_id informado não existe' } });
  });

  test('crm-anexar-historico: por telefone dentro da conta; cliente de outra conta não é achado', async () => {
    const cliente = await umaLinha<{ id: string }>(`select id::text as id from public.clientes where telefone = '62981110010' and corretor_id = $1::uuid`, [banco.corretorB]);
    const r = await n8n.anexarHistorico({ telefone: '62981110010', corretor_id: banco.corretorB, direcao: 'IN', mensagem: 'Quero visitar', metadata: { msg_id: 'm1' } });
    assert.deepEqual({ ...r, historico_id: undefined }, { success: true, historico_id: undefined, cliente_id: cliente.id });
    const h = await umaLinha<Linha>(`select tipo::text as tipo, direcao::text as direcao, conteudo, metadata from public.historico_contatos where id = $1::uuid`, [r.historico_id]);
    assert.deepEqual(h, { tipo: 'WHATSAPP', direcao: 'IN', conteudo: 'Quero visitar', metadata: { msg_id: 'm1' } });
    // O cliente de B não existe para A, nem por id.
    assert.deepEqual(await capturarErroHttp(n8n.anexarHistorico({ cliente_id: cliente.id, corretor_id: banco.corretorA, direcao: 'IN', mensagem: 'x' })),
      { status: 404, corpo: { error: 'cliente não encontrado; chame crm-upsert-lead antes' } });
    assert.deepEqual(await capturarErroHttp(n8n.anexarHistorico({ cliente_id: cliente.id, direcao: 'SIDEWAYS', mensagem: 'x' })),
      { status: 400, corpo: { success: false, error: 'direcao deve ser IN ou OUT' } });
    assert.equal(await contar('select count(*)::int as n from public.historico_contatos where cliente_id = $1::uuid', [cliente.id]), 1);
  });
});
