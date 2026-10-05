// SQL real do módulo assinatura e onboarding (contrato 2026-10-05 §1 a §3) contra um Postgres de verdade:
// PGlite com todas as migrations, RLS ligado, gatilhos de plano ativos e o TenantDb de produção.
// Cobre C1–C3 (catálogo público pelo CatalogoRepo), A1–A5 (assinatura) e O1–O10 (onboarding): caminho
// feliz, isolamento entre as contas A e B e os erros traduzidos. Nenhum acesso a rede.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { AssinaturaService } from '../../src/assinatura/assinatura.service';
import { CatalogoRepo } from '../../src/assinatura/catalogo.repo';
import { CatalogoService } from '../../src/assinatura/catalogo.service';
import { OnboardingService } from '../../src/assinatura/onboarding/onboarding.service';
import { type BancoTeste, capturarErroHttp, criarBanco, type ContaTeste } from './harness';

let banco: BancoTeste;
let assinatura: AssinaturaService;
let catalogo: CatalogoService;
let onboarding: OnboardingService;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00:00$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_INEXISTENTE = 'token-que-nunca-existiu';

async function falha(promessa: Promise<unknown>, status: number, codigo: string): Promise<Record<string, unknown>> {
  const r = await capturarErroHttp(promessa);
  assert.equal(r.status, status, JSON.stringify(r.corpo));
  assert.equal(r.corpo.codigo, codigo, JSON.stringify(r.corpo));
  return r.corpo;
}

const imovel = (corretorId: string, extra: Record<string, unknown> = {}) => ({
  corretor_id: corretorId, titulo: 'Apartamento de teste', tipo: 'APARTAMENTO', finalidade: 'VENDA',
  valor: 250000, endereco: 'Rua 1, 10', cidade: 'Campinas', estado: 'SP', proprietario_nome: 'A informar', ...extra,
});

async function contagem(sql: string, params: unknown[] = []): Promise<number> {
  const r = await banco.sqlSuperusuario<{ n: number }>(`select count(*)::int as n from ${sql}`, params);
  return r[0].n;
}

before(async () => {
  banco = await criarBanco();
  assinatura = new AssinaturaService(banco.db);
  catalogo = new CatalogoService(new CatalogoRepo(banco.prisma as unknown as PrismaService));
  onboarding = new OnboardingService(banco.db);
});

after(async () => {
  await banco?.fechar();
});

// ---------------------------------------------------------------- C1–C3: catálogo público

describe('catálogo público pelo CatalogoRepo (C1–C3)', () => {
  test('C1: planos ativos aparecem; plano inativo não', async () => {
    await banco.inserir('plans', { code: 'desligado', name: 'Plano desligado', monthly_price: 10, annual_price: 100, active: false });
    const planos = await catalogo.listarPlanos();
    const codigos = planos.map((p) => p.code);
    assert.ok(codigos.includes(`teste-${banco.contaA.userId}`), JSON.stringify(codigos));
    assert.ok(!codigos.includes('desligado'));
    assert.equal(typeof planos[0].monthly_price, 'number', 'to_jsonb: numeric vira número JSON');
  });

  test('C2: o entitlement max_imoveis do plano da conta A aparece', async () => {
    const ents = await catalogo.listarEntitlements();
    const meu = ents.find((e) => e.plan_id === banco.contaA.planoId);
    assert.ok(meu, 'o entitlement da conta A deveria estar no catálogo');
    assert.equal(meu.feature_key, 'max_imoveis');
  });

  test('C3: zero, uma e duas campanhas ativas', async () => {
    assert.equal(await catalogo.campanhaAtiva(), null);
    const uma = await banco.inserir('pricing_campaigns', { name: 'Fundadores', discount_value: 30, starts_at: new Date().toISOString() });
    const linha = await catalogo.campanhaAtiva();
    assert.equal(linha?.id, uma.id);
    assert.equal(typeof linha?.discount_value, 'number');
    await banco.inserir('pricing_campaigns', { name: 'Outra', discount_value: 10, starts_at: new Date().toISOString() });
    await falha(catalogo.campanhaAtiva(), 409, 'campanha_ambigua');
    await banco.sqlSuperusuario('update public.pricing_campaigns set active = false');
    assert.equal(await catalogo.campanhaAtiva(), null);
  });
});

// ---------------------------------------------------------------- A1–A5: assinatura

describe('assinatura (A1–A5)', () => {
  test('A1: a conta A vê a própria assinatura com o plano embutido; a conta B não vê nada', async () => {
    const linha = await assinatura.atual(banco.claimsA);
    assert.ok(linha, 'a conta A deveria ter assinatura');
    assert.match(String(linha.id), UUID);
    assert.equal(linha.status, 'active');
    assert.match(String(linha.current_period_end), TIMESTAMPTZ);
    const plano = linha.plan as Record<string, unknown>;
    assert.equal(plano.id, banco.contaA.planoId);
    assert.equal(typeof plano.monthly_price, 'number');
    assert.equal(await assinatura.atual(banco.claimsB), null);
  });

  test('A1: RLS de verdade — o mesmo select com as claims de B não enxerga a assinatura de A', async () => {
    const comA = await banco.db.run(banco.claimsA, (tx) => tx.$queryRaw<unknown[]>(Prisma.sql`select s.id from public.subscriptions s`));
    assert.equal(comA.length, 1);
    const comB = await banco.db.run(banco.claimsB, (tx) => tx.$queryRaw<unknown[]>(Prisma.sql`select s.id from public.subscriptions s`));
    assert.equal(comB.length, 0);
  });

  test('A2: contagens vivas, contadores do período e isolamento', async () => {
    await banco.inserir('imoveis', imovel(banco.corretorA));
    await banco.inserir('imoveis', imovel(banco.corretorA, { titulo: 'Casa de teste', tipo: 'CASA' }));
    await banco.inserir('imoveis', imovel(banco.corretorA, { titulo: 'Inativo', ativo: false }));
    const [{ inicio }] = await banco.sqlSuperusuario<{ inicio: string }>(
      `select to_char(date_trunc('month', now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as inicio`);
    await banco.inserir('usage_counters', {
      corretor_id: banco.corretorA, feature_key: 'ai_assistant_monthly', used_quantity: 4,
      period_start: inicio, period_end: inicio,
    });
    await banco.inserir('usage_counters', {
      corretor_id: banco.corretorA, feature_key: 'ai_contracts_monthly', used_quantity: 9,
      period_start: '2020-01-01', period_end: '2020-01-31',
    });

    const uso = await assinatura.uso(banco.claimsA);
    assert.match(uso.period_start, DATA);
    assert.match(uso.period_end, DATA);
    assert.equal(uso.period_start, inicio, 'o período sai do fuso America/Sao_Paulo');
    assert.equal(uso.ativos.max_imoveis, 2, 'só imóveis ativos');
    assert.equal(uso.ativos.max_contratos_locacao, 0);
    assert.equal(uso.ativos.max_fachadas, 0);
    const chaves = uso.contadores.map((c) => c.feature_key);
    assert.deepEqual(chaves, ['ai_assistant_monthly'], 'contador de outro período não entra');
    assert.equal(uso.contadores[0].used_quantity, 4);
    assert.match(String(uso.contadores[0].period_start), DATA, 'formato do PostgREST para date');

    const usoB = await assinatura.uso(banco.claimsB);
    assert.deepEqual(usoB.ativos, { max_imoveis: 0, max_contratos_locacao: 0, max_fachadas: 0 });
    assert.deepEqual(usoB.contadores, []);
  });

  test('A2: o consumo de um membro da organização de A não conta os imóveis e contratos de A', async () => {
    // As policies `routine organization: properties read` e `routine organization: contracts read` são
    // PERMISSIVAS: qualquer membro da organização LÊ os imóveis e contratos do corretor dono dela.
    // O consumo tem de seguir a conta de hoje (`.eq('corretor_id', ...)`) e a de checar_cota:
    // só o que é do próprio corretor.
    await banco.inserir('imoveis', imovel(banco.corretorA, { titulo: 'Imóvel da conta A' }));
    await banco.inserir('contratos', {
      corretor_id: banco.corretorA, tipo: 'LOCACAO_RESIDENCIAL', status: 'ATIVO', valor: 2500,
      data_inicio: '2026-01-01', data_fim: '2026-12-31', conteudo: 'Contrato de teste',
    }, { semGatilhos: true });
    const [{ org }] = await banco.sqlSuperusuario<{ org: string }>(
      'select id as org from public.routine_organizations where legacy_corretor_id = $1::uuid limit 1',
      [banco.corretorA]);
    // Só uma associação ativa por usuário: a conta C entra na organização de A como corretora.
    const contaC = await banco.criarConta();
    await banco.sqlSuperusuario(
      `update public.routine_memberships set organization_id = $1::uuid, role = 'corretor'
        where user_id = $2::uuid and status = 'active'`, [org, contaC.userId]);

    const usoC = await assinatura.uso(contaC.claims);
    assert.equal(usoC.ativos.max_imoveis, 0, 'imóvel da conta A não entra no consumo de C');
    assert.equal(usoC.ativos.max_contratos_locacao, 0, 'contrato da conta A não entra no consumo de C');
  });

  test('A3: addon ativo de A aparece; cancelado e addon de B não', async () => {
    const [{ id: assinaturaA }] = await banco.sqlSuperusuario<{ id: string }>(
      'select id::text as id from public.subscriptions where corretor_id = $1::uuid', [banco.corretorA]);
    await banco.inserir('subscription_addons', {
      subscription_id: assinaturaA, corretor_id: banco.corretorA, addon_code: 'extra_leads_50',
      addon_name: 'Mais 50 leads', unit_price: 29.9, status: 'active',
    });
    await banco.inserir('subscription_addons', {
      subscription_id: assinaturaA, corretor_id: banco.corretorA, addon_code: 'extra_imoveis_10',
      addon_name: 'Mais 10 imóveis', unit_price: 19.9, status: 'canceled',
    });
    const addons = await assinatura.addons(banco.claimsA);
    assert.deepEqual(addons.map((a) => a.addon_code), ['extra_leads_50']);
    assert.deepEqual(await assinatura.addons(banco.claimsB), []);
  });

  test('A4: conta antiga sem limite segue a regra da função', async () => {
    assert.deepEqual(await assinatura.contaAntiga(banco.claimsA), { sem_limite: false });
    const antiga = await banco.criarConta({ nome: 'Conta antiga' });
    await banco.inserir('billing_legacy_accounts', { corretor_id: antiga.corretorId });
    assert.deepEqual(await assinatura.contaAntiga(antiga.claims), { sem_limite: true }, 'legado sem assinatura');
    const plano = await banco.inserir('plans', { code: 'trial-antiga', name: 'Trial', monthly_price: 0, annual_price: 0 });
    await banco.inserir('subscriptions', {
      corretor_id: antiga.corretorId, plan_id: plano.id, status: 'trialing',
      trial_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    assert.deepEqual(await assinatura.contaAntiga(antiga.claims), { sem_limite: true }, 'trialing não derruba a isenção');
    await banco.sqlSuperusuario(`update public.subscriptions set status = 'active' where corretor_id = $1::uuid`, [antiga.corretorId]);
    assert.deepEqual(await assinatura.contaAntiga(antiga.claims), { sem_limite: false });
  });

  test('A5: leitura de cota sem afrouxar nada', async () => {
    const sobrando = await assinatura.cota(banco.claimsA, 'max_imoveis');
    assert.equal(sobrando.permitido, true);
    assert.equal(sobrando.habilitado, true);
    assert.equal(sobrando.limite, 1000);

    const semEnt = await assinatura.cota(banco.claimsA, 'storage_gb');
    assert.equal(semEnt.permitido, false);
    assert.equal(semEnt.habilitado, false);

    const apertada = await banco.criarConta({ nome: 'Conta no limite', limiteImoveis: 1 });
    await banco.inserir('imoveis', imovel(apertada.corretorId));
    const cheia = await assinatura.cota(apertada.claims, 'max_imoveis');
    assert.deepEqual(
      { permitido: cheia.permitido, usado: cheia.usado, limite: cheia.limite },
      { permitido: false, usado: 1, limite: 1 },
    );

    const semPlano = await assinatura.cota(banco.claimsB, 'max_imoveis');
    assert.equal(semPlano.permitido, false);
  });

  test('billing_legacy_accounts só é alcançável pela função SECURITY DEFINER', async () => {
    await assert.rejects(
      banco.db.run(banco.claimsA, (tx) => tx.$queryRaw(Prisma.sql`select b.corretor_id from public.billing_legacy_accounts b`)),
      (e: unknown) => {
        const meta = (e as { meta?: { code?: string } }).meta;
        assert.equal(meta?.code, '42501', `esperado 42501, veio ${JSON.stringify(meta)}`);
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------- O1–O10: onboarding

describe('onboarding (O1–O10)', () => {
  test('O1: o contexto da conta A traz os blocos da função; sem perfil devolve null', async () => {
    const ctx = await onboarding.contexto(banco.claimsA);
    assert.ok(ctx, 'a conta A deveria ter contexto');
    for (const bloco of ['profile', 'progress', 'organization', 'membership', 'evidence', 'subscription']) {
      assert.ok(bloco in ctx, `falta o bloco ${bloco}`);
    }
    const sub = ctx.subscription as Record<string, unknown>;
    assert.equal(sub.plan_code, `teste-${banco.contaA.userId}`);

    const sem = await banco.criarConta({ nome: 'Sem onboarding' });
    await banco.sqlSuperusuario('delete from public.onboarding_profiles where user_id = $1::uuid', [sem.userId]);
    assert.equal(await onboarding.contexto(sem.claims), null);
  });

  test('O2: grava etapa, evento persona_selected e devolve o contexto; repetir não duplica o evento', async () => {
    const ctx = await onboarding.salvar(banco.claimsA, {
      profile: { persona: 'corretor_autonomo' }, stepKey: 'persona', stepStatus: 'concluido',
    });
    assert.ok(ctx);
    assert.equal((ctx.profile as Record<string, unknown>).persona, 'corretor_autonomo');
    const etapas = await contagem(
      `public.onboarding_steps s join public.onboarding_profiles p on p.id = s.profile_id
       where p.user_id = $1::uuid and s.step_key = 'persona' and s.status = 'concluido'`, [banco.contaA.userId]);
    assert.equal(etapas, 1);
    const eventos = () => contagem(
      `public.onboarding_events e where e.user_id = $1::uuid and e.event_name = 'persona_selected'`, [banco.contaA.userId]);
    assert.equal(await eventos(), 1);
    await onboarding.salvar(banco.claimsA, { profile: { persona: 'corretor_autonomo' }, stepKey: 'persona', stepStatus: 'concluido' });
    assert.equal(await eventos(), 1, 'o ON CONFLICT DO NOTHING da função evita o evento repetido');
  });

  test('O2: sem perfil de onboarding vira 404 traduzido', async () => {
    const sem = await banco.criarConta({ nome: 'Sem perfil 2' });
    await banco.sqlSuperusuario('delete from public.onboarding_profiles where user_id = $1::uuid', [sem.userId]);
    await falha(onboarding.salvar(sem.claims, { stepKey: 'persona', stepStatus: 'concluido' }), 404, 'perfil_nao_encontrado');
  });

  test('O3: sample_client é idempotente e remove_samples limpa', async () => {
    const conta = await banco.criarConta({ nome: 'Demo', limiteImoveis: 50 });
    const primeira = await onboarding.executarAcao(conta.claims, { action: 'sample_client', payload: { nome: 'Cliente demo', telefone: '19999990000' } });
    assert.match(String(primeira.id), UUID);
    assert.equal(primeira.reused, false);
    const segunda = await onboarding.executarAcao(conta.claims, { action: 'sample_client', payload: { nome: 'Outro', telefone: '19999990001' } });
    assert.equal(segunda.id, primeira.id);
    assert.equal(segunda.reused, true);
    assert.equal(await contagem('public.clientes c where c.corretor_id = $1::uuid', [conta.corretorId]), 1);

    const removido = await onboarding.executarAcao(conta.claims, { action: 'remove_samples' });
    assert.deepEqual(removido, { removed: true });
    assert.equal(await contagem('public.clientes c where c.corretor_id = $1::uuid', [conta.corretorId]), 0);
  });

  test('O3 é atômico: first_deal sem cliente falha com 422 e não grava nada', async () => {
    const conta = await banco.criarConta({ nome: 'Sem cliente', limiteImoveis: 50 });
    const antes = banco.transacoes.commitsAbortados;
    const corpo = await capturarErroHttp(onboarding.executarAcao(conta.claims, { action: 'first_deal', payload: {} }));
    assert.equal(corpo.status, 422, JSON.stringify(corpo.corpo));
    assert.ok(['cliente_invalido', 'pipeline_nao_configurado'].includes(String(corpo.corpo.codigo)), JSON.stringify(corpo.corpo));
    assert.equal(await contagem('public.crm_oportunidades o where o.corretor_id = $1::uuid', [conta.corretorId]), 0);
    assert.equal(banco.transacoes.commitsAbortados, antes, 'nenhum commit abortado: o erro sobe e a transação faz ROLLBACK');
  });

  test('O3: payload incompleto vira 422 dados_incompletos', async () => {
    const conta = await banco.criarConta({ nome: 'Incompleto', limiteImoveis: 50 });
    await falha(onboarding.executarAcao(conta.claims, { action: 'first_property', payload: { titulo: 'x' } }), 422, 'dados_incompletos');
  });

  test('O3: o gatilho de cota continua valendo pela API (402 PLAN_LIMIT_REACHED)', async () => {
    const conta = await banco.criarConta({ nome: 'Cota de um imóvel', limiteImoveis: 1 });
    const antes = banco.transacoes.commitsAbortados;
    const payload = { titulo: 'Primeiro imóvel', cidade: 'Campinas', valor: 300000 };
    const primeiro = await onboarding.executarAcao(conta.claims, { action: 'first_property', payload });
    assert.match(String(primeiro.id), UUID);
    const corpo = await falha(
      onboarding.executarAcao(conta.claims, { action: 'sample_property', payload: { ...payload, titulo: 'Segundo' } }),
      402, 'PLAN_LIMIT_REACHED');
    assert.equal(corpo.recurso, 'max_imoveis');
    assert.equal(await contagem('public.imoveis i where i.corretor_id = $1::uuid', [conta.corretorId]), 1);
    assert.equal(banco.transacoes.commitsAbortados, antes);
  });

  test('O4: evento grava e o metadata fora da allowlist da função é descartado', async () => {
    await onboarding.registrarEvento(banco.claimsA, {
      eventName: 'onboarding_step_skipped', stepKey: 'equipe',
      metadata: { persona: 'corretor_autonomo', telefone: '19999990000' },
    });
    const r = await banco.sqlSuperusuario<{ metadata: Record<string, unknown> }>(
      `select metadata from public.onboarding_events
       where user_id = $1::uuid and event_name = 'onboarding_step_skipped' order by criado_em desc limit 1`,
      [banco.contaA.userId]);
    assert.deepEqual(Object.keys(r[0].metadata), ['persona']);
  });

  test('O5: tour concluído grava completed_at; dispensar depois mantém o completed_at', async () => {
    await onboarding.salvarTour(banco.claimsA, { tourKey: 'crm', status: 'concluido', currentStep: 3 });
    const ler = () => banco.sqlSuperusuario<{ completed_at: Date | null; dismissed_at: Date | null; current_step: number }>(
      `select t.completed_at, t.dismissed_at, t.current_step from public.onboarding_tours t
       join public.onboarding_profiles p on p.id = t.profile_id
       where p.user_id = $1::uuid and t.tour_key = 'crm'`, [banco.contaA.userId]);
    const [antes] = await ler();
    assert.ok(antes.completed_at, 'completed_at deveria estar preenchido');
    assert.equal(antes.dismissed_at, null);
    assert.equal(antes.current_step, 3);
    await onboarding.salvarTour(banco.claimsA, { tourKey: 'crm', status: 'dispensado', currentStep: 5 });
    const [depois] = await ler();
    assert.deepEqual(depois.completed_at, antes.completed_at, 'o coalesce da função preserva o completed_at');
    assert.ok(depois.dismissed_at);
    assert.equal(depois.current_step, 5);
  });

  test('O6: minimized e dismissed gravam, e a conta B nunca altera a linha de A', async () => {
    const lerA = () => banco.sqlSuperusuario<{ minimized: boolean; dismissed_at: Date | null }>(
      `select c.minimized, c.dismissed_at from public.onboarding_checklist c
       join public.onboarding_profiles p on p.id = c.profile_id where p.user_id = $1::uuid`, [banco.contaA.userId]);
    await onboarding.salvarChecklist(banco.claimsA, { minimized: true });
    assert.equal((await lerA())[0].minimized, true);
    await onboarding.salvarChecklist(banco.claimsA, { dismissed: true });
    assert.ok((await lerA())[0].dismissed_at);

    await onboarding.salvarChecklist(banco.claimsB, { minimized: false });
    const [a] = await lerA();
    assert.equal(a.minimized, true, 'a chamada da conta B mexeu só na linha dela');
    const [b] = await banco.sqlSuperusuario<{ minimized: boolean }>(
      `select c.minimized from public.onboarding_checklist c
       join public.onboarding_profiles p on p.id = c.profile_id where p.user_id = $1::uuid`, [banco.contaB.userId]);
    assert.equal(b.minimized, false);
  });

  test('O6: sem perfil o returning volta vazio e a rota responde 404', async () => {
    const sem = await banco.criarConta({ nome: 'Sem checklist' });
    await banco.sqlSuperusuario('delete from public.onboarding_checklist where profile_id in (select id from public.onboarding_profiles where user_id = $1::uuid)', [sem.userId]);
    await falha(onboarding.salvarChecklist(sem.claims, { minimized: true }), 404, 'nao_encontrado');
  });

  test('O6/O7/O8: corpo sem campo conhecido responde 400 nada_para_atualizar', async () => {
    await falha(onboarding.salvarChecklist(banco.claimsA, {}), 400, 'nada_para_atualizar');
    await falha(onboarding.atualizarPerfil(banco.claimsA, {}), 400, 'nada_para_atualizar');
    await falha(onboarding.atualizarOrganizacao(banco.claimsA, banco.contaA.userId, {}), 400, 'nada_para_atualizar');
  });

  test('O7: atualiza o corretor da própria conta e nunca o da outra', async () => {
    await onboarding.atualizarPerfil(banco.claimsA, { nome: 'Corretora A revisada', cidade: 'Campinas', creci_status: 'validado' });
    const [a] = await banco.sqlSuperusuario<{ nome: string; cidade: string; creci_status: string }>(
      'select nome, cidade, creci_status from public.corretores where user_id = $1::uuid', [banco.contaA.userId]);
    assert.equal(a.nome, 'Corretora A revisada');
    assert.equal(a.cidade, 'Campinas');
    assert.equal(a.creci_status, 'validado');
    const [b] = await banco.sqlSuperusuario<{ nome: string }>(
      'select nome from public.corretores where user_id = $1::uuid', [banco.contaB.userId]);
    assert.equal(b.nome, 'Corretor B', 'o corretor da conta B ficou intacto');
  });

  test('O8: a conta dona grava; a conta B recebe 404 porque a policy de gestor nega', async () => {
    const [{ id: orgA }] = await banco.sqlSuperusuario<{ id: string }>(
      'select id::text as id from public.routine_organizations where legacy_corretor_id = $1::uuid', [banco.corretorA]);
    await onboarding.atualizarOrganizacao(banco.claimsA, orgA, { nome: 'Imobiliária A', tipo_operacao: ['venda', 'locacao'] });
    const [org] = await banco.sqlSuperusuario<{ name: string; operation_types: string[] }>(
      'select name, operation_types from public.routine_organizations where id = $1::uuid', [orgA]);
    assert.equal(org.name, 'Imobiliária A');
    assert.deepEqual(org.operation_types, ['venda', 'locacao']);
    await falha(onboarding.atualizarOrganizacao(banco.claimsB, orgA, { nome: 'Invasão' }), 404, 'nao_encontrado');
    const [depois] = await banco.sqlSuperusuario<{ name: string }>(
      'select name from public.routine_organizations where id = $1::uuid', [orgA]);
    assert.equal(depois.name, 'Imobiliária A');
  });

  test('O9/O10: convite ponta a ponta, com os erros de permissão e de e-mail', async () => {
    const convidado = await banco.criarConta({ nome: 'Convidada', email: 'convidada@teste.lotti.local' });
    const convite = await onboarding.criarConvite(banco.claimsA, { email: convidado.email, papel: 'gestor' });
    assert.match(convite.id, UUID);
    assert.equal(convite.expires_in_days, 7);
    assert.equal(typeof convite.token, 'string');
    const [linha] = await banco.sqlSuperusuario<{ token_hash: string; status: string; email: string }>(
      'select token_hash, status, email from public.organizacao_convites where id = $1::uuid', [convite.id]);
    assert.equal(linha.status, 'pendente');
    assert.equal(linha.email, convidado.email);
    assert.match(linha.token_hash, /^[0-9a-f]{64}$/);
    assert.notEqual(linha.token_hash, convite.token, 'o banco guarda só o hash');

    await falha(onboarding.aceitarConvite(banco.claimsB, { token: TOKEN_INEXISTENTE }), 404, 'convite_invalido');
    await falha(onboarding.aceitarConvite(banco.claimsB, { token: convite.token }), 403, 'convite_de_outro_email');

    const aceite = await onboarding.aceitarConvite(convidado.claims, { token: convite.token });
    assert.equal(aceite.papel, 'gestor');
    const [membro] = await banco.sqlSuperusuario<{ status: string; job_role: string }>(
      `select status, job_role from public.routine_memberships
       where user_id = $1::uuid and organization_id = $2::uuid`, [convidado.userId, aceite.organization_id]);
    assert.equal(membro.status, 'active');
    assert.equal(membro.job_role, 'gestor');
    const [convitePos] = await banco.sqlSuperusuario<{ status: string }>(
      'select status from public.organizacao_convites where id = $1::uuid', [convite.id]);
    assert.equal(convitePos.status, 'aceito');
  });

  test('O9: conta sem papel de gestão recebe 403 sem_permissao_convite', async () => {
    const simples: ContaTeste = await banco.criarConta({ nome: 'Sem gestão' });
    await banco.sqlSuperusuario(
      `update public.routine_memberships set role = 'colaborador' where user_id = $1::uuid`, [simples.userId]);
    await falha(onboarding.criarConvite(simples.claims, { email: 'alguem@teste.lotti.local' }), 403, 'sem_permissao_convite');
  });
});
