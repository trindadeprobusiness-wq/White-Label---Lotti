import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

let db: PGlite;
const cv = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const customer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table corretores(id uuid primary key, user_id uuid, nome text);
    create table clientes(id uuid primary key, corretor_id uuid, status_funil text);
    create table crm_etapas(id uuid primary key, nome text);
    create table crm_oportunidades(id uuid primary key, corretor_id uuid, cliente_id uuid, etapa_id uuid, titulo text);
    create table lotti_agent_conversations(id uuid primary key, corretor_id uuid, cliente_id uuid, mode text, status text default 'open', archived_at timestamptz);
    insert into corretores values('${owner}','11111111-1111-4111-8111-111111111111','Evandro');
    insert into clientes values('${customer}','${owner}','QUALIFICACAO');
    insert into lotti_agent_conversations(id,corretor_id,cliente_id,mode,archived_at) values('${cv}','${owner}','${customer}','human',null);
    insert into crm_etapas values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Novo lead'),('ffffffff-ffff-4fff-8fff-ffffffffffff','Agendado');
    insert into crm_oportunidades values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','${owner}','${customer}','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Compra da casa');
    set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
  `);
  await db.exec(readFileSync(new URL('./20260924000200_lotti_inbox_events.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('./20260925000100_lotti_inbox_status_events.sql', import.meta.url), 'utf8'));
}, 30_000);
afterAll(async () => db?.close());

it('registra mudança real de IA sem criar mensagem de WhatsApp', async () => {
  await db.exec(`update lotti_agent_conversations set mode='ai' where id='${cv}'`);
  await db.exec(`update lotti_agent_conversations set mode='ai' where id='${cv}'`);
  const { rows } = await db.query(`select kind,to_label,actor_label from lotti_inbox_events where conversation_id='${cv}'`);
  expect(rows).toEqual([{ kind: 'mode', to_label: 'IA', actor_label: 'Evandro' }]);
});

it('registra a mudança de etapa com nomes anteriores e novos', async () => {
  await db.exec("update crm_oportunidades set etapa_id='ffffffff-ffff-4fff-8fff-ffffffffffff' where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'");
  const { rows } = await db.query(`select from_label,to_label,subject_label from lotti_inbox_events where conversation_id='${cv}' and kind='stage'`);
  expect(rows).toEqual([{ from_label: 'Novo lead', to_label: 'Agendado', subject_label: 'Compra da casa' }]);
});

it('fechar conversa registra fechamento sem exibir IA pausada', async () => {
  await db.exec(`update lotti_agent_conversations set status='closed',mode='paused' where id='${cv}'`);
  const { rows } = await db.query(`select kind,to_label from lotti_inbox_events where conversation_id='${cv}' order by created_at`);
  expect(rows.filter((row) => row.kind === 'status')).toEqual([{ kind: 'status', to_label: 'Fechada' }]);
  expect(rows.some((row) => row.kind === 'mode' && row.to_label === 'Pausada')).toBe(false);
});
