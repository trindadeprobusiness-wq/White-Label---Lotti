import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';
import { createCommercialDiagnosticHandler } from './handler.ts';

const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey);
serve(createCommercialDiagnosticHandler(client, Deno.env.get('PUBLIC_RATE_LIMIT_SECRET') || serviceKey));
