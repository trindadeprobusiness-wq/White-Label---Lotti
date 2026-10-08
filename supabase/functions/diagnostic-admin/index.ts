import { createClient } from 'npm:@supabase/supabase-js@2.89.0';
import { createDiagnosticAdminHandler } from './handler.ts';
const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const authApiUrl = Deno.env.get('DIAGNOSTIC_AUTH_API_URL');
if (!url || !key || !authApiUrl) throw new Error('Missing diagnostic admin configuration');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createDiagnosticAdminHandler({ client, authApiUrl }));
