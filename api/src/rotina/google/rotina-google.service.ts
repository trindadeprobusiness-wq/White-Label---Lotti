import { randomUUID } from 'node:crypto';
import { HttpException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../../prisma/tenant-db';
import { ConfigRotina, lerConfigRotina } from '../rotina.config';
import { exigirContexto } from '../rotina.contexto';
import {
  COLUNAS_CALENDARIO, ConfigurarCalendarioDto, ConfigurarPrivacidadeDto, LIMITE_LISTA, SincronizarDto,
} from '../rotina.dto';
import { ERROS, traduzirErroBanco } from '../rotina.erros';
import { cifrar, compararSegredo, decifrar, sha256Base64Url, tokenAleatorio } from './cripto';
import { Fetcher, FETCH_ROTINA, googleRequest, safeErrorCode } from './google-http';
import {
  activityFromGoogle, buildGoogleEventPayload, GoogleCalendarEvent, googleEventIdForRoutine, googleTimes,
  hasBidirectionalConflict, recurrenceFromGoogle,
} from './mapeamento';
import { Calendario, Conexao, Linha, RotinaGoogleRepo } from './rotina-google.repo';

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];
const API = 'https://www.googleapis.com/calendar/v3';
const ESCRITA = ['export_only', 'bidirectional'];

export interface ResultadoSync { imported: number; cancelled: number; pushed: number; conflicts: number; errors: number }
export interface RespostaWebhook { status: number; body: Record<string, unknown> }
type GoogleConfig = ConfigRotina['google'];

const agoraIso = () => new Date().toISOString();
const ehEscrita = (c: Pick<Calendario, 'sync_direction'> | null | undefined) => !!c && ESCRITA.includes(c.sync_direction);

@Injectable()
export class RotinaGoogleService {
  private readonly logger = new Logger('RotinaGoogle');
  private readonly fetcher: Fetcher;

  constructor(
    private readonly db: TenantDb,
    private readonly repo: RotinaGoogleRepo,
    @Optional() @Inject(FETCH_ROTINA) fetcher?: Fetcher,
  ) {
    this.fetcher = fetcher ?? ((...args: Parameters<Fetcher>) => fetch(...args));
  }

  /** Contexto + org/uid da membership (nunca do corpo). */
  private async contexto(claims: SupabaseClaims): Promise<{ org: string; uid: string }> {
    try {
      const ctx = await this.db.run(claims, (tx) => exigirContexto(tx, claims.sub));
      return { org: ctx.membership.organization_id, uid: claims.sub };
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  private configExigida(): GoogleConfig & { clientId: string; clientSecret: string; chaveCripto: string } {
    const cfg = lerConfigRotina().google;
    if (!cfg.configurado) throw ERROS.googleNaoConfigurado();
    return cfg as GoogleConfig & { clientId: string; clientSecret: string; chaveCripto: string };
  }

  private req(token: string, url: string, init: RequestInit = {}, retries = 2) {
    return googleRequest(this.fetcher, token, url, init, retries);
  }

  // ================================================================ auth (G1–G4, P1)

  async status(claims: SupabaseClaims): Promise<Record<string, unknown>> {
    const { org, uid } = await this.contexto(claims);
    const c = await this.repo.statusConexao(org, uid);
    if (!c) return { connected: false, status: 'not_connected' };
    return {
      connected: c.status === 'connected',
      status: c.status,
      provider_email: c.provider_email,
      privacy_mode: c.privacy_mode,
      last_sync_at: c.last_sync_at,
      last_error_code: c.last_error_code,
    };
  }

  async conectar(claims: SupabaseClaims): Promise<{ authorization_url: string }> {
    const cfg = this.configExigida();
    if (!cfg.redirectUri) throw ERROS.googleNaoConfigurado();
    const { org, uid } = await this.contexto(claims);
    const state = tokenAleatorio(32);
    const verifier = tokenAleatorio(64);
    const challenge = sha256Base64Url(verifier);
    try {
      await this.repo.prepararStart(org, uid, sha256Base64Url(state), cifrar(verifier, cfg.chaveCripto));
    } catch (e) {
      this.logger.error(`google-calendar-auth: ${safeErrorCode(e)}`);
      throw ERROS.conexaoFalhou();
    }
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.search = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent select_account',
    }).toString();
    return { authorization_url: authUrl.toString() };
  }

  async configurarPrivacidade(claims: SupabaseClaims, dto: ConfigurarPrivacidadeDto): Promise<{ configured: true; privacy_mode: string }> {
    const { org, uid } = await this.contexto(claims);
    const conexao = await this.repo.conexaoDoUsuario(org, uid);
    if (!conexao) throw ERROS.googleNaoConectado();
    await this.repo.configurarPrivacidade(conexao.id, org, uid, dto.privacy_mode);
    return { configured: true, privacy_mode: dto.privacy_mode };
  }

  async desconectar(claims: SupabaseClaims): Promise<{ disconnected: true; idempotent?: true }> {
    const { org, uid } = await this.contexto(claims);
    const conexao = await this.repo.conexaoDoUsuario(org, uid);
    if (!conexao) return { disconnected: true, idempotent: true };
    const cfg = lerConfigRotina().google;
    if (cfg.configurado) {
      try {
        const token = await this.accessTokenForConnection(conexao, cfg);
        for (const canal of await this.repo.canaisDaConexao(conexao.id)) {
          await this.req(token, `${API}/channels/stop`, {
            method: 'POST', body: JSON.stringify({ id: canal.channel_id, resourceId: canal.resource_id }),
          }, 0);
        }
        const rawToken = conexao.refresh_token_ciphertext ? decifrar(conexao.refresh_token_ciphertext, cfg.chaveCripto!) : token;
        await this.fetcher(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(rawToken)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
      } catch {
        // Revogação remota é melhor esforço; a exclusão local abaixo é obrigatória.
      }
    }
    try {
      await this.repo.apagarConexao(conexao.id, org, uid);
    } catch (e) {
      this.logger.error(`google-calendar-auth: ${safeErrorCode(e)}`);
      throw ERROS.conexaoFalhou();
    }
    return { disconnected: true };
  }

  appRedirect(resultado: 'connected' | 'error'): string {
    const url = new URL(lerConfigRotina().google.appRedirectUrl);
    url.searchParams.set('google_calendar', resultado);
    return url.toString();
  }

  /** P1: devolve a URL do 302. Nunca lança. */
  async callback(query: { state?: unknown; code?: unknown; error?: unknown }): Promise<string> {
    const state = typeof query.state === 'string' && query.state ? query.state : null;
    const code = typeof query.code === 'string' && query.code ? query.code : null;
    const erroOauth = typeof query.error === 'string' && query.error ? query.error : null;
    const cfg = lerConfigRotina().google;
    if (!state || !cfg.configurado || !cfg.redirectUri) return this.appRedirect('error');
    let conexao: Conexao | null;
    try {
      conexao = await this.repo.conexaoPorState(sha256Base64Url(state));
    } catch (e) {
      this.logger.error(`google-calendar-auth: ${safeErrorCode(e)}`);
      return this.appRedirect('error');
    }
    if (!conexao) return this.appRedirect('error');
    if (erroOauth || !code) {
      await this.falharCallback(conexao, 'oauth_denied');
      return this.appRedirect('error');
    }
    try {
      await this.concluirCallback(conexao, code, cfg as GoogleConfig & { clientId: string; clientSecret: string; chaveCripto: string; redirectUri: string });
      return this.appRedirect('connected');
    } catch (e) {
      await this.falharCallback(conexao, safeErrorCode(e));
      return this.appRedirect('error');
    }
  }

  private async falharCallback(conexao: Conexao, codigo: string): Promise<void> {
    this.logger.warn(`google-calendar-auth: callback ${codigo}`);
    try {
      if (conexao.status === 'connected') await this.repo.limparStateConexao(conexao.id);
      else await this.repo.marcarErroCallback(conexao.id, codigo);
    } catch (e) {
      this.logger.error(`google-calendar-auth: ${safeErrorCode(e)}`);
    }
  }

  private async concluirCallback(
    conexao: Conexao, code: string, cfg: GoogleConfig & { clientId: string; clientSecret: string; chaveCripto: string; redirectUri: string },
  ): Promise<void> {
    const verifier = decifrar(conexao.pkce_verifier_ciphertext as string | null, cfg.chaveCripto);
    const tokenResponse = await this.fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });
    const tokens = await tokenResponse.json().catch(() => ({})) as Record<string, unknown>;
    if (!tokenResponse.ok || !tokens.access_token) throw new Error('oauth_exchange_failed');
    const accessToken = String(tokens.access_token);

    const profileResponse = await this.fetcher('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = (profileResponse.ok ? await profileResponse.json().catch(() => ({})) : {}) as Record<string, unknown>;
    const refreshCiphertext = tokens.refresh_token
      ? cifrar(String(tokens.refresh_token), cfg.chaveCripto)
      : conexao.refresh_token_ciphertext;
    if (!refreshCiphertext) throw new Error('refresh_token_missing');

    try {
      await this.repo.atualizarConexao(conexao.id, {
        provider_account_id: profile.sub || null,
        provider_email: profile.email || null,
        scopes: String(tokens.scope || '').split(/\s+/).filter(Boolean),
        status: 'connected',
        access_token_ciphertext: cifrar(accessToken, cfg.chaveCripto),
        refresh_token_ciphertext: refreshCiphertext,
        token_expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
        oauth_state_hash: null,
        pkce_verifier_ciphertext: null,
        oauth_expires_at: null,
        last_error_code: null,
        disconnected_at: null,
      });
    } catch {
      throw new Error('connection_update_failed');
    }

    const calendarsResponse = await this.req(accessToken, `${API}/users/me/calendarList?minAccessRole=reader&showHidden=false`);
    if (!calendarsResponse.ok) throw new Error('calendar_list_failed');
    const calendars = await calendarsResponse.json() as { items?: Array<Record<string, unknown>> };
    for (const calendar of calendars.items || []) {
      await this.repo.upsertCalendario(conexao, {
        external_calendar_id: String(calendar.id),
        summary: String(calendar.summaryOverride || calendar.summary || 'Google Agenda'),
        color: (calendar.backgroundColor as string) || null,
        access_role: (calendar.accessRole as string) || null,
        primary: !!calendar.primary,
        sync_direction: calendar.accessRole === 'reader' ? 'import_only' : 'bidirectional',
      });
    }
  }

  // ================================================================ calendários (G5, G6: TenantDb)

  async listarCalendarios(claims: SupabaseClaims): Promise<Linha[]> {
    try {
      return await this.db.run(claims, async (tx) => {
        const ctx = await exigirContexto(tx, claims.sub);
        const r = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
          select to_jsonb(ec) as linha from public.external_calendars ec
          where ec.organization_id = ${ctx.membership.organization_id}::uuid and ec.user_id = ${claims.sub}::uuid
          order by ec.is_primary desc limit ${LIMITE_LISTA}::int`);
        return r.map((l) => l.linha);
      });
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  async configurarCalendario(claims: SupabaseClaims, id: string, dto: ConfigurarCalendarioDto): Promise<Linha> {
    const cols = COLUNAS_CALENDARIO.filter((c) => (dto as Record<string, unknown>)[c] !== undefined);
    if (cols.length === 0) throw ERROS.nadaParaAtualizar();
    const json = JSON.stringify(Object.fromEntries(cols.map((c) => [c, (dto as Record<string, unknown>)[c]])));
    try {
      return await this.db.run(claims, async (tx) => {
        const ctx = await exigirContexto(tx, claims.sub);
        const org = ctx.membership.organization_id;
        if (dto.is_default === true) {
          await tx.$executeRaw(Prisma.sql`
            update public.external_calendars set is_default = false
            where connection_id = (select connection_id from public.external_calendars where id = ${id}::uuid)
              and id <> ${id}::uuid and user_id = ${claims.sub}::uuid`);
        }
        const r = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
          update public.external_calendars t
          set (${Prisma.raw(cols.join(', '))}) = (select ${Prisma.raw(cols.map((c) => `r.${c}`).join(', '))}
            from jsonb_populate_record(null::public.external_calendars, ${json}::jsonb) r), updated_at = now()
          where t.id = ${id}::uuid and t.user_id = ${claims.sub}::uuid and t.organization_id = ${org}::uuid
          returning to_jsonb(t) as linha`);
        if (r.length === 0) throw ERROS.naoEncontrado('Calendário não encontrado.');
        return r[0].linha;
      });
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  // ================================================================ sync (G7)

  async sincronizar(claims: SupabaseClaims, dto: SincronizarDto): Promise<Record<string, unknown>> {
    const cfg = this.configExigida();
    const action = dto.action ?? 'sync';
    if (action === 'sync') {
      const { org, uid } = await this.contexto(claims);
      const conexao = await this.repo.conexaoConectada(org, uid);
      if (!conexao) throw ERROS.googleNaoConectado();
      return this.comFalhaRegistrada(conexao, async () => ({ synced: true, ...(await this.syncConnection(conexao, undefined, false, cfg)) }));
    }
    const eventId = dto.event_id as string;
    // O chamador precisa enxergar o evento; a conexão usada é a do responsável (contrato §6.1).
    let responsavel: string;
    let org: string;
    try {
      ({ responsavel, org } = await this.db.run(claims, async (tx) => {
        const ctx = await exigirContexto(tx, claims.sub);
        const r = await tx.$queryRaw<Array<{ assigned_to: string }>>(Prisma.sql`
          select assigned_to::text as assigned_to from public.routine_events
          where id = ${eventId}::uuid and organization_id = ${ctx.membership.organization_id}::uuid`);
        if (r.length === 0) throw ERROS.naoEncontrado();
        return { responsavel: r[0].assigned_to, org: ctx.membership.organization_id };
      }));
    } catch (e) {
      traduzirErroBanco(e);
    }
    const conexao = await this.repo.conexaoConectada(org, responsavel);
    if (!conexao) {
      if (action === 'push_event') return { skipped: true };
      throw ERROS.googleNaoConectado();
    }
    if (action === 'resolve_conflict_google') {
      return this.comFalhaRegistrada(conexao, async () => ({ synced: true, ...(await this.acceptGoogleVersion(conexao, eventId, cfg)) }));
    }
    return this.comFalhaRegistrada(conexao, async () => ({
      synced: true, ...(await this.syncConnection(conexao, eventId, action === 'resolve_conflict_lotti', cfg)),
    }));
  }

  private async comFalhaRegistrada<T>(conexao: Conexao, trabalho: () => Promise<T>): Promise<T> {
    try {
      return await trabalho();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      const codigo = safeErrorCode(e);
      this.logger.error(`google-calendar-sync: ${codigo}`);
      await this.repo.gravarErroConexao(conexao.id, codigo).catch(() => undefined);
      throw ERROS.syncPendente();
    }
  }

  /**
   * Push depois do commit de R10/R12/R14/R15. Nunca lança: falha vai só para o log.
   * Sem as chaves do Google não faz nada (matriz §0.5).
   */
  async pushEventoEmSegundoPlano(eventId: string, assignedTo: string, responsavelAnterior?: string | null): Promise<void> {
    try {
      const cfg = lerConfigRotina().google;
      if (!cfg.configurado) {
        this.logger.debug(`push ignorado: Google Agenda não configurado (${eventId})`);
        return;
      }
      const evento = await this.repo.eventoPorId(eventId);
      if (!evento) return;
      const org = String(evento.organization_id);
      const conexao = await this.repo.conexaoConectada(org, assignedTo);
      if (responsavelAnterior && responsavelAnterior !== assignedTo) {
        await this.retirarDeOutrasAgendas(eventId, org, conexao?.id ?? null, cfg);
      }
      if (!conexao) return;
      try {
        await this.syncConnection(conexao, eventId, false, cfg);
      } catch (e) {
        const codigo = safeErrorCode(e);
        await this.repo.gravarErroConexao(conexao.id, codigo).catch(() => undefined);
        throw e;
      }
    } catch (e) {
      this.logger.warn(`push em segundo plano falhou (${eventId}): ${safeErrorCode(e)}`);
    }
  }

  /** Troca de responsável: apaga o evento da agenda Google antiga (melhor esforço) e marca o mapeamento. */
  private async retirarDeOutrasAgendas(eventId: string, org: string, connNova: string | null, cfg: GoogleConfig): Promise<void> {
    const antigos = await this.repo.mapeamentosDeOutrasConexoes(eventId, org, connNova);
    for (const m of antigos) {
      try {
        if (m.conexao.status !== 'connected' || !m.calendario_externo) throw new Error('conexao_antiga_indisponivel');
        const token = await this.accessTokenForConnection(m.conexao, cfg);
        const r = await this.req(token,
          `${API}/calendars/${encodeURIComponent(m.calendario_externo)}/events/${encodeURIComponent(m.google_event_id)}`,
          { method: 'DELETE' });
        if (!r.ok && ![404, 410].includes(r.status)) throw new Error(`google_delete_failed_${r.status}`);
      } catch (e) {
        this.logger.warn(`evento ${eventId} pode ter ficado na agenda antiga: ${safeErrorCode(e)}`);
      }
      await this.repo.atualizarMapeamento(m.id, { deleted_at: agoraIso(), last_synced_at: agoraIso() });
    }
  }

  async accessTokenForConnection(conexao: Conexao, cfg: GoogleConfig = lerConfigRotina().google): Promise<string> {
    if (!cfg.configurado) throw new Error('google_nao_configurado');
    const chave = cfg.chaveCripto as string;
    const expiresAt = conexao.token_expires_at ? new Date(conexao.token_expires_at).getTime() : 0;
    if (conexao.access_token_ciphertext && expiresAt > Date.now() + 60_000) {
      return decifrar(conexao.access_token_ciphertext, chave);
    }
    if (!conexao.refresh_token_ciphertext) {
      await this.repo.atualizarConexao(conexao.id, { status: 'expired', last_error_code: 'refresh_token_missing' });
      throw new Error('refresh_token_missing');
    }
    const refreshToken = decifrar(conexao.refresh_token_ciphertext, chave);
    const response = await this.fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId as string,
        client_secret: cfg.clientSecret as string,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || !payload.access_token) {
      const codigo = payload.error === 'invalid_grant' ? 'refresh_token_revoked' : 'refresh_failed';
      await this.repo.atualizarConexao(conexao.id, { status: 'expired', last_error_code: codigo });
      throw new Error(codigo);
    }
    const accessToken = String(payload.access_token);
    await this.repo.atualizarConexao(conexao.id, {
      access_token_ciphertext: cifrar(accessToken, chave),
      token_expires_at: new Date(Date.now() + Number(payload.expires_in || 3600) * 1000).toISOString(),
      status: 'connected',
      last_error_code: null,
    });
    return accessToken;
  }

  async syncConnection(conexao: Conexao, alvo?: string, force = false, cfg: GoogleConfig = lerConfigRotina().google): Promise<ResultadoSync> {
    const token = await this.accessTokenForConnection(conexao, cfg);
    const calendarios = await this.repo.calendariosAtivos(conexao.id);
    const res: ResultadoSync = { imported: 0, cancelled: 0, pushed: 0, conflicts: 0, errors: 0 };
    for (const cal of calendarios) {
      if (!alvo && ['import_only', 'bidirectional'].includes(cal.sync_direction)) {
        const r = await this.pullCalendar(conexao, cal, token, true, cfg);
        res.imported += r.imported;
        res.cancelled += r.cancelled;
      }
    }
    const destino = calendarios.find((c) => ehEscrita(c) && (c.is_default || c.is_primary)) || calendarios.find((c) => ehEscrita(c));
    if (destino) {
      const eventos = await this.repo.eventosParaPush(conexao, alvo ?? null, force);
      for (const evento of eventos) {
        try {
          const r = await this.pushEvent(conexao, destino, token, evento, force);
          if (r.pushed || r.deleted) res.pushed += 1;
          if (r.conflict) res.conflicts += 1;
        } catch (e) {
          res.errors += 1;
          this.logger.warn(`push do evento ${String(evento.id)} falhou: ${safeErrorCode(e)}`);
          await this.repo.atualizarEvento(String(evento.id), null, { sync_status: 'error' }).catch(() => undefined);
        }
      }
    }
    await this.repo.marcarSincronizada(conexao.id);
    return res;
  }

  async pullCalendar(
    conexao: Conexao, calendario: Calendario, token: string, allowFullRetry = true, cfg: GoogleConfig = lerConfigRotina().google,
  ): Promise<{ imported: number; cancelled: number }> {
    const chave = cfg.chaveCripto as string;
    const syncState = (await this.repo.syncState(calendario.id)) ?? (await this.repo.criarSyncState(calendario.id));
    const syncToken = syncState?.sync_token_ciphertext ? decifrar(String(syncState.sync_token_ciphertext), chave) : null;
    let pageToken: string | null = null;
    let nextSyncToken: string | null = null;
    let imported = 0;
    let cancelled = 0;

    do {
      const params = new URLSearchParams({ showDeleted: 'true', maxResults: '2500' });
      if (syncToken) params.set('syncToken', syncToken);
      if (pageToken) params.set('pageToken', pageToken);
      const response = await this.req(token, `${API}/calendars/${encodeURIComponent(calendario.external_calendar_id)}/events?${params}`);
      if (response.status === 410 && syncToken && allowFullRetry) {
        await this.repo.atualizarSyncState(calendario.id, {
          sync_token_ciphertext: null, full_sync_started_at: agoraIso(), last_error_code: 'sync_token_invalid',
        });
        return this.pullCalendar(conexao, calendario, token, false, cfg);
      }
      if (!response.ok) throw new Error(`events_list_failed_${response.status}`);
      const payload = await response.json() as { nextPageToken?: string; nextSyncToken?: string; items?: GoogleCalendarEvent[] };
      pageToken = payload.nextPageToken || null;
      nextSyncToken = payload.nextSyncToken || nextSyncToken;

      for (const googleEvent of payload.items || []) {
        if (!googleEvent.id) continue;
        const mapping = await this.repo.mapeamentoPorGoogleId(calendario.id, googleEvent.id);
        if (googleEvent.status === 'cancelled') {
          if (mapping?.routine_event_id) {
            await this.repo.atualizarEvento(mapping.routine_event_id, null, { status: 'cancelled', deleted_at: agoraIso(), sync_status: 'synced' });
            await this.repo.atualizarMapeamento(mapping.id, { deleted_at: agoraIso(), google_updated_at: googleEvent.updated || null });
          }
          cancelled += 1;
          continue;
        }
        const times = googleTimes(googleEvent, 'America/Sao_Paulo');
        if (!times) continue;
        const camposGoogle = {
          title: googleEvent.summary || 'Compromisso do Google',
          description: googleEvent.description || null,
          location: googleEvent.location || null,
          activity_type: activityFromGoogle(googleEvent.summary),
          start_at: times.startAt,
          end_at: times.endAt,
          all_day: times.allDay,
          timezone: times.timeZone,
          recurrence_rule: recurrenceFromGoogle(googleEvent.recurrence),
          status: 'confirmed',
          visibility: 'private',
          source: 'google',
          sync_status: 'synced',
        };

        if (mapping?.routine_event_id) {
          const local = await this.repo.eventoPorId(mapping.routine_event_id);
          if (local && hasBidirectionalConflict(googleEvent.updated, mapping.last_synced_at, Number(local.sync_version), Number(mapping.sync_version))) {
            await this.repo.atualizarEvento(mapping.routine_event_id, null, { sync_status: 'conflict' });
            continue;
          }
          if (local) {
            const versao = await this.repo.atualizarEvento(String(local.id), null, { ...camposGoogle, deleted_at: null });
            await this.repo.atualizarMapeamento(mapping.id, {
              google_etag: googleEvent.etag || null,
              google_updated_at: googleEvent.updated || null,
              sync_version: versao || Number(local.sync_version),
              last_synced_at: agoraIso(),
              deleted_at: null,
            });
            imported += 1;
          }
          continue;
        }

        let local: { id: string; sync_version: number };
        try {
          local = await this.repo.inserirEvento({
            ...camposGoogle,
            organization_id: conexao.organization_id,
            assigned_to: conexao.user_id,
            created_by: conexao.user_id,
            priority: 'medium',
          });
        } catch {
          throw new Error('google_event_insert_failed');
        }
        await this.repo.inserirMapeamento({
          organization_id: conexao.organization_id,
          connection_id: conexao.id,
          external_calendar_id: calendario.id,
          routine_event_id: local.id,
          google_event_id: googleEvent.id,
          google_etag: googleEvent.etag || null,
          google_updated_at: googleEvent.updated || null,
          sync_version: local.sync_version,
          origin: 'google',
        });
        imported += 1;
      }
    } while (pageToken);

    if (nextSyncToken) {
      await this.repo.atualizarSyncState(calendario.id, {
        sync_token_ciphertext: cifrar(nextSyncToken, chave),
        last_incremental_sync_at: syncToken ? agoraIso() : null,
        last_success_at: agoraIso(),
        last_error_code: null,
        retry_count: 0,
        next_retry_at: null,
      });
    }
    await this.ensureWatch(token, calendario, cfg);
    return { imported, cancelled };
  }

  private async ensureWatch(token: string, calendario: Calendario, cfg: GoogleConfig): Promise<void> {
    if (!cfg.webhookUrl) return;
    if (await this.repo.canalVigente(calendario.id)) return;
    const channelId = randomUUID();
    const channelToken = tokenAleatorio(32);
    const expiration = Date.now() + 6 * 24 * 60 * 60_000;
    const response = await this.req(token, `${API}/calendars/${encodeURIComponent(calendario.external_calendar_id)}/events/watch`, {
      method: 'POST',
      body: JSON.stringify({ id: channelId, type: 'web_hook', address: cfg.webhookUrl, token: channelToken, expiration }),
    });
    if (!response.ok) throw new Error(`watch_failed_${response.status}`);
    const watch = await response.json() as { resourceId: string; resourceUri?: string; expiration?: string | number };
    for (const anterior of await this.repo.canaisAtivosDoCalendario(calendario.id)) {
      await this.req(token, `${API}/channels/stop`, {
        method: 'POST', body: JSON.stringify({ id: anterior.channel_id, resourceId: anterior.resource_id }),
      }, 0).catch(() => undefined);
    }
    await this.repo.trocarCanal(calendario.id, {
      channel_id: channelId,
      resource_id: watch.resourceId,
      resource_uri: watch.resourceUri || null,
      channel_token_hash: sha256Base64Url(channelToken),
      expires_at: new Date(Number(watch.expiration || expiration)).toISOString(),
    });
  }

  private async pushEvent(
    conexao: Conexao, destino: Calendario, token: string, evento: Linha, force: boolean,
  ): Promise<{ skipped?: boolean; deleted?: boolean; conflict?: boolean; pushed?: boolean }> {
    const eventId = String(evento.id);
    const mapping = await this.repo.mapeamentoPorEvento(conexao.id, eventId);
    const apagado = !!evento.deleted_at || evento.status === 'cancelled';
    if (!force && mapping && Number(mapping.sync_version) >= Number(evento.sync_version) && !apagado) return { skipped: true };

    // O evento mapeado continua no calendário do mapeamento; import_only (ou fora da conexão) não recebe escrita.
    let calendario = destino;
    if (mapping) {
      const doMapeamento = mapping.external_calendar_id === destino.id
        ? destino
        : await this.repo.calendarioDaConexao(mapping.external_calendar_id, conexao.id);
      if (!ehEscrita(doMapeamento)) return { skipped: true };
      calendario = doMapeamento as Calendario;
    }
    const base = `${API}/calendars/${encodeURIComponent(calendario.external_calendar_id)}/events`;

    if (apagado) {
      if (mapping) {
        const response = await this.req(token, `${base}/${encodeURIComponent(mapping.google_event_id)}`, { method: 'DELETE' });
        if (!response.ok && ![404, 410].includes(response.status)) throw new Error(`google_delete_failed_${response.status}`);
        await this.repo.atualizarMapeamento(mapping.id, { deleted_at: agoraIso(), last_synced_at: agoraIso() });
      }
      return { deleted: true };
    }

    const parcial = typeof evento.property_id === 'string' ? await this.repo.contextoImovel(evento.property_id) : null;
    const payload = buildGoogleEventPayload(evento, conexao.privacy_mode, parcial);
    const googleEventId = mapping?.google_event_id || googleEventIdForRoutine(eventId);
    let response = await this.req(token, `${base}/${encodeURIComponent(googleEventId)}`, {
      method: 'PUT',
      headers: !force && mapping?.google_etag ? { 'If-Match': mapping.google_etag } : {},
      body: JSON.stringify({ ...payload, id: googleEventId }),
    });
    if (response.status === 412) {
      await this.repo.atualizarEvento(eventId, null, { sync_status: 'conflict' });
      return { conflict: true };
    }
    if (response.status === 404 && !mapping) {
      response = await this.req(token, `${base}?sendUpdates=none`, { method: 'POST', body: JSON.stringify({ ...payload, id: googleEventId }) });
    }
    if (!response.ok) throw new Error(`google_upsert_failed_${response.status}`);
    const googleEvent = await response.json().catch(() => ({})) as GoogleCalendarEvent;
    await this.repo.atualizarEvento(eventId, null, { sync_status: 'synced' });
    await this.repo.upsertMapeamento({
      organization_id: conexao.organization_id,
      connection_id: conexao.id,
      external_calendar_id: calendario.id,
      routine_event_id: eventId,
      google_event_id: googleEvent.id || googleEventId,
      google_etag: googleEvent.etag || null,
      google_updated_at: googleEvent.updated || null,
      sync_version: evento.sync_version,
      origin: evento.source || 'lotti',
      last_synced_at: agoraIso(),
      deleted_at: null,
    });
    return { pushed: true };
  }

  async acceptGoogleVersion(conexao: Conexao, eventId: string, cfg: GoogleConfig = lerConfigRotina().google): Promise<Record<string, unknown>> {
    const token = await this.accessTokenForConnection(conexao, cfg);
    const mapping = await this.repo.mapeamentoPorEvento(conexao.id, eventId);
    if (!mapping) throw new Error('calendar_mapping_missing');
    const calendario = await this.repo.calendarioDaConexao(mapping.external_calendar_id, conexao.id);
    if (!calendario) throw new Error('external_calendar_missing');
    const response = await this.req(token,
      `${API}/calendars/${encodeURIComponent(calendario.external_calendar_id)}/events/${encodeURIComponent(mapping.google_event_id)}`);
    const org = conexao.organization_id;
    if (response.status === 404 || response.status === 410) {
      const versao = await this.repo.atualizarEvento(eventId, org, { status: 'cancelled', deleted_at: agoraIso(), sync_status: 'synced' });
      await this.repo.atualizarMapeamento(mapping.id, {
        deleted_at: agoraIso(), sync_version: versao || mapping.sync_version, last_synced_at: agoraIso(),
      });
      return { accepted: 'google', cancelled: true };
    }
    if (!response.ok) throw new Error(`google_event_get_failed_${response.status}`);
    const googleEvent = await response.json() as GoogleCalendarEvent;
    if (googleEvent.status === 'cancelled') {
      const versao = await this.repo.atualizarEvento(eventId, org, { status: 'cancelled', deleted_at: agoraIso(), sync_status: 'synced' });
      await this.repo.atualizarMapeamento(mapping.id, {
        deleted_at: agoraIso(), sync_version: versao || mapping.sync_version,
        google_etag: googleEvent.etag || null, google_updated_at: googleEvent.updated || null, last_synced_at: agoraIso(),
      });
      return { accepted: 'google', cancelled: true };
    }
    const times = googleTimes(googleEvent, 'America/Sao_Paulo');
    if (!times) throw new Error('google_event_times_missing');
    let versao: number | null;
    try {
      versao = await this.repo.atualizarEvento(eventId, org, {
        title: googleEvent.summary || 'Compromisso do Google',
        description: googleEvent.description || null,
        location: googleEvent.location || null,
        activity_type: activityFromGoogle(googleEvent.summary),
        start_at: times.startAt,
        end_at: times.endAt,
        all_day: times.allDay,
        timezone: times.timeZone,
        recurrence_rule: recurrenceFromGoogle(googleEvent.recurrence),
        status: 'confirmed',
        visibility: 'private',
        source: 'google',
        sync_status: 'synced',
        deleted_at: null,
      });
    } catch {
      throw new Error('google_conflict_apply_failed');
    }
    if (versao === null) throw new Error('google_conflict_apply_failed');
    await this.repo.atualizarMapeamento(mapping.id, {
      google_etag: googleEvent.etag || null,
      google_updated_at: googleEvent.updated || null,
      sync_version: versao,
      last_synced_at: agoraIso(),
      deleted_at: null,
    });
    return { accepted: 'google', cancelled: false };
  }

  // ================================================================ webhook (P2) e job

  /** Ramo action:'webhook' do Deno: só o pull do calendário avisado, sem push e sem syncConnection. */
  async webhookCalendario(externalCalendarId: string): Promise<{ imported: number; cancelled: number }> {
    const cfg = lerConfigRotina().google;
    const achado = await this.repo.calendarioComConexaoConectada(externalCalendarId);
    if (!achado) throw new Error('google_nao_conectado');
    const token = await this.accessTokenForConnection(achado.conexao, cfg);
    try {
      return await this.pullCalendar(achado.conexao, achado.calendario, token, true, cfg);
    } catch (e) {
      await this.repo.gravarErroConexao(achado.conexao.id, safeErrorCode(e)).catch(() => undefined);
      throw e;
    }
  }

  async webhook(headers: Record<string, string | string[] | undefined>): Promise<RespostaWebhook> {
    this.configExigida();
    const h = (nome: string) => {
      const v = headers[nome];
      return Array.isArray(v) ? v[0] ?? null : v ?? null;
    };
    const channelId = h('x-goog-channel-id');
    const channelToken = h('x-goog-channel-token');
    const resourceId = h('x-goog-resource-id');
    const resourceState = h('x-goog-resource-state') || 'exists';
    const bruto = h('x-goog-message-number');
    const messageNumber = bruto === null || bruto.trim() === '' ? NaN : Number(bruto);
    if (!channelId || !channelToken || !resourceId || !Number.isSafeInteger(messageNumber)) {
      return { status: 400, body: { error: 'Invalid notification' } };
    }
    let reciboInserido = false;
    try {
      const canal = await this.repo.canalDoWebhook(channelId, resourceId);
      if (!canal || !compararSegredo(String(canal.channel_token_hash), sha256Base64Url(channelToken))) {
        return { status: 401, body: { error: 'Unauthorized notification' } };
      }
      if ((await this.repo.inserirRecibo(channelId, messageNumber, resourceState)) === 'duplicado') {
        return { status: 200, body: { received: true, duplicate: true } };
      }
      reciboInserido = true;
      if (resourceState !== 'sync') await this.webhookCalendario(String(canal.external_calendar_id));
      return { status: 200, body: { received: true } };
    } catch (e) {
      if (reciboInserido) await this.repo.apagarRecibo(channelId, messageNumber).catch(() => undefined);
      this.logger.error(`google-calendar-webhook: ${safeErrorCode(e)}`);
      return { status: 500, body: { error: 'Temporary failure' } };
    }
  }

  async manter(): Promise<{ maintained: number; results: Array<Record<string, unknown>> }> {
    const cfg = lerConfigRotina().google;
    const results: Array<Record<string, unknown>> = [];
    for (const conexao of await this.repo.conexoesConectadas()) {
      try {
        results.push({ id: conexao.id, ...(await this.syncConnection(conexao, undefined, false, cfg)) });
      } catch (e) {
        const codigo = safeErrorCode(e);
        await this.repo.gravarErroConexao(conexao.id, codigo).catch(() => undefined);
        results.push({ id: conexao.id, error: codigo });
      }
    }
    await this.repo.limparRecibosAntigos();
    this.logger.log(`maintain: ${JSON.stringify({ maintained: results.length, results })}`);
    return { maintained: results.length, results };
  }
}
