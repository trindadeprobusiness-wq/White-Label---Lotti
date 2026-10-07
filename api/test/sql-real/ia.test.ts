// SQL real do módulo ia (porte das Edge Functions de IA) contra um Postgres de verdade: PGlite com todas as
// migrations, RLS ligado e o TenantDb de produção (claims + `set local role authenticated`). Confere o CRUD
// das conversas, a persistência do assistente, as ferramentas de leitura (isolamento entre as contas A e B),
// a escrita das ações confirmadas, o anexo e os caminhos privilegiados (cota, uso e limite por minuto).
// O Gemini nunca é chamado: o fetch é sempre falso. As tabelas do gateway (ai_runs, ai_tool_calls,
// ai_action_proposals) NÃO existem nas migrations (nem na produção): o teste confere primeiro o caminho sem
// elas e depois as cria (DDL da migration 20260821002556 do Supabase) para conferir as ações.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ArquivosRepo } from '../../src/arquivos/arquivos.repo';
import { AcaoIaService } from '../../src/ia/acao.service';
import { AnexosIaService } from '../../src/ia/anexos.service';
import { AssistenteService, EventoAssistente } from '../../src/ia/assistente.service';
import { ConversasService } from '../../src/ia/conversas.service';
import { consumirLimiteIa, type ClienteSql } from '../../src/ia/cotas';
import { FerramentasIaService } from '../../src/ia/ferramentas.service';
import { FotosIaService } from '../../src/ia/fotos.service';
import { AlterarConversaDto, AssistenteDto, DecisaoAcaoDto, SugestaoInboxDto } from '../../src/ia/ia.dto';
import { MensagensIaService } from '../../src/ia/mensagens.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { StorageService } from '../../src/storage/storage.service';
import { type BancoTeste, capturarErroHttp, criarBanco } from './harness';

let banco: BancoTeste;
let prisma: PrismaService;
let conversas: ConversasService;
let ferramentas: FerramentasIaService;
let assistente: AssistenteService;
let acao: AcaoIaService;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INEXISTENTE = '99999999-9999-4999-8999-999999999999';
const ambiente = { ...process.env };

let conversaA: string;
let conversaB: string;
let mensagemA: string;
let clienteA: string;
let clienteB: string;
let imovelA: string;
let imovelB: string;

const sse = (...textos: string[]) => new Response(
  textos.map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).join(''),
  { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
);
const chat = (conteudo: string) => new Response(JSON.stringify({ choices: [{ message: { content: conteudo } }] }), { status: 200 });

async function contar(sql: string, params: unknown[] = []): Promise<number> {
  const [r] = await banco.sqlSuperusuario<{ n: number }>(`select count(*)::int as n from (${sql}) x`, params);
  return Number(r.n);
}

before(async () => {
  process.env.GEMINI_API_KEY = 'chave-falsa';
  delete process.env.LOTTI_AI_FAST_MODEL;
  banco = await criarBanco();
  prisma = banco.prisma as unknown as PrismaService;
  conversas = new ConversasService(banco.db);
  ferramentas = new FerramentasIaService(banco.db, prisma);
  assistente = new AssistenteService(banco.db, prisma, ferramentas);
  acao = new AcaoIaService(banco.db, prisma);

  // O plano da conta A ganha o Assistente (100 interações/mês); a conta B segue sem plano.
  await banco.inserir('plan_entitlements', {
    plan_id: banco.contaA.planoId, feature_key: 'ai_assistant_monthly', feature_name: 'Assistente', enabled: true, limit_value: 100, unlimited: false,
  });
  conversaA = String((await banco.inserir('ai_conversations', { corretor_id: banco.corretorA, title: 'Conversa A', model: 'gemini-3.8-flash' })).id);
  conversaB = String((await banco.inserir('ai_conversations', { corretor_id: banco.corretorB, title: 'Conversa B' })).id);
  mensagemA = String((await banco.inserir('ai_messages', { conversation_id: conversaA, role: 'user', content: 'Olá' })).id);
  await banco.inserir('ai_messages', { conversation_id: conversaA, role: 'assistant', content: 'Oi!' });
  await banco.inserir('ai_messages', { conversation_id: conversaB, role: 'user', content: 'Segredo de B' });
  clienteA = String((await banco.inserir('clientes', { corretor_id: banco.corretorA, nome: 'Ana Souza', telefone: '62999990001', email: 'ana@x.com' })).id);
  clienteB = String((await banco.inserir('clientes', { corretor_id: banco.corretorB, nome: 'Ana Bastos', telefone: '62999990002' }, { semGatilhos: true })).id);
  imovelA = String((await banco.inserir('imoveis', {
    corretor_id: banco.corretorA, titulo: 'Casa Centro', tipo: 'CASA', valor: 450000, endereco: 'Rua 1', cidade: 'Anápolis', proprietario_nome: 'Dono A',
  })).id);
  imovelB = String((await banco.inserir('imoveis', {
    corretor_id: banco.corretorB, titulo: 'Apto B', tipo: 'APARTAMENTO', valor: 1, endereco: 'Rua 2', cidade: 'Goiânia', proprietario_nome: 'Dono B',
  }, { semGatilhos: true })).id);
  await banco.inserir('lancamentos_financeiros', { corretor_id: banco.corretorA, tipo: 'RECEITA', categoria: 'COMISSAO_VENDA', descricao: 'Venda', valor: 1500.5, data: new Date().toISOString() });
  await banco.inserir('historico_contatos', { cliente_id: clienteA, tipo: 'WHATSAPP', direcao: 'IN', conteudo: 'Quero visitar' });
});

after(async () => {
  process.env = ambiente;
  await banco?.fechar();
});

describe('conversas do assistente (RLS)', () => {
  test('cada conta lista só as suas conversas e mensagens', async () => {
    const deA = await conversas.listar(banco.claimsA);
    assert.deepEqual(deA.map((c) => c.id), [conversaA]);
    assert.equal(deA[0].title, 'Conversa A');
    assert.equal(deA[0].corretor_id, banco.corretorA);
    assert.deepEqual((await conversas.listar(banco.claimsB)).map((c) => c.id), [conversaB]);
    const mensagens = await conversas.mensagens(banco.claimsA, conversaA);
    assert.deepEqual(mensagens.map((m) => [m.role, m.content]), [['user', 'Olá'], ['assistant', 'Oi!']]);
    assert.deepEqual(await conversas.mensagens(banco.claimsA, conversaB), []);
  });

  test('renomear e fixar; a outra conta recebe 404 e não muda nada', async () => {
    const r = await conversas.alterar(banco.claimsA, conversaA, Object.assign(new AlterarConversaDto(), { title: ' Novo título ' }));
    assert.equal(r.title, 'Novo título');
    assert.equal(r.pinned, false);
    assert.equal((await conversas.alterar(banco.claimsA, conversaA, Object.assign(new AlterarConversaDto(), { pinned: true }))).pinned, true);
    const erro = await capturarErroHttp(conversas.alterar(banco.claimsB, conversaA, Object.assign(new AlterarConversaDto(), { title: 'invadido' })));
    assert.equal(erro.status, 404);
    const [linha] = await banco.sqlSuperusuario<{ title: string }>('select title from public.ai_conversations where id = $1', [conversaA]);
    assert.equal(linha.title, 'Novo título');
  });

  test('apagar da outra conta não apaga; da própria apaga em cascata', async () => {
    const extra = String((await banco.inserir('ai_conversations', { corretor_id: banco.corretorA })).id);
    await banco.inserir('ai_messages', { conversation_id: extra, role: 'user', content: 'x' });
    await conversas.apagar(banco.claimsB, extra);
    assert.equal(await contar('select 1 from public.ai_conversations where id = $1', [extra]), 1);
    await conversas.apagar(banco.claimsA, extra);
    assert.equal(await contar('select 1 from public.ai_conversations where id = $1', [extra]), 0);
    assert.equal(await contar('select 1 from public.ai_messages where conversation_id = $1', [extra]), 0);
  });
});

describe('ferramentas de leitura (TenantDb)', () => {
  const ctx = () => ({ claims: banco.claimsA, runId: null, corretorId: banco.corretorA, userId: banco.contaA.userId, entityRefs: [] });

  test('search_clients e get_client_details só enxergam a conta de quem conversa', async () => {
    const achados = JSON.parse(await ferramentas.executar('search_clients', { query: 'Ana' }, ctx()));
    assert.deepEqual(achados.map((c: { id: string }) => c.id), [clienteA]);
    assert.equal(achados[0].status_funil, 'QUALIFICACAO');
    const detalhe = JSON.parse(await ferramentas.executar('get_client_details', { client_id: clienteA }, ctx()));
    assert.equal(detalhe.client.id, clienteA);
    assert.deepEqual(detalhe.history.map((h: { conteudo: string }) => h.conteudo), ['Quero visitar']);
    const deB = JSON.parse(await ferramentas.executar('get_client_details', { client_id: clienteB }, ctx()));
    assert.deepEqual(deB, { client: null, history: [] });
  });

  test('as outras leituras rodam no Postgres sem erro e respeitam o RLS', async () => {
    const imoveis = JSON.parse(await ferramentas.executar('search_properties', { cidade: 'anáp', preco_max: 500000, tipo: 'CASA' }, ctx()));
    assert.deepEqual(imoveis.map((i: { id: string }) => i.id), [imovelA]);
    assert.equal(imoveis[0].valor, 450000);
    const detalhe = JSON.parse(await ferramentas.executar('get_property_details', { property_id: imovelB }, ctx()));
    assert.deepEqual(detalhe, { property: null, photos: [] });
    const resumo = JSON.parse(await ferramentas.executar('get_financial_summary', {}, ctx()));
    assert.deepEqual(resumo, { period: 'month', receita: 1500.5, despesa: 0, saldo: 1500.5, total_lancamentos: 1 });
    const lancamentos = JSON.parse(await ferramentas.executar('get_financial_entries', { tipo: 'RECEITA', date_from: '2000-01-01' }, ctx()));
    assert.equal(lancamentos.length, 1);
    assert.equal(lancamentos[0].valor, 1500.5);
    assert.deepEqual(JSON.parse(await ferramentas.executar('get_contracts', { status: 'RASCUNHO', tipo: 'XYZ' }, ctx())), []);
    assert.deepEqual(JSON.parse(await ferramentas.executar('get_alerts', { tipo: 'GERAL', prioridade: 'ALTA' }, ctx())), []);
    assert.deepEqual(JSON.parse(await ferramentas.executar('get_funnel_stats', {}, ctx())), { total: 1, by_status: { QUALIFICACAO: 1 } });
    assert.equal(JSON.parse(await ferramentas.executar('get_contact_history', { client_id: clienteA }, ctx())).length, 1);
    // filtro inválido do modelo: o erro volta para ele e a conversa segue
    assert.deepEqual(JSON.parse(await ferramentas.executar('get_financial_entries', { date_from: 'ontem' }, ctx())), { error: 'query_failed' });
    assert.equal(banco.transacoes.commitsAbortados, 0);
  });
});

describe('assistente: preparo, stream e caminhos privilegiados', () => {
  test('conversa nova: grava mensagem e resposta, dá título, conta uso e limite (sem tabelas de telemetria)', async () => {
    const fetchImpl = async () => sse('Você tem ', '**1** cliente.');
    assistente.fetchImpl = fetchImpl as never;
    const sessao = await assistente.preparar(banco.claimsA, Object.assign(new AssistenteDto(), { message: 'Quantos clientes?', module: 'clients' }));
    assert.equal(sessao.runId, null);
    assert.match(sessao.conversationId, UUID);
    assert.match(sessao.mensagens[0].content, /- Corretor: Corretora A \(CRECI/);
    assert.match(sessao.mensagens[0].content, /- Total de clientes: 1\n- Total de imóveis: 1/);
    assert.match(sessao.mensagens[0].content, /- Receita do mês: R\$ 1\.500,50/);
    const eventos: EventoAssistente[] = [];
    await assistente.transmitir(sessao, (e) => eventos.push(e));
    assert.deepEqual(eventos.at(-1), { type: 'done', conversation_id: sessao.conversationId, trace_id: sessao.pedido.traceId, prompt_version: 'assistant.general@2026-08-20.1' });

    const msgs = await conversas.mensagens(banco.claimsA, sessao.conversationId);
    assert.deepEqual(msgs.map((m) => [m.role, m.content]), [['user', 'Quantos clientes?'], ['assistant', 'Você tem **1** cliente.']]);
    assert.equal((msgs[0].metadata as Record<string, unknown>).module, 'clients');
    const [conv] = await banco.sqlSuperusuario<{ title: string; corretor_id: string; model: string }>(
      'select title, corretor_id::text, model from public.ai_conversations where id = $1', [sessao.conversationId]);
    assert.deepEqual(conv, { title: 'Você tem 1 cliente.', corretor_id: banco.corretorA, model: 'gemini-3.8-flash' });
    const [uso] = await banco.sqlSuperusuario<{ used_quantity: number }>(
      "select used_quantity from public.usage_counters where corretor_id = $1 and feature_key = 'ai_assistant_monthly'", [banco.corretorA]);
    assert.equal(uso.used_quantity, 1);
    const [limite] = await banco.sqlSuperusuario<{ message_count: number }>('select message_count from public.ai_rate_limits where corretor_id = $1', [banco.corretorA]);
    assert.equal(limite.message_count, 1);
  });

  test('conta B: sem plano → 402; conversa da conta A → 404', async () => {
    const semPlano = await capturarErroHttp(assistente.preparar(banco.claimsB, Object.assign(new AssistenteDto(), { message: 'oi' })));
    assert.equal(semPlano.status, 402);
    assert.equal(semPlano.corpo.message, 'Seu plano atual não inclui o Assistente Lotti.');
    const alheia = await capturarErroHttp(assistente.preparar(banco.claimsA, Object.assign(new AssistenteDto(), { message: 'oi', conversation_id: conversaB })));
    assert.equal(alheia.status, 404);
    assert.equal(await contar("select 1 from public.ai_messages where conversation_id = $1 and content = 'oi'", [conversaB]), 0);
  });

  test('limite por minuto conta no mesmo registro e nega a partir do 31º', async () => {
    const sql = banco.prisma as unknown as ClienteSql;
    await banco.sqlSuperusuario('update public.ai_rate_limits set message_count = 29, window_start = now() where corretor_id = $1', [banco.corretorA]);
    assert.equal(await consumirLimiteIa(sql, banco.corretorA, 30), 'permitido');
    assert.equal(await consumirLimiteIa(sql, banco.corretorA, 30), 'negado');
    await banco.sqlSuperusuario("update public.ai_rate_limits set window_start = now() - interval '2 minutes' where corretor_id = $1", [banco.corretorA]);
    assert.equal(await consumirLimiteIa(sql, banco.corretorA, 30), 'permitido');
    const [r] = await banco.sqlSuperusuario<{ message_count: number }>('select message_count from public.ai_rate_limits where corretor_id = $1', [banco.corretorA]);
    assert.equal(r.message_count, 1);
  });
});

describe('ações propostas e confirmadas', () => {
  const ctx = (runId: string | null = null) => ({ claims: banco.claimsA, runId, corretorId: banco.corretorA, userId: banco.contaA.userId, entityRefs: [] });
  const decidir = (claims = banco.claimsA, proposal_id: string, decision: 'confirm' | 'reject' = 'confirm') =>
    acao.decidir(claims, Object.assign(new DecisaoAcaoDto(), { proposal_id, decision }));
  const propor = async (action_type: string, params: Record<string, unknown>) => {
    const r = JSON.parse(await ferramentas.executar('suggest_action', { action_type, params, description: 'Teste' }, ctx()));
    assert.equal(r.type, 'action', JSON.stringify(r));
    return r.action.id as string;
  };

  test('sem as tabelas do gateway: a proposta não é preparada e a confirmação dá 404 (como a função)', async () => {
    assert.deepEqual(JSON.parse(await ferramentas.executar('suggest_action', { action_type: 'create_alert', params: { mensagem: 'x' }, description: 'd' }, ctx())), {
      error: 'action_persistence_unavailable', message: 'A ação não pôde ser preparada com segurança. Tente novamente.',
    });
    assert.equal((await capturarErroHttp(decidir(banco.claimsA, INEXISTENTE))).status, 404);
  });

  test('com as tabelas: cada ação grava no TenantDb com o corretor da sessão', async () => {
    await banco.pglite.exec(`
      create table public.ai_runs (
        id uuid primary key default gen_random_uuid(), trace_id text not null unique,
        corretor_id uuid not null references public.corretores(id) on delete cascade, user_id uuid references auth.users(id) on delete set null,
        module text not null, intent text not null, provider text not null default 'google', model text not null, prompt_version_id text,
        output_mode text not null check (output_mode in ('text','structured','action_proposal')),
        status text not null check (status in ('started','completed','failed','blocked')),
        input_chars integer not null default 0, output_chars integer not null default 0, input_tokens integer, output_tokens integer,
        estimated_cost_usd numeric(14,8), latency_ms integer, confirmation_required boolean not null default false, error_code text,
        metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), completed_at timestamptz);
      create table public.ai_tool_calls (
        id uuid primary key default gen_random_uuid(), run_id uuid not null references public.ai_runs(id) on delete cascade,
        tool_name text not null, tool_kind text not null check (tool_kind in ('read','proposal','write')),
        status text not null check (status in ('started','completed','failed','blocked')), entity_refs jsonb not null default '[]'::jsonb,
        duration_ms integer, error_code text, created_at timestamptz not null default now(), completed_at timestamptz);
      create table public.ai_action_proposals (
        id uuid primary key default gen_random_uuid(), run_id uuid references public.ai_runs(id) on delete set null,
        corretor_id uuid not null references public.corretores(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
        action_type text not null, entity_refs jsonb not null default '[]'::jsonb, preview jsonb not null, payload jsonb not null,
        status text not null default 'pending' check (status in ('pending','confirmed','rejected','expired','executed','failed')),
        idempotency_key text not null unique, expires_at timestamptz not null default (now() + interval '30 minutes'),
        confirmed_at timestamptz, executed_at timestamptz, error_code text,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now());`);

    const novo = await propor('create_client', { nome: 'Bruno Lima', telefone: '62988887777', tipo_interesse: 'LOCACAO' });
    const r1 = await decidir(banco.claimsA, novo);
    assert.equal(r1.status, 'executed');
    const criado = (r1 as { record_id: string }).record_id;
    const [cliente] = await banco.sqlSuperusuario<{ corretor_id: string; tipo_interesse: string }>(
      'select corretor_id::text, tipo_interesse::text from public.clientes where id = $1', [criado]);
    assert.deepEqual(cliente, { corretor_id: banco.corretorA, tipo_interesse: 'LOCACAO' });
    // mesmo telefone em outra grafia: não cria outro, diz que já existia
    const repetido = await decidir(banco.claimsA, await propor('create_client', { nome: 'Bruno', telefone: '(62) 98888-7777' }));
    assert.deepEqual(repetido, { status: 'executed', proposal_id: (repetido as { proposal_id: string }).proposal_id, record_id: criado, existing: true });
    assert.deepEqual(await decidir(banco.claimsA, novo), { status: 'executed', proposal_id: novo, idempotent: true });

    await decidir(banco.claimsA, await propor('update_client_status', { client_id: clienteA, status: 'DOCUMENTACAO' }));
    await decidir(banco.claimsA, await propor('schedule_followup', { client_id: clienteA, date: '2026-12-01' }));
    const [atualizado] = await banco.sqlSuperusuario<{ status_funil: string; f: string }>(
      "select status_funil::text, to_char(proximo_followup at time zone 'UTC', 'YYYY-MM-DD') as f from public.clientes where id = $1", [clienteA]);
    assert.deepEqual(atualizado, { status_funil: 'DOCUMENTACAO', f: '2026-12-01' });

    const alerta = await decidir(banco.claimsA, await propor('create_alert', { mensagem: 'Ligar para Ana', prioridade: 'ALTA' }));
    const [linhaAlerta] = await banco.sqlSuperusuario<{ tipo: string; metadata: Record<string, unknown>; corretor_id: string }>(
      'select tipo::text, metadata, corretor_id::text from public.alertas where id = $1', [(alerta as { record_id: string }).record_id]);
    assert.deepEqual(linhaAlerta, { tipo: 'GERAL', metadata: { prioridade: 'ALTA' }, corretor_id: banco.corretorA });

    const contato = await decidir(banco.claimsA, await propor('register_contact', { client_id: clienteA, tipo: 'ligacao', descricao: 'Retornou' }));
    const [linhaContato] = await banco.sqlSuperusuario<{ tipo: string; direcao: string }>(
      'select tipo::text, direcao::text from public.historico_contatos where id = $1', [(contato as { record_id: string }).record_id]);
    assert.deepEqual(linhaContato, { tipo: 'TELEFONE', direcao: 'OUT' });

    const imovel = await decidir(banco.claimsA, await propor('create_property', { titulo: 'Apto Novo', valor: 320000, dormitorios: 2, cidade: 'Anápolis' }));
    const [linhaImovel] = await banco.sqlSuperusuario<{ corretor_id: string; tipo: string }>(
      'select corretor_id::text, tipo::text from public.imoveis where id = $1', [(imovel as { record_id: string }).record_id]);
    assert.deepEqual(linhaImovel, { corretor_id: banco.corretorA, tipo: 'APARTAMENTO' });

    const lanc = await decidir(banco.claimsA, await propor('create_financial_entry', { tipo: 'DESPESA', categoria: 'OUTROS', descricao: 'Placa', valor: 80 }));
    assert.equal(await contar('select 1 from public.lancamentos_financeiros where id = $1 and corretor_id = $2', [(lanc as { record_id: string }).record_id, banco.corretorA]), 1);
    assert.equal(await contar("select 1 from public.ai_action_proposals where status = 'executed'"), 8);
  });

  test('a outra conta não confirma; recusa; falha marca failed; cliente de outra conta não é tocado', async () => {
    const id = await propor('create_alert', { mensagem: 'x' });
    assert.equal((await capturarErroHttp(decidir(banco.claimsB, id))).status, 404);
    assert.deepEqual(await decidir(banco.claimsA, id, 'reject'), { status: 'rejected', proposal_id: id });
    assert.equal((await capturarErroHttp(decidir(banco.claimsA, id))).status, 409);

    const alheio = await propor('update_client_status', { client_id: clienteB, status: 'FECHADO_PERDIDO' });
    const erro = await capturarErroHttp(decidir(banco.claimsA, alheio));
    assert.equal(erro.status, 500);
    const [p] = await banco.sqlSuperusuario<{ status: string; error_code: string }>('select status, error_code from public.ai_action_proposals where id = $1', [alheio]);
    assert.deepEqual(p, { status: 'failed', error_code: 'execution_failed' });
    const [b] = await banco.sqlSuperusuario<{ status_funil: string }>('select status_funil::text from public.clientes where id = $1', [clienteB]);
    assert.equal(b.status_funil, 'QUALIFICACAO');
  });

  test('com ai_runs: o assistente registra a execução e as ferramentas', async () => {
    let rodada = 0;
    assistente.fetchImpl = (async () => {
      rodada += 1;
      if (rodada === 1) {
        return new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ id: 'call_1', function: { name: 'get_funnel_stats', arguments: '{}' } }] } }] })}\n\n`, { status: 200 });
      }
      return sse('Pronto.');
    }) as never;
    const sessao = await assistente.preparar(banco.claimsA, Object.assign(new AssistenteDto(), { message: 'Funil?', trace_id: 'trace_sql_real_1' }));
    assert.match(String(sessao.runId), UUID);
    await assistente.transmitir(sessao, () => undefined);
    const [run] = await banco.sqlSuperusuario<{ status: string; corretor_id: string }>('select status, corretor_id::text from public.ai_runs where id = $1', [sessao.runId]);
    assert.deepEqual(run, { status: 'completed', corretor_id: banco.corretorA });
    const ferr = await banco.sqlSuperusuario<{ tool_name: string; tool_kind: string; status: string }>('select tool_name, tool_kind, status from public.ai_tool_calls where run_id = $1', [sessao.runId]);
    assert.deepEqual(ferr, [{ tool_name: 'get_funnel_stats', tool_kind: 'read', status: 'completed' }]);
    const papeis = (await conversas.mensagens(banco.claimsA, sessao.conversationId)).map((m) => [m.role, m.tool_name]);
    assert.deepEqual(papeis, [['user', null], ['assistant', null], ['tool', 'call_1'], ['assistant', null]]);
  });
});

describe('anexo, descrição do imóvel e sugestão do Inbox', () => {
  test('anexo com message_id fica legível pela rota anexo-ia só para a dona', async () => {
    const enviados: string[] = [];
    const storage = { enviar: async (_b: string, key: string) => { enviados.push(key); } } as unknown as StorageService;
    const anexos = new AnexosIaService(banco.db, storage);
    const r = await anexos.processar(banco.claimsA, { originalname: 'notas.txt', mimetype: 'text/plain', size: 5, buffer: Buffer.from('notas') }, mensagemA);
    assert.match(r.storage_path, new RegExp(`^${banco.contaA.userId}/\\d+\\.txt$`));
    assert.deepEqual(enviados, [r.storage_path]);
    const repo = new ArquivosRepo(banco.db);
    assert.equal(await repo.donoAnexoIa(banco.claimsA, r.storage_path), true);
    assert.equal(await repo.donoAnexoIa(banco.claimsB, r.storage_path), false);
    // message_id de outra conta: o insert é recusado pelo RLS e ignorado, como a função
    await anexos.processar(banco.claimsB, { originalname: 'b.txt', mimetype: 'text/plain', size: 1, buffer: Buffer.from('b') }, mensagemA);
    assert.equal(await contar('select 1 from public.ai_attachments where message_id = $1', [mensagemA]), 1);
  });

  test('descrição: a dona grava; a outra conta recebe 404', async () => {
    const fotos = new FotosIaService(banco.db);
    assert.deepEqual(await fotos.salvarDescricao(banco.claimsA, imovelA, 'Casa clara.'), { id: imovelA, descricao: 'Casa clara.' });
    assert.equal((await capturarErroHttp(fotos.salvarDescricao(banco.claimsB, imovelA, 'x'))).status, 404);
  });

  test('sugestão do Inbox: só imóveis ativos da conta; cadastro público vai para o modelo e o uso é contado', async () => {
    const mensagens = new MensagensIaService(banco.db, prisma);
    assert.deepEqual((await mensagens.imoveisParaSugestao(banco.claimsA)).map((i) => i.titulo), ['Apto Novo', 'Casa Centro']);
    await banco.sqlSuperusuario("update public.imoveis set ativo = false where titulo = 'Apto Novo'");
    assert.deepEqual(await mensagens.imoveisParaSugestao(banco.claimsA), [{ id: imovelA, titulo: 'Casa Centro' }]);
    assert.deepEqual((await mensagens.imoveisParaSugestao(banco.claimsB)).map((i) => i.id), [imovelB]);
    let enviado: Record<string, unknown> = {};
    mensagens.fetchImpl = (async (_u: string, init: RequestInit) => {
      enviado = JSON.parse(String(init.body));
      return chat('Sim, tem garagem.');
    }) as never;
    const dto = Object.assign(new SugestaoInboxDto(), { propertyId: imovelA, question: 'Tem garagem?' });
    assert.deepEqual(await mensagens.sugerirResposta(banco.claimsA, dto), { suggestion: 'Sim, tem garagem.', propertyId: imovelA, requiresReview: true });
    const cadastro = JSON.parse((enviado.messages as Array<{ content: string }>)[1].content).cadastro;
    assert.equal(cadastro.titulo, 'Casa Centro');
    assert.equal(cadastro.proprietario_nome, undefined);
    assert.equal(cadastro.endereco, undefined);
    const outro = await capturarErroHttp(mensagens.sugerirResposta(banco.claimsA, Object.assign(new SugestaoInboxDto(), { propertyId: imovelB, question: 'x' })));
    assert.equal(outro.status, 404);
  });
});
