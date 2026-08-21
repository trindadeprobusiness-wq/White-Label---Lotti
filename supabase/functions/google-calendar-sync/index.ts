import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  accessTokenForConnection, adminClient, decryptSecret, encryptSecret,
  googleRequest, randomToken, requireInternalSecret, requireRoutineUser,
  routineCorsHeaders, routineJson, safeErrorCode, sha256,
  type CalendarConnectionRow,
} from "../_shared/routine/google.ts";
import {
  activityFromGoogle, buildGoogleEventPayload, googleEventIdForRoutine,
  googleTimes, hasBidirectionalConflict, type GoogleCalendarEvent,
} from "../_shared/routine/calendar-mapping.ts";

type Admin = ReturnType<typeof adminClient>;
type ExternalCalendar = {
  id: string;
  connection_id: string;
  organization_id: string;
  user_id: string;
  external_calendar_id: string;
  summary: string;
  selected: boolean;
  is_primary: boolean;
  is_default: boolean;
  sync_direction: "import_only" | "export_only" | "bidirectional" | "disabled";
};

async function ensureWatch(admin: Admin, accessToken: string, calendar: ExternalCalendar) {
  const webhookUrl = Deno.env.get("GOOGLE_CALENDAR_WEBHOOK_URL");
  if (!webhookUrl) return;
  const { data: current } = await admin.from("calendar_watch_channels").select("*")
    .eq("external_calendar_id", calendar.id)
    .eq("status", "active")
    .gt("expires_at", new Date(Date.now() + 24 * 60 * 60_000).toISOString())
    .order("expires_at", { ascending: false })
    .limit(1).maybeSingle();
  if (current) return;

  const channelId = crypto.randomUUID();
  const channelToken = randomToken(32);
  const expiration = Date.now() + 6 * 24 * 60 * 60_000;
  const response = await googleRequest(
    accessToken,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.external_calendar_id)}/events/watch`,
    {
      method: "POST",
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: webhookUrl,
        token: channelToken,
        expiration,
      }),
    },
  );
  if (!response.ok) throw new Error(`watch_failed_${response.status}`);
  const watch = await response.json();
  const { data: previousChannels } = await admin.from("calendar_watch_channels")
    .select("channel_id, resource_id")
    .eq("external_calendar_id", calendar.id)
    .eq("status", "active");
  for (const previous of previousChannels || []) {
    await googleRequest(accessToken, "https://www.googleapis.com/calendar/v3/channels/stop", {
      method: "POST",
      body: JSON.stringify({ id: previous.channel_id, resourceId: previous.resource_id }),
    }, 0).catch(() => undefined);
  }
  await admin.from("calendar_watch_channels").update({ status: "expired" })
    .eq("external_calendar_id", calendar.id).eq("status", "active");
  await admin.from("calendar_watch_channels").insert({
    external_calendar_id: calendar.id,
    channel_id: channelId,
    resource_id: watch.resourceId,
    resource_uri: watch.resourceUri || null,
    channel_token_hash: await sha256(channelToken),
    expires_at: new Date(Number(watch.expiration || expiration)).toISOString(),
    status: "active",
  });
}

async function pullCalendar(
  admin: Admin,
  connection: CalendarConnectionRow,
  calendar: ExternalCalendar,
  accessToken: string,
  allowFullRetry = true,
) {
  let { data: syncState } = await admin.from("calendar_sync_states").select("*")
    .eq("external_calendar_id", calendar.id).maybeSingle();
  if (!syncState) {
    const { data } = await admin.from("calendar_sync_states").insert({
      external_calendar_id: calendar.id,
      full_sync_started_at: new Date().toISOString(),
    }).select("*").single();
    syncState = data;
  }
  const syncToken = syncState?.sync_token_ciphertext
    ? await decryptSecret(syncState.sync_token_ciphertext)
    : null;
  let pageToken: string | null = null;
  let nextSyncToken: string | null = null;
  let imported = 0;
  let cancelled = 0;

  do {
    const params = new URLSearchParams({ showDeleted: "true", maxResults: "2500" });
    if (syncToken) params.set("syncToken", syncToken);
    if (pageToken) params.set("pageToken", pageToken);
    const response = await googleRequest(
      accessToken,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.external_calendar_id)}/events?${params}`,
    );
    if (response.status === 410 && syncToken && allowFullRetry) {
      await admin.from("calendar_sync_states").update({
        sync_token_ciphertext: null,
        full_sync_started_at: new Date().toISOString(),
        last_error_code: "sync_token_invalid",
      }).eq("external_calendar_id", calendar.id);
      return pullCalendar(admin, connection, calendar, accessToken, false);
    }
    if (!response.ok) throw new Error(`events_list_failed_${response.status}`);
    const payload = await response.json();
    pageToken = payload.nextPageToken || null;
    nextSyncToken = payload.nextSyncToken || nextSyncToken;

    for (const googleEvent of (payload.items || []) as GoogleCalendarEvent[]) {
      if (!googleEvent.id) continue;
      const { data: mapping } = await admin.from("calendar_event_mappings").select("*")
        .eq("external_calendar_id", calendar.id)
        .eq("google_event_id", googleEvent.id)
        .maybeSingle();
      if (googleEvent.status === "cancelled") {
        if (mapping?.routine_event_id) {
          await admin.from("routine_events").update({
            status: "cancelled", deleted_at: new Date().toISOString(), sync_status: "synced",
          }).eq("id", mapping.routine_event_id);
          await admin.from("calendar_event_mappings").update({
            deleted_at: new Date().toISOString(), google_updated_at: googleEvent.updated || null,
          }).eq("id", mapping.id);
        }
        cancelled += 1;
        continue;
      }
      const times = googleTimes(googleEvent, "America/Sao_Paulo");
      if (!times) continue;

      if (mapping?.routine_event_id) {
        const { data: local } = await admin.from("routine_events").select("*").eq("id", mapping.routine_event_id).maybeSingle();
        if (local && hasBidirectionalConflict(
          googleEvent.updated,
          mapping.last_synced_at,
          Number(local.sync_version),
          Number(mapping.sync_version),
        )) {
          await admin.from("routine_events").update({ sync_status: "conflict" }).eq("id", mapping.routine_event_id);
          continue;
        }
        if (local) {
          const { data: updated } = await admin.from("routine_events").update({
            title: googleEvent.summary || "Compromisso do Google",
            description: googleEvent.description || null,
            location: googleEvent.location || null,
            activity_type: activityFromGoogle(googleEvent.summary),
            start_at: times.startAt,
            end_at: times.endAt,
            all_day: times.allDay,
            timezone: times.timeZone,
            recurrence_rule: googleEvent.recurrence?.find((rule) => rule.startsWith("RRULE:"))?.replace(/^RRULE:/, "") || null,
            status: "confirmed",
            visibility: "private",
            source: "google",
            sync_status: "synced",
            deleted_at: null,
          }).eq("id", local.id).select("sync_version").single();
          await admin.from("calendar_event_mappings").update({
            google_etag: googleEvent.etag || null,
            google_updated_at: googleEvent.updated || null,
            sync_version: updated?.sync_version || local.sync_version,
            last_synced_at: new Date().toISOString(),
            deleted_at: null,
          }).eq("id", mapping.id);
          imported += 1;
        }
        continue;
      }

      const { data: local, error: insertError } = await admin.from("routine_events").insert({
        organization_id: connection.organization_id,
        assigned_to: connection.user_id,
        created_by: connection.user_id,
        title: googleEvent.summary || "Compromisso do Google",
        description: googleEvent.description || null,
        activity_type: activityFromGoogle(googleEvent.summary),
        status: "confirmed",
        priority: "medium",
        start_at: times.startAt,
        end_at: times.endAt,
        all_day: times.allDay,
        timezone: times.timeZone,
        recurrence_rule: googleEvent.recurrence?.find((rule) => rule.startsWith("RRULE:"))?.replace(/^RRULE:/, "") || null,
        location: googleEvent.location || null,
        visibility: "private",
        source: "google",
        sync_status: "synced",
      }).select("id, sync_version").single();
      if (insertError) throw new Error("google_event_insert_failed");
      await admin.from("calendar_event_mappings").insert({
        organization_id: connection.organization_id,
        connection_id: connection.id,
        external_calendar_id: calendar.id,
        routine_event_id: local.id,
        google_event_id: googleEvent.id,
        google_etag: googleEvent.etag || null,
        google_updated_at: googleEvent.updated || null,
        sync_version: local.sync_version,
        origin: "google",
      });
      imported += 1;
    }
  } while (pageToken);

  if (nextSyncToken) {
    await admin.from("calendar_sync_states").update({
      sync_token_ciphertext: await encryptSecret(nextSyncToken),
      last_incremental_sync_at: syncToken ? new Date().toISOString() : null,
      last_success_at: new Date().toISOString(),
      last_error_code: null,
      retry_count: 0,
      next_retry_at: null,
    }).eq("external_calendar_id", calendar.id);
  }
  await ensureWatch(admin, accessToken, calendar);
  return { imported, cancelled };
}

async function propertyContext(admin: Admin, propertyId: string | null) {
  if (!propertyId) return null;
  const { data } = await admin.from("imoveis").select("bairro, cidade").eq("id", propertyId).maybeSingle();
  return data ? [data.bairro, data.cidade].filter(Boolean).join(" · ") : null;
}

async function googlePayload(admin: Admin, connection: CalendarConnectionRow, event: Record<string, unknown>) {
  const partialLocation = await propertyContext(admin, typeof event.property_id === "string" ? event.property_id : null);
  return buildGoogleEventPayload(event, connection.privacy_mode, partialLocation);
}

async function pushEvent(
  admin: Admin,
  connection: CalendarConnectionRow,
  calendar: ExternalCalendar,
  accessToken: string,
  event: Record<string, unknown>,
  force = false,
) {
  const { data: mapping } = await admin.from("calendar_event_mappings").select("*")
    .eq("connection_id", connection.id).eq("routine_event_id", event.id).maybeSingle();
  if (!force && mapping && Number(mapping.sync_version) >= Number(event.sync_version) && !event.deleted_at && event.status !== "cancelled") {
    return { skipped: true };
  }
  if (event.deleted_at || event.status === "cancelled") {
    if (mapping) {
      const response = await googleRequest(accessToken,
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.external_calendar_id)}/events/${encodeURIComponent(mapping.google_event_id)}`,
        { method: "DELETE" });
      if (!response.ok && ![404, 410].includes(response.status)) throw new Error(`google_delete_failed_${response.status}`);
      await admin.from("calendar_event_mappings").update({ deleted_at: new Date().toISOString(), last_synced_at: new Date().toISOString() }).eq("id", mapping.id);
    }
    return { deleted: true };
  }

  const payload = await googlePayload(admin, connection, event);
  const googleEventId = mapping?.google_event_id || googleEventIdForRoutine(String(event.id));
  const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.external_calendar_id)}/events`;
  let response = await googleRequest(accessToken, `${baseUrl}/${encodeURIComponent(googleEventId)}`, {
    method: "PUT",
    headers: !force && mapping?.google_etag ? { "If-Match": mapping.google_etag } : {},
    body: JSON.stringify({ ...payload, id: googleEventId }),
  });
  if (response.status === 412) {
    await admin.from("routine_events").update({ sync_status: "conflict" }).eq("id", event.id);
    return { conflict: true };
  }
  if (response.status === 404 && !mapping) {
    response = await googleRequest(accessToken, `${baseUrl}?sendUpdates=none`, {
      method: "POST", body: JSON.stringify({ ...payload, id: googleEventId }),
    });
  }
  if (!response.ok) throw new Error(`google_upsert_failed_${response.status}`);
  const googleEvent = await response.json();
  await admin.from("routine_events").update({ sync_status: "synced" }).eq("id", event.id);
  await admin.from("calendar_event_mappings").upsert({
    organization_id: connection.organization_id,
    connection_id: connection.id,
    external_calendar_id: calendar.id,
    routine_event_id: event.id,
    google_event_id: googleEvent.id || googleEventId,
    google_etag: googleEvent.etag || null,
    google_updated_at: googleEvent.updated || null,
    sync_version: event.sync_version,
    origin: event.source || "lotti",
    last_synced_at: new Date().toISOString(),
    deleted_at: null,
  }, { onConflict: "connection_id,routine_event_id" });
  return { pushed: true };
}

async function acceptGoogleVersion(
  admin: Admin,
  connection: CalendarConnectionRow,
  eventId: string,
) {
  const accessToken = await accessTokenForConnection(connection, admin);
  const { data: mapping } = await admin.from("calendar_event_mappings").select("*")
    .eq("connection_id", connection.id)
    .eq("routine_event_id", eventId)
    .maybeSingle();
  if (!mapping) throw new Error("calendar_mapping_missing");
  const { data: calendar } = await admin.from("external_calendars").select("*")
    .eq("id", mapping.external_calendar_id)
    .eq("connection_id", connection.id)
    .single();
  if (!calendar) throw new Error("external_calendar_missing");
  const response = await googleRequest(
    accessToken,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.external_calendar_id)}/events/${encodeURIComponent(mapping.google_event_id)}`,
  );
  if (response.status === 404 || response.status === 410) {
    const { data: local } = await admin.from("routine_events").update({
      status: "cancelled", deleted_at: new Date().toISOString(), sync_status: "synced",
    }).eq("id", eventId).eq("organization_id", connection.organization_id).select("sync_version").single();
    await admin.from("calendar_event_mappings").update({
      deleted_at: new Date().toISOString(), sync_version: local?.sync_version || mapping.sync_version,
      last_synced_at: new Date().toISOString(),
    }).eq("id", mapping.id);
    return { accepted: "google", cancelled: true };
  }
  if (!response.ok) throw new Error(`google_event_get_failed_${response.status}`);
  const googleEvent = await response.json() as GoogleCalendarEvent;
  if (googleEvent.status === "cancelled") {
    const { data: local } = await admin.from("routine_events").update({
      status: "cancelled", deleted_at: new Date().toISOString(), sync_status: "synced",
    }).eq("id", eventId).eq("organization_id", connection.organization_id).select("sync_version").single();
    await admin.from("calendar_event_mappings").update({
      deleted_at: new Date().toISOString(), sync_version: local?.sync_version || mapping.sync_version,
      google_etag: googleEvent.etag || null, google_updated_at: googleEvent.updated || null,
      last_synced_at: new Date().toISOString(),
    }).eq("id", mapping.id);
    return { accepted: "google", cancelled: true };
  }
  const times = googleTimes(googleEvent, "America/Sao_Paulo");
  if (!times) throw new Error("google_event_times_missing");
  const { data: local, error } = await admin.from("routine_events").update({
    title: googleEvent.summary || "Compromisso do Google",
    description: googleEvent.description || null,
    location: googleEvent.location || null,
    activity_type: activityFromGoogle(googleEvent.summary),
    start_at: times.startAt,
    end_at: times.endAt,
    all_day: times.allDay,
    timezone: times.timeZone,
    recurrence_rule: googleEvent.recurrence?.find((rule) => rule.startsWith("RRULE:"))?.replace(/^RRULE:/, "") || null,
    status: googleEvent.status === "cancelled" ? "cancelled" : "confirmed",
    visibility: "private",
    source: "google",
    sync_status: "synced",
    deleted_at: googleEvent.status === "cancelled" ? new Date().toISOString() : null,
  }).eq("id", eventId).eq("organization_id", connection.organization_id).select("sync_version").single();
  if (error) throw new Error("google_conflict_apply_failed");
  await admin.from("calendar_event_mappings").update({
    google_etag: googleEvent.etag || null,
    google_updated_at: googleEvent.updated || null,
    sync_version: local.sync_version,
    last_synced_at: new Date().toISOString(),
    deleted_at: googleEvent.status === "cancelled" ? new Date().toISOString() : null,
  }).eq("id", mapping.id);
  return { accepted: "google", cancelled: googleEvent.status === "cancelled" };
}

async function syncConnection(admin: Admin, connection: CalendarConnectionRow, targetEventId?: string, force = false) {
  const accessToken = await accessTokenForConnection(connection, admin);
  const { data: calendars } = await admin.from("external_calendars").select("*")
    .eq("connection_id", connection.id).eq("selected", true).neq("sync_direction", "disabled");
  let imported = 0;
  let cancelled = 0;
  let pushed = 0;
  let conflicts = 0;
  for (const calendar of (calendars || []) as ExternalCalendar[]) {
    if (!targetEventId && ["import_only", "bidirectional"].includes(calendar.sync_direction)) {
      const result = await pullCalendar(admin, connection, calendar, accessToken);
      imported += result.imported;
      cancelled += result.cancelled;
    }
  }
  const destination = ((calendars || []) as ExternalCalendar[]).find((calendar) =>
    ["export_only", "bidirectional"].includes(calendar.sync_direction) && (calendar.is_default || calendar.is_primary)
  ) || ((calendars || []) as ExternalCalendar[]).find((calendar) => ["export_only", "bidirectional"].includes(calendar.sync_direction));
  if (destination) {
    let eventQuery = admin.from("routine_events").select("*")
      .eq("organization_id", connection.organization_id).eq("assigned_to", connection.user_id);
    if (targetEventId) eventQuery = eventQuery.eq("id", targetEventId);
    const { data: events, error } = await eventQuery.limit(targetEventId ? 1 : 1000);
    if (error) throw new Error("local_events_load_failed");
    for (const event of events || []) {
      const result = await pushEvent(admin, connection, destination, accessToken, event, force);
      if (result.pushed || result.deleted) pushed += 1;
      if (result.conflict) conflicts += 1;
    }
  }
  await admin.from("calendar_connections").update({
    status: "connected", last_sync_at: new Date().toISOString(), last_error_code: null,
  }).eq("id", connection.id);
  return { imported, cancelled, pushed, conflicts };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: routineCorsHeaders });
  if (req.method !== "POST") return routineJson({ error: "Method not allowed" }, 405);
  const admin = adminClient();
  let connectionId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const internal = req.headers.has("x-routine-internal-secret");
    let connection: CalendarConnectionRow | null = null;

    if (internal) {
      requireInternalSecret(req);
      if (body.action === "maintain") {
        const { data: connections } = await admin.from("calendar_connections").select("*").eq("status", "connected");
        const results = [];
        for (const item of connections || []) {
          try { results.push({ id: item.id, ...(await syncConnection(admin, item as CalendarConnectionRow)) }); }
          catch (error) { results.push({ id: item.id, error: safeErrorCode(error) }); }
        }
        return routineJson({ maintained: results.length, results });
      }
      if (body.external_calendar_id) {
        const { data: calendar } = await admin.from("external_calendars").select("connection_id").eq("id", body.external_calendar_id).single();
        connectionId = calendar?.connection_id || null;
      } else connectionId = body.connection_id || null;
      const { data } = await admin.from("calendar_connections").select("*").eq("id", connectionId).eq("status", "connected").maybeSingle();
      connection = data as CalendarConnectionRow | null;
    } else {
      const { user, membership } = await requireRoutineUser(req);
      const { data } = await admin.from("calendar_connections").select("*")
        .eq("organization_id", membership.organization_id).eq("user_id", user.id).eq("status", "connected").maybeSingle();
      connection = data as CalendarConnectionRow | null;
    }
    if (!connection) return routineJson({ error: "Google Agenda não conectado." }, 409);
    connectionId = connection.id;

    if (body.action === "webhook" && body.external_calendar_id) {
      const accessToken = await accessTokenForConnection(connection, admin);
      const { data: calendar } = await admin.from("external_calendars").select("*").eq("id", body.external_calendar_id).single();
      const result = await pullCalendar(admin, connection, calendar as ExternalCalendar, accessToken);
      return routineJson({ synced: true, ...result });
    }
    if (body.action === "resolve_conflict_google" && body.event_id) {
      return routineJson({ synced: true, ...(await acceptGoogleVersion(admin, connection, body.event_id)) });
    }
    const targetEventId = ["push_event", "resolve_conflict_lotti"].includes(body.action) ? body.event_id : undefined;
    const result = await syncConnection(admin, connection, targetEventId, body.action === "resolve_conflict_lotti");
    return routineJson({ synced: true, ...result });
  } catch (error) {
    const code = safeErrorCode(error);
    if (connectionId) await admin.from("calendar_connections").update({ last_error_code: code }).eq("id", connectionId);
    console.error("google-calendar-sync:", code);
    const status = Number((error as { status?: number }).status) || 500;
    return routineJson({ error: status === 500 ? "A sincronização ficou pendente e será tentada novamente." : "Sua sessão não autoriza esta ação." }, status);
  }
});
