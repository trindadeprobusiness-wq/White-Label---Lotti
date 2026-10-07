import { createClient } from 'npm:@supabase/supabase-js@2.89.0';
import { PublicRequestError, readPublicJson } from '../_shared/public-request.ts';
import { runDiagnosticMaintenance } from '../diagnostic/handler.ts';
import type { RpcClient } from '../diagnostic/contracts.ts';

const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function equalSecret(received: string, expected: string): boolean {
  const left = new TextEncoder().encode(received);
  const right = new TextEncoder().encode(expected);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left[index] ^ right[index];
  return diff === 0;
}

export function createNotificationWorker(dependencies: {
  client: RpcClient;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}) {
  return async (request: Request) => {
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
    const expected = dependencies.env.DIAGNOSTIC_WORKER_SECRET || '';
    const authorization = request.headers.get('authorization') || '';
    if (!expected || expected.length < 32 || !authorization.startsWith('Bearer ')
      || !equalSecret(authorization.slice(7), expected)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
    }
    try {
      const body = await readPublicJson(request, 1024) as Record<string, unknown>;
      if (body.action !== 'maintenance') return Response.json({ error: 'Invalid action' }, { status: 400, headers });
      const result = await runDiagnosticMaintenance({
        client: dependencies.client,
        env: dependencies.env,
        notificationFetch: dependencies.fetch,
      });
      return Response.json({ ok: true, ...result }, { headers });
    } catch (error) {
      const status = error instanceof PublicRequestError ? error.status : 503;
      return Response.json({ error: status === 503 ? 'Maintenance unavailable' : 'Invalid request' }, { status, headers });
    }
  };
}

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) throw new Error('Missing Supabase service configuration');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const keys = [
  'DIAGNOSTIC_WORKER_SECRET', 'EMAIL_PROVIDER', 'EMAIL_API_KEY', 'RESEND_API_KEY',
  'EMAIL_FROM', 'LEAD_NOTIFICATION_EMAIL', 'DIAGNOSTIC_PUBLIC_URL',
  'DIAGNOSTIC_AI_ENABLED', 'DIAGNOSTIC_AI_DAILY_LIMIT', 'SUPABASE_SERVICE_ROLE_KEY',
];
Deno.serve(createNotificationWorker({
  client,
  env: Object.fromEntries(keys.map(name => [name, Deno.env.get(name)])),
}));
