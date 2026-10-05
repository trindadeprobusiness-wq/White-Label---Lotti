// SQL real do módulo parceiros (contrato 2026-10-05 §3.2) contra um Postgres de verdade: PGlite com todas
// as migrations, RLS ligado, o TenantDb de produção e o caminho do dono pela conexão do Prisma. Cobre as
// rotas P1, T1–T4, B1–B44 e D1 (caminho felizmente completo, isolamento entre as contas A e B e erros), e
// as travas de §0.6 nas constraints e nos gatilhos. Nenhuma rede: a porta de convite é a ConviteSemProvedor.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/parceiros/admin/admin.service';
import { ConviteService } from '../../src/parceiros/convite/convite.service';
import { ConviteSemProvedor } from '../../src/parceiros/convite/porta-convite';
import { DiagnosticoRepo } from '../../src/parceiros/diagnostico/diagnostico.repo';
import { DiagnosticoService } from '../../src/parceiros/diagnostico/diagnostico.service';
import { PortalService } from '../../src/parceiros/portal/portal.service';
import { ParceirosPublicoRepo } from '../../src/parceiros/publico/parceiros-publico.repo';
import { ParceirosPublicoService } from '../../src/parceiros/publico/parceiros-publico.service';
import { type BancoTeste, capturarErroHttp, criarBanco } from './harness';

let banco: BancoTeste;
let publico: ParceirosPublicoService;
let portal: PortalService;
let convite: ConviteService;
let admin: AdminService;
let diagnostico: DiagnosticoService;
/** Parceiro cujo indicado é a própria conta A: usado no caso 18 para ver o embed de corretores. */
let parceiroDeA: ParceiroCriado;

const TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00:00$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const VARIAVEIS = ['PARCEIRO_ORIGENS_PERMITIDAS', 'IP_HASH_SALT', 'PUBLIC_RATE_LIMIT_SECRET', 'PARCEIRO_APP_URL', 'PARCEIRO_PORTAL_URL'];
const salvas: Record<string, string | undefined> = {};

/** v4 canônico, o que o navegador gera. */
const visitante = () => randomUUID();

async function falha(promessa: Promise<unknown>, status: number, codigo: string): Promise<Record<string, unknown>> {
  const r = await capturarErroHttp(promessa);
  assert.equal(r.status, status, JSON.stringify(r.corpo));
  assert.equal(r.corpo.codigo, codigo, JSON.stringify(r.corpo));
  return r.corpo;
}

interface ParceiroCriado {
  id: string;
  linkId: string;
  slug: string;
  email: string;
}

/** Monta parceiro + link principal + vigência por superusuário (fora de RLS). */
async function criarParceiro(opcoes: {
  nome?: string; email?: string; status?: string; slug?: string; janela?: number; percentual?: number; teto?: number | null;
} = {}): Promise<ParceiroCriado> {
  const sufixo = randomUUID().slice(0, 8);
  const email = opcoes.email ?? `parceiro-${sufixo}@teste.lotti.local`;
  const parceiro = await banco.inserir('parceiros', {
    nome: opcoes.nome ?? `Parceiro ${sufixo}`,
    email,
    status: opcoes.status ?? 'ativo',
    janela_atribuicao_dias: opcoes.janela ?? 90,
  });
  const id = String(parceiro.id);
  const slug = opcoes.slug ?? `parceiro-${sufixo}`;
  const link = await banco.inserir('parceiro_links', { parceiro_id: id, slug, principal: true });
  await banco.inserir('parceiro_percentuais', {
    parceiro_id: id,
    percentual: opcoes.percentual ?? 10,
    base_calculo: 'receita_bruta',
    teto_renovacoes: opcoes.teto ?? null,
  });
  return { id, linkId: String(link.id), slug, email };
}

const contar = async (sql: string, params: unknown[] = []): Promise<number> => {
  const r = await banco.sqlSuperusuario<{ n: number }>(sql, params);
  return Number(r[0].n);
};

before(async () => {
  for (const v of VARIAVEIS) { salvas[v] = process.env[v]; delete process.env[v]; }
  process.env.PUBLIC_RATE_LIMIT_SECRET = 'segredo-de-teste';
  banco = await criarBanco();
  // A conta A é super_admin: cobre is_admin() e as rotas que exigem exigir_super_admin (receita, config).
  await banco.inserir('user_roles', { user_id: banco.contaA.userId, role: 'super_admin' });
  // As migrations criam a tabela vazia; o ambiente real já tem estas chaves (B40b/B41 leem e escrevem nelas).
  await banco.inserir('admin_config', { chave: 'programa_hold_dias', valor: 0, descricao: 'Dias de hold do repasse' });
  await banco.inserir('admin_config', { chave: 'programa_saldo_minimo', valor: 0, descricao: 'Saldo mínimo do repasse' });
  const repo = new ParceirosPublicoRepo(banco.prisma as unknown as PrismaService);
  publico = new ParceirosPublicoService(repo);
  portal = new PortalService(banco.db);
  convite = new ConviteService(banco.db, new ConviteSemProvedor());
  admin = new AdminService(banco.db);
  diagnostico = new DiagnosticoService(new DiagnosticoRepo(banco.prisma as unknown as PrismaService));
});

after(async () => {
  for (const v of VARIAVEIS) { if (salvas[v] === undefined) delete process.env[v]; else process.env[v] = salvas[v]; }
  await banco?.fechar();
});

describe('P1 clique', () => {
  test('1. primeiro clique vence: o segundo parceiro não sobrescreve', async () => {
    const um = await criarParceiro();
    const dois = await criarParceiro();
    const v = visitante();
    const a = await publico.registrarClique({ slug: um.slug, visitante_id: v }, {});
    const b = await publico.registrarClique({ slug: dois.slug, visitante_id: v }, {});
    assert.deepEqual(Object.keys(a).sort(), ['ok', 'parceiro_nome']);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    const atribuicoes = await banco.sqlSuperusuario<{ parceiro_id: string }>(
      `select parceiro_id::text as parceiro_id from public.parceiro_atribuicoes where visitante_id = $1::uuid`, [v]);
    assert.deepEqual(atribuicoes, [{ parceiro_id: um.id }]);
    assert.equal(await contar(`select count(*)::int as n from public.parceiro_cliques where visitante_id = $1::uuid`, [v]), 2);
  });

  test('2. janela de 90 dias (e 30 quando a coluna diz 30) vem do banco', async () => {
    for (const [janela, min, max] of [[90, 89, 91], [30, 29, 31]] as const) {
      const p = await criarParceiro({ janela });
      const v = visitante();
      await publico.registrarClique({ slug: p.slug, visitante_id: v }, {});
      const [linha] = await banco.sqlSuperusuario<{ dias: number; janela_dias: number }>(
        `select extract(epoch from (expira_em - primeiro_clique_em))::float8 / 86400 as dias, janela_dias
           from public.parceiro_atribuicoes where visitante_id = $1::uuid`, [v]);
      assert.ok(linha.dias > min && linha.dias < max, `dias = ${linha.dias}`);
      assert.equal(linha.janela_dias, janela);
    }
  });

  test('3. slug inexistente, link revogado e parceiro inativo respondem igual e não gravam nada', async () => {
    const revogado = await criarParceiro();
    await banco.sqlSuperusuario(`update public.parceiro_links set ativo = false, revogado_em = now() where id = $1::uuid`, [revogado.linkId]);
    const inativo = await criarParceiro({ status: 'inativo' });
    const antesCliques = await contar('select count(*)::int as n from public.parceiro_cliques');
    const antesAtribuicoes = await contar('select count(*)::int as n from public.parceiro_atribuicoes');
    for (const slug of ['slug-que-nao-existe', revogado.slug, inativo.slug]) {
      assert.deepEqual(await publico.registrarClique({ slug, visitante_id: visitante() }, {}), { ok: false });
    }
    assert.equal(await contar('select count(*)::int as n from public.parceiro_cliques'), antesCliques);
    assert.equal(await contar('select count(*)::int as n from public.parceiro_atribuicoes'), antesAtribuicoes);
  });

  test('4. a resposta do clique não traz id nenhum', async () => {
    const p = await criarParceiro();
    const r = await publico.registrarClique({ slug: p.slug, visitante_id: visitante() }, {});
    assert.deepEqual(Object.keys(r), ['ok', 'parceiro_nome']);
    assert.ok(!JSON.stringify(r).includes(p.id));
  });
});

describe('T1 atribuição', () => {
  test('5. conversão da conta A, e a segunda chamada é idempotente', async () => {
    const p = await criarParceiro();
    parceiroDeA = p;
    const v = visitante();
    await publico.registrarClique({ slug: p.slug, visitante_id: v }, {});
    const r = await publico.reivindicarAtribuicao(banco.claimsA, { visitante_id: v });
    assert.deepEqual(r, { ok: true, parceiro_nome: (await nomeDoParceiro(p.id)) });
    const [linha] = await banco.sqlSuperusuario<{ status: string; user_id: string; corretor_id: string; convertido: boolean }>(
      `select status, user_id::text as user_id, corretor_id::text as corretor_id, convertido_em is not null as convertido
         from public.parceiro_atribuicoes where visitante_id = $1::uuid`, [v]);
    assert.equal(linha.status, 'convertida');
    assert.equal(linha.user_id, banco.contaA.userId);
    assert.equal(linha.corretor_id, banco.corretorA);
    assert.equal(linha.convertido, true);

    assert.deepEqual(await publico.reivindicarAtribuicao(banco.claimsA, { visitante_id: v }), { ok: true, ja_atribuido: true });
  });

  test('6. autoindicação é registrada, não apagada', async () => {
    const p = await criarParceiro({ email: banco.contaB.email });
    const v = visitante();
    await publico.registrarClique({ slug: p.slug, visitante_id: v }, {});
    assert.deepEqual(await publico.reivindicarAtribuicao(banco.claimsB, { visitante_id: v }), { ok: false });
    const [linha] = await banco.sqlSuperusuario<{ status: string; motivo: string }>(
      `select status, motivo_invalidacao as motivo from public.parceiro_atribuicoes where visitante_id = $1::uuid`, [v]);
    assert.equal(linha.status, 'invalidada');
    assert.ok(linha.motivo.startsWith('autoindicação'), linha.motivo);
  });

  test('7. janela expirada invalida com o motivo da janela', async () => {
    const p = await criarParceiro();
    const v = visitante();
    await publico.registrarClique({ slug: p.slug, visitante_id: v }, {});
    await banco.sqlSuperusuario(`update public.parceiro_atribuicoes set expira_em = now() - interval '1 day' where visitante_id = $1::uuid`, [v]);
    const conta = await banco.criarConta();
    assert.deepEqual(await publico.reivindicarAtribuicao(conta.claims, { visitante_id: v }), { ok: false });
    const [linha] = await banco.sqlSuperusuario<{ status: string; motivo: string }>(
      `select status, motivo_invalidacao as motivo from public.parceiro_atribuicoes where visitante_id = $1::uuid`, [v]);
    assert.equal(linha.status, 'invalidada');
    assert.equal(linha.motivo, 'janela de atribuição expirada');
  });

  test('8. uma conta só pode ter uma origem (uq_atribuicao_user)', async () => {
    const conta = await banco.criarConta();
    const um = await criarParceiro();
    const dois = await criarParceiro();
    const v1 = visitante();
    const v2 = visitante();
    await publico.registrarClique({ slug: um.slug, visitante_id: v1 }, {});
    await publico.registrarClique({ slug: dois.slug, visitante_id: v2 }, {});
    assert.equal((await publico.reivindicarAtribuicao(conta.claims, { visitante_id: v1 })).ok, true);
    assert.deepEqual(await publico.reivindicarAtribuicao(conta.claims, { visitante_id: v2 }), { ok: true, ja_atribuido: true });
    const [segunda] = await banco.sqlSuperusuario<{ status: string }>(
      `select status from public.parceiro_atribuicoes where visitante_id = $1::uuid`, [v2]);
    assert.equal(segunda.status, 'pendente');
  });
});

async function nomeDoParceiro(id: string): Promise<string> {
  const r = await banco.sqlSuperusuario<{ nome: string }>('select nome from public.parceiros where id = $1::uuid', [id]);
  return r[0].nome;
}

describe('B9–B17 receita, comissão e vigência', () => {
  test('9–11. comissão nasce do gatilho, estorno e vigência nova', async () => {
    const p = await criarParceiro({ percentual: 10 });
    const conta = await banco.criarConta();
    const v = visitante();
    await publico.registrarClique({ slug: p.slug, visitante_id: v }, {});
    assert.equal((await publico.reivindicarAtribuicao(conta.claims, { visitante_id: v })).ok, true);

    // 9. B16 registra receita; a comissão vem do gatilho, não da API.
    const confirmado = new Date(Date.now() - 60_000).toISOString();
    const receita = await admin.registrarReceita(banco.claimsA, {
      corretor_id: conta.corretorId, valor_bruto: 200, confirmado_em: confirmado, motivo: 'receita de teste conferida',
    }) as { id: string };
    const comissoes = await banco.sqlSuperusuario<{ id: string; percentual: string; base: string; status: string }>(
      `select id::text as id, percentual_aplicado::text as percentual, valor_base::text as base, status
         from public.parceiro_comissoes where parceiro_id = $1::uuid`, [p.id]);
    assert.equal(comissoes.length, 1);
    assert.equal(Number(comissoes[0].percentual), 10);
    assert.equal(Number(comissoes[0].base), 200);
    assert.equal(comissoes[0].status, 'pendente');

    // 11. B9 abre vigência nova: o gatilho fecha a anterior e a comissão já gerada não muda.
    const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await admin.definirPercentual(banco.claimsA, p.id, { percentual: 20, base_calculo: 'receita_bruta', vigencia_inicio: amanha });
    const vigencias = await banco.sqlSuperusuario<{ percentual: string; fim: string | null }>(
      `select percentual::text as percentual, vigencia_fim::text as fim from public.parceiro_percentuais
        where parceiro_id = $1::uuid order by vigencia_inicio asc`, [p.id]);
    assert.equal(vigencias.length, 2);
    assert.ok(vigencias[0].fim !== null);
    assert.equal(vigencias[1].fim, null);
    const [depois] = await banco.sqlSuperusuario<{ percentual: string }>(
      `select percentual_aplicado::text as percentual from public.parceiro_comissoes where id = $1::uuid`, [comissoes[0].id]);
    assert.equal(Number(depois.percentual), 10);

    // 10. B17 estorna; o gatilho estorna a comissão. O segundo estorno é recusado pela regra.
    await admin.estornarReceita(banco.claimsA, receita.id, { motivo: 'chargeback confirmado no banco' });
    const [estornada] = await banco.sqlSuperusuario<{ receita: string; comissao: string }>(
      `select r.status as receita, c.status as comissao from public.receita_eventos r
         join public.parceiro_comissoes c on c.receita_evento_id = r.id where r.id = $1::uuid`, [receita.id]);
    assert.equal(estornada.receita, 'estornado');
    assert.equal(estornada.comissao, 'estornada');
    await falha(admin.estornarReceita(banco.claimsA, receita.id, { motivo: 'tentando de novo agora' }), 422, 'receita_nao_confirmada');
  });

  test('17. lote de repasse: elegíveis, gerar, exportar, pagar e cancelar', async () => {
    const p = await criarParceiro({ percentual: 10 });
    await banco.sqlSuperusuario(
      `update public.parceiros set documento = '12345678901', chave_pix = '12345678901', tipo_chave_pix = 'cpf' where id = $1::uuid`,
      [p.id]);
    const conta = await banco.criarConta();
    const v = visitante();
    await publico.registrarClique({ slug: p.slug, visitante_id: v }, {});
    await publico.reivindicarAtribuicao(conta.claims, { visitante_id: v });
    await admin.registrarReceita(banco.claimsA, {
      corretor_id: conta.corretorId, valor_bruto: 500, confirmado_em: new Date(Date.now() - 60_000).toISOString(),
      motivo: 'receita para o lote de teste',
    });
    const [comissao] = await banco.sqlSuperusuario<{ id: string }>(
      `select id::text as id from public.parceiro_comissoes where parceiro_id = $1::uuid`, [p.id]);
    await admin.transicionarComissao(banco.claimsA, comissao.id, { novo_status: 'aprovada' });

    const elegiveis = await admin.elegiveisRepasse(banco.claimsA, 0) as { itens: Array<{ parceiro_id: string }> };
    assert.ok(elegiveis.itens.some((i) => i.parceiro_id === p.id), JSON.stringify(elegiveis));

    const lote = await admin.gerarLote(banco.claimsA, { parceiro_ids: [p.id] }) as { id: string; total_comissoes: number };
    assert.equal(lote.total_comissoes, 1);
    await admin.marcarLoteExportado(banco.claimsA, lote.id);
    await admin.marcarLotePago(banco.claimsA, lote.id, { pago_em: new Date().toISOString().slice(0, 10), referencia: 'TED 998' });
    const [paga] = await banco.sqlSuperusuario<{ status: string }>(
      `select status from public.parceiro_comissoes where id = $1::uuid`, [comissao.id]);
    assert.equal(paga.status, 'paga');
    assert.equal(await contar(`select count(*)::int as n from public.parceiro_pagamentos where parceiro_id = $1::uuid`, [p.id]), 1);
    await falha(admin.cancelarLote(banco.claimsA, lote.id, { motivo: 'cancelando depois de pago' }), 422, 'lote_pago');

    const detalhe = await admin.lote(banco.claimsA, lote.id);
    assert.ok(detalhe && typeof detalhe === 'object');
    const lotes = await admin.listarLotes(banco.claimsA, {});
    assert.ok(lotes && typeof lotes === 'object');
    const comissoes = await admin.listarComissoes(banco.claimsA, { parceiro_id: p.id });
    assert.ok(comissoes && typeof comissoes === 'object');
    const receitas = await admin.listarReceita(banco.claimsA, { corretor_id: conta.corretorId });
    assert.ok(receitas && typeof receitas === 'object');
  });
});

describe('B1–B11 parceiros e auditoria', () => {
  test('12–13. auditoria é append-only e B3 devolve number', async () => {
    const antes = await contar('select count(*)::int as n from public.admin_auditoria');
    const criado = await admin.criarParceiro(banco.claimsA, {
      nome: 'Parceiro do Backoffice', email: `backoffice-${randomUUID().slice(0, 8)}@teste.lotti.local`, status: 'ativo',
    });
    await admin.editarParceiro(banco.claimsA, criado.id, { status: 'inativo', observacoes: 'em revisão' });
    const link = await admin.criarLink(banco.claimsA, criado.id, { slug: `backoffice-${randomUUID().slice(0, 8)}`, principal: true });
    assert.ok(link.slug.startsWith('backoffice-'));
    assert.ok(await contar('select count(*)::int as n from public.admin_auditoria') > antes);

    const trilha = await admin.registrarAuditoria(banco.claimsA, { acao: 'teste_manual', entidade: 'parceiros', entidade_id: criado.id });
    assert.equal(typeof trilha.id, 'number');
    const auditoria = await admin.listarAuditoria(banco.claimsA, { entidade: 'parceiros' }) as { itens?: unknown[] };
    assert.ok(auditoria && typeof auditoria === 'object');

    // O gatilho tr_admin_auditoria_imutavel recusa UPDATE até do superusuário.
    await assert.rejects(
      banco.sqlSuperusuario(`update public.admin_auditoria set acao = 'x' where id = $1::int`, [trilha.id]),
      /append-only/,
    );

    // B11 revoga o link e a segunda vez dá 404.
    assert.deepEqual(await admin.revogarLink(banco.claimsA, link.id), { revogado: true });
    await falha(admin.revogarLink(banco.claimsA, '99999999-9999-4999-8999-999999999999'), 404, 'nao_encontrado');
    await falha(admin.editarParceiro(banco.claimsA, criado.id, {}), 400, 'nada_para_atualizar');
  });

  test('18. B6 devolve o formato do PostgREST', async () => {
    const p = await criarParceiro();
    const conta = await banco.criarConta();
    const v = visitante();
    await publico.registrarClique({ slug: p.slug, visitante_id: v }, {});
    await publico.reivindicarAtribuicao(conta.claims, { visitante_id: v });

    const r = await admin.parceiro(banco.claimsA, p.id);
    assert.equal(r.parceiro.id, p.id);
    assert.match(String(r.parceiro.data_inicio), DATA);
    assert.match(String(r.parceiro.criado_em), TIMESTAMPTZ);
    assert.equal(typeof r.percentuais[0].percentual, 'number');
    assert.match(String(r.percentuais[0].vigencia_inicio), DATA);
    assert.equal(r.links[0].slug, p.slug);
    // Atribuição sem corretor visível e atribuição sem corretor nenhum dão o mesmo null do PostgREST:
    // a policy "Corretor vê tudo" de public.corretores só mostra a linha do próprio usuário, então o
    // embed corretores(nome, email) já era null no painel de hoje para o indicado de outra conta.
    assert.ok('corretores' in r.atribuicoes[0]);
    assert.equal(r.atribuicoes[0].corretores, null);
    assert.equal(conta.email.length > 0, true);

    const semCorretor = await criarParceiro();
    await publico.registrarClique({ slug: semCorretor.slug, visitante_id: visitante() }, {});
    const outro = await admin.parceiro(banco.claimsA, semCorretor.id);
    assert.equal(outro.atribuicoes[0].corretores, null);

    // Quando o indicado é a própria conta que lê, o embed vem como objeto { nome, email }.
    const comEmbed = await admin.parceiro(banco.claimsA, parceiroDeA.id);
    const embed = comEmbed.atribuicoes[0].corretores as { nome: string; email: string };
    assert.deepEqual(Object.keys(embed).sort(), ['email', 'nome']);
    assert.equal(embed.email, banco.contaA.email);

    await falha(admin.parceiro(banco.claimsA, '99999999-9999-4999-8999-999999999999'), 404, 'nao_encontrado');
  });

  test('B1, B4, B5 e as rotas de leitura do backoffice respondem para a conta A', async () => {
    assert.deepEqual(await admin.papeis(banco.claimsA), ['super_admin']);
    for (const leitura of [
      admin.listarParceiros(banco.claimsA, { busca: 'Parceiro', status: 'ativo' }),
      admin.opcoesParceiros(banco.claimsA),
      admin.listarUsuarios(banco.claimsA, {}),
      admin.listarAtendimento(banco.claimsA, {}),
      admin.listarAssinaturas(banco.claimsA, {}),
      admin.listarPagamentos(banco.claimsA, {}),
      admin.listarCancelamentos(banco.claimsA, {}),
      admin.listarOrganizacoes(banco.claimsA, {}),
      admin.listarAcessos(banco.claimsA, {}),
      admin.statusIntegracoes(banco.claimsA),
      admin.metricas(banco.claimsA, { inicio: '2026-01-01', fim: '2026-12-31' }),
      admin.metricasSaas(banco.claimsA, { inicio: '2026-01-01', fim: '2026-12-31' }),
      admin.metricasCancelamento(banco.claimsA, { inicio: '2026-01-01', fim: '2026-12-31' }),
      admin.metricasOnboarding(banco.claimsA, { inicio: '2026-01-01T00:00:00Z', fim: '2026-12-31T00:00:00Z' }),
      admin.listarConfig(banco.claimsA),
      admin.usuario(banco.claimsA, banco.corretorA),
    ]) {
      const r = await leitura;
      assert.ok(r !== undefined, 'a rota devolveu undefined');
    }
  });

  test('B40b, B41 e B42 passam pelas duas portas de admin_config', async () => {
    const linhas = await admin.listarLinhasConfig(banco.claimsA);
    assert.ok(linhas.length > 0);
    const chaves = linhas.map((l) => String(l.chave));
    assert.deepEqual(chaves, [...chaves].sort());
    const chave = chaves.includes('programa_hold_dias') ? 'programa_hold_dias' : chaves[0];
    const atualizada = await admin.atualizarConfig(banco.claimsA, chave, { valor: 3 });
    assert.equal(atualizada.chave, chave);
    assert.equal(atualizada.valor, 3);
    await falha(admin.atualizarConfig(banco.claimsA, 'chave_que_nao_existe', { valor: 1 }), 404, 'config_desconhecida');
    await admin.salvarConfig(banco.claimsA, chave, { valor: 5 });
    const [depois] = await banco.sqlSuperusuario<{ valor: unknown }>(
      'select valor from public.admin_config where chave = $1::text', [chave]);
    assert.equal(depois.valor, 5);
  });
});

describe('T2–T4 portal e convite', () => {
  test('15. portal: aceite, resumo, teto e repasse', async () => {
    const p = await criarParceiro({ email: banco.contaA.email, teto: 4 });
    const painel = await portal.painel(banco.claimsA);
    assert.ok(painel && typeof painel === 'object');
    assert.equal(painel.teto_renovacoes, 4);
    const [carimbado] = await banco.sqlSuperusuario<{ convite_status: string; user_id: string }>(
      `select convite_status, user_id::text as user_id from public.parceiros where id = $1::uuid`, [p.id]);
    assert.equal(carimbado.convite_status, 'aceito');
    assert.equal(carimbado.user_id, banco.contaA.userId);

    assert.deepEqual(await portal.salvarRepasse(banco.claimsA, {
      documento: '390.533.447-05', tipo_chave: 'cpf', chave: '39053344705',
    }), { salvo: true });
    const [repasse] = await banco.sqlSuperusuario<{ doc: string; tipo: string; chave: string }>(
      `select documento_beneficiario as doc, tipo_chave_pix as tipo, chave_pix as chave from public.parceiros where id = $1::uuid`,
      [p.id]);
    assert.equal(repasse.doc, '39053344705');
    assert.equal(repasse.tipo, 'cpf');
    assert.equal(repasse.chave, '39053344705');

    await falha(portal.salvarRepasse(banco.claimsA, {
      documento: '39053344705', tipo_chave: 'cpf', chave: '11144477735',
    }), 422, 'dados_de_repasse_invalidos');

    // Conta sem parceiro nenhum: 403 com texto que não vaza nada do banco.
    const semParceiro = await banco.criarConta();
    const erro = await falha(portal.painel(semParceiro.claims), 403, 'parceiro_nao_vinculado');
    assert.equal(erro.message, 'Este e-mail ainda não está vinculado a um parceiro ativo.');
  });

  test('16. convite sem provedor: 503 no reenvio, cadastro salvo na criação', async () => {
    const p = await criarParceiro();
    await falha(convite.convidar(banco.claimsA, { parceiro_id: p.id }), 503, 'provedor_de_email_nao_configurado');
    const [falhou] = await banco.sqlSuperusuario<{ convite_status: string }>(
      'select convite_status from public.parceiros where id = $1::uuid', [p.id]);
    assert.equal(falhou.convite_status, 'falhou');

    const sufixo = randomUUID().slice(0, 8);
    const r = await convite.convidar(banco.claimsA, {
      acao: 'criar',
      dados: {
        parceiro: { nome: 'Parceira Nova', email: `nova-${sufixo}@teste.lotti.local` },
        link: { slug: `nova-${sufixo}` },
        comissao: { percentual: 15, base_calculo: 'receita_bruta' },
      },
    });
    assert.equal(r.ok, false);
    assert.equal(r.email_enviado, false);
    assert.ok(r.parceiro_id);
    const [novo] = await banco.sqlSuperusuario<{ convite_status: string; links: number; vigencias: number }>(
      `select p.convite_status,
              (select count(*)::int from public.parceiro_links l where l.parceiro_id = p.id) as links,
              (select count(*)::int from public.parceiro_percentuais pp where pp.parceiro_id = p.id) as vigencias
         from public.parceiros p where p.id = $1::uuid`, [r.parceiro_id!]);
    assert.equal(novo.convite_status, 'falhou');
    assert.equal(Number(novo.links), 1);
    assert.equal(Number(novo.vigencias), 1);

    // Com acao 'criar' a recusa vem da RPC (exigir admin) e é 403. No reenvio puro a policy de
    // public.parceiros simplesmente não devolve linha para quem não é admin, e a rota responde 404 —
    // o mesmo que o painel de hoje vê quando o select do PostgREST volta vazio.
    await falha(convite.convidar(banco.claimsB, { acao: 'criar', dados: { parceiro: { nome: 'X' } } }), 403, 'sem_permissao');
    await falha(convite.convidar(banco.claimsB, { parceiro_id: p.id }), 404, 'nao_encontrado');
  });
});

describe('D1 diagnóstico comercial', () => {
  const RESPOSTAS = {
    profile: 'Imobiliária',
    team: '6–15',
    sources: ['Indicação', 'Portais'],
    acquisition: 'Os dois',
    leads: '101–250',
    properties: '51–100',
    response: 'Às vezes demora ou fica sem resposta',
    followup: 'Muitos contatos ficam sem retorno',
    tools: ['Planilhas'],
    gaps: ['Poucos leads', 'Demora no atendimento'],
    priority: 'Responder e converter melhor',
    timing: 'Agora',
    decision: 'Eu decido',
  };

  test('19. submit grava a linha e os eventos; reenvio é idempotente', async () => {
    const sessao = visitante();
    const r = await diagnostico.receber({
      action: 'submit', session_id: sessao, consent: true, name: 'Ana Souza', phone: '11988887777',
      email: 'ana@teste.lotti.local', answers: RESPOSTAS, attribution: { utm_source: 'google', is_admin: 'true' },
    });
    assert.equal(r.success, true);
    assert.ok(r.result);
    const [linha] = await banco.sqlSuperusuario<{ phone: string; attribution: Record<string, unknown>; status: string }>(
      `select phone, attribution, status from public.commercial_diagnostics where session_id = $1::uuid`, [sessao]);
    assert.equal(linha.phone, '5511988887777');
    assert.deepEqual(linha.attribution, { utm_source: 'google' });
    const eventos = await banco.sqlSuperusuario<{ event: string }>(
      `select event from public.commercial_diagnostic_events where session_id = $1::uuid order by id`, [sessao]);
    assert.deepEqual(eventos.map((e) => e.event), ['diagnostic_completed', 'qualified_lead']);

    const repetido = await diagnostico.receber({
      action: 'submit', session_id: sessao, consent: true, name: 'Ana Souza', phone: '11988887777', answers: RESPOSTAS,
    });
    assert.equal(repetido.success, true);
    assert.equal(await contar(`select count(*)::int as n from public.commercial_diagnostics where session_id = $1::uuid`, [sessao]), 1);
    assert.equal(await contar(`select count(*)::int as n from public.commercial_diagnostic_events where session_id = $1::uuid`, [sessao]), 2);

    // B43 lista e B44 muda o status; a conta B não passa pelas policies.
    const lista = await admin.listarDiagnosticos(banco.claimsA, {});
    assert.ok(lista.some((d) => d.session_id === sessao));
    const atualizado = await admin.atualizarStatusDiagnostico(banco.claimsA, String(lista[0].id), { status: 'em_contato' });
    assert.equal(atualizado.status, 'em_contato');
    assert.deepEqual(await admin.listarDiagnosticos(banco.claimsB, {}), []);
    await falha(admin.atualizarStatusDiagnostico(banco.claimsB, String(lista[0].id), { status: 'concluido' }), 404, 'diagnostico_nao_encontrado');
  });

  test('19b. o limite real de eventos corta no 51º da mesma sessão', async () => {
    const sessao = visitante();
    for (let i = 0; i < 50; i += 1) {
      assert.deepEqual(await diagnostico.receber({ action: 'event', session_id: sessao, event: 'diagnostic_step_completed', step: 'profile' }), { success: true });
    }
    await falha(diagnostico.receber({ action: 'event', session_id: sessao, event: 'diagnostic_step_completed' }), 429, 'muitas_tentativas');
    assert.equal(await contar(`select count(*)::int as n from public.commercial_diagnostic_events where session_id = $1::uuid`, [sessao]), 50);
  });
});

describe('14. isolamento por papel', () => {
  test('a conta B (sem papel) recebe 403 em todas as rotas do backoffice e não altera nada', async () => {
    const p = await criarParceiro();
    const antesParceiros = await contar('select count(*)::int as n from public.parceiros');
    const antesVigencias = await contar('select count(*)::int as n from public.parceiro_percentuais');
    const chamadas: Array<[string, Promise<unknown>]> = [
      ['B4', admin.listarParceiros(banco.claimsB, {})],
      ['B7', admin.criarParceiro(banco.claimsB, { nome: 'Intruso', email: 'intruso@teste.lotti.local', status: 'ativo' })],
      ['B9', admin.definirPercentual(banco.claimsB, p.id, { percentual: 90, base_calculo: 'receita_bruta' })],
      ['B12', admin.listarComissoes(banco.claimsB, {})],
      ['B16', admin.registrarReceita(banco.claimsB, {
        corretor_id: banco.corretorB, valor_bruto: 10, confirmado_em: new Date(Date.now() - 60_000).toISOString(),
        motivo: 'tentativa sem papel nenhum',
      })],
      ['B19', admin.listarLotes(banco.claimsB, {})],
      ['B21', admin.gerarLote(banco.claimsB, { parceiro_ids: [p.id] })],
      ['B40', admin.listarConfig(banco.claimsB)],
      ['B42', admin.salvarConfig(banco.claimsB, 'programa_hold_dias', { valor: 99 })],
    ];
    for (const [rota, promessa] of chamadas) {
      const r = await capturarErroHttp(promessa);
      assert.equal(r.status, 403, `${rota}: ${JSON.stringify(r.corpo)}`);
      assert.equal(r.corpo.codigo, 'sem_permissao', `${rota}: ${JSON.stringify(r.corpo)}`);
    }
    // B6 lê por policy: sem papel o select não devolve linha, então a rota responde 404 em vez de 403
    // (é o que o PostgREST já entrega hoje para a mesma leitura). Nada é criado nem alterado.
    await falha(admin.parceiro(banco.claimsB, p.id), 404, 'nao_encontrado');
    assert.equal(await contar('select count(*)::int as n from public.parceiros'), antesParceiros);
    assert.equal(await contar('select count(*)::int as n from public.parceiro_percentuais'), antesVigencias);
    assert.deepEqual(await admin.papeis(banco.claimsB), []);
    assert.deepEqual(await admin.listarLinhasConfig(banco.claimsB), []);
  });
});

describe('20. nenhuma transação abortada', () => {
  test('commitsAbortados continua 0', () => {
    assert.equal(banco.transacoes.commitsAbortados, 0);
  });
});
