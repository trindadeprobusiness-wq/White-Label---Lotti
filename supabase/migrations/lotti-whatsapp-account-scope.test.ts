import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const migration = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

describe('conversas separadas pelo número conectado', () => {
  let db: PGlite;
  const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const user = '11111111-1111-4111-8111-111111111111';
  const numberA = '5562999990000';
  const numberB = '5562888880000';
  const ingest = (event: Record<string, unknown>) =>
    db.query<{ r: Record<string, unknown> }>('select public.lotti_agent_ingest($1::jsonb) r', [JSON.stringify({ instance: 'lotti-agent', text: 'Oi', from_me: false, unsupported: false, ...event })]);
  const live = async () => (await db.query<{ id: string; phone: string; contact_name: string | null }>(
    `select c.id,c.phone,c.contact_name from lotti_agent_conversations c join lotti_agent_channels h on h.id=c.channel_id where h.instance='lotti-agent' order by c.phone`)).rows;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TABLE public.corretores(id uuid primary key, user_id uuid not null);
      CREATE TABLE public.clientes(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, nome text not null, telefone text not null, status_funil text, tipo_interesse text, created_at timestamptz default now());
      CREATE TYPE public.direcao_contato AS ENUM ('IN','OUT');
      CREATE TABLE public.historico_contatos(id uuid primary key default gen_random_uuid(), cliente_id uuid, tipo text, direcao public.direcao_contato, conteudo text, metadata jsonb);
      CREATE TABLE public.alertas(id uuid primary key default gen_random_uuid(), corretor_id uuid, cliente_id uuid, tipo text, mensagem text, metadata jsonb, origem text);
      INSERT INTO corretores VALUES ('${owner}','${user}');
    `);
    await db.exec(migration('20260912125137_lotti_agent_runtime.sql'));
    await db.exec(migration('20260920000100_lotti_history_import.sql'));
    await db.exec(`INSERT INTO lotti_agent_channels(corretor_id,instance,enabled,sandbox) VALUES ('${owner}','lotti-agent',true,false)`);
    // Legacy data from before the connected number was recorded.
    await ingest({ phone: '447000000001', external_id: 'legacy-1' });
    await db.exec(migration('20260923120000_lotti_whatsapp_account_scope.sql'));
  }, 60_000);
  afterAll(async () => db?.close());

  it('runtime antigo sem número conectado continua funcionando sem arquivar', async () => {
    await ingest({ phone: '5511000000001', external_id: 'old-runtime' });
    expect((await live()).map(c => c.phone)).toEqual(['447000000001', '5511000000001']);
  });

  it('primeiro número identificado arquiva as conversas sem origem, sem apagar', async () => {
    const result = await ingest({ phone: '5511111111111', external_id: 'a-1', account: numberA, name: 'Maria Souza' });
    expect(result.rows[0].r.accepted).toBe(true);
    expect((await live()).map(c => c.phone)).toEqual(['5511111111111']);
    const archived = await db.query<{ phone: string; enabled: boolean; sandbox: boolean; archived_at: string | null; messages: number }>(`
      select c.phone,h.enabled,h.sandbox,c.archived_at,(select count(*)::int from lotti_agent_messages m where m.conversation_id=c.id) messages
      from lotti_agent_conversations c join lotti_agent_channels h on h.id=c.channel_id where h.instance<>'lotti-agent' order by c.phone`);
    expect(archived.rows.map(r => r.phone)).toEqual(['447000000001', '5511000000001']);
    expect(archived.rows.every(r => !r.enabled && r.sandbox && r.archived_at && r.messages === 1)).toBe(true);
    expect((await db.query(`select account_phone from lotti_agent_channels where instance='lotti-agent'`)).rows[0]).toEqual({ account_phone: numberA });
  });

  it('mesmo número não arquiva de novo e guarda o nome do contato', async () => {
    await ingest({ phone: '5511222222222', external_id: 'a-2', account: numberA, name: 'João' });
    expect((await live()).map(c => [c.phone, c.contact_name])).toEqual([['5511111111111', 'Maria Souza'], ['5511222222222', 'João']]);
    expect((await db.query(`select count(*)::int n from lotti_agent_channels where archived_at is not null`)).rows[0]).toEqual({ n: 1 });
  });

  it('cliente criado no CRM usa o nome do contato em vez do genérico', async () => {
    const names = await db.query<{ nome: string }>(`select nome from clientes where telefone in ('5511111111111','5511222222222') order by telefone`);
    expect(names.rows.map(r => r.nome)).toEqual(['Maria Souza', 'João']);
  });

  it('mensagem própria não altera o nome do contato', async () => {
    await ingest({ phone: '5511222222222', external_id: 'a-3', account: numberA, from_me: true, name: 'Dono do Celular' });
    expect((await live()).find(c => c.phone === '5511222222222')?.contact_name).toBe('João');
  });

  it('outro número conectado começa um Inbox limpo e preserva o anterior', async () => {
    await ingest({ phone: '5511111111111', external_id: 'b-1', account: numberB, name: 'Maria (outro número)' });
    expect((await live()).map(c => c.phone)).toEqual(['5511111111111']);
    const conversations = await db.query<{ n: number }>(`select count(*)::int n from lotti_agent_conversations where phone='5511111111111'`);
    expect(conversations.rows[0].n).toBe(2);
    expect((await db.query(`select count(*)::int n from lotti_agent_channels where archived_at is not null`)).rows[0]).toEqual({ n: 2 });
  });

  it('histórico usa o número conectado de cada item e guarda nomes', async () => {
    const messages = [
      { external_id: 'h-1', phone: '5511333333333', from_me: false, text: 'Antiga', created_at: '2026-09-01T12:00:00Z', account: numberB, name: 'Ana' },
      { external_id: 'h-2', phone: '5511333333333', from_me: true, text: 'Resposta', created_at: '2026-09-01T12:05:00Z', account: numberB, name: 'Dono' },
    ];
    const result = await db.query<{ r: { imported: number } }>('select public.lotti_agent_import_history($1,$2::jsonb) r', ['lotti-agent', JSON.stringify(messages)]);
    expect(result.rows[0].r.imported).toBe(2);
    expect((await live()).find(c => c.phone === '5511333333333')?.contact_name).toBe('Ana');
  });

  it('histórico de outro número arquiva antes de importar', async () => {
    const messages = [{ external_id: 'h-a', phone: '5511444444444', from_me: false, text: 'Oi', created_at: '2026-09-02T12:00:00Z', account: numberA }];
    await db.query('select public.lotti_agent_import_history($1,$2::jsonb) r', ['lotti-agent', JSON.stringify(messages)]);
    expect((await live()).map(c => c.phone)).toEqual(['5511444444444']);
  });

  it('nome inválido é ignorado sem descartar a mensagem', async () => {
    for (const [i, name] of ['x'.repeat(200), '+55 (11) 99999-9999', '   '].entries()) {
      const result = await ingest({ phone: '5511555555555', external_id: `n-${i}`, account: numberA, name });
      expect(result.rows[0].r.accepted).toBe(true);
    }
    expect((await live()).find(c => c.phone === '5511555555555')?.contact_name).toBeNull();
    await ingest({ phone: '5511555555555', external_id: 'n-ok', account: numberA, name: 'Zoë 李' });
    expect((await live()).find(c => c.phone === '5511555555555')?.contact_name).toBe('Zoë 李');
  });

  it('registro da ponte aceita só túnel da Cloudflare e só pelo runtime', async () => {
    await db.query("select public.lotti_agent_register_bridge('abc-def.trycloudflare.com')");
    await db.query("select public.lotti_agent_register_bridge('novo.trycloudflare.com')");
    expect((await db.query('select host from lotti_agent_bridge_endpoint')).rows).toEqual([{ host: 'novo.trycloudflare.com' }]);
    await expect(db.query("select public.lotti_agent_register_bridge('attacker.example.com')")).rejects.toThrow(/invalid_bridge_host/);
    for (const role of ['authenticated', 'anon']) {
      await db.exec(`SET ROLE ${role}`);
      await expect(db.query("select public.lotti_agent_register_bridge('x.trycloudflare.com')")).rejects.toThrow(/permission denied/);
      await expect(db.query('select host from public.lotti_agent_bridge_endpoint')).rejects.toThrow(/permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    await db.query("select public.lotti_agent_register_bridge('runtime.trycloudflare.com')");
    expect((await db.query('select host from public.lotti_agent_bridge_endpoint')).rows).toEqual([{ host: 'runtime.trycloudflare.com' }]);
    await db.exec('RESET ROLE');
  });

  it('vínculo de número não pode ser chamado pelo navegador', async () => {
    await db.exec('SET ROLE authenticated');
    await expect(db.query(`select public.lotti_agent_bind_account(gen_random_uuid(),'${numberA}')`)).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
  });
});
