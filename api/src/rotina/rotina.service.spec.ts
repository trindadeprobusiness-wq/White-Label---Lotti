import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ConflitosDto, CriarEventoDto, CriarInboxDto, CriarTarefaDto, EditarEventoDto, EditarTarefaDto, ListarEventosDto, ListarTarefasDto,
} from './rotina.dto';
import { comOrigem, traduzirErroBanco } from './rotina.erros';
import { RotinaService } from './rotina.service';

const ORG = '0rg00000-0000-4000-8000-000000000000'.replace('0rg', '0a0');
const USER = '11111111-1111-4111-8111-111111111111';
const OUTRO = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';
const CLIENTE = '44444444-4444-4444-8444-444444444444';
const TOKEN = '2026-10-05T12:34:56.123456+00:00';
const claims = { sub: USER, role: 'authenticated' };
const CTX = {
  membership: { organization_id: ORG, user_id: USER, role: 'proprietario', status: 'active' },
  organization: { id: ORG, timezone: 'America/Fortaleza' },
};

function montar() {
  const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn(async () => 0) };
  const db = { run: jest.fn(async (_c: unknown, w: (t: typeof tx) => unknown) => w(tx)) };
  const google = { pushEventoEmSegundoPlano: jest.fn(async () => undefined) };
  const servico = new RotinaService(db as never, google as never);
  return { tx, db, google, servico };
}

/** Primeira consulta de toda rota que exige rotina: a membership. */
const comContexto = (tx: { $queryRaw: jest.Mock }) => tx.$queryRaw.mockResolvedValueOnce([CTX]);
const sql = (m: jest.Mock, i: number) => m.mock.calls[i][0] as Prisma.Sql;
const texto = (m: jest.Mock, i: number) => sql(m, i).text.replace(/\s+/g, ' ').trim();

function confereCasts(m: jest.Mock) {
  for (const [q] of m.mock.calls) expect((q as Prisma.Sql).text).not.toMatch(/\$\d+(?!\d|::)/);
}

function erroBanco(code: string, message: string) {
  return new Prisma.PrismaClientKnownRequestError('x', { code: 'P2010', clientVersion: 'teste', meta: { code, message } });
}

async function erroDe(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('não lançou');
}

function traduzido(e: unknown, op?: Parameters<typeof traduzirErroBanco>[1]) {
  try {
    traduzirErroBanco(e, op);
  } catch (t) {
    if (t instanceof HttpException) return { status: t.getStatus(), ...(t.getResponse() as Record<string, unknown>) };
    return t;
  }
  return null;
}

const dto = <T extends object>(Classe: new () => T, dados: Partial<T>): T => Object.assign(new Classe(), dados);
const eventoDto = (extra: Partial<CriarEventoDto> = {}) => dto(CriarEventoDto, {
  title: 'Visita', activity_type: 'visita_imovel', priority: 'medium', assigned_to: USER, visibility: 'team',
  start_at: '2026-11-10T13:00:00.000Z', end_at: '2026-11-10T14:00:00.000Z', all_day: false, ...extra,
});

describe('RotinaService: contexto e listagens', () => {
  it('R1 contexto: consulta de membership e null sem linha', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await servico.contexto(claims)).toBeNull();
    expect(texto(tx.$queryRaw, 0)).toBe(
      "select to_jsonb(m) as membership, to_jsonb(o) as organization from public.routine_memberships m join public.routine_organizations o on o.id = m.organization_id where m.user_id = $1::uuid and m.status = 'active' limit 1",
    );
    expect(sql(tx.$queryRaw, 0).values).toEqual([USER]);
  });

  it('R1 contexto: 42P01 vira null', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockRejectedValueOnce(erroBanco('42P01', 'ERROR: relation "routine_memberships" does not exist'));
    expect(await servico.contexto(claims)).toBeNull();
  });

  it('sem membership: 403 routine_membership_required', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    const { status, body } = await erroDe(servico.listarMembros(claims));
    expect(status).toBe(403);
    expect(body).toEqual({ statusCode: 403, codigo: 'routine_membership_required', message: 'Sua conta ainda não tem uma rotina ativa.' });
  });

  it('R2 membros', async () => {
    const { tx, servico } = montar();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: 'm1' } }]);
    expect(await servico.listarMembros(claims)).toEqual([{ id: 'm1' }]);
    expect(texto(tx.$queryRaw, 1)).toBe(
      "select to_jsonb(m) as linha from public.routine_memberships m where m.organization_id = $1::uuid and m.status = 'active' order by m.display_name asc nulls last limit $2::int",
    );
    expect(sql(tx.$queryRaw, 1).values).toEqual([ORG, 1000]);
    confereCasts(tx.$queryRaw);
  });

  it('R3 eventos: união numa consulta, responsável opcional, org da membership', async () => {
    const { tx, servico } = montar();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([]);
    await servico.listarEventos(claims, dto(ListarEventosDto, { inicio: '2026-11-01T00:00:00Z', fim: '2026-11-30T00:00:00Z' }));
    const t = texto(tx.$queryRaw, 1);
    expect(t).toContain('select to_jsonb(e) as linha from public.routine_events e where e.organization_id = $1::uuid and e.deleted_at is null');
    expect(t).toContain('and ($2::uuid is null or e.assigned_to = $3::uuid) and e.start_at <= $4::timestamptz');
    expect(t).toContain('and (e.end_at >= $5::timestamptz or e.recurrence_rule is not null) order by e.start_at asc limit $6::int');
    expect(sql(tx.$queryRaw, 1).values).toEqual([ORG, null, null, '2026-11-30T00:00:00Z', '2026-11-01T00:00:00Z', 1000]);
    confereCasts(tx.$queryRaw);
  });

  it('R4 tarefas, R5 atividade e R6 inbox', async () => {
    const { tx, servico } = montar();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([]);
    await servico.listarTarefas(claims, dto(ListarTarefasDto, { responsavel: OUTRO }));
    expect(texto(tx.$queryRaw, 1)).toContain('from public.routine_tasks t where t.organization_id = $1::uuid and t.deleted_at is null');
    expect(texto(tx.$queryRaw, 1)).toContain('order by t.due_at asc nulls last limit $4::int');
    expect(sql(tx.$queryRaw, 1).values).toEqual([ORG, OUTRO, OUTRO, 1000]);

    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([]);
    await servico.listarAtividade(claims);
    expect(texto(tx.$queryRaw, 3)).toBe(
      'select to_jsonb(a) as linha from public.routine_activity_log a where a.organization_id = $1::uuid order by a.created_at desc limit $2::int',
    );
    expect(sql(tx.$queryRaw, 3).values).toEqual([ORG, 40]);

    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([]);
    await servico.listarInbox(claims);
    expect(texto(tx.$queryRaw, 5)).toBe(
      "select to_jsonb(i) as linha from public.routine_inbox i where i.organization_id = $1::uuid and i.user_id = $2::uuid and i.status = 'unprocessed' order by i.created_at desc limit $3::int",
    );
    expect(sql(tx.$queryRaw, 5).values).toEqual([ORG, USER, 1000]);
    confereCasts(tx.$queryRaw);
  });
});

describe('RotinaService: inbox', () => {
  it('R7 cria com kind padrão note', async () => {
    const { tx, servico } = montar();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: ID } }]);
    expect(await servico.criarInbox(claims, dto(CriarInboxDto, { content: 'Ligar' }))).toEqual({ id: ID });
    expect(texto(tx.$queryRaw, 1)).toBe(
      'insert into public.routine_inbox (organization_id, user_id, kind, content) values ($1::uuid, $2::uuid, $3::text, $4::text) returning to_jsonb(routine_inbox.*) as linha',
    );
    expect(sql(tx.$queryRaw, 1).values).toEqual([ORG, USER, 'note', 'Ligar']);
  });

  it('R8 arquiva; sem linha → 404 Anotação não encontrada', async () => {
    const { tx, servico } = montar();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([]);
    const { status, body } = await erroDe(servico.arquivarInbox(claims, ID));
    expect(status).toBe(404);
    expect(body.message).toBe('Anotação não encontrada.');
    expect(texto(tx.$queryRaw, 1)).toBe("update public.routine_inbox set status = 'archived' where id = $1::uuid and user_id = $2::uuid returning id");
  });
});

describe('RotinaService: R9 e R10', () => {
  it('R9 chama a RPC com casts; 22023 vira intervalo_invalido', async () => {
    const { tx, servico } = montar();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { event_id: ID } }]);
    const corpo = dto(ConflitosDto, { assigned_to: USER, start_at: 'a', end_at: 'b' });
    expect(await servico.detectarConflitos(claims, corpo)).toEqual([{ event_id: ID }]);
    expect(texto(tx.$queryRaw, 1)).toBe(
      'select to_jsonb(c) as linha from public.routine_detect_conflicts($1::uuid, $2::timestamptz, $3::timestamptz, $4::uuid) c',
    );
    expect(sql(tx.$queryRaw, 1).values).toEqual([USER, 'a', 'b', null]);

    comContexto(tx);
    tx.$queryRaw.mockRejectedValueOnce(erroBanco('22023', 'ERROR: solicitação inválida'));
    expect((await erroDe(servico.detectarConflitos(claims, corpo))).body.codigo).toBe('intervalo_invalido');
  });

  it('R10 conflito → 409 CONFLICT com conflicts e nenhum insert', async () => {
    const { tx, google, servico } = montar();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { event_id: OUTRO, title: 'Ocupado' } }]);
    const { status, body } = await erroDe(servico.criarEvento(claims, eventoDto()));
    expect(status).toBe(409);
    expect(body).toEqual({ statusCode: 409, codigo: 'CONFLICT', message: 'Existe outro compromisso nesse horário.', conflicts: [{ event_id: OUTRO, title: 'Ocupado' }] });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(google.pushEventoEmSegundoPlano).not.toHaveBeenCalled();
  });

  it('R10 insere com org/created_by/timezone/sync_status; lembrete em savepoint; push depois do run', async () => {
    const { tx, db, google, servico } = montar();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([]);
    const linha = { id: ID, assigned_to: USER, start_at: '2026-11-10T13:00:00+00:00' };
    tx.$queryRaw.mockResolvedValueOnce([{ linha }]);
    let pushDentroDoRun = false;
    db.run.mockImplementationOnce(async (_c, w) => {
      const r = await w(tx);
      pushDentroDoRun = google.pushEventoEmSegundoPlano.mock.calls.length > 0;
      return r;
    });
    const r = await servico.criarEvento(claims, eventoDto({ reminder_minutes: 30, organization_id: 'x' } as Partial<CriarEventoDto>));
    expect(r).toEqual({ evento: linha, lembrete_criado: true });
    const t = texto(tx.$queryRaw, 2);
    expect(t).toBe(
      'insert into public.routine_events as e (title, activity_type, priority, assigned_to, visibility, start_at, end_at, all_day, organization_id, created_by, timezone, source, sync_status) select r.title, r.activity_type, r.priority, r.assigned_to, r.visibility, r.start_at, r.end_at, r.all_day, r.organization_id, r.created_by, r.timezone, r.source, r.sync_status from jsonb_populate_record(null::public.routine_events, $1::jsonb) r returning to_jsonb(e) as linha',
    );
    expect(JSON.parse(sql(tx.$queryRaw, 2).values[0] as string)).toEqual({
      title: 'Visita', activity_type: 'visita_imovel', priority: 'medium', assigned_to: USER, visibility: 'team',
      start_at: '2026-11-10T13:00:00.000Z', end_at: '2026-11-10T14:00:00.000Z', all_day: false,
      organization_id: ORG, created_by: USER, timezone: 'America/Fortaleza', source: 'lotti', sync_status: 'pending',
    });
    expect(texto(tx.$executeRaw, 0)).toBe('savepoint lembrete');
    expect(texto(tx.$executeRaw, 1)).toBe(
      'insert into public.routine_reminders (organization_id, user_id, event_id, remind_at, minutes_before) values ($1::uuid, $2::uuid, $3::uuid, $4::timestamptz - make_interval(mins => $5::int), $6::int)',
    );
    expect(sql(tx.$executeRaw, 1).values).toEqual([ORG, USER, ID, '2026-11-10T13:00:00+00:00', 30, 30]);
    expect(texto(tx.$executeRaw, 2)).toBe('release savepoint lembrete');
    expect(pushDentroDoRun).toBe(false);
    expect(google.pushEventoEmSegundoPlano).toHaveBeenCalledWith(ID, USER, undefined);
    confereCasts(tx.$queryRaw);
    confereCasts(tx.$executeRaw);
  });

  it('R10 lembrete recusado (42501) → rollback to savepoint, lembrete_criado false e evento devolvido', async () => {
    const { tx, servico } = montar();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ linha: { id: ID, assigned_to: OUTRO, start_at: 'x' } }]);
    tx.$executeRaw
      .mockResolvedValueOnce(0)
      .mockRejectedValueOnce(erroBanco('42501', 'ERROR: new row violates row-level security policy for table "routine_reminders"'))
      .mockResolvedValueOnce(0);
    const r = await servico.criarEvento(claims, eventoDto({ assigned_to: OUTRO, reminder_minutes: 10 }));
    expect(r.lembrete_criado).toBe(false);
    expect(r.evento.id).toBe(ID);
    expect(texto(tx.$executeRaw, 2)).toBe('rollback to savepoint lembrete');
  });

  it('R10 outro SQLSTATE no lembrete sobe', async () => {
    const { tx, google, servico } = montar();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ linha: { id: ID, assigned_to: USER, start_at: 'x' } }]);
    tx.$executeRaw.mockResolvedValueOnce(0).mockRejectedValueOnce(erroBanco('22P02', 'ERROR: invalid input syntax'));
    expect((await erroDe(servico.criarEvento(claims, eventoDto({ reminder_minutes: 10 })))).body.codigo).toBe('dados_invalidos');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(google.pushEventoEmSegundoPlano).not.toHaveBeenCalled();
  });

  it('R11 tarefa com source informado e sem lembrete', async () => {
    const { tx, google, servico } = montar();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: ID } }]);
    await servico.criarTarefa(claims, dto(CriarTarefaDto, {
      title: 'T', activity_type: 'outro', priority: 'low', assigned_to: USER, visibility: 'private', due_at: null, source: 'inbox',
    }));
    expect(texto(tx.$queryRaw, 1)).toContain('insert into public.routine_tasks as t (title, activity_type, priority, assigned_to, visibility, due_at, organization_id, created_by, timezone, source)');
    expect(JSON.parse(sql(tx.$queryRaw, 1).values[0] as string)).toMatchObject({ due_at: null, source: 'inbox', organization_id: ORG });
    expect(google.pushEventoEmSegundoPlano).not.toHaveBeenCalled();
  });
});

describe('RotinaService: R12–R15', () => {
  it('patch vazio → 400 nada_para_atualizar sem tocar no banco', async () => {
    const { db, servico } = montar();
    const { status, body } = await erroDe(servico.editarEvento(claims, ID, dto(EditarEventoDto, { expected_updated_at: TOKEN })));
    expect(status).toBe(400);
    expect(body.codigo).toBe('nada_para_atualizar');
    expect(db.run).not.toHaveBeenCalled();
  });

  it('R12: lê o responsável anterior com for update, só colunas permitidas, token como timestamptz', async () => {
    const { tx, google, servico } = montar();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([{ assigned_to: USER }]).mockResolvedValueOnce([{ linha: { id: ID, assigned_to: OUTRO } }]);
    const corpo = dto(EditarEventoDto, { title: 'Novo', assigned_to: OUTRO, expected_updated_at: TOKEN });
    (corpo as unknown as Record<string, unknown>).sync_status = 'synced';
    await servico.editarEvento(claims, ID, corpo);
    expect(texto(tx.$queryRaw, 1)).toBe(
      'select assigned_to::text as assigned_to from public.routine_events where id = $1::uuid and organization_id = $2::uuid for update',
    );
    const t = texto(tx.$queryRaw, 2);
    expect(t).toBe(
      'update public.routine_events t set (title, assigned_to) = (select r.title, r.assigned_to from jsonb_populate_record(null::public.routine_events, $1::jsonb) r) where t.id = $2::uuid and t.organization_id = $3::uuid and t.deleted_at is null and ($4::timestamptz is null or t.updated_at = $5::timestamptz) returning to_jsonb(t) as linha',
    );
    expect(t).not.toContain('sync_status');
    expect(sql(tx.$queryRaw, 2).values).toEqual([JSON.stringify({ title: 'Novo', assigned_to: OUTRO }), ID, ORG, TOKEN, TOKEN]);
    expect(google.pushEventoEmSegundoPlano).toHaveBeenCalledWith(ID, OUTRO, USER);
    confereCasts(tx.$queryRaw);
  });

  it('R12 sem linha: com token → 409 CONCURRENCY_CONFLICT; sem token → 404', async () => {
    const { tx, servico } = montar();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([{ assigned_to: USER }]).mockResolvedValueOnce([]);
    const a = await erroDe(servico.editarEvento(claims, ID, dto(EditarEventoDto, { title: 'x', expected_updated_at: TOKEN })));
    expect(a.status).toBe(409);
    expect(a.body).toEqual({ statusCode: 409, codigo: 'CONCURRENCY_CONFLICT', message: 'Esse compromisso mudou em outro lugar. Recarregue e tente de novo.' });
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const b = await erroDe(servico.editarEvento(claims, ID, dto(EditarEventoDto, { title: 'x' })));
    expect(b.status).toBe(404);
    expect(b.body.codigo).toBe('nao_encontrado');
  });

  it('R13 tarefa: sem for update e sem push', async () => {
    const { tx, google, servico } = montar();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: ID } }]);
    await servico.editarTarefa(claims, ID, dto(EditarTarefaDto, { due_at: null }));
    expect(texto(tx.$queryRaw, 1)).toContain('update public.routine_tasks t set (due_at) = (select r.due_at from jsonb_populate_record(null::public.routine_tasks, $1::jsonb) r)');
    expect(google.pushEventoEmSegundoPlano).not.toHaveBeenCalled();
  });

  it('R14: conclui e chama a RPC em outro run quando há cliente', async () => {
    const { tx, db, google, servico } = montar();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: ID, client_id: CLIENTE, assigned_to: USER } }]).mockResolvedValueOnce([{ ok: true }]);
    expect(await servico.concluir(claims, 'evento', ID)).toEqual({ item: { id: ID, client_id: CLIENTE, assigned_to: USER }, registrado_no_crm: true });
    expect(db.run).toHaveBeenCalledTimes(2);
    expect(texto(tx.$queryRaw, 1)).toBe(
      "update public.routine_events t set status = 'completed', completed_at = now() where t.id = $1::uuid and t.organization_id = $2::uuid and t.deleted_at is null returning to_jsonb(t) as linha",
    );
    expect(texto(tx.$queryRaw, 2)).toBe('select public.routine_register_completion($1::text, $2::uuid) as ok');
    expect(sql(tx.$queryRaw, 2).values).toEqual(['event', ID]);
    expect(google.pushEventoEmSegundoPlano).toHaveBeenCalledWith(ID, USER, undefined);
  });

  it('R14: falha da RPC vira registrado_no_crm false; sem cliente não chama; sem linha 404', async () => {
    const { tx, db, servico } = montar();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: ID, client_id: CLIENTE } }])
      .mockRejectedValueOnce(erroBanco('22023', 'ERROR: routine_item_type_invalid'));
    expect((await servico.concluir(claims, 'tarefa', ID)).registrado_no_crm).toBe(false);
    expect(sql(tx.$queryRaw, 2).values).toEqual(['task', ID]);

    db.run.mockClear();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: ID, client_id: null } }]);
    expect((await servico.concluir(claims, 'tarefa', ID)).registrado_no_crm).toBe(false);
    expect(db.run).toHaveBeenCalledTimes(1);

    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect((await erroDe(servico.concluir(claims, 'evento', ID))).status).toBe(404);
  });

  it('R15 remove com deleted_at; sem linha 404', async () => {
    const { tx, google, servico } = montar();
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([{ id: ID, assigned_to: USER }]);
    expect(await servico.remover(claims, 'evento', ID)).toEqual({ removido: true });
    expect(texto(tx.$queryRaw, 1)).toBe(
      'update public.routine_events t set deleted_at = now() where t.id = $1::uuid and t.organization_id = $2::uuid and t.deleted_at is null returning id, assigned_to::text as assigned_to',
    );
    expect(google.pushEventoEmSegundoPlano).toHaveBeenCalledWith(ID, USER, undefined);
    comContexto(tx);
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect((await erroDe(servico.remover(claims, 'tarefa', ID))).body.codigo).toBe('nao_encontrado');
  });
});

describe('traduzirErroBanco (contrato §0.4)', () => {
  const casos: Array<[string, string, Record<string, unknown>]> = [
    ['42501', 'ERROR: routine_client_outside_organization', { status: 422, codigo: 'cliente_fora_da_organizacao', message: 'Este cliente não pertence à sua organização.' }],
    ['42501', 'ERROR: routine_property_outside_organization', { status: 422, codigo: 'imovel_fora_da_organizacao', message: 'Este imóvel não pertence à sua organização.' }],
    ['42501', 'ERROR: routine_deal_outside_organization', { status: 422, codigo: 'vinculo_fora_da_organizacao', message: 'Um registro vinculado não pertence à sua organização.' }],
    ['42501', 'ERROR: routine_item_forbidden', { status: 403, codigo: 'sem_permissao', message: 'Você não tem permissão para alterar esta atividade.' }],
    ['42501', 'ERROR: acesso negado', { status: 403, codigo: 'sem_permissao', message: 'Você não tem acesso à agenda desta pessoa.' }],
    ['42501', 'ERROR: new row violates row-level security policy', { status: 403, codigo: 'sem_permissao', message: 'Você não tem permissão para fazer esta alteração.' }],
    ['23514', 'ERROR: new row for relation "routine_events" violates check constraint "routine_events_check"', { status: 400, codigo: 'intervalo_invalido', message: 'O horário de término precisa ser depois do início.' }],
    ['23503', 'ERROR: insert or update violates foreign key constraint', { status: 422, codigo: 'referencia_invalida', message: 'Um registro relacionado não existe mais. Recarregue a página e tente de novo.' }],
    ['22P02', 'ERROR: invalid input syntax for type uuid', { status: 400, codigo: 'dados_invalidos' }],
    ['22007', 'ERROR: invalid datetime', { status: 400, codigo: 'dados_invalidos' }],
    ['22008', 'ERROR: out of range', { status: 400, codigo: 'dados_invalidos' }],
    ['22003', 'ERROR: out of range', { status: 400, codigo: 'dados_invalidos' }],
    ['22001', 'ERROR: too long', { status: 400, codigo: 'dados_invalidos' }],
    ['23502', 'ERROR: null value', { status: 400, codigo: 'dados_invalidos' }],
    ['23514', 'ERROR: violates check constraint "routine_events_priority_check"', { status: 400, codigo: 'dados_invalidos' }],
    ['22023', 'ERROR: solicitação inválida', { status: 400, codigo: 'dados_invalidos' }],
  ];
  it.each(casos)('%s %s', (code, msg, esperado) => {
    expect(traduzido(erroBanco(code, msg))).toMatchObject(esperado);
  });

  it('22023 por origem: conflitos → intervalo_invalido; conclusao → tipo_invalido (por opção ou marca)', () => {
    expect(traduzido(erroBanco('22023', 'ERROR: x'), { origem: 'conflitos' })).toMatchObject({ status: 400, codigo: 'intervalo_invalido' });
    expect(traduzido(erroBanco('22023', 'ERROR: x'), { origem: 'conclusao' })).toMatchObject({ status: 400, codigo: 'tipo_invalido', message: 'Tipo de atividade inválido.' });
    expect(traduzido(comOrigem(erroBanco('22023', 'ERROR: x'), 'conclusao'))).toMatchObject({ codigo: 'tipo_invalido' });
  });

  it('outro SQLSTATE ou erro que não é do banco sobe como veio', () => {
    const e = erroBanco('40001', 'ERROR: serialization');
    expect(traduzido(e)).toBe(e);
    const rede = new Error('rede');
    expect(traduzido(rede)).toBe(rede);
  });
});
