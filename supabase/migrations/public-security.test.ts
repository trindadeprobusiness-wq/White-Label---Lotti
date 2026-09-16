import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

describe('proteção pública executada no PostgreSQL', () => {
  let db: PGlite;
  const id = '11111111-1111-4111-8111-111111111111';
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.fachadas(id uuid PRIMARY KEY, ativo boolean);
      CREATE TABLE public.fachada_leads(id uuid DEFAULT gen_random_uuid(), fachada_id uuid, nome text, telefone text, email text, convertido boolean DEFAULT false, cliente_id uuid, created_at timestamptz DEFAULT now());
      CREATE TABLE public.fachada_escaneamentos(id uuid DEFAULT gen_random_uuid(), fachada_id uuid, user_agent text, ip_hash text, created_at timestamptz DEFAULT now());
      ALTER TABLE public.fachadas ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.fachada_leads ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.fachada_escaneamentos ENABLE ROW LEVEL SECURITY;
      GRANT INSERT ON public.fachada_leads, public.fachada_escaneamentos TO anon, authenticated;
      INSERT INTO public.fachadas VALUES ('${id}', true);
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets(id text PRIMARY KEY, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      INSERT INTO storage.buckets(id) VALUES ('ai-attachments');
    `);
    await db.exec(readFileSync(new URL('./20260916010000_public_security.sql', import.meta.url), 'utf8'));
  }, 30_000);
  afterAll(async () => { await db?.close(); });
  async function asRole(role: string, sql: string) {
    await db.exec(`SET ROLE ${role}`);
    try { return await db.query(sql); } finally { await db.exec('RESET ROLE'); }
  }
  it('nega leitura dos contadores e chamada do limitador por visitantes', async () => {
    await expect(asRole('anon', 'SELECT * FROM public.public_request_limits')).rejects.toThrow(/permission denied/);
    await expect(asRole('authenticated', "SELECT public.consume_public_lead_limit(repeat('a',64))")).rejects.toThrow(/permission denied/);
  });
  it('limita uma identidade, mantém identidades separadas e permite após expirar', async () => {
    for (let i = 0; i < 5; i++) expect((await asRole('service_role', "SELECT public.consume_public_lead_limit(repeat('a',64)) AS ok")).rows[0]).toEqual({ ok: true });
    expect((await asRole('service_role', "SELECT public.consume_public_lead_limit(repeat('a',64)) AS ok")).rows[0]).toEqual({ ok: false });
    expect((await asRole('service_role', "SELECT public.consume_public_lead_limit(repeat('b',64)) AS ok")).rows[0]).toEqual({ ok: true });
    await db.exec("UPDATE public.public_request_limits SET expires_at=now()-interval '1 second'");
    expect((await asRole('service_role', "SELECT public.consume_public_lead_limit(repeat('a',64)) AS ok")).rows[0]).toEqual({ ok: true });
  });
  it('limite global impede contorno por troca de telefone', async () => {
    await db.exec("UPDATE public.public_request_limits SET hits=300 WHERE scope='lead-global'");
    expect((await asRole('service_role', "SELECT public.consume_public_lead_limit(repeat('c',64)) AS ok")).rows[0]).toEqual({ ok: false });
    await db.exec('TRUNCATE public.public_request_limits');
  });
  it('aceita QR público sem expor tabela de fachadas nem campos de conversão', async () => {
    await asRole('anon', `INSERT INTO public.fachada_leads(fachada_id,nome,telefone,convertido,cliente_id,created_at) VALUES ('${id}','Cliente teste','(11) 99999-1234',true,'${id}','2000-01-01')`);
    const row = (await db.query('SELECT convertido,cliente_id,created_at FROM public.fachada_leads')).rows[0];
    expect(row.convertido).toBe(false);
    expect(row.cliente_id).toBeNull();
    expect(new Date(row.created_at as string).getFullYear()).toBeGreaterThan(2000);
    await expect(asRole('anon', 'SELECT * FROM public.fachadas')).rejects.toThrow(/permission denied/);
  });
  it('não aceita dados malformados ou fachada inativa por INSERT direto', async () => {
    await expect(asRole('anon', `INSERT INTO public.fachada_leads(fachada_id,nome,telefone) VALUES ('${id}','a','bad')`)).rejects.toThrow();
    await expect(asRole('authenticated', `INSERT INTO public.fachada_leads(fachada_id,nome,telefone) VALUES ('22222222-2222-4222-8222-222222222222','Teste','11999991234')`)).rejects.toThrow();
  });
  it('bloqueia spam de QR mesmo usando formatos diferentes do mesmo telefone', async () => {
    await db.exec('TRUNCATE public.public_request_limits');
    for (let i=0;i<5;i++) await asRole('anon', `INSERT INTO public.fachada_leads(fachada_id,nome,telefone) VALUES ('${id}','Teste','(11) 99999-1234')`);
    await expect(asRole('anon', `INSERT INTO public.fachada_leads(fachada_id,nome,telefone) VALUES ('${id}','Teste','5511999991234')`)).rejects.toThrow(/Muitas tentativas/);
  });
  it('restringe anexos de IA no bucket, não apenas no frontend', async () => {
    const row = (await db.query("SELECT * FROM storage.buckets WHERE id='ai-attachments'")).rows[0];
    expect(row.public).toBe(false);
    expect(Number(row.file_size_limit)).toBe(50*1024*1024);
    expect(row.allowed_mime_types).not.toContain('text/html');
    expect(row.allowed_mime_types).not.toContain('image/svg+xml');
  });
  it('não grava hashes de IP arbitrários enviados por visitantes', async () => {
    await asRole('anon', `INSERT INTO public.fachada_escaneamentos(fachada_id,user_agent,ip_hash) VALUES ('${id}',repeat('a',1000),repeat('x',100000))`);
    const row = (await db.query('SELECT user_agent,ip_hash FROM public.fachada_escaneamentos')).rows[0];
    expect((row.user_agent as string).length).toBeLessThanOrEqual(500);
    expect(row.ip_hash).toBeNull();
  });
});
