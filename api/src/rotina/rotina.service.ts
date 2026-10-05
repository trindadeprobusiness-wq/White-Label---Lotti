import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { RotinaGoogleService } from './google/rotina-google.service';
import { buscarContexto, ContextoRotina, exigirContexto, Linha, Tx } from './rotina.contexto';
import {
  COLUNAS_EDICAO_EVENTO, COLUNAS_EDICAO_TAREFA, COLUNAS_NOVA_TAREFA, COLUNAS_NOVO_EVENTO, ConflitosDto, CriarEventoDto,
  CriarInboxDto, CriarTarefaDto, EditarEventoDto, EditarTarefaDto, LIMITE_ATIVIDADE, LIMITE_LISTA, ListarEventosDto,
  ListarTarefasDto,
} from './rotina.dto';
import { comOrigem, erroPg, ERROS, OpcoesErro, traduzirErroBanco } from './rotina.erros';

export type { Linha } from './rotina.contexto';
export type TipoItem = 'evento' | 'tarefa';

const TABELA: Record<TipoItem, Prisma.Sql> = {
  evento: Prisma.raw('public.routine_events'),
  tarefa: Prisma.raw('public.routine_tasks'),
};
const TIPO_RPC: Record<TipoItem, 'event' | 'task'> = { evento: 'event', tarefa: 'task' };
/** Recusas do banco que, no PostgREST de hoje, só deixavam o lembrete sem criar. */
const RECUSAS_LEMBRETE = new Set(['42501', '23514', '23503']);

function presentes<T extends string>(dados: object, permitidas: readonly T[]): T[] {
  return permitidas.filter((c) => (dados as Record<string, unknown>)[c] !== undefined);
}

function jsonDe(dados: object, cols: readonly string[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...Object.fromEntries(cols.map((c) => [c, (dados as Record<string, unknown>)[c]])), ...extra });
}

const lista = (cols: readonly string[], prefixo = '') => Prisma.raw(cols.map((c) => `${prefixo}${c}`).join(', '));

@Injectable()
export class RotinaService {
  private readonly logger = new Logger('Rotina');

  constructor(private readonly db: TenantDb, private readonly google: RotinaGoogleService) {}

  // ------------------------------------------------------------ leituras

  /** R1: sem rotina devolve null (não é 403). */
  async contexto(claims: SupabaseClaims): Promise<ContextoRotina | null> {
    try {
      return await this.db.run(claims, (tx) => buscarContexto(tx, claims.sub));
    } catch (e) {
      if (erroPg(e)?.sqlstate === '42P01') return null;
      traduzirErroBanco(e);
    }
  }

  listarMembros(claims: SupabaseClaims): Promise<Linha[]> {
    return this.listar(claims, (org) => Prisma.sql`
      select to_jsonb(m) as linha from public.routine_memberships m
      where m.organization_id = ${org}::uuid and m.status = 'active'
      order by m.display_name asc nulls last limit ${LIMITE_LISTA}::int`);
  }

  listarEventos(claims: SupabaseClaims, q: ListarEventosDto): Promise<Linha[]> {
    const resp = q.responsavel ?? null;
    return this.listar(claims, (org) => Prisma.sql`
      select to_jsonb(e) as linha from public.routine_events e
      where e.organization_id = ${org}::uuid and e.deleted_at is null
        and (${resp}::uuid is null or e.assigned_to = ${resp}::uuid)
        and e.start_at <= ${q.fim}::timestamptz
        and (e.end_at >= ${q.inicio}::timestamptz or e.recurrence_rule is not null)
      order by e.start_at asc limit ${LIMITE_LISTA}::int`);
  }

  listarTarefas(claims: SupabaseClaims, q: ListarTarefasDto): Promise<Linha[]> {
    const resp = q.responsavel ?? null;
    return this.listar(claims, (org) => Prisma.sql`
      select to_jsonb(t) as linha from public.routine_tasks t
      where t.organization_id = ${org}::uuid and t.deleted_at is null
        and (${resp}::uuid is null or t.assigned_to = ${resp}::uuid)
      order by t.due_at asc nulls last limit ${LIMITE_LISTA}::int`);
  }

  listarAtividade(claims: SupabaseClaims): Promise<Linha[]> {
    return this.listar(claims, (org) => Prisma.sql`
      select to_jsonb(a) as linha from public.routine_activity_log a
      where a.organization_id = ${org}::uuid
      order by a.created_at desc limit ${LIMITE_ATIVIDADE}::int`);
  }

  listarInbox(claims: SupabaseClaims): Promise<Linha[]> {
    return this.listar(claims, (org) => Prisma.sql`
      select to_jsonb(i) as linha from public.routine_inbox i
      where i.organization_id = ${org}::uuid and i.user_id = ${claims.sub}::uuid and i.status = 'unprocessed'
      order by i.created_at desc limit ${LIMITE_LISTA}::int`);
  }

  // ------------------------------------------------------------ inbox

  criarInbox(claims: SupabaseClaims, dto: CriarInboxDto): Promise<Linha> {
    return this.rodar(claims, async (tx, ctx) => {
      const r = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        insert into public.routine_inbox (organization_id, user_id, kind, content)
        values (${ctx.membership.organization_id}::uuid, ${claims.sub}::uuid, ${dto.kind ?? 'note'}::text, ${dto.content}::text)
        returning to_jsonb(routine_inbox.*) as linha`);
      return r[0].linha;
    });
  }

  arquivarInbox(claims: SupabaseClaims, id: string): Promise<{ arquivado: true }> {
    return this.rodar(claims, async (tx) => {
      const r = await tx.$queryRaw<unknown[]>(Prisma.sql`
        update public.routine_inbox set status = 'archived'
        where id = ${id}::uuid and user_id = ${claims.sub}::uuid returning id`);
      if (r.length === 0) throw ERROS.naoEncontrado('Anotação não encontrada.');
      return { arquivado: true as const };
    });
  }

  // ------------------------------------------------------------ conflitos e criação

  async detectarConflitos(claims: SupabaseClaims, dto: ConflitosDto): Promise<Linha[]> {
    return this.rodar(claims, (tx) => this.conflitos(tx, dto.assigned_to, dto.start_at, dto.end_at, dto.exclude_event_id ?? null),
      { origem: 'conflitos' });
  }

  private async conflitos(tx: Tx, assigned: string, inicio: string, fim: string, excluir: string | null): Promise<Linha[]> {
    try {
      const r = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        select to_jsonb(c) as linha
        from public.routine_detect_conflicts(${assigned}::uuid, ${inicio}::timestamptz, ${fim}::timestamptz, ${excluir}::uuid) c`);
      return r.map((l) => l.linha);
    } catch (e) {
      throw comOrigem(e, 'conflitos');
    }
  }

  async criarEvento(claims: SupabaseClaims, dto: CriarEventoDto): Promise<{ evento: Linha; lembrete_criado: boolean }> {
    const resultado = await this.rodar(claims, async (tx, ctx) => {
      const org = ctx.membership.organization_id;
      const conflicts = await this.conflitos(tx, dto.assigned_to, dto.start_at, dto.end_at, null);
      if (conflicts.length > 0) throw ERROS.conflito(conflicts);

      const cols = presentes(dto, COLUNAS_NOVO_EVENTO).filter((c) => c !== 'source');
      const fixas = ['organization_id', 'created_by', 'timezone', 'source', 'sync_status'];
      const json = jsonDe(dto, cols, {
        organization_id: org,
        created_by: claims.sub,
        timezone: ctx.organization.timezone,
        source: dto.source ?? 'lotti',
        sync_status: 'pending',
      });
      const todas = [...cols, ...fixas];
      const r = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        insert into public.routine_events as e (${lista(todas)})
        select ${lista(todas, 'r.')} from jsonb_populate_record(null::public.routine_events, ${json}::jsonb) r
        returning to_jsonb(e) as linha`);
      const evento = r[0].linha;

      let lembreteCriado = false;
      if (dto.reminder_minutes !== null && dto.reminder_minutes !== undefined) {
        // Savepoint: a recusa da policy/constraints não deixa a transação abortada (contrato §1.3, R10 passo 3).
        await tx.$executeRaw(Prisma.sql`savepoint lembrete`);
        try {
          await tx.$executeRaw(Prisma.sql`
            insert into public.routine_reminders (organization_id, user_id, event_id, remind_at, minutes_before)
            values (${org}::uuid, ${dto.assigned_to}::uuid, ${String(evento.id)}::uuid,
              ${String(evento.start_at)}::timestamptz - make_interval(mins => ${dto.reminder_minutes}::int), ${dto.reminder_minutes}::int)`);
          await tx.$executeRaw(Prisma.sql`release savepoint lembrete`);
          lembreteCriado = true;
        } catch (e) {
          const pg = erroPg(e);
          if (!pg || !RECUSAS_LEMBRETE.has(pg.sqlstate)) throw e;
          await tx.$executeRaw(Prisma.sql`rollback to savepoint lembrete`);
          this.logger.warn(`lembrete não criado (${pg.sqlstate}) para o evento ${String(evento.id)}`);
        }
      }
      return { evento, lembrete_criado: lembreteCriado };
    });
    this.pushDepois(String(resultado.evento.id), String(resultado.evento.assigned_to));
    return resultado;
  }

  criarTarefa(claims: SupabaseClaims, dto: CriarTarefaDto): Promise<Linha> {
    return this.rodar(claims, async (tx, ctx) => {
      const cols = presentes(dto, COLUNAS_NOVA_TAREFA).filter((c) => c !== 'source');
      const fixas = ['organization_id', 'created_by', 'timezone', 'source'];
      const json = jsonDe(dto, cols, {
        organization_id: ctx.membership.organization_id,
        created_by: claims.sub,
        timezone: ctx.organization.timezone,
        source: dto.source ?? 'lotti',
      });
      const todas = [...cols, ...fixas];
      const r = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        insert into public.routine_tasks as t (${lista(todas)})
        select ${lista(todas, 'r.')} from jsonb_populate_record(null::public.routine_tasks, ${json}::jsonb) r
        returning to_jsonb(t) as linha`);
      return r[0].linha;
    });
  }

  // ------------------------------------------------------------ edição, conclusão e remoção

  editarEvento(claims: SupabaseClaims, id: string, dto: EditarEventoDto): Promise<Linha> {
    return this.editar(claims, 'evento', id, dto, COLUNAS_EDICAO_EVENTO);
  }

  editarTarefa(claims: SupabaseClaims, id: string, dto: EditarTarefaDto): Promise<Linha> {
    return this.editar(claims, 'tarefa', id, dto, COLUNAS_EDICAO_TAREFA);
  }

  private async editar(
    claims: SupabaseClaims, tipo: TipoItem, id: string, dto: EditarEventoDto | EditarTarefaDto, permitidas: readonly string[],
  ): Promise<Linha> {
    const cols = presentes(dto, permitidas);
    if (cols.length === 0) throw ERROS.nadaParaAtualizar();
    const esperado = dto.expected_updated_at ?? null;
    const json = jsonDe(dto, cols);
    const { linha, anterior } = await this.rodar(claims, async (tx, ctx) => {
      const org = ctx.membership.organization_id;
      let anterior: string | null = null;
      if (tipo === 'evento') {
        const a = await tx.$queryRaw<Array<{ assigned_to: string }>>(Prisma.sql`
          select assigned_to::text as assigned_to from public.routine_events
          where id = ${id}::uuid and organization_id = ${org}::uuid for update`);
        anterior = a[0]?.assigned_to ?? null;
      }
      const r = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        update ${TABELA[tipo]} t set (${lista(cols)}) = (select ${lista(cols, 'r.')}
          from jsonb_populate_record(null::${TABELA[tipo]}, ${json}::jsonb) r)
        where t.id = ${id}::uuid and t.organization_id = ${org}::uuid and t.deleted_at is null
          and (${esperado}::timestamptz is null or t.updated_at = ${esperado}::timestamptz)
        returning to_jsonb(t) as linha`);
      if (r.length === 0) throw esperado ? ERROS.concorrencia() : ERROS.naoEncontrado();
      return { linha: r[0].linha, anterior };
    });
    if (tipo === 'evento') {
      const atual = String(linha.assigned_to);
      this.pushDepois(id, atual, anterior && anterior !== atual ? anterior : undefined);
    }
    return linha;
  }

  async concluir(claims: SupabaseClaims, tipo: TipoItem, id: string): Promise<{ item: Linha; registrado_no_crm: boolean }> {
    const item = await this.rodar(claims, async (tx, ctx) => {
      const r = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        update ${TABELA[tipo]} t set status = 'completed', completed_at = now()
        where t.id = ${id}::uuid and t.organization_id = ${ctx.membership.organization_id}::uuid and t.deleted_at is null
        returning to_jsonb(t) as linha`);
      if (r.length === 0) throw ERROS.naoEncontrado();
      return r[0].linha;
    });
    let registrado = false;
    if (item.client_id !== null && item.client_id !== undefined) {
      // Melhor esforço, em outro run depois do commit: a conclusão não volta se o CRM falhar.
      try {
        registrado = await this.db.run(claims, async (tx) => {
          try {
            const r = await tx.$queryRaw<Array<{ ok: boolean | null }>>(Prisma.sql`
              select public.routine_register_completion(${TIPO_RPC[tipo]}::text, ${id}::uuid) as ok`);
            return r[0]?.ok === true;
          } catch (e) {
            throw comOrigem(e, 'conclusao');
          }
        });
      } catch (e) {
        registrado = false;
        let codigo = erroPg(e)?.sqlstate ?? 'erro';
        try {
          traduzirErroBanco(e);
        } catch (t) {
          const corpo = (t as { getResponse?: () => unknown }).getResponse?.() as { codigo?: string } | undefined;
          if (corpo?.codigo) codigo = `${codigo} ${corpo.codigo}`;
        }
        this.logger.warn(`registro no CRM falhou (${tipo} ${id}): ${codigo}`);
      }
    }
    if (tipo === 'evento') this.pushDepois(id, String(item.assigned_to));
    return { item, registrado_no_crm: registrado };
  }

  async remover(claims: SupabaseClaims, tipo: TipoItem, id: string): Promise<{ removido: true }> {
    const assigned = await this.rodar(claims, async (tx, ctx) => {
      const r = await tx.$queryRaw<Array<{ id: string; assigned_to: string }>>(Prisma.sql`
        update ${TABELA[tipo]} t set deleted_at = now()
        where t.id = ${id}::uuid and t.organization_id = ${ctx.membership.organization_id}::uuid and t.deleted_at is null
        returning id, assigned_to::text as assigned_to`);
      if (r.length === 0) throw ERROS.naoEncontrado();
      return r[0].assigned_to;
    });
    if (tipo === 'evento') this.pushDepois(id, assigned);
    return { removido: true };
  }

  // ------------------------------------------------------------ apoio

  /** Push depois do commit, sem await; erro só em log. */
  private pushDepois(eventId: string, assignedTo: string, anterior?: string): void {
    const log = (e: unknown) => this.logger.warn(`push em segundo plano falhou: ${(e as Error)?.message ?? 'erro'}`);
    try {
      void Promise.resolve(this.google.pushEventoEmSegundoPlano(eventId, assignedTo, anterior)).catch(log);
    } catch (e) {
      log(e);
    }
  }

  /** Erro do banco é traduzido fora do run: dentro dele a transação já está abortada. */
  private async rodar<T>(
    claims: SupabaseClaims, work: (tx: Tx, ctx: ContextoRotina) => Promise<T>, opcoes?: OpcoesErro,
  ): Promise<T> {
    try {
      return await this.db.run(claims, async (tx) => work(tx, await exigirContexto(tx, claims.sub)));
    } catch (e) {
      traduzirErroBanco(e, opcoes);
    }
  }

  private async listar(claims: SupabaseClaims, consulta: (org: string) => Prisma.Sql): Promise<Linha[]> {
    return this.rodar(claims, async (tx, ctx) => {
      const r = await tx.$queryRaw<Array<{ linha: Linha }>>(consulta(ctx.membership.organization_id));
      return r.map((l) => l.linha);
    });
  }
}
