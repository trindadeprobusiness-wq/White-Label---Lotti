import { describe, expect, it } from 'vitest';
import { buildSummary } from '../_shared/diagnostic/engine.ts';
import { drainNotifications, notificationHtml, notificationText, type Notification } from './notifications.ts';

const row: Notification = {
  id: 'notification', session_id: 'session', kind: 'completed', lease_id: 'lease',
  payload: {
    session: { id: 'session', status: 'completed', started_at: '2026-10-07T15:00:00Z', last_activity_at: '2026-10-07T15:05:00Z', completed_at: '2026-10-07T15:05:00Z', version: 15, score: 12, temperature: 'HOT', utm_source: 'instagram', utm_term: 'growth' },
    lead: { name: 'Pessoa <script>alert(1)</script>', phone: '+5562999999999', email: null, company: 'Empresa QA', segment: 'services' },
    answers: { name: 'Pessoa QA', bottleneck: 'follow_up', goal: 'Organizar atendimento', revenue: '100k_300k', decision: 'yes' },
    summary: buildSummary({ bottleneck: 'follow_up', goal: 'Organizar atendimento', conversation: 'yes' }),
  },
};
describe('organized diagnostic notifications', () => {
  it('includes answers, attribution, localized commercial labels and escaped HTML', () => {
    const text = notificationText(row, 'https://example.test');
    expect(text).toContain('UTM term: growth');
    expect(text).toContain('Decisor: Sim');
    expect(text).toContain('RESPOSTAS SALVAS:');
    expect(text).toContain('/admin/diagnosticos/session');
    expect(notificationHtml(row)).toContain('&lt;script&gt;');
    expect(notificationHtml(row)).not.toContain('<script>');
  });
  it('labels an incomplete contact-only diagnostic without inventing a bottleneck', () => {
    const partial = { ...row, kind: 'abandoned' as const, payload: { ...row.payload, answers: { name: 'Pessoa QA', contact: '+5562999999999' }, summary: null } };
    const text = notificationText(partial);
    expect(text).toContain('10 minutos');
    expect(text).toContain('Ainda não há respostas suficientes');
    expect(text).toContain('Principal gargalo: Não identificado');
    expect(text).toContain('Classificação parcial: HOT');
  });
  it('sends text + HTML to configured recipient with stable deduplication and records provider failure', async () => {
    const finishes: Record<string, unknown>[] = [];
    const client = { rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === 'diagnostic_finish_notification') finishes.push(args!);
      return { data: name === 'diagnostic_claim_notifications' ? [row] : true, error: null };
    } };
    const requests: RequestInit[] = [];
    const send = async (_url: RequestInfo | URL, init?: RequestInit) => { requests.push(init!); return new Response('{}', { status: requests.length === 1 ? 200 : 429 }); };
    const config = { apiKey: 'local-test-key', from: 'sender@example.test', to: 'operator@example.test', fetch: send };
    expect(await drainNotifications(client, config)).toEqual({ sent: 1, failed: 0 });
    expect(await drainNotifications(client, config)).toEqual({ sent: 0, failed: 1 });
    const payload = JSON.parse(requests[0].body as string);
    expect(payload.to).toEqual(['operator@example.test']);
    expect(payload.html).toContain('<html');
    expect(payload.text).toContain('RESPOSTAS SALVAS:');
    expect(new Headers(requests[0].headers).get('Idempotency-Key')).toBe(new Headers(requests[1].headers).get('Idempotency-Key'));
    expect(finishes[1]).toMatchObject({ p_success: false, p_error: 'provider_http_429' });
  });
});
