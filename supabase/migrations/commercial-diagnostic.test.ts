import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('migration commercial_diagnostic', () => {
  it('cria armazenamento e restringe leitura ao admin autenticado', async () => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
        CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
        CREATE FUNCTION public.consume_public_request_limit(text,text,integer,integer) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;`);
      const sql = readFileSync(new URL('./20260930180000_commercial_diagnostic.sql', import.meta.url), 'utf8');
      await db.exec(sql);
      const table = await db.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE oid='public.commercial_diagnostics'::regclass");
      expect(table.rows[0].relrowsecurity).toBe(true);
      const policies = await db.query<{ policyname: string }>("SELECT policyname FROM pg_policies WHERE tablename='commercial_diagnostics'");
      expect(policies.rows.map(row => row.policyname)).toEqual(['commercial_diagnostics_admin_select', 'commercial_diagnostics_admin_update']);
      const events = await db.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE oid='public.commercial_diagnostic_events'::regclass");
      expect(events.rows[0].relrowsecurity).toBe(true);
    } finally { await db.close(); }
  });
});
