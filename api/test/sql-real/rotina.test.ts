// SQL real do módulo rotina (contrato 2026-10-05 §3.2) contra um Postgres de verdade: PGlite com todas as
// migrations, RLS ligado e o TenantDb de produção. Cobre as rotas R1–R15 (caminho feliz, isolamento entre
// as contas A e B e erros traduzidos) e o caminho do servidor (calendar_*) pelo RotinaGoogleRepo com o
// superusuário. O Google nunca é chamado: o fetch é falso e, sem as chaves, o push em segundo plano não faz nada.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { cifrar } from '../../src/rotina/google/cripto';
import { googleEventIdForRoutine } from '../../src/rotina/google/mapeamento';
import { RotinaGoogleRepo } from '../../src/rotina/google/rotina-google.repo';
import { RotinaGoogleService } from '../../src/rotina/google/rotina-google.service';
import {
  ConflitosDto, CriarEventoDto, CriarInboxDto, CriarTarefaDto, EditarEventoDto, EditarTarefaDto, ListarEventosDto, ListarTarefasDto,
} from '../../src/rotina/rotina.dto';
import { RotinaService } from '../../src/rotina/rotina.service';
import { type BancoTeste, capturarErroHttp, criarBanco } from './harness';

let banco: BancoTeste;
let servico: RotinaService;
let repo: RotinaGoogleRepo;
let google: RotinaGoogleService;
const pushes: unknown[][] = [];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00:00$/;
const INEXISTENTE = '99999999-9999-4999-8999-999999999999';
const CHAVE = 'ab'.repeat(32);
const VARIAVEIS = ['GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'GOOGLE_TOKEN_ENCRYPTION_KEY', 'GOOGLE_CALENDAR_REDIRECT_URI'];
const salvas: Record<string, string | undefined> = {};

const OPCOES_PIPE = { whitelist: true, forbidNonWhitelisted: true };
function dto<T extends object>(Classe: new () => T, corpo: Record<string, unknown>): T {
  const instancia = plainToInstance(Classe, corpo);
  assert.deepEqual(validateSync(instancia, OPCOES_PIPE).map((e) => e.property), [], 'o ValidationPipe deveria aceitar este corpo');
  return instancia;
}

const evento = (extra: Record<string, unknown> = {}) => dto(CriarEventoDto, {
  title: 'Visita ao apartamento', activity_type: 'visita_imovel', priority: 'medium', assigned_to: banco.contaA.userId,
  visibility: 'team', start_at: '2026-11-10T13:00:00.000Z', end_at: '2026-11-10T14:00:00.000Z', all_day: false, ...extra,
});
const tarefa = (extra: Record<string, unknown> = {}) => dto(CriarTarefaDto, {
  title: 'Separar documentos', activity_type: 'separacao_documentos', priority: 'high', assigned_to: banco.contaA.userId,
  visibility: 'team', due_at: '2026-11-11T12:00:00.000Z', ...extra,
});

async function falha(promessa: Promise<unknown>, status: number, codigo: string): Promise<Record<string, unknown>> {
  const r = await capturarErroHttp(promessa);
  assert.equal(r.status, status, JSON.stringify(r.corpo));
  assert.equal(r.corpo.codigo, codigo);
  return r.corpo;
}

async function orgDe(userId: string): Promise<string> {
  const r = await banco.sqlSuperusuario<{ id: string }>(
    `select organization_id::text as id from public.routine_memberships where user_id = $1::uuid and status = 'active'`, [userId]);
  return r[0].id;
}

before(async () => {
  for (const v of VARIAVEIS) { salvas[v] = process.env[v]; delete process.env[v]; }
  banco = await criarBanco();
  repo = new RotinaGoogleRepo(banco.prisma as unknown as PrismaService);
  google = new RotinaGoogleService(banco.db, repo, (async () => { throw new Error('rede proibida no teste'); }) as unknown as typeof fetch);
  const googleEspiao = {
    pushEventoEmSegundoPlano: async (...args: unknown[]) => { pushes.push(args); },
  } as unknown as RotinaGoogleService;
  servico = new RotinaService(banco.db, googleEspiao);
});

after(async () => {
  for (const v of VARIAVEIS) { if (salvas[v] === undefined) delete process.env[v]; else process.env[v] = salvas[v]; }
  await banco?.fechar();
});

beforeEach(() => { pushes.length = 0; });

describe('R1 contexto e R2 membros', () => {
  test('A recebe organization e membership no formato do PostgREST', async () => {
    const ctx = await servico.contexto(banco.claimsA);
    assert.ok(ctx);
    assert.match(String(ctx.organization.id), UUID);
    assert.match(String(ctx.organization.created_at), TIMESTAMPTZ);
    assert.equal(ctx.membership.user_id, banco.contaA.userId);
    assert.equal(ctx.membership.role, 'proprietario');
    assert.equal(ctx.membership.organization_id, ctx.organization.id);
    assert.equal(ctx.organization.timezone, 'America/Sao_Paulo');
  });

  test('conta sem rotina: contexto null e demais rotas 403', async () => {
    const conta = await banco.criarConta();
    await banco.sqlSuperusuario(`update public.routine_memberships set status = 'suspended' where user_id = $1::uuid`, [conta.userId]);
    assert.equal(await servico.contexto(conta.claims), null);
    await falha(servico.listarMembros(conta.claims), 403, 'routine_membership_required');
  });

  test('membros: só os da própria organização', async () => {
    const a = await servico.listarMembros(banco.claimsA);
    assert.deepEqual(a.map((m) => m.user_id), [banco.contaA.userId]);
    const b = await servico.listarMembros(banco.claimsB);
    assert.deepEqual(b.map((m) => m.user_id), [banco.contaB.userId]);
  });
});

describe('R10 criação de evento', () => {
  test('grava pending, timezone da org e created_by; sobreposto dá 409 sem abortar transação', async () => {
    const r = await servico.criarEvento(banco.claimsA, evento());
    assert.equal(r.lembrete_criado, false);
    assert.equal(r.evento.sync_status, 'pending');
    assert.equal(r.evento.timezone, 'America/Sao_Paulo');
    assert.equal(r.evento.created_by, banco.contaA.userId);
    assert.equal(r.evento.organization_id, await orgDe(banco.contaA.userId));
    assert.equal(r.evento.source, 'lotti');
    assert.match(String(r.evento.updated_at), TIMESTAMPTZ);
    assert.deepEqual(pushes, [[r.evento.id, banco.contaA.userId, undefined]]);

    const abortadosAntes = banco.transacoes.commitsAbortados;
    const corpo = await falha(servico.criarEvento(banco.claimsA, evento({ title: 'Outro', start_at: '2026-11-10T13:30:00.000Z', end_at: '2026-11-10T15:00:00.000Z' })), 409, 'CONFLICT');
    const conflicts = corpo.conflicts as Array<Record<string, unknown>>;
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].event_id, r.evento.id);
    assert.equal(conflicts[0].is_private, false);
    assert.equal(banco.transacoes.commitsAbortados, abortadosAntes);
    const total = await banco.sqlSuperusuario<{ n: number }>(`select count(*)::int as n from public.routine_events where title = 'Outro'`);
    assert.equal(total[0].n, 0);
  });

  test('reminder_minutes grava routine_reminders com remind_at = início - n min', async () => {
    const r = await servico.criarEvento(banco.claimsA, evento({ start_at: '2026-11-12T13:00:00.000Z', end_at: '2026-11-12T14:00:00.000Z', reminder_minutes: 90 }));
    assert.equal(r.lembrete_criado, true);
    const l = await banco.sqlSuperusuario<{ remind_at: string; minutes_before: number; user_id: string }>(
      `select to_char(remind_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as remind_at, minutes_before, user_id::text as user_id
       from public.routine_reminders where event_id = $1::uuid`, [r.evento.id]);
    assert.deepEqual(l, [{ remind_at: '2026-11-12T11:30', minutes_before: 90, user_id: banco.contaA.userId }]);
    assert.equal(banco.transacoes.commitsAbortados, 0);
  });

  test('cliente de B em evento de A → 422 cliente_fora_da_organizacao', async () => {
    const cliente = await banco.inserir('clientes', { corretor_id: banco.corretorB, nome: 'Cliente de B', telefone: '62900000001' }, { semGatilhos: true });
    await falha(servico.criarEvento(banco.claimsA, evento({ start_at: '2026-11-13T13:00:00.000Z', end_at: '2026-11-13T14:00:00.000Z', client_id: cliente.id })), 422, 'cliente_fora_da_organizacao');
  });

  test('responsável de outra organização → 403 sem_permissao (RPC de conflito)', async () => {
    await falha(servico.criarEvento(banco.claimsA, evento({ assigned_to: banco.contaB.userId })), 403, 'sem_permissao');
  });
});

describe('R9 conflitos', () => {
  test('fim antes do início → 400 intervalo_invalido', async () => {
    await falha(servico.detectarConflitos(banco.claimsA, dto(ConflitosDto, {
      assigned_to: banco.contaA.userId, start_at: '2026-11-10T14:00:00.000Z', end_at: '2026-11-10T13:00:00.000Z',
    })), 400, 'intervalo_invalido');
  });

  test('B não enxerga a agenda de A; A vê o próprio conflito', async () => {
    const corpo = { assigned_to: banco.contaA.userId, start_at: '2026-11-10T13:15:00.000Z', end_at: '2026-11-10T13:45:00.000Z' };
    const a = await servico.detectarConflitos(banco.claimsA, dto(ConflitosDto, corpo));
    assert.equal(a.length, 1);
    assert.deepEqual(Object.keys(a[0]).sort(), ['end_at', 'event_id', 'is_private', 'start_at', 'title']);
    await falha(servico.detectarConflitos(banco.claimsB, dto(ConflitosDto, corpo)), 403, 'sem_permissao');
  });
});

describe('R3/R4 listagens e isolamento', () => {
  test('R3 traz recorrente iniciado antes do período e não traz apagado; B não vê nada de A', async () => {
    const rec = await servico.criarEvento(banco.claimsA, evento({
      title: 'Reunião semanal', start_at: '2026-01-05T12:00:00.000Z', end_at: '2026-01-05T13:00:00.000Z', recurrence_rule: 'FREQ=WEEKLY',
    }));
    const apagado = await servico.criarEvento(banco.claimsA, evento({ title: 'Apagado', start_at: '2026-11-20T12:00:00.000Z', end_at: '2026-11-20T13:00:00.000Z' }));
    await servico.remover(banco.claimsA, 'evento', String(apagado.evento.id));
    const q = dto(ListarEventosDto, { inicio: '2026-11-01T00:00:00.000Z', fim: '2026-11-30T23:59:59.000Z' });
    const ids = (await servico.listarEventos(banco.claimsA, q)).map((e) => e.id);
    assert.ok(ids.includes(rec.evento.id));
    assert.ok(!ids.includes(apagado.evento.id));
    const soA = await servico.listarEventos(banco.claimsA, dto(ListarEventosDto, { ...q, responsavel: banco.contaA.userId }));
    assert.equal(soA.length, ids.length);
    assert.deepEqual(await servico.listarEventos(banco.claimsB, q), []);
  });

  test('R11/R4 tarefas: cria, lista para A e nada para B', async () => {
    const t = await servico.criarTarefa(banco.claimsA, tarefa());
    assert.equal(t.source, 'lotti');
    assert.equal(t.created_by, banco.contaA.userId);
    const lista = await servico.listarTarefas(banco.claimsA, dto(ListarTarefasDto, {}));
    assert.ok(lista.some((x) => x.id === t.id));
    assert.deepEqual(await servico.listarTarefas(banco.claimsB, dto(ListarTarefasDto, {})), []);
  });

  test('R5 atividade registra o log da organização de A e nada para B', async () => {
    const a = await servico.listarAtividade(banco.claimsA);
    assert.ok(a.length > 0);
    assert.deepEqual(await servico.listarAtividade(banco.claimsB), []);
  });
});

describe('R12/R13 edição', () => {
  test('expected_updated_at certo grava, o antigo dá 409 e sync_version sobe', async () => {
    const { evento: ev } = await servico.criarEvento(banco.claimsA, evento({ title: 'Editar', start_at: '2026-11-14T13:00:00.000Z', end_at: '2026-11-14T14:00:00.000Z' }));
    pushes.length = 0;
    const editado = await servico.editarEvento(banco.claimsA, String(ev.id), dto(EditarEventoDto, {
      title: 'Editado', expected_updated_at: ev.updated_at,
    }));
    assert.equal(editado.title, 'Editado');
    assert.equal(Number(editado.sync_version), Number(ev.sync_version) + 1);
    assert.deepEqual(pushes, [[ev.id, banco.contaA.userId, undefined]]);
    await falha(servico.editarEvento(banco.claimsA, String(ev.id), dto(EditarEventoDto, { title: 'De novo', expected_updated_at: ev.updated_at })), 409, 'CONCURRENCY_CONFLICT');
    await falha(servico.editarEvento(banco.claimsA, String(ev.id), dto(EditarEventoDto, {
      start_at: '2026-11-14T15:00:00.000Z', end_at: '2026-11-14T14:00:00.000Z',
    })), 400, 'intervalo_invalido');
    assert.equal(banco.transacoes.commitsAbortados, 0);
  });

  test('B não edita, não conclui e não remove item de A (404)', async () => {
    const { evento: ev } = await servico.criarEvento(banco.claimsA, evento({ title: 'De A', start_at: '2026-11-15T13:00:00.000Z', end_at: '2026-11-15T14:00:00.000Z' }));
    const t = await servico.criarTarefa(banco.claimsA, tarefa({ title: 'Tarefa de A' }));
    await falha(servico.editarEvento(banco.claimsB, String(ev.id), dto(EditarEventoDto, { title: 'Invadido' })), 404, 'nao_encontrado');
    await falha(servico.editarTarefa(banco.claimsB, String(t.id), dto(EditarTarefaDto, { title: 'Invadido' })), 404, 'nao_encontrado');
    await falha(servico.concluir(banco.claimsB, 'evento', String(ev.id)), 404, 'nao_encontrado');
    await falha(servico.remover(banco.claimsB, 'tarefa', String(t.id)), 404, 'nao_encontrado');
    await falha(servico.remover(banco.claimsA, 'evento', INEXISTENTE), 404, 'nao_encontrado');
    const ainda = await banco.sqlSuperusuario<{ title: string; deleted_at: string | null }>(
      `select title, deleted_at::text from public.routine_events where id = $1::uuid`, [ev.id]);
    assert.deepEqual(ainda, [{ title: 'De A', deleted_at: null }]);
  });

  test('R13 tarefa: edita e remove', async () => {
    const t = await servico.criarTarefa(banco.claimsA, tarefa({ title: 'Para editar' }));
    const e = await servico.editarTarefa(banco.claimsA, String(t.id), dto(EditarTarefaDto, { priority: 'urgent', due_at: null }));
    assert.equal(e.priority, 'urgent');
    assert.equal(e.due_at, null);
    assert.deepEqual(await servico.remover(banco.claimsA, 'tarefa', String(t.id)), { removido: true });
    assert.deepEqual(pushes, []);
  });
});

describe('R14 conclusão', () => {
  test('com cliente de A registra no CRM; sem cliente não registra', async () => {
    const cliente = await banco.inserir('clientes', { corretor_id: banco.corretorA, nome: 'Cliente de A', telefone: '62900000002' });
    const { evento: ev } = await servico.criarEvento(banco.claimsA, evento({ start_at: '2026-11-16T13:00:00.000Z', end_at: '2026-11-16T14:00:00.000Z', client_id: cliente.id }));
    const r = await servico.concluir(banco.claimsA, 'evento', String(ev.id));
    assert.equal(r.registrado_no_crm, true);
    assert.equal(r.item.status, 'completed');
    assert.match(String(r.item.completed_at), TIMESTAMPTZ);
    const h = await banco.sqlSuperusuario<{ n: number }>(`select count(*)::int as n from public.historico_contatos where cliente_id = $1::uuid`, [cliente.id]);
    assert.equal(h[0].n, 1);

    const t = await servico.criarTarefa(banco.claimsA, tarefa({ title: 'Sem cliente' }));
    const r2 = await servico.concluir(banco.claimsA, 'tarefa', String(t.id));
    assert.equal(r2.registrado_no_crm, false);
    assert.equal(r2.item.status, 'completed');
  });
});

describe('R6–R8 inbox', () => {
  test('cria, lista, arquiva e some; B não arquiva o de A', async () => {
    const i = await servico.criarInbox(banco.claimsA, dto(CriarInboxDto, { content: '  Ligar para o síndico  ' }));
    assert.equal(i.content, 'Ligar para o síndico');
    assert.equal(i.kind, 'note');
    assert.equal(i.status, 'unprocessed');
    assert.ok((await servico.listarInbox(banco.claimsA)).some((x) => x.id === i.id));
    assert.deepEqual(await servico.listarInbox(banco.claimsB), []);
    await falha(servico.arquivarInbox(banco.claimsB, String(i.id)), 404, 'nao_encontrado');
    assert.deepEqual(await servico.arquivarInbox(banco.claimsA, String(i.id)), { arquivado: true });
    assert.ok(!(await servico.listarInbox(banco.claimsA)).some((x) => x.id === i.id));
  });
});

describe('caminho do servidor (calendar_*)', () => {
  test('o repo grava e lê calendar_connections; o TenantDb não alcança a tabela (42501)', async () => {
    const org = await orgDe(banco.contaA.userId);
    await repo.prepararStart(org, banco.contaA.userId, 'hash-1', 'v1.verificador');
    const c = await repo.conexaoDoUsuario(org, banco.contaA.userId);
    assert.ok(c);
    assert.equal(c.status, 'pending');
    assert.equal(c.oauth_state_hash, 'hash-1');
    assert.equal((await repo.conexaoPorState('hash-1'))?.id, c.id);
    assert.equal(await repo.conexaoDoUsuario(await orgDe(banco.contaB.userId), banco.contaB.userId), null);
    await assert.rejects(
      banco.db.run(banco.claimsA, (tx) => tx.$queryRaw`select id from public.calendar_connections`),
      (e: unknown) => (e as { meta?: { code?: string } }).meta?.code === '42501',
    );
  });

  test('start sobre conexão connected mantém connected; status lê pelo repo', async () => {
    const org = await orgDe(banco.contaA.userId);
    await banco.sqlSuperusuario(`update public.calendar_connections set status = 'connected', provider_email = 'a@gmail.com' where organization_id = $1::uuid`, [org]);
    await repo.prepararStart(org, banco.contaA.userId, 'hash-2', 'v1.outro');
    const c = await repo.conexaoDoUsuario(org, banco.contaA.userId);
    assert.equal(c?.status, 'connected');
    assert.equal(c?.oauth_state_hash, 'hash-2');
    const st = await google.status(banco.claimsA);
    assert.deepEqual(st, { connected: true, status: 'connected', provider_email: 'a@gmail.com', privacy_mode: 'partial', last_sync_at: null, last_error_code: null });
    assert.deepEqual(await google.status(banco.claimsB), { connected: false, status: 'not_connected' });
  });

  test('callback com access_denied numa conexão connected só limpa o state e volta com google_calendar=error', async () => {
    process.env.GOOGLE_CALENDAR_CLIENT_ID = 'cid';
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'segredo';
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = CHAVE;
    process.env.GOOGLE_CALENDAR_REDIRECT_URI = 'https://api.teste/api/google-agenda/callback';
    try {
      const org = await orgDe(banco.contaA.userId);
      const { sha256Base64Url } = await import('../../src/rotina/google/cripto');
      await repo.prepararStart(org, banco.contaA.userId, sha256Base64Url('estado-3'), cifrar('verificador', CHAVE));
      const url = await google.callback({ state: 'estado-3', error: 'access_denied' });
      assert.equal(new URL(url).searchParams.get('google_calendar'), 'error');
      assert.deepEqual([...new URL(url).searchParams.keys()], ['google_calendar']);
      const c = await repo.conexaoDoUsuario(org, banco.contaA.userId);
      assert.equal(c?.status, 'connected');
      assert.equal(c?.oauth_state_hash, null);
      assert.equal(c?.oauth_expires_at, null);
    } finally {
      for (const v of VARIAVEIS) delete process.env[v];
    }
  });

  test('G5/G6 calendários pelo TenantDb: is_default troca em transação; B não vê o de A', async () => {
    const org = await orgDe(banco.contaA.userId);
    const c = await repo.conexaoDoUsuario(org, banco.contaA.userId);
    await repo.upsertCalendario(c!, { external_calendar_id: 'primario@gmail.com', summary: 'Principal', color: null, access_role: 'owner', primary: true, sync_direction: 'bidirectional' });
    await repo.upsertCalendario(c!, { external_calendar_id: 'trabalho', summary: 'Trabalho', color: '#fff', access_role: 'writer', primary: false, sync_direction: 'bidirectional' });
    const lista = await google.listarCalendarios(banco.claimsA);
    assert.equal(lista.length, 2);
    assert.equal(lista[0].is_primary, true);
    assert.deepEqual(await google.listarCalendarios(banco.claimsB), []);
    const trabalho = lista.find((x) => x.external_calendar_id === 'trabalho')!;
    const r = await google.configurarCalendario(banco.claimsA, String(trabalho.id), { is_default: true, selected: true });
    assert.equal(r.is_default, true);
    const depois = await google.listarCalendarios(banco.claimsA);
    assert.deepEqual(depois.filter((x) => x.is_default).map((x) => x.id), [trabalho.id]);
    await falha(google.configurarCalendario(banco.claimsB, String(trabalho.id), { selected: false }), 404, 'nao_encontrado');
    // Reconexão preserva selected/is_default.
    await repo.upsertCalendario(c!, { external_calendar_id: 'primario@gmail.com', summary: 'Principal 2', color: null, access_role: 'owner', primary: true, sync_direction: 'bidirectional' });
    const prim = (await google.listarCalendarios(banco.claimsA)).find((x) => x.external_calendar_id === 'primario@gmail.com')!;
    assert.equal(prim.is_default, false);
    assert.equal(prim.summary, 'Principal 2');
  });

  test('G3 sem chaves apaga a conexão sem revogar; segunda vez é idempotente', async () => {
    assert.deepEqual(await google.desconectar(banco.claimsA), { disconnected: true });
    assert.deepEqual(await google.desconectar(banco.claimsA), { disconnected: true, idempotent: true });
  });

  test('recibo de webhook repetido é reconhecido fora de transação', async () => {
    assert.equal(await repo.inserirRecibo('canal-1', 7, 'exists'), 'inserido');
    assert.equal(await repo.inserirRecibo('canal-1', 7, 'exists'), 'duplicado');
    await repo.apagarRecibo('canal-1', 7);
    assert.equal(await repo.inserirRecibo('canal-1', 7, 'exists'), 'inserido');
    assert.equal(await repo.limparRecibosAntigos(), 0);
  });
});

describe('sync pelo caminho do servidor (fetch falso)', () => {
  test('pull importa evento do Google, push sobe evento do Lotti, troca de responsável e webhook', async () => {
    process.env.GOOGLE_CALENDAR_CLIENT_ID = 'cid';
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'segredo';
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = CHAVE;
    try {
      const org = await orgDe(banco.contaA.userId);
      const conn = await banco.inserir('calendar_connections', {
        organization_id: org, user_id: banco.contaA.userId, status: 'connected',
        access_token_ciphertext: cifrar('token-a', CHAVE), refresh_token_ciphertext: cifrar('refresh-a', CHAVE),
        token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
      const cal = await banco.inserir('external_calendars', {
        connection_id: conn.id, organization_id: org, user_id: banco.contaA.userId, external_calendar_id: 'a@gmail.com',
        summary: 'A', selected: true, is_primary: true, is_default: true, sync_direction: 'bidirectional',
      });
      const { evento: local } = await servico.criarEvento(banco.claimsA, evento({ title: 'Sobe pro Google', start_at: '2026-12-01T13:00:00.000Z', end_at: '2026-12-01T14:00:00.000Z' }));
      const chamadas: Array<{ metodo: string; url: string }> = [];
      const fetchFalso = (async (url: string, init?: RequestInit) => {
        const metodo = init?.method ?? 'GET';
        chamadas.push({ metodo, url: String(url) });
        if (metodo === 'GET' && String(url).includes('/events?')) {
          return new Response(JSON.stringify({
            items: [{ id: 'g-1', etag: 'e1', updated: '2026-12-01T10:00:00Z', summary: 'Reunião no Google',
              start: { dateTime: '2026-12-02T12:00:00Z' }, end: { dateTime: '2026-12-02T13:00:00Z' } }],
            nextSyncToken: 'sync-1',
          }), { status: 200 });
        }
        if (metodo === 'PUT') {
          const id = decodeURIComponent(String(url).split('/').pop() as string);
          return new Response(JSON.stringify({ id, etag: 'e2', updated: '2026-12-01T11:00:00Z' }), { status: 200 });
        }
        if (metodo === 'DELETE') return new Response(null, { status: 204 });
        return new Response('{}', { status: 500 });
      }) as unknown as typeof fetch;
      const g = new RotinaGoogleService(banco.db, repo, fetchFalso);
      const conexao = (await repo.conexaoConectada(org, banco.contaA.userId))!;
      const r = await g.syncConnection(conexao);
      assert.equal(r.imported, 1);
      assert.equal(r.errors, 0);
      assert.ok(r.pushed >= 1);
      const importado = await banco.sqlSuperusuario<{ title: string; source: string; sync_status: string }>(
        `select e.title, e.source, e.sync_status from public.routine_events e
         join public.calendar_event_mappings m on m.routine_event_id = e.id where m.google_event_id = 'g-1'`);
      assert.deepEqual(importado, [{ title: 'Reunião no Google', source: 'google', sync_status: 'synced' }]);
      const subido = await banco.sqlSuperusuario<{ sync_status: string; google_event_id: string; external_calendar_id: string }>(
        `select e.sync_status, m.google_event_id, m.external_calendar_id::text from public.routine_events e
         join public.calendar_event_mappings m on m.routine_event_id = e.id where e.id = $1::uuid`, [local.id]);
      assert.deepEqual(subido, [{ sync_status: 'synced', google_event_id: googleEventIdForRoutine(String(local.id)), external_calendar_id: cal.id }]);
      const estado = await repo.syncState(String(cal.id));
      assert.match(String(estado?.sync_token_ciphertext), /^v1\./);
      assert.equal((await repo.conexaoDoUsuario(org, banco.contaA.userId))?.last_error_code, null);

      // Segundo sync: nada novo para subir (versão do mapeamento igual à do evento).
      chamadas.length = 0;
      const r2 = await g.syncConnection((await repo.conexaoConectada(org, banco.contaA.userId))!, undefined, false);
      assert.equal(r2.pushed, 0);
      assert.ok(!chamadas.some((c) => c.metodo === 'PUT'));

      // Troca de responsável: membro novo sem conexão; o mapeamento antigo é apagado no Google e marcado.
      const outro = await banco.criarConta();
      await banco.sqlSuperusuario(`update public.routine_memberships set organization_id = $1::uuid where user_id = $2::uuid`, [org, outro.userId]);
      chamadas.length = 0;
      await g.pushEventoEmSegundoPlano(String(local.id), outro.userId, banco.contaA.userId);
      assert.ok(chamadas.some((c) => c.metodo === 'DELETE' && c.url.endsWith(`/events/${googleEventIdForRoutine(String(local.id))}`)));
      const mapa = await banco.sqlSuperusuario<{ apagado: boolean }>(
        `select deleted_at is not null as apagado from public.calendar_event_mappings where routine_event_id = $1::uuid`, [local.id]);
      assert.deepEqual(mapa, [{ apagado: true }]);

      // webhookCalendario: só o pull do calendário avisado.
      chamadas.length = 0;
      const w = await g.webhookCalendario(String(cal.id));
      assert.deepEqual(w, { imported: 1, cancelled: 0 });
      assert.ok(chamadas.every((c) => c.metodo === 'GET'));
      assert.equal(banco.transacoes.commitsAbortados, 0);
    } finally {
      for (const v of VARIAVEIS) delete process.env[v];
    }
  });
});
