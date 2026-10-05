import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LIMITE_LISTA } from '../rotina.dto';
import { erroPg } from '../rotina.erros';

/**
 * Todo SQL do caminho do servidor (contrato §0.2.2): tabelas calendar_* sem grant para authenticated,
 * acessadas como dona da conexão, fora do TenantDb. Requisição de usuário filtra por organization_id e
 * user_id da membership; callback, webhook e job localizam a linha por segredo ou por id do próprio banco.
 */
export type Linha = Record<string, unknown>;

export interface Conexao extends Linha {
  id: string;
  organization_id: string;
  user_id: string;
  status: string;
  privacy_mode: 'full' | 'partial' | 'busy_only';
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
}

export interface Calendario extends Linha {
  id: string;
  connection_id: string;
  organization_id: string;
  user_id: string;
  external_calendar_id: string;
  summary: string;
  selected: boolean;
  is_primary: boolean;
  is_default: boolean;
  sync_direction: 'import_only' | 'export_only' | 'bidirectional' | 'disabled';
}

export interface Mapeamento extends Linha {
  id: string;
  connection_id: string;
  external_calendar_id: string;
  routine_event_id: string | null;
  google_event_id: string;
  google_etag: string | null;
  last_synced_at: string | null;
  sync_version: number;
}

// Colunas que o caminho do servidor pode escrever (Prisma.raw só a partir destas constantes).
const COLUNAS_CONEXAO = [
  'provider_account_id', 'provider_email', 'scopes', 'status', 'access_token_ciphertext', 'refresh_token_ciphertext',
  'token_expires_at', 'oauth_state_hash', 'pkce_verifier_ciphertext', 'oauth_expires_at', 'last_error_code', 'disconnected_at',
  'privacy_mode', 'last_sync_at',
] as const;
const COLUNAS_EVENTO = [
  'title', 'description', 'location', 'activity_type', 'start_at', 'end_at', 'all_day', 'timezone', 'recurrence_rule',
  'status', 'visibility', 'source', 'sync_status', 'deleted_at',
] as const;
const COLUNAS_NOVO_EVENTO = [...COLUNAS_EVENTO, 'organization_id', 'assigned_to', 'created_by', 'priority'] as const;
const COLUNAS_MAPEAMENTO = ['google_etag', 'google_updated_at', 'sync_version', 'last_synced_at', 'deleted_at'] as const;
const COLUNAS_NOVO_MAPEAMENTO = [
  'organization_id', 'connection_id', 'external_calendar_id', 'routine_event_id', 'google_event_id', 'google_etag',
  'google_updated_at', 'sync_version', 'origin', 'last_synced_at', 'deleted_at',
] as const;
const COLUNAS_SYNC_STATE = [
  'sync_token_ciphertext', 'full_sync_started_at', 'last_incremental_sync_at', 'last_success_at', 'last_error_code',
  'retry_count', 'next_retry_at',
] as const;

type Campos = Record<string, unknown>;

function colunas(campos: Campos, permitidas: readonly string[]): string[] {
  const cols = Object.keys(campos).filter((c) => campos[c] !== undefined);
  const fora = cols.find((c) => !permitidas.includes(c));
  if (fora) throw new Error(`coluna_nao_permitida_${fora}`);
  if (cols.length === 0) throw new Error('nada_para_gravar');
  return cols;
}

/** `(a, b) = (select r.a, r.b from jsonb_populate_record(null::tabela, json) r)`: o banco converte cada valor. */
function atribuicao(tabela: string, campos: Campos, permitidas: readonly string[]): Prisma.Sql {
  const cols = colunas(campos, permitidas);
  const json = JSON.stringify(Object.fromEntries(cols.map((c) => [c, campos[c]])));
  return Prisma.sql`(${Prisma.raw(cols.join(', '))}) = (select ${Prisma.raw(cols.map((c) => `r.${c}`).join(', '))}
    from jsonb_populate_record(null::public.${Prisma.raw(tabela)}, ${json}::jsonb) r)`;
}

function insercao(tabela: string, campos: Campos, permitidas: readonly string[]): Prisma.Sql {
  const cols = colunas(campos, permitidas);
  const json = JSON.stringify(Object.fromEntries(cols.map((c) => [c, campos[c]])));
  return Prisma.sql`(${Prisma.raw(cols.join(', '))}) select ${Prisma.raw(cols.map((c) => `r.${c}`).join(', '))}
    from jsonb_populate_record(null::public.${Prisma.raw(tabela)}, ${json}::jsonb) r`;
}

@Injectable()
export class RotinaGoogleRepo {
  constructor(private readonly prisma: PrismaService) {}

  private async linhas<T>(consulta: Prisma.Sql): Promise<T[]> {
    const r = await this.prisma.$queryRaw<Array<{ linha: T }>>(consulta);
    return r.map((l) => l.linha);
  }

  private async uma<T>(consulta: Prisma.Sql): Promise<T | null> {
    return (await this.linhas<T>(consulta))[0] ?? null;
  }

  // ------------------------------------------------------------ conexões

  conexaoDoUsuario(org: string, uid: string): Promise<Conexao | null> {
    return this.uma<Conexao>(Prisma.sql`
      select to_jsonb(c) as linha from public.calendar_connections c
      where c.organization_id = ${org}::uuid and c.user_id = ${uid}::uuid and c.provider = 'google'
      limit 1`);
  }

  conexaoConectada(org: string, uid: string): Promise<Conexao | null> {
    return this.uma<Conexao>(Prisma.sql`
      select to_jsonb(c) as linha from public.calendar_connections c
      where c.organization_id = ${org}::uuid and c.user_id = ${uid}::uuid and c.provider = 'google' and c.status = 'connected'
      limit 1`);
  }

  conexoesConectadas(): Promise<Conexao[]> {
    return this.linhas<Conexao>(Prisma.sql`
      select to_jsonb(c) as linha from public.calendar_connections c where c.status = 'connected' order by c.id limit ${LIMITE_LISTA}::int`);
  }

  async statusConexao(org: string, uid: string): Promise<Linha | null> {
    return this.uma<Linha>(Prisma.sql`
      select jsonb_build_object('status', c.status, 'provider_email', c.provider_email, 'privacy_mode', c.privacy_mode,
        'last_sync_at', c.last_sync_at, 'last_error_code', c.last_error_code) as linha
      from public.calendar_connections c
      where c.organization_id = ${org}::uuid and c.user_id = ${uid}::uuid and c.provider = 'google'
      limit 1`);
  }

  /** Start do OAuth: conexão `connected` continua `connected` (contrato §6.2). */
  async prepararStart(org: string, uid: string, stateHash: string, verifierCifrado: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      insert into public.calendar_connections
        (organization_id, user_id, provider, status, oauth_state_hash, pkce_verifier_ciphertext, oauth_expires_at, last_error_code)
      values (${org}::uuid, ${uid}::uuid, 'google', 'pending', ${stateHash}::text, ${verifierCifrado}::text, now() + interval '10 minutes', null)
      on conflict (organization_id, user_id, provider) do update set
        oauth_state_hash = excluded.oauth_state_hash,
        pkce_verifier_ciphertext = excluded.pkce_verifier_ciphertext,
        oauth_expires_at = excluded.oauth_expires_at,
        last_error_code = null,
        status = case when calendar_connections.status = 'connected' then 'connected' else 'pending' end,
        updated_at = now()`);
  }

  conexaoPorState(stateHash: string): Promise<Conexao | null> {
    return this.uma<Conexao>(Prisma.sql`
      select to_jsonb(c) as linha from public.calendar_connections c
      where c.oauth_state_hash = ${stateHash}::text and c.status in ('pending', 'connected') and c.oauth_expires_at > now()
      limit 1`);
  }

  async atualizarConexao(id: string, campos: Campos): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      update public.calendar_connections set ${atribuicao('calendar_connections', campos, COLUNAS_CONEXAO)}, updated_at = now()
      where id = ${id}::uuid`);
  }

  /** Falha do callback numa conexão que já estava conectada: só descarta o state (contrato §2.2). */
  async limparStateConexao(id: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      update public.calendar_connections
      set oauth_state_hash = null, pkce_verifier_ciphertext = null, oauth_expires_at = null, updated_at = now()
      where id = ${id}::uuid`);
  }

  async marcarErroCallback(id: string, codigo: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      update public.calendar_connections
      set status = 'error', last_error_code = ${codigo}::text, oauth_state_hash = null, pkce_verifier_ciphertext = null,
          oauth_expires_at = null, updated_at = now()
      where id = ${id}::uuid`);
  }

  async configurarPrivacidade(id: string, org: string, uid: string, modo: string): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      update public.calendar_connections set privacy_mode = ${modo}::text, updated_at = now()
      where id = ${id}::uuid and organization_id = ${org}::uuid and user_id = ${uid}::uuid`);
  }

  async gravarErroConexao(id: string, codigo: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      update public.calendar_connections set last_error_code = ${codigo}::text, updated_at = now() where id = ${id}::uuid`);
  }

  async marcarSincronizada(id: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      update public.calendar_connections set status = 'connected', last_sync_at = now(), last_error_code = null, updated_at = now()
      where id = ${id}::uuid`);
  }

  async apagarConexao(id: string, org: string, uid: string): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      delete from public.calendar_connections
      where id = ${id}::uuid and organization_id = ${org}::uuid and user_id = ${uid}::uuid`);
  }

  canaisDaConexao(connId: string): Promise<Array<{ channel_id: string; resource_id: string }>> {
    return this.linhas(Prisma.sql`
      select jsonb_build_object('channel_id', w.channel_id, 'resource_id', w.resource_id) as linha
      from public.calendar_watch_channels w
      join public.external_calendars ec on ec.id = w.external_calendar_id
      where ec.connection_id = ${connId}::uuid`);
  }

  // ------------------------------------------------------------ calendários

  async upsertCalendario(conexao: Conexao, cal: {
    external_calendar_id: string; summary: string; color: string | null; access_role: string | null;
    primary: boolean; sync_direction: string;
  }): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      insert into public.external_calendars
        (connection_id, organization_id, user_id, external_calendar_id, summary, color, access_role, selected, is_primary, is_default, sync_direction)
      values (${conexao.id}::uuid, ${conexao.organization_id}::uuid, ${conexao.user_id}::uuid, ${cal.external_calendar_id}::text,
        ${cal.summary}::text, ${cal.color}::text, ${cal.access_role}::text, ${cal.primary}::boolean, ${cal.primary}::boolean,
        ${cal.primary}::boolean, ${cal.sync_direction}::text)
      on conflict (connection_id, external_calendar_id) do update set
        summary = excluded.summary, color = excluded.color, access_role = excluded.access_role,
        is_primary = excluded.is_primary, sync_direction = excluded.sync_direction, updated_at = now()`);
  }

  calendariosAtivos(connId: string): Promise<Calendario[]> {
    return this.linhas<Calendario>(Prisma.sql`
      select to_jsonb(ec) as linha from public.external_calendars ec
      where ec.connection_id = ${connId}::uuid and ec.selected = true and ec.sync_direction <> 'disabled'
      order by ec.is_primary desc, ec.created_at, ec.id`);
  }

  calendarioDaConexao(id: string, connId: string): Promise<Calendario | null> {
    return this.uma<Calendario>(Prisma.sql`
      select to_jsonb(ec) as linha from public.external_calendars ec
      where ec.id = ${id}::uuid and ec.connection_id = ${connId}::uuid`);
  }

  async calendarioComConexaoConectada(id: string): Promise<{ calendario: Calendario; conexao: Conexao } | null> {
    const r = await this.prisma.$queryRaw<Array<{ calendario: Calendario; conexao: Conexao }>>(Prisma.sql`
      select to_jsonb(ec) as calendario, to_jsonb(c) as conexao
      from public.external_calendars ec
      join public.calendar_connections c on c.id = ec.connection_id
      where ec.id = ${id}::uuid and c.status = 'connected'`);
    return r[0] ?? null;
  }

  // ------------------------------------------------------------ estado de sincronização

  syncState(calId: string): Promise<Linha | null> {
    return this.uma<Linha>(Prisma.sql`
      select to_jsonb(s) as linha from public.calendar_sync_states s where s.external_calendar_id = ${calId}::uuid`);
  }

  criarSyncState(calId: string): Promise<Linha | null> {
    return this.uma<Linha>(Prisma.sql`
      insert into public.calendar_sync_states as s (external_calendar_id, full_sync_started_at)
      values (${calId}::uuid, now()) returning to_jsonb(s) as linha`);
  }

  async atualizarSyncState(calId: string, campos: Campos): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      update public.calendar_sync_states set ${atribuicao('calendar_sync_states', campos, COLUNAS_SYNC_STATE)}, updated_at = now()
      where external_calendar_id = ${calId}::uuid`);
  }

  // ------------------------------------------------------------ eventos e mapeamentos

  mapeamentoPorGoogleId(calId: string, googleEventId: string): Promise<Mapeamento | null> {
    return this.uma<Mapeamento>(Prisma.sql`
      select to_jsonb(m) as linha from public.calendar_event_mappings m
      where m.external_calendar_id = ${calId}::uuid and m.google_event_id = ${googleEventId}::text`);
  }

  mapeamentoPorEvento(connId: string, eventId: string): Promise<Mapeamento | null> {
    return this.uma<Mapeamento>(Prisma.sql`
      select to_jsonb(m) as linha from public.calendar_event_mappings m
      where m.connection_id = ${connId}::uuid and m.routine_event_id = ${eventId}::uuid`);
  }

  /** Mapeamentos vivos do evento em conexões que não são a do novo responsável (troca de responsável, §2.3). */
  mapeamentosDeOutrasConexoes(eventId: string, org: string, connNova: string | null): Promise<Array<Mapeamento & {
    conexao: Conexao; calendario_externo: string | null;
  }>> {
    return this.linhas(Prisma.sql`
      select to_jsonb(m) || jsonb_build_object('conexao', to_jsonb(c), 'calendario_externo', ec.external_calendar_id) as linha
      from public.calendar_event_mappings m
      join public.calendar_connections c on c.id = m.connection_id
      left join public.external_calendars ec on ec.id = m.external_calendar_id
      where m.routine_event_id = ${eventId}::uuid and m.organization_id = ${org}::uuid
        and (${connNova}::uuid is null or m.connection_id <> ${connNova}::uuid)
        and m.deleted_at is null`);
  }

  async atualizarMapeamento(id: string, campos: Campos): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      update public.calendar_event_mappings set ${atribuicao('calendar_event_mappings', campos, COLUNAS_MAPEAMENTO)}
      where id = ${id}::uuid`);
  }

  async inserirMapeamento(campos: Campos): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      insert into public.calendar_event_mappings ${insercao('calendar_event_mappings', campos, COLUNAS_NOVO_MAPEAMENTO)}`);
  }

  /** Upsert do push: nunca troca external_calendar_id de um mapeamento existente (defeito 4). */
  async upsertMapeamento(campos: Campos): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      insert into public.calendar_event_mappings ${insercao('calendar_event_mappings', campos, COLUNAS_NOVO_MAPEAMENTO)}
      on conflict (connection_id, routine_event_id) do update set
        google_event_id = excluded.google_event_id, google_etag = excluded.google_etag,
        google_updated_at = excluded.google_updated_at, sync_version = excluded.sync_version, origin = excluded.origin,
        last_synced_at = excluded.last_synced_at, deleted_at = excluded.deleted_at`);
  }

  eventoPorId(id: string): Promise<Linha | null> {
    return this.uma<Linha>(Prisma.sql`select to_jsonb(e) as linha from public.routine_events e where e.id = ${id}::uuid`);
  }

  /** Atualiza o evento pelo caminho do servidor; `org` restringe quando vem da conexão. Devolve o sync_version novo. */
  async atualizarEvento(id: string, org: string | null, campos: Campos): Promise<number | null> {
    const r = await this.prisma.$queryRaw<Array<{ sync_version: number }>>(Prisma.sql`
      update public.routine_events set ${atribuicao('routine_events', campos, COLUNAS_EVENTO)}
      where id = ${id}::uuid and (${org}::uuid is null or organization_id = ${org}::uuid)
      returning sync_version::int as sync_version`);
    return r[0]?.sync_version ?? null;
  }

  async inserirEvento(campos: Campos): Promise<{ id: string; sync_version: number }> {
    const r = await this.prisma.$queryRaw<Array<{ id: string; sync_version: number }>>(Prisma.sql`
      insert into public.routine_events ${insercao('routine_events', campos, COLUNAS_NOVO_EVENTO)}
      returning id::text as id, sync_version::int as sync_version`);
    return r[0];
  }

  /** Leitura do sync (correção do defeito 3): só o que precisa subir, mais antigo primeiro. */
  eventosParaPush(conexao: Conexao, alvo: string | null, force: boolean): Promise<Linha[]> {
    const filtroAlvo = alvo ? Prisma.sql`and e.id = ${alvo}::uuid` : Prisma.empty;
    const filtroVersao = alvo && force
      ? Prisma.empty
      : Prisma.sql`and (m.id is null or e.sync_version > m.sync_version or e.deleted_at is not null or e.status = 'cancelled')`;
    return this.linhas<Linha>(Prisma.sql`
      select to_jsonb(e) as linha from public.routine_events e
      left join public.calendar_event_mappings m on m.routine_event_id = e.id and m.connection_id = ${conexao.id}::uuid
      where e.organization_id = ${conexao.organization_id}::uuid and e.assigned_to = ${conexao.user_id}::uuid
        and (e.deleted_at is null and e.status <> 'cancelled' or (m.id is not null and m.deleted_at is null))
        ${filtroVersao}
        ${filtroAlvo}
      order by e.updated_at asc limit ${LIMITE_LISTA}::int`);
  }

  async contextoImovel(propertyId: string): Promise<string | null> {
    const r = await this.prisma.$queryRaw<Array<{ bairro: string | null; cidade: string | null }>>(Prisma.sql`
      select bairro, cidade from public.imoveis where id = ${propertyId}::uuid`);
    return r[0] ? [r[0].bairro, r[0].cidade].filter(Boolean).join(' · ') : null;
  }

  // ------------------------------------------------------------ canais de watch e recibos

  canalVigente(calId: string): Promise<Linha | null> {
    return this.uma<Linha>(Prisma.sql`
      select to_jsonb(w) as linha from public.calendar_watch_channels w
      where w.external_calendar_id = ${calId}::uuid and w.status = 'active' and w.expires_at > now() + interval '24 hours'
      order by w.expires_at desc limit 1`);
  }

  canaisAtivosDoCalendario(calId: string): Promise<Array<{ channel_id: string; resource_id: string }>> {
    return this.linhas(Prisma.sql`
      select jsonb_build_object('channel_id', w.channel_id, 'resource_id', w.resource_id) as linha
      from public.calendar_watch_channels w where w.external_calendar_id = ${calId}::uuid and w.status = 'active'`);
  }

  async trocarCanal(calId: string, canal: { channel_id: string; resource_id: string; resource_uri: string | null; channel_token_hash: string; expires_at: string }): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      update public.calendar_watch_channels set status = 'expired', updated_at = now()
      where external_calendar_id = ${calId}::uuid and status = 'active'`);
    await this.prisma.$executeRaw(Prisma.sql`
      insert into public.calendar_watch_channels (external_calendar_id, channel_id, resource_id, resource_uri, channel_token_hash, expires_at, status)
      values (${calId}::uuid, ${canal.channel_id}::text, ${canal.resource_id}::text, ${canal.resource_uri}::text,
        ${canal.channel_token_hash}::text, ${canal.expires_at}::timestamptz, 'active')`);
  }

  canalDoWebhook(channelId: string, resourceId: string): Promise<Linha | null> {
    return this.uma<Linha>(Prisma.sql`
      select to_jsonb(w) as linha from public.calendar_watch_channels w
      where w.channel_id = ${channelId}::text and w.resource_id = ${resourceId}::text and w.status = 'active' and w.expires_at > now()
      limit 1`);
  }

  /** Fora de transação: o 23505 do recibo repetido não deixa nada abortado. */
  async inserirRecibo(channelId: string, messageNumber: number, resourceState: string): Promise<'inserido' | 'duplicado'> {
    try {
      await this.prisma.$executeRaw(Prisma.sql`
        insert into public.calendar_webhook_receipts (channel_id, message_number, resource_state)
        values (${channelId}::text, ${messageNumber}::bigint, ${resourceState}::text)`);
      return 'inserido';
    } catch (e) {
      if (erroPg(e)?.sqlstate === '23505') return 'duplicado';
      throw e;
    }
  }

  async apagarRecibo(channelId: string, messageNumber: number): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      delete from public.calendar_webhook_receipts where channel_id = ${channelId}::text and message_number = ${messageNumber}::bigint`);
  }

  async limparRecibosAntigos(): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      delete from public.calendar_webhook_receipts where received_at < now() - interval '7 days'`);
  }
}
