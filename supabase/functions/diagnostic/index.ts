import { createClient } from 'npm:@supabase/supabase-js@2.89.0';
import { createDiagnosticHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!url || !serviceKey) throw new Error('Missing Supabase service configuration');

const client = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { 'X-Client-Info': 'diagnostic-edge-function' } },
});

Deno.serve(createDiagnosticHandler({
  client,
  env: Object.fromEntries([
    'SUPABASE_SERVICE_ROLE_KEY', 'DIAGNOSTIC_RATE_LIMIT_SECRET',
    'EMAIL_PROVIDER', 'EMAIL_API_KEY', 'RESEND_API_KEY', 'EMAIL_FROM', 'LEAD_NOTIFICATION_EMAIL',
    'DIAGNOSTIC_PUBLIC_URL', 'DIAGNOSTIC_AI_ENABLED', 'DIAGNOSTIC_AI_DAILY_LIMIT',
  ].map(key => [key, Deno.env.get(key)])),
  schedule: task => EdgeRuntime.waitUntil(task),
}));
