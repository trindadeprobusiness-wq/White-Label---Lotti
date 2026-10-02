import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// A cadeia até a véspera desta migration. Ela é aplicada com conversas já
// existentes, que é a situação real: 102 das 103 estavam presas no humano.
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
let db: PGlite;

const conversa = async (phone: string) => (await db.query<{
  id: string; mode: string; pausa_ia_ate: string | null; revision: number; processed_revision: number;
}>(`select id,mode,pausa_ia_ate,revision,processed_revision from lotti_agent_conversations where phone=$1`, [phone])).rows[0];

const claim = async () => (await db.query<{ job: Record<string, unknown> | null }>(
  'select public.lotti_agent_claim() as job')).rows[0].job;

/** Devolve a conversa à fila: a IA só pega quem tem mensagem sem resposta. */
const mensagemNova = async (id: string) =>
  db.exec(`update lotti_agent_conversations set revision=revision+1, next_attempt_at=now() where id='${id}'`);

const salvarConfig = async (behavior: Record<string, unknown>, schedule?: Record<string, unknown>) => {
  const settings = {
    version: 2, active: true, model: 'gpt-4.1',
    identity: { name: 'Lotti' },
    behavior: {
      attendMode: 'always', attendDelayMinutes: 5,
      handoff: { mode: 'message' }, guards: { aggregationSeconds: 0 },
      ...behavior,
    },
    schedule: {
      timezone: 'America/Sao_Paulo',
      week: {
        mon: { enabled: true, start: '09:00', end: '18:00' },
        tue: { enabled: true, start: '09:00', end: '18:00' },
        wed: { enabled: true, start: '09:00', end: '18:00' },
        thu: { enabled: true, start: '09:00', end: '18:00' },
        fri: { enabled: true, start: '09:00', end: '18:00' },
        sat: { enabled: true, start: '09:00', end: '13:00' },
        sun: { enabled: false, start: '09:00', end: '13:00' },
      },
      ...schedule,
    },
  };
  await db.query('insert into lotti_agent_settings(corretor_id,settings) values($1,$2) on conflict(corretor_id) do update set settings=excluded.settings',
    [owner, JSON.stringify(settings)]);
};

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
  `);
  for (const nome of anteriores) await db.exec(readFileSync(new URL(`./${nome}`, import.meta.url), 'utf8'));

  await db.exec(`
    INSERT INTO lotti_agent_channels(id,corretor_id,instance,enabled,sandbox,account_phone)
      VALUES ('${canal}','${owner}','lotti-agent',true,true,'5562900000001');
    -- Presa no humano por gatilho: só tem evento de 'Sistema'.
    INSERT INTO lotti_agent_conversations(id,channel_id,corretor_id,phone,mode,status)
      VALUES ('11111111-0000-4000-8000-000000000001','${canal}','${owner}','5562911110001','human','open');
    -- Movida de propósito por uma pessoa.
    INSERT INTO lotti_agent_conversations(id,channel_id,corretor_id,phone,mode,status)
      VALUES ('11111111-0000-4000-8000-000000000002','${canal}','${owner}','5562911110002','human','open');
    INSERT INTO lotti_inbox_events(conversation_id,kind,to_label,actor_label)
      VALUES ('11111111-0000-4000-8000-000000000001','mode','Equipe','Sistema'),
             ('11111111-0000-4000-8000-000000000002','mode','Equipe','Evandro');
    -- Em IA, para os testes de pausa e de modo.
    INSERT INTO lotti_agent_conversations(id,channel_id,corretor_id,phone,mode,status)
      VALUES ('11111111-0000-4000-8000-000000000003','${canal}','${owner}','5562911110003','ai','open');
  `);

  await db.exec(readFileSync(new URL('./20261002090000_ia_pausa_com_prazo_e_modo_de_atendimento.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('./20261002160000_atendimento_combinavel.sql', import.meta.url), 'utf8'));
}, 90_000);
afterAll(async () => db?.close());

describe('a IA volta sozinha depois da resposta humana', () => {
  it('devolve à IA quem só foi para o humano por gatilho', async () => {
    const porGatilho = await conversa('5562911110001');
    expect(porGatilho.mode).toBe('ai');
    // Com silêncio, para ninguém levar susto no mesmo dia.
    expect(porGatilho.pausa_ia_ate).not.toBeNull();
  });

  it('não mexe em quem uma pessoa moveu de propósito', async () => {
    // O evento ficou gravado com o nome de quem mudou; isso é decisão, não
    // mecanismo, e desfazer seria passar por cima do corretor.
    expect((await conversa('5562911110002')).mode).toBe('human');
  });

  it('responder pelo celular silencia a IA com prazo, em vez de condená-la', async () => {
    const antes = await conversa('5562911110003');
    await db.query(`select public.lotti_agent_ingest($1::jsonb)`, [JSON.stringify({
      instance: 'lotti-agent', phone: '5562911110003', external_id: 'eco-1',
      from_me: true, text: 'respondi pelo celular',
    })]);
    const depois = await conversa('5562911110003');

    expect(depois.mode).toBe('ai');            // antes virava 'human' para sempre
    expect(depois.pausa_ia_ate).not.toBeNull();
    expect(new Date(depois.pausa_ia_ate!).getTime()).toBeGreaterThan(Date.now());
    expect(antes.id).toBe(depois.id);
  });

  it('enquanto a pausa vale, a fila não entrega a conversa', async () => {
    const cv = await conversa('5562911110003');
    await mensagemNova(cv.id);
    expect(await claim()).toBeNull();
  });

  it('vencida a pausa, a IA retoma sem ninguém mexer em nada', async () => {
    const cv = await conversa('5562911110003');
    await db.exec(`update lotti_agent_conversations set pausa_ia_ate=now()-interval '1 minute' where id='${cv.id}'`);
    const job = await claim();
    expect(job).not.toBeNull();
    expect((job as { id: string }).id).toBe(cv.id);
    await db.exec(`update lotti_agent_conversations set lease_until=null,lease_token=null where id='${cv.id}'`);
  });

  it('ligar a IA no perfil limpa a pausa na hora', async () => {
    const cv = await conversa('5562911110003');
    await db.exec(`update lotti_agent_conversations set mode='human',pausa_ia_ate=now()+interval '20 hours' where id='${cv.id}'`);
    await db.exec(`set request.jwt.claim.sub='${user}'`);
    await db.query(`select public.lotti_agent_set_mode($1::uuid,'ai')`, [cv.id]);
    const depois = await conversa('5562911110003');
    expect(depois.mode).toBe('ai');
    expect(depois.pausa_ia_ate).toBeNull();
  });
});

describe('modo de atendimento', () => {
  const idIA = '11111111-0000-4000-8000-000000000003';

  it('always: a IA atende sempre', async () => {
    await salvarConfig({ attendMode: 'always' });
    await db.exec(`update lotti_agent_conversations set mode='ai',pausa_ia_ate=null,lease_until=null,lease_token=null where id='${idIA}'`);
    await mensagemNova(idIA);
    expect(await claim()).not.toBeNull();
    await db.exec(`update lotti_agent_conversations set lease_until=null,lease_token=null where id='${idIA}'`);
  });

  it('after_delay: a IA não fala por cima de quem acabou de responder', async () => {
    await salvarConfig({ attendMode: 'after_delay', attendDelayMinutes: 30 });
    await db.exec(`insert into lotti_agent_messages(conversation_id,external_id,direction,sender,content)
      values('${idIA}','humano-agora','out','human','acabei de responder')`);
    await mensagemNova(idIA);

    const resultado = await claim();
    // Não é bloqueio nem erro: é a vez do corretor. A conversa fica na fila.
    expect(resultado).toMatchObject({ skipped: 'attend_mode' });
    expect((await conversa('5562911110003')).mode).toBe('ai');
  });

  it('after_delay: passado o tempo, a IA assume', async () => {
    await salvarConfig({ attendMode: 'after_delay', attendDelayMinutes: 30 });
    await db.exec(`update lotti_agent_messages set created_at=now()-interval '2 hours' where external_id='humano-agora'`);
    await db.exec(`update lotti_agent_conversations set next_attempt_at=now() where id='${idIA}'`);
    expect(await claim()).not.toBeNull();
    await db.exec(`update lotti_agent_conversations set lease_until=null,lease_token=null where id='${idIA}'`);
  });


  // `outside_hours` lê a aba Agendamento, não um horário fixo. O teste chama a
  // função direto com um instante escolhido: depender do relógio faria o
  // resultado mudar conforme a hora em que a suíte roda.
  it('outside_hours: dentro do expediente a conversa é do corretor', async () => {
    await salvarConfig({ attendMode: 'outside_hours' });
    const cv = await conversa('5562911110003');
    // Quarta-feira, 10h de Brasília.
    const dentro = await db.query<{ pode: boolean }>(
      `select public.lotti_agent_pode_atender($1::uuid, timestamptz '2026-10-07 13:00:00+00') as pode`, [cv.id]);
    expect(dentro.rows[0].pode).toBe(false);
  });

  it('outside_hours: fora do expediente a IA cobre', async () => {
    await salvarConfig({ attendMode: 'outside_hours' });
    const cv = await conversa('5562911110003');
    // Mesma quarta, 22h de Brasília.
    const fora = await db.query<{ pode: boolean }>(
      `select public.lotti_agent_pode_atender($1::uuid, timestamptz '2026-10-08 01:00:00+00') as pode`, [cv.id]);
    expect(fora.rows[0].pode).toBe(true);
  });

  it('outside_hours: dia sem expediente é turno inteiro da IA', async () => {
    await salvarConfig({ attendMode: 'outside_hours' });
    const cv = await conversa('5562911110003');
    // Domingo às 10h: a semana marca `sun` como desligado.
    const domingo = await db.query<{ pode: boolean }>(
      `select public.lotti_agent_pode_atender($1::uuid, timestamptz '2026-10-11 13:00:00+00') as pode`, [cv.id]);
    expect(domingo.rows[0].pode).toBe(true);
  });


  // Os dois motivos somam. Antes era preciso abrir mão de um.
  it('os dois ligados: basta um valer para a IA entrar', async () => {
    await salvarConfig({ attend: { outsideHours: true, afterDelay: true }, attendDelayMinutes: 30 });
    const cv = await conversa('5562911110003');
    await db.exec(`delete from lotti_agent_messages where conversation_id='${cv.id}' and sender='human'`);

    // Quarta, 10h: dentro do expediente. Mas a equipe está calada, e isso basta.
    const dentroDoHorarioSemEquipe = await db.query<{ pode: boolean }>(
      `select public.lotti_agent_pode_atender($1::uuid, timestamptz '2026-10-07 13:00:00+00') as pode`, [cv.id]);
    expect(dentroDoHorarioSemEquipe.rows[0].pode).toBe(true);
  });

  it('os dois ligados: nenhum valendo, a conversa é da equipe', async () => {
    await salvarConfig({ attend: { outsideHours: true, afterDelay: true }, attendDelayMinutes: 30 });
    const cv = await conversa('5562911110003');
    // Alguém respondeu agora, e é quarta às 10h — dentro do expediente.
    await db.exec(`insert into lotti_agent_messages(conversation_id,external_id,direction,sender,content)
      values('${cv.id}','humano-recente-2','out','human','respondi')`);
    await db.exec(`update lotti_agent_messages set created_at=timestamptz '2026-10-07 12:50:00+00' where external_id='humano-recente-2'`);

    const resultado = await db.query<{ pode: boolean }>(
      `select public.lotti_agent_pode_atender($1::uuid, timestamptz '2026-10-07 13:00:00+00') as pode`, [cv.id]);
    expect(resultado.rows[0].pode).toBe(false);
  });

  it('o formato antigo continua sendo lido', async () => {
    // Conta salva antes desta versão não pode perder a escolha que tinha.
    const cv = await conversa('5562911110003');
    await db.query(`update lotti_agent_settings set settings = settings - 'behavior' ||
      jsonb_build_object('behavior', (settings->'behavior') - 'attend' || jsonb_build_object('attendMode','outside_hours'))
      where corretor_id=$1`, [owner]);
    const domingo = await db.query<{ pode: boolean }>(
      `select public.lotti_agent_pode_atender($1::uuid, timestamptz '2026-10-11 13:00:00+00') as pode`, [cv.id]);
    expect(domingo.rows[0].pode).toBe(true);
  });

  it('sem configuração salva, o comportamento é o de hoje: atende', async () => {
    await db.exec(`delete from lotti_agent_settings where corretor_id='${owner}'`);
    await db.exec(`update lotti_agent_conversations set next_attempt_at=now() where id='${idIA}'`);
    expect(await claim()).not.toBeNull();
  });
});
