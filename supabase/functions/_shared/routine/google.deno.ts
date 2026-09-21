import { assertEquals, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  accessTokenForConnection, decryptSecret, encryptSecret, googleRequest,
  isDuplicateReceiptError, sha256, type CalendarConnectionRow,
} from "./google.ts";

const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index + 1)));

Deno.test("Google secrets use authenticated encryption and round-trip", async () => {
  Deno.env.set("GOOGLE_TOKEN_ENCRYPTION_KEY", KEY);
  const first = await encryptSecret("refresh-token-sensitive");
  const second = await encryptSecret("refresh-token-sensitive");
  assertNotEquals(first, "refresh-token-sensitive");
  assertNotEquals(first, second); // IV aleatório: ciphertext não é determinístico.
  assertEquals(await decryptSecret(first), "refresh-token-sensitive");
});

Deno.test("valid access token is reused without network refresh", async () => {
  Deno.env.set("GOOGLE_TOKEN_ENCRYPTION_KEY", KEY);
  const connection = {
    id: "connection-1",
    organization_id: "org-1",
    user_id: "user-1",
    access_token_ciphertext: await encryptSecret("still-valid"),
    refresh_token_ciphertext: await encryptSecret("refresh"),
    token_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    privacy_mode: "partial",
    status: "connected",
  } satisfies CalendarConnectionRow;
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => { called = true; throw new Error("must not fetch"); }) as typeof fetch;
  try {
    assertEquals(await accessTokenForConnection(connection), "still-valid");
    assertEquals(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("expired access token is refreshed and stored encrypted", async () => {
  Deno.env.set("GOOGLE_TOKEN_ENCRYPTION_KEY", KEY);
  Deno.env.set("GOOGLE_CALENDAR_CLIENT_ID", "client-id");
  Deno.env.set("GOOGLE_CALENDAR_CLIENT_SECRET", "client-secret");
  const connection = {
    id: "connection-2",
    organization_id: "org-1",
    user_id: "user-1",
    access_token_ciphertext: await encryptSecret("expired"),
    refresh_token_ciphertext: await encryptSecret("refresh-token"),
    token_expires_at: new Date(Date.now() - 60_000).toISOString(),
    privacy_mode: "partial",
    status: "connected",
  } satisfies CalendarConnectionRow;
  const updates: Record<string, unknown>[] = [];
  const admin = {
    from: () => ({
      update: (value: Record<string, unknown>) => ({
        eq: async () => { updates.push(value); return { error: null }; },
      }),
    }),
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    assertEquals(String(init?.body).includes("refresh-token"), true);
    return new Response(JSON.stringify({ access_token: "fresh-access", expires_in: 3600 }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    assertEquals(await accessTokenForConnection(connection, admin as never), "fresh-access");
    assertEquals(updates.length, 1);
    assertEquals(await decryptSecret(String(updates[0].access_token_ciphertext)), "fresh-access");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("temporary Google failure retries with backoff", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1 ? new Response("busy", { status: 503 }) : new Response("ok", { status: 200 });
  }) as typeof fetch;
  try {
    const response = await googleRequest("token", "https://example.test", {}, 1);
    assertEquals(response.status, 200);
    assertEquals(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("webhook duplicate is recognized by unique-violation code", () => {
  assertEquals(isDuplicateReceiptError({ code: "23505" }), true);
  assertEquals(isDuplicateReceiptError({ code: "42501" }), false);
  assertEquals(isDuplicateReceiptError(null), false);
});

Deno.test("OAuth state and webhook tokens are stored only as hashes", async () => {
  const hash = await sha256("state-secret");
  assertNotEquals(hash, "state-secret");
  assertEquals(hash, await sha256("state-secret"));
});
