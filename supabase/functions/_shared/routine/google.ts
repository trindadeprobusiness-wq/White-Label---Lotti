import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const routineCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-routine-internal-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function routineJson(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...routineCorsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomToken(size = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

function encryptionKeyBytes(): Uint8Array {
  const raw = Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY")?.trim();
  if (!raw) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY not configured");
  const bytes = /^[0-9a-f]{64}$/i.test(raw)
    ? Uint8Array.from(raw.match(/.{2}/g)!.map((pair) => parseInt(pair, 16)))
    : base64ToBytes(raw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(raw.length / 4) * 4, "="));
  if (bytes.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must contain 32 bytes");
  return bytes;
}

async function aesKey() {
  const bytes = encryptionKeyBytes();
  return crypto.subtle.importKey("raw", bytes.buffer as ArrayBuffer, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(),
    new TextEncoder().encode(value),
  ));
  const payload = new Uint8Array(iv.length + encrypted.length);
  payload.set(iv);
  payload.set(encrypted, iv.length);
  return `v1.${bytesToBase64(payload)}`;
}

export async function decryptSecret(value: string | null | undefined): Promise<string> {
  if (!value?.startsWith("v1.")) throw new Error("encrypted secret missing or unsupported");
  const payload = base64ToBytes(value.slice(3));
  const iv = payload.slice(0, 12);
  const encrypted = payload.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(), encrypted);
  return new TextDecoder().decode(plain);
}

export async function sha256(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function requireRoutineUser(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization) throw Object.assign(new Error("unauthorized"), { status: 401 });
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } },
  );
  const { data: { user }, error } = await userClient.auth.getUser(token);
  if (error || !user) throw Object.assign(new Error("unauthorized"), { status: 401 });
  const { data: membership, error: membershipError } = await userClient
    .from("routine_memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (membershipError || !membership) throw Object.assign(new Error("routine_membership_required"), { status: 403 });
  return { user, membership, userClient };
}

export function requireInternalSecret(req: Request): void {
  const expected = Deno.env.get("ROUTINE_INTERNAL_SECRET");
  const received = req.headers.get("x-routine-internal-secret");
  if (!expected || !received || received !== expected) {
    throw Object.assign(new Error("unauthorized"), { status: 401 });
  }
}

export function googleClientConfig() {
  const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");
  const redirectUri = Deno.env.get("GOOGLE_CALENDAR_REDIRECT_URI")
    || `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-calendar-auth/callback`;
  if (!clientId || !clientSecret) throw new Error("Google Calendar OAuth not configured");
  return { clientId, clientSecret, redirectUri };
}

export interface CalendarConnectionRow {
  id: string;
  organization_id: string;
  user_id: string;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
  privacy_mode: "full" | "partial" | "busy_only";
  status: string;
}

export async function accessTokenForConnection(
  connection: CalendarConnectionRow,
  admin?: ReturnType<typeof adminClient>,
): Promise<string> {
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (connection.access_token_ciphertext && expiresAt > Date.now() + 60_000) {
    return decryptSecret(connection.access_token_ciphertext);
  }
  const client = admin ?? adminClient();
  if (!connection.refresh_token_ciphertext) {
    await client.from("calendar_connections").update({ status: "expired", last_error_code: "refresh_token_missing" }).eq("id", connection.id);
    throw new Error("refresh_token_missing");
  }
  const { clientId, clientSecret } = googleClientConfig();
  const refreshToken = await decryptSecret(connection.refresh_token_ciphertext);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    const code = payload.error === "invalid_grant" ? "refresh_token_revoked" : "refresh_failed";
    await client.from("calendar_connections").update({ status: "expired", last_error_code: code }).eq("id", connection.id);
    throw new Error(code);
  }
  const expires = new Date(Date.now() + Number(payload.expires_in || 3600) * 1000).toISOString();
  await client.from("calendar_connections").update({
    access_token_ciphertext: await encryptSecret(payload.access_token),
    token_expires_at: expires,
    status: "connected",
    last_error_code: null,
  }).eq("id", connection.id);
  return payload.access_token;
}

export async function googleRequest(
  accessToken: string,
  url: string,
  init: RequestInit = {},
  retries = 2,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    if (attempt >= retries || ![408, 429, 500, 502, 503, 504].includes(response.status)) return response;
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 300 * (2 ** attempt) + Math.floor(Math.random() * 100)));
  }
}

export function safeErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : "unknown";
  return /^[a-z0-9_]{1,80}$/i.test(value) ? value : "unexpected_error";
}

export function isDuplicateReceiptError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}
