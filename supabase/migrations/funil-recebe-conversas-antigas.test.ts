import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// A cadeia até a véspera. A migration em teste roda sobre conversas que já
// existiam antes do gatilho da 20261001160000 — que é exatamente o caso real:
// 102 contatos capturados antes dela, nenhum no Kanban.
const anteriores = [
  '20260912125137_lotti_agent_runtime.sql',
  '20260912171307_lotti_agent_resume_guard.sql',
  '20260916000100_lotti_manual_inbox.sql',
  '20260920000100_lotti_history_import.sql',
  '20260921130000_lotti_inbox_actions.sql',
  '20260923120000_lotti_whatsapp_account_scope.sql',
  '20260923220000_lotti_inbox_update_contact.sql',
  '20260924000100_lotti_channel_company_name.sql',
  '20260924000200_lotti_inbox_events.sql',
  '20260925000100_lotti_inbox_status_events.sql',
  '20260926200000_lotti_whatsapp_lid_conversations.sql',
  '20260927120000_lotti_agent_stalled_claims.sql',
  '20260927120100_lotti_agent_opt_out.sql',
  '20260927130000_lotti_agent_settings.sql',
  '20260927140000_lotti_agent_follow_up.sql',
  '20260927150000_lotti_broadcasts.sql',
  '20260928190000_lotti_whatsapp_contact_names_and_merge.sql',
  '20260928200000_lotti_inbox_add_to_crm.sql',
  '20260929100000_crm_cliente_sem_duplicidade.sql',
  '20260929110000_crm_conversao_e_oportunidade.sql',
  '20260929120000_lotti_conversa_por_chave.sql',
  '20260929130000_lotti_canal_e_optout.sql',
  '20260929140000_duplicidade_ajustes_revisao.sql',
  '20260930190000_conversa_sempre_no_crm.sql',
  '20261001160000_conversa_abre_negocio_em_novo_lead.sql',
];

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user = '11111111-1111-4111-8111-111111111111';
const canal = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const canalTeste = 'cccccccc-cccc-4ccc-8ccc-cccccccccccd';
let db: PGlite;

const backfill = () => db.exec(readFileSync(new URL('./20261002180000_funil_recebe_conversas_antigas.sql', import.meta.url), 'utf8'));

const negociosDe = async (cliente: string) => (await db.query<{ titulo: string; etapa_id: string; origem: string }>(
  'select titulo, etapa_id, origem from crm_oportunidades where cliente_id=$1 and fechada_em is null', [cliente])).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    CREATE TABLE public.corretores(id uuid primary key, user_id uuid not null, nome text);
    GRANT SELECT ON public.corretores TO authenticated;
    CREATE TABLE public.clientes(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, nome text not null, telefone text not null, email text, status_funil text, tipo_interesse text, created_at timestamptz default clock_timestamp());
    CREATE TYPE public.direcao_contato AS ENUM ('IN','OUT');
    CREATE TABLE public.historico_contatos(id uuid primary key default gen_random_uuid(), cliente_id uuid, tipo text, direcao public.direcao_contato, conteudo text, metadata jsonb);
    CREATE TABLE public.alertas(id uuid primary key default gen_random_uuid(), corretor_id uuid, cliente_id uuid, tipo text, mensagem text, metadata jsonb, origem text, entidade_tipo text, entidade_id uuid, lido boolean default false);
    CREATE TABLE public.plan_entitlements(plan_id uuid, feature_key text, limit_value int, unlimited boolean default false, enabled boolean default true);
    CREATE TABLE public.subscriptions(id uuid primary key default gen_random_uuid(), corretor_id uuid, plan_id uuid, status text, trial_ends_at timestamptz, current_period_end timestamptz, created_at timestamptz default now());
    CREATE TABLE public.usage_counters(corretor_id uuid, feature_key text, used_quantity int, period_start date, period_end date, updated_at timestamptz default now(), unique(corretor_id,feature_key,period_start));
    CREATE TABLE public.crm_etapas(id uuid primary key, corretor_id uuid not null, nome text, ordem int not null default 0, tipo text not null default 'ABERTA', ativo boolean not null default true);
    CREATE TABLE public.crm_oportunidades(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, cliente_id uuid, etapa_id uuid not null, titulo text not null, origem text, fechada_em timestamptz, updated_at timestamptz not null default now());
    INSERT INTO corretores VALUES ('${owner}','${user}','Evandro');
    INSERT INTO crm_etapas(id,corretor_id,nome,ordem) VALUES
      ('eeee0000-0000-4000-8000-000000000002','${owner}','Primeiro contato',2),
      ('eeee0000-0000-4000-8000-000000000001','${owner}','Novo lead',1);
  `);
  for (const nome of anteriores) await db.exec(readFileSync(new URL(`./${nome}`, import.meta.url), 'utf8'));

  // As conversas deste teste PRECEDEM o gatilho da 20261001160000 — é esse o
  // caso que a migration existe para resolver. Semear com o gatilho ligado
  // criaria os cartões na inserção e o teste passaria sem testar nada.
  await db.exec(`
    ALTER TABLE lotti_agent_conversations DISABLE TRIGGER lotti_conversa_no_crm_insert;
    INSERT INTO lotti_agent_channels(id,corretor_id,instance,enabled,sandbox,account_phone)
      VALUES ('${canal}','${owner}','lotti-agent',true,false,'5562900000001'),
             ('${canalTeste}','${owner}','lotti-sandbox',true,true,'5562900000002');

    INSERT INTO clientes(id,corretor_id,nome,telefone) VALUES
      ('c1aa0000-0000-4000-8000-000000000001','${owner}','Marina Alves','5562911110001'),
      ('c1aa0000-0000-4000-8000-000000000002','${owner}','Carlos Henrique','5562911110002'),
      ('c1aa0000-0000-4000-8000-000000000003','${owner}','Bianca Souza','5562911110003'),
      ('c1aa0000-0000-4000-8000-000000000004','${owner}','Contato de teste','5562911110004'),
      ('c1aa0000-0000-4000-8000-000000000005','${owner}','Sem cadastro','5562911110005');

    -- Conversa antiga, com nome salvo na agenda: o cartão usa esse nome.
    INSERT INTO lotti_agent_conversations(id,channel_id,corretor_id,phone,mode,status,cliente_id,contact_name)
      VALUES ('11111111-0000-4000-8000-000000000001','${canal}','${owner}','5562911110001','ai','open','c1aa0000-0000-4000-8000-000000000001','Marina da Quadra 7');

    -- Mesmo cliente em duas conversas: não pode virar dois cartões.
    INSERT INTO lotti_agent_conversations(id,channel_id,corretor_id,phone,mode,status,cliente_id)
      VALUES ('11111111-0000-4000-8000-000000000002','${canal}','${owner}','5562911110002','ai','open','c1aa0000-0000-4000-8000-000000000002'),
             ('11111111-0000-4000-8000-000000000006','${canal}','${owner}','5562911110006','ai','open','c1aa0000-0000-4000-8000-000000000002');

    -- Já trabalhado no funil, numa etapa adiante: não volta para o começo.
    INSERT INTO lotti_agent_conversations(id,channel_id,corretor_id,phone,mode,status,cliente_id)
      VALUES ('11111111-0000-4000-8000-000000000003','${canal}','${owner}','5562911110003','ai','open','c1aa0000-0000-4000-8000-000000000003');
    INSERT INTO crm_oportunidades(corretor_id,cliente_id,etapa_id,titulo,origem)
      VALUES ('${owner}','c1aa0000-0000-4000-8000-000000000003','eeee0000-0000-4000-8000-000000000002','Bianca — proposta','manual');

    -- Canal de teste não povoa o funil de ninguém.
    INSERT INTO lotti_agent_conversations(id,channel_id,corretor_id,phone,mode,status,cliente_id)
      VALUES ('11111111-0000-4000-8000-000000000004','${canalTeste}','${owner}','5562911110004','ai','open','c1aa0000-0000-4000-8000-000000000004');

    -- Conversa sem cliente vinculado: não há o que abrir.
    INSERT INTO lotti_agent_conversations(id,channel_id,corretor_id,phone,mode,status)
      VALUES ('11111111-0000-4000-8000-000000000005','${canal}','${owner}','5562911110007','ai','open');
    ALTER TABLE lotti_agent_conversations ENABLE TRIGGER lotti_conversa_no_crm_insert;
  `);

  // Trava da trava: sem a migration, nenhum desses contatos tem cartão.
  const antesDoBackfill = (await db.query<{ total: number }>('select count(*)::int as total from crm_oportunidades')).rows[0].total;
  expect(antesDoBackfill).toBe(1); // só o "Bianca — proposta", inserido à mão

  await backfill();
}, 90_000);
afterAll(async () => db?.close());

describe('conversas antigas entram no funil', () => {
  it('abre o negócio na primeira etapa, com o nome do contato', async () => {
    const negocios = await negociosDe('c1aa0000-0000-4000-8000-000000000001');
    expect(negocios).toHaveLength(1);
    expect(negocios[0].titulo).toBe('Marina da Quadra 7');
    expect(negocios[0].origem).toBe('whatsapp');
    // A etapa é escolhida pela ordem, não pelo nome — "Novo lead" é ordem 1,
    // mesmo tendo sido inserida depois de "Primeiro contato".
    expect(negocios[0].etapa_id).toBe('eeee0000-0000-4000-8000-000000000001');
  });

  it('duas conversas do mesmo cliente dão um cartão só', async () => {
    expect(await negociosDe('c1aa0000-0000-4000-8000-000000000002')).toHaveLength(1);
  });

  it('não devolve ao começo quem já está sendo trabalhado', async () => {
    const negocios = await negociosDe('c1aa0000-0000-4000-8000-000000000003');
    expect(negocios).toHaveLength(1);
    expect(negocios[0].etapa_id).toBe('eeee0000-0000-4000-8000-000000000002');
    expect(negocios[0].titulo).toBe('Bianca — proposta');
  });

  it('canal de teste não entra no funil', async () => {
    expect(await negociosDe('c1aa0000-0000-4000-8000-000000000004')).toHaveLength(0);
  });

  it('conversa sem cliente vinculado não vira cartão órfão', async () => {
    const orfaos = await db.query<{ total: number }>(
      "select count(*)::int as total from crm_oportunidades where cliente_id is null");
    expect(orfaos.rows[0].total).toBe(0);
  });

  it('rodar de novo não duplica nada', async () => {
    const antes = (await db.query<{ total: number }>('select count(*)::int as total from crm_oportunidades')).rows[0].total;
    await backfill();
    const depois = (await db.query<{ total: number }>('select count(*)::int as total from crm_oportunidades')).rows[0].total;
    expect(depois).toBe(antes);
  });
});
