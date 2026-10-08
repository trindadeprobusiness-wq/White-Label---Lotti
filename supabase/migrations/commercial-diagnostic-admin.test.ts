import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

let db: PGlite;
const sql = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const lead = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
const token = 'a'.repeat(64);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.admin',true),'false')='true' $$;`);
  await db.exec(sql('20261007191137_diagnostic_conversational_mvp.sql'));
  await db.exec(sql('20261007191140_diagnostic_admin.sql'));
  await db.query(`INSERT INTO diagnostic_leads(id,name,email,company,segment) VALUES($1,'Pessoa QA','pessoa@example.test','Empresa QA','real_estate')`, [lead]);
  await db.query(`INSERT INTO diagnostic_sessions(id,lead_id,token_hash,status,utm_source,score,temperature,completed_at) VALUES($1,$2,$3,'completed','instagram',12,'HOT',now())`, [session, lead, token]);
  await db.query(`INSERT INTO diagnostic_events(session_id,event_type) VALUES($1,'cta_clicked')`, [session]);
  await db.query(`INSERT INTO diagnostic_sessions(id,token_hash,status,last_activity_at,source) VALUES(gen_random_uuid(),$1,'started',now()-interval '25 hours','direct')`, [token]);
}, 30_000);
afterAll(async () => { await db?.close(); });

async function list(args = '') {
  const result = await db.query<{ value: { total: number; items: Record<string, unknown>[]; metrics: Record<string, number>; dropoff: unknown[] } }>(`SELECT diagnostic_admin_list(${args}) AS value`);
  return result.rows[0].value;
}

describe('diagnostic admin with real Postgres policies', () => {
  it('denies anonymous and ordinary authenticated callers', async () => {
    await db.exec('SET ROLE anon');
    await expect(list()).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE; SET ROLE authenticated');
    await expect(list()).rejects.toThrow(/acesso negado/);
    await db.exec('RESET ROLE');
  });
  it('returns funnel metrics without session tokens and derives abandonment without unload', async () => {
    await db.exec("SET test.admin='true'; SET ROLE authenticated");
    const result = await list();
    expect(result.total).toBe(2);
    expect(result.metrics).toMatchObject({ started: 2, contacts: 1, completed: 1, abandoned: 1, hot: 1, cta: 1 });
    expect(JSON.stringify(result)).not.toContain('token_hash');
    expect(JSON.stringify(result)).not.toContain(token);
    expect(result.dropoff).toEqual([{ question_id: 'before_name', count: 1 }]);
    await db.exec('RESET ROLE');
  });
  it('filters all metrics and pages on the server', async () => {
    const result = await list("_segment => 'real_estate', _source => 'instagram', _temperature => 'HOT', _search => 'Pessoa'");
    expect(result.total).toBe(1);
    expect(result.metrics).toMatchObject({ started: 1, contacts: 1, abandoned: 0 });
    expect((await list('_offset => 1, _limit => 1')).items).toHaveLength(1);
    expect((await list("_search => 'nothing'")).items).toHaveLength(0);
    await expect(list('_limit => 1000')).rejects.toThrow(/filtro inválido/);
  });
});
