import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { getQuestions } from '../_shared/diagnostic/engine.ts';
import type { Answers } from '../_shared/diagnostic/types.ts';
import { createDiagnosticHandler } from './handler.ts';

let db: PGlite;
const sql = (name: string) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
const token = 'b'.repeat(64);
type SnapshotView = {
  session: { id: string; status: string; version: number };
  answers: Record<string, unknown>;
  next_question: { id: string } | null;
  summary: Record<string, unknown> | null;
  [key: string]: unknown;
};
const ids = {
  abandoned: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  property: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  other: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;`);
  await db.exec(sql('20261007191137_diagnostic_conversational_mvp.sql'));
  await db.exec(sql('20261007191140_diagnostic_admin.sql'));
  await db.exec(sql('20261008000000_diagnostic_abandonment_notifications.sql'));
}, 30_000);
afterAll(async () => { await db?.close(); });

const client = {
  async rpc(name: string, args: Record<string, unknown> = {}) {
    const entries = Object.entries(args);
    const parameters = entries.map(([, value]) => value && typeof value === 'object' ? JSON.stringify(value) : value);
    const named = entries.map(([key], index) => `${key} => $${index + 1}`).join(', ');
    try {
      const query = name === 'diagnostic_claim_notifications'
        ? `SELECT coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) AS value FROM public.${name}(${named}) n`
        : `SELECT public.${name}(${named}) AS value`;
      const result = await db.query(query, parameters as (string | number | boolean | null)[]);
      return { data: result.rows[0]?.value ?? null, error: null };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : 'database error' } };
    }
  },
};
const handler = createDiagnosticHandler({
  client, env: { DIAGNOSTIC_RATE_LIMIT_SECRET: 'local-qa-rate-limit-secret-at-least-32-bytes' },
});

async function post(sessionId: string, payload: Record<string, unknown>) {
  const response = await handler(new Request('https://local.test/diagnostic', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.15' },
    body: JSON.stringify({ ...payload, session_id: sessionId, token }),
  }));
  return { status: response.status, body: await response.json() as SnapshotView };
}

async function answer(sessionId: string, snapshot: SnapshotView, questionId: string, value: unknown) {
  return post(sessionId, { action: 'answer', version: snapshot.session.version, question_id: questionId, answer: value });
}

describe('diagnostic HTTP handler with the production PostgreSQL migrations', () => {
  it('persists name and phone immediately and can mark the unfinished session abandoned', async () => {
    let result = await post(ids.abandoned, { action: 'start', consent: true, tracking: { utm_source: 'qa', utm_campaign: 'abandon', referrer: 'https://example.test/landing?private=1' } });
    expect(result.status).toBe(200);
    result = await answer(ids.abandoned, result.body, 'name', 'Ana QA');
    result = await answer(ids.abandoned, result.body, 'contact', '(62) 99999-9999');
    const lead = await db.query<{ name: string; phone: string; status: string }>('SELECT name,phone,status FROM diagnostic_leads');
    expect(lead.rows[0]).toMatchObject({ name: 'Ana QA', phone: '+5562999999999', status: 'lead_iniciado' });
    expect(result.body.session.status).toBe('contact_captured');
    expect(await db.query('SELECT kind FROM diagnostic_notifications WHERE session_id=$1', [ids.abandoned])).toMatchObject({ rows: [{ kind: 'started' }] });
    await db.query("UPDATE diagnostic_sessions SET last_activity_at=now()-interval '9 minutes' WHERE id=$1", [ids.abandoned]);
    expect((await client.rpc('diagnostic_maintenance')).data).toBe(0);
    await db.query("UPDATE diagnostic_sessions SET last_activity_at=now()-interval '10 minutes 1 second' WHERE id=$1", [ids.abandoned]);
    const maintenance = await client.rpc('diagnostic_maintenance');
    expect(maintenance.data).toBe(1);
    expect((await db.query('SELECT status FROM diagnostic_sessions WHERE id=$1', [ids.abandoned])).rows[0].status).toBe('abandoned');
    await client.rpc('diagnostic_maintenance');
    expect((await db.query("SELECT count(*)::int AS total FROM diagnostic_notifications WHERE session_id=$1 AND kind='abandoned'", [ids.abandoned])).rows[0].total).toBe(1);
    result = await post(ids.abandoned, { action: 'resume' });
    expect(result.body.session.status).toBe('in_progress');
    expect(result.body.answers).toMatchObject({ name: 'Ana QA', contact: '+5562999999999' });
    const claim = await client.rpc('diagnostic_claim_notifications', { p_session: ids.abandoned });
    expect((claim.data as { kind: string }[]).map(row => row.kind)).toEqual(['started']);
    result = await answer(ids.abandoned, result.body, 'company', 'Empresa após retomada');
    await db.query("UPDATE diagnostic_sessions SET last_activity_at=now()-interval '11 minutes' WHERE id=$1", [ids.abandoned]);
    await client.rpc('diagnostic_maintenance');
    const partial = await client.rpc('diagnostic_claim_notifications', { p_session: ids.abandoned });
    expect(partial.data).toMatchObject([{ kind: 'abandoned', payload: { answers: { company: 'Empresa após retomada' } } }]);
  });

  it('completes the real-estate branch, computes score, summary, UTM and unique notification outbox rows', async () => {
    let snapshot = (await post(ids.property, { action: 'start', consent: true, tracking: { utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'real-estate', utm_content: 'video', utm_term: 'growth' } })).body;
    const values: Record<string, unknown> = {
      name: 'Gabriel QA', contact: 'gabriel.qa@example.test', company: 'Imobiliária QA', segment: 'real_estate',
      real_estate_type: 'agency', brokers: '12', listings: '320', revenue: '100k_300k', acquisition: ['instagram','meta_ads'],
      paid_media: 'yes', paid_budget: '3k_10k', content: 'weekly', lead_intake: ['whatsapp','crm'], lead_attribution: 'no',
      response_time: 'same_day', funnel_tracking: 'no', bottleneck: 'follow_up', goal: 'Organizar o acompanhamento de cada lead',
      urgency: 'now', decision: 'yes', conversation: 'yes',
    } satisfies Answers;
    while (snapshot.next_question) {
      const id = snapshot.next_question.id;
      const result = await answer(ids.property, snapshot, id, values[id]);
      expect(result.status, JSON.stringify({ id, body: result.body })).toBe(200);
      snapshot = result.body;
    }
    const result = await post(ids.property, { action: 'complete', version: snapshot.session.version });
    expect(result.status).toBe(200);
    expect(result.body.session.status).toBe('completed');
    expect(result.body.summary).toMatchObject({ primary_bottleneck: 'follow_up', source: 'rules' });
    expect(result.body.summary.user_message).toContain('Gabriel');
    const session = await db.query<{ score: number; temperature: string; utm_source: string; utm_term: string }>(
      'SELECT score,temperature,utm_source,utm_term FROM diagnostic_sessions WHERE id=$1', [ids.property]);
    expect(session.rows[0]).toMatchObject({ score: 16, temperature: 'HOT', utm_source: 'instagram', utm_term: 'growth' });
    const notifications = await db.query<{ kind: string }>('SELECT kind FROM diagnostic_notifications WHERE session_id=$1 ORDER BY kind', [ids.property]);
    expect(notifications.rows.map(row => row.kind)).toEqual(['completed','started']);
    await db.query("INSERT INTO diagnostic_notifications(session_id,kind,payload) VALUES ($1,'abandoned',diagnostic_snapshot($1))", [ids.property]);
    const claim = await client.rpc('diagnostic_claim_notifications', { p_session: ids.property });
    expect((claim.data as { kind: string }[]).map(row => row.kind).sort()).toEqual(['completed','started']);
    expect((await db.query("SELECT status,last_error FROM diagnostic_notifications WHERE session_id=$1 AND kind='abandoned'", [ids.property])).rows[0]).toMatchObject({ status: 'dead', last_error: 'session_completed' });
    expect(getQuestions({ segment: 'real_estate' }).map(item => item.id)).toContain('real_estate_type');
  });

  it('does not present property questions for another segment', async () => {
    let snapshot = (await post(ids.other, { action: 'start', consent: true })).body;
    const answers: Record<string, unknown> = {
      name: 'Jo Teste', contact: 'jo@example.test', company: 'Studio QA', segment: 'services',
      city: 'Goiânia', offer: 'Consultoria de marketing',
    };
    while (snapshot.next_question && snapshot.next_question.id !== 'revenue') {
      const id = snapshot.next_question.id;
      const result = await answer(ids.other, snapshot, id, answers[id]);
      expect(result.status, JSON.stringify({ id, body: result.body })).toBe(200);
      snapshot = result.body;
    }
    expect(snapshot.next_question.id).toBe('revenue');
    expect(snapshot.answers).not.toHaveProperty('real_estate_type');
    expect(snapshot.answers).not.toHaveProperty('brokers');
  });

  it('does not queue a partial notification before a recoverable contact exists', async () => {
    const sessionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    let result = await post(sessionId, { action: 'start', consent: true });
    result = await answer(sessionId, result.body, 'name', 'Sem contato');
    expect(result.status).toBe(200);
    await db.query("UPDATE diagnostic_sessions SET last_activity_at=now()-interval '11 minutes' WHERE id=$1", [sessionId]);
    await client.rpc('diagnostic_maintenance');
    expect((await db.query('SELECT count(*)::int AS total FROM diagnostic_notifications WHERE session_id=$1', [sessionId])).rows[0].total).toBe(0);
  });
});
