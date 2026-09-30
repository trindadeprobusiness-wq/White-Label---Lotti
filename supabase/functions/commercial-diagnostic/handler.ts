import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.89.0';
import { consumeLeadLimit, PublicRequestError, readPublicJson } from '../_shared/public-request.ts';
import { scoreDiagnostic, validateAnswers, questions } from '../_shared/commercial-diagnostic.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eventNames = ['diagnostic_started','profile_selected','diagnostic_step_completed','diagnostic_abandoned','cta_clicked'];
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
const response = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const hash = async (secret: string, value: string) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
};

export function createCommercialDiagnosticHandler(client: Pick<SupabaseClient, 'from' | 'rpc'>, rateSecret: string) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return response({ error: 'Método não permitido.' }, 405);
    try {
      const data = await readPublicJson(req, 16_384) as Record<string, unknown>;
      if (!data || typeof data !== 'object' || Array.isArray(data) || !uuid.test(String(data.session_id))) throw new PublicRequestError(400, 'Dados inválidos.');
      const sessionId = String(data.session_id);
      if (data.action === 'event') {
        const event = text(data.event, 40);
        const step = text(data.step, 40);
        if (!eventNames.includes(event) || (step && !questions.some(q => q.id === step))) throw new PublicRequestError(400, 'Evento inválido.');
        const key = await hash(rateSecret, `diagnostic-event:${sessionId}`);
        const limited = await client.rpc('consume_public_request_limit', { _scope: 'commercial-diagnostic-event', _subject_hash: key, _limit: 50, _seconds: 3600 });
        if (limited.error || limited.data !== true) throw new PublicRequestError(429, 'Muitas tentativas.');
        const { error } = await client.from('commercial_diagnostic_events').insert({ session_id: sessionId, event, step: step || null });
        if (error) throw error;
        if (event === 'cta_clicked') await client.from('commercial_diagnostics').update({ cta_clicked_at: new Date().toISOString() }).eq('session_id', sessionId);
        return response({ success: true });
      }
      if (data.action !== 'submit') throw new PublicRequestError(400, 'Ação inválida.');
      if (data.consent !== true) throw new PublicRequestError(400, 'Confirme o uso dos dados para contato.');
      const name = text(data.name, 120);
      const digits = text(data.phone, 32).replace(/\D/g, '');
      const local = digits.startsWith('55') && [12, 13].includes(digits.length) ? digits.slice(2) : digits;
      const email = text(data.email, 254);
      const city = text(data.city, 120);
      const company = text(data.company, 120);
      if (name.length < 2 || !/^[1-9]\d{9,10}$/.test(local) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new PublicRequestError(400, 'Confira nome, WhatsApp e e-mail.');
      const answers = validateAnswers(data.answers);
      await consumeLeadLimit(client, `55${local}`, rateSecret);
      const attribution: Record<string, string> = {};
      if (data.attribution && typeof data.attribution === 'object' && !Array.isArray(data.attribution)) {
        const incoming = data.attribution as Record<string, unknown>;
        for (const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','landing_page','referrer']) {
          const value = text(incoming[key], 300);
          if (value) attribution[key] = value;
        }
      }
      const scored = scoreDiagnostic(answers);
      const { error } = await client.from('commercial_diagnostics').insert({
        session_id: sessionId, name, phone: `55${local}`, email: email || null, city: city || null, company: company || null,
        consent_at: new Date().toISOString(), answers, attribution, scores: scored,
        dominant_problem: scored.dominant_problem, secondary_problems: scored.secondary_problems,
        urgency_label: scored.urgency_label, profile_label: scored.profile_label, recommended_next_step: scored.recommended_next_step,
      });
      if (error && error.code !== '23505') throw error;
      if (!error) {
        await client.from('commercial_diagnostic_events').insert([
          { session_id: sessionId, event: 'diagnostic_completed' },
          ...(scored.commercial_fit_score >= 60 ? [{ session_id: sessionId, event: 'qualified_lead' }] : []),
        ]);
      }
      return response({ success: true, result: scored });
    } catch (error) {
      if (error instanceof PublicRequestError) return response({ error: error.message }, error.status);
      if (error instanceof Error && /Respostas inválidas|Resposta inválida|Responda todas/.test(error.message)) return response({ error: error.message }, 400);
      console.error('[commercial-diagnostic] Falha de persistência', error);
      return response({ error: 'Não foi possível salvar agora. Tente novamente.' }, 500);
    }
  };
}
