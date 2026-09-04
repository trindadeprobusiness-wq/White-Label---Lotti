import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  accessTokenForConnection, adminClient, decryptSecret, encryptSecret,
  googleClientConfig, googleRequest, randomToken, requireRoutineUser,
  routineCorsHeaders, routineJson, safeErrorCode, sha256,
  type CalendarConnectionRow,
} from "../_shared/routine/google.ts";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

function appRedirect(result: "connected" | "error") {
  const base = Deno.env.get("GOOGLE_CALENDAR_APP_REDIRECT_URL") || "http://localhost:8085/rotina";
  const url = new URL(base);
  url.searchParams.set("google_calendar", result);
  return Response.redirect(url.toString(), 302);
}

async function callback(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code || url.searchParams.get("error")) return appRedirect("error");
  const admin = adminClient();
  const stateHash = await sha256(state);
  const { data: connection, error } = await admin.from("calendar_connections")
    .select("*")
    .eq("oauth_state_hash", stateHash)
    .eq("status", "pending")
    .gt("oauth_expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !connection) return appRedirect("error");

  try {
    const { clientId, clientSecret, redirectUri } = googleClientConfig();
    const verifier = await decryptSecret(connection.pkce_verifier_ciphertext);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) throw new Error("oauth_exchange_failed");

    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = profileResponse.ok ? await profileResponse.json() : {};
    const refreshCiphertext = tokens.refresh_token
      ? await encryptSecret(tokens.refresh_token)
      : connection.refresh_token_ciphertext;
    if (!refreshCiphertext) throw new Error("refresh_token_missing");

    const { error: updateError } = await admin.from("calendar_connections").update({
      provider_account_id: profile.sub || null,
      provider_email: profile.email || null,
      scopes: String(tokens.scope || "").split(/\s+/).filter(Boolean),
      status: "connected",
      access_token_ciphertext: await encryptSecret(tokens.access_token),
      refresh_token_ciphertext: refreshCiphertext,
      token_expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
      oauth_state_hash: null,
      pkce_verifier_ciphertext: null,
      oauth_expires_at: null,
      last_error_code: null,
      disconnected_at: null,
    }).eq("id", connection.id);
    if (updateError) throw new Error("connection_update_failed");

    const calendarsResponse = await googleRequest(
      tokens.access_token,
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&showHidden=false",
    );
    if (!calendarsResponse.ok) throw new Error("calendar_list_failed");
    const calendars = await calendarsResponse.json();
    for (const calendar of calendars.items || []) {
      await admin.from("external_calendars").upsert({
        connection_id: connection.id,
        organization_id: connection.organization_id,
        user_id: connection.user_id,
        external_calendar_id: calendar.id,
        summary: calendar.summaryOverride || calendar.summary || "Google Agenda",
        color: calendar.backgroundColor || null,
        access_role: calendar.accessRole || null,
        selected: calendar.primary || false,
        is_primary: calendar.primary || false,
        is_default: calendar.primary || false,
        sync_direction: calendar.accessRole === "reader" ? "import_only" : "bidirectional",
      }, { onConflict: "connection_id,external_calendar_id" });
    }
    return appRedirect("connected");
  } catch (caught) {
    await admin.from("calendar_connections").update({
      status: "error",
      last_error_code: safeErrorCode(caught),
      oauth_state_hash: null,
      pkce_verifier_ciphertext: null,
    }).eq("id", connection.id);
    return appRedirect("error");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: routineCorsHeaders });
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname.endsWith("/callback")) return callback(req);
  if (req.method !== "POST") return routineJson({ error: "Method not allowed" }, 405);

  try {
    const { user, membership } = await requireRoutineUser(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const admin = adminClient();

    if (action === "start") {
      const state = randomToken(32);
      const verifier = randomToken(64);
      const challenge = await sha256(verifier);
      const { data: existing } = await admin.from("calendar_connections").select("id")
        .eq("organization_id", membership.organization_id).eq("user_id", user.id).eq("provider", "google").maybeSingle();
      const values = {
        organization_id: membership.organization_id,
        user_id: user.id,
        provider: "google",
        status: "pending",
        oauth_state_hash: await sha256(state),
        pkce_verifier_ciphertext: await encryptSecret(verifier),
        oauth_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        last_error_code: null,
      };
      const result = existing
        ? await admin.from("calendar_connections").update(values).eq("id", existing.id)
        : await admin.from("calendar_connections").insert(values);
      if (result.error) throw new Error("connection_prepare_failed");

      const { clientId, redirectUri } = googleClientConfig();
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPES.join(" "),
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "consent select_account",
      }).toString();
      return routineJson({ authorization_url: authUrl.toString() });
    }

    const { data: connection } = await admin.from("calendar_connections").select("*")
      .eq("organization_id", membership.organization_id).eq("user_id", user.id).eq("provider", "google").maybeSingle();

    if (action === "status") {
      if (!connection) return routineJson({ connected: false, status: "not_connected" });
      return routineJson({
        connected: connection.status === "connected",
        status: connection.status,
        provider_email: connection.provider_email,
        privacy_mode: connection.privacy_mode,
        last_sync_at: connection.last_sync_at,
        last_error_code: connection.last_error_code,
      });
    }

    if (action === "configure") {
      if (!connection) return routineJson({ error: "Google Agenda não conectado." }, 409);
      const privacyMode = body.privacy_mode;
      if (!["full", "partial", "busy_only"].includes(privacyMode)) {
        return routineJson({ error: "Invalid privacy mode" }, 400);
      }
      const { error } = await admin.from("calendar_connections").update({ privacy_mode: privacyMode })
        .eq("id", connection.id)
        .eq("organization_id", membership.organization_id)
        .eq("user_id", user.id);
      if (error) throw new Error("privacy_update_failed");
      return routineJson({ configured: true, privacy_mode: privacyMode });
    }

    if (action === "disconnect") {
      if (!connection) return routineJson({ disconnected: true, idempotent: true });
      try {
        const token = await accessTokenForConnection(connection as CalendarConnectionRow, admin);
        const { data: channels } = await admin.from("calendar_watch_channels")
          .select("channel_id, resource_id, external_calendars!inner(connection_id)")
          .eq("external_calendars.connection_id", connection.id);
        for (const channel of channels || []) {
          await googleRequest(token, "https://www.googleapis.com/calendar/v3/channels/stop", {
            method: "POST", body: JSON.stringify({ id: channel.channel_id, resourceId: channel.resource_id }),
          }, 0);
        }
        const rawToken = connection.refresh_token_ciphertext
          ? await decryptSecret(connection.refresh_token_ciphertext)
          : token;
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(rawToken)}`, {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      } catch {
        // Revogação remota é best-effort; a exclusão local abaixo é obrigatória.
      }
      await admin.from("calendar_connections").delete().eq("id", connection.id);
      return routineJson({ disconnected: true });
    }

    return routineJson({ error: "Invalid action" }, 400);
  } catch (error) {
    const status = Number((error as { status?: number }).status) || 500;
    console.error("google-calendar-auth:", safeErrorCode(error));
    return routineJson({ error: status === 500 ? "Não foi possível concluir a conexão." : "Sua sessão não autoriza esta ação." }, status);
  }
});
