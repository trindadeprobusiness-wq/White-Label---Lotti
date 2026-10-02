import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

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
  '20261002090000_ia_pausa_com_prazo_e_modo_de_atendimento.sql',
  '20261002160000_atendimento_combinavel.sql',
  '20261002190000_reconciliar_envio_pelo_inbox.sql',
  '20261002210000_falha_de_envio_com_certeza.sql',
  '20261002220000_freio_e_motivos_honestos.sql',
];

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user = '11111111-1111-4111-8111-111111111111';
const canal = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const plano = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const conversa = '11111111-0000-4000-8000-000000000001';
let db: PGlite;

const estado = async () => (await db.query<{ mode: string; attempts: number; last_error: string | null; revision: string; processed_revision: string }>(
  'select mode, attempts, last_error, revision, processed_revision from lotti_agent_conversations where id=$1', [conversa])).rows[0];
const outbox = async () => (await db.query<{ status: string; revision: string }>(
  'select status, revision from lotti_agent_outbox where conversation_id=$1 order by revision', [conversa])).rows;
const alertas = async () => (await db.query<{ total: number }>(
  'select count(*)::int as total from alertas where metadata->>\'conversation_id\'=$1', [conversa])).rows[0].total;

/** Põe a conversa na fila com uma mensagem do lead sem resposta. */
const contador = async () => (await db.query<{ falhas_de_envio: number }>(
  'select falhas_de_envio from lotti_agent_conversations where id=$1', [conversa])).rows[0].falhas_de_envio;

const comMensagemNova = async (attempts = 0, falhas = 0) => {
  await db.exec(`
    delete from lotti_agent_outbox where conversation_id='${conversa}';
    delete from alertas;
    update lotti_agent_conversations set mode='ai', revision=5, processed_revision=4,
      attempts=${attempts}, falhas_de_envio=${falhas}, lease_token=null, lease_until=null, last_error=null,
      next_attempt_at=now()-interval '1 minute' where id='${conversa}';
  `);
};

/** Reserva a conversa e escreve a resposta, como o runtime faz. */
const ateOEnvio = async () => {
  const job = (await db.query<{ job: { id: string; token: string; revision: number } | null }>(
    'select public.lotti_agent_claim() as job')).rows[0].job;
  if (!job) throw new Error('claim devolveu vazio');
  await db.query('select public.lotti_agent_prepare($1,$2,$3,$4)',
    [job.id, job.token, job.revision, JSON.stringify({ response: 'Temos opcoes em Anapolis.', stage: 'qualificando' })]);
  await db.query('select public.lotti_agent_begin_send($1,$2,$3,true)', [job.id, job.token, job.revision]);
  return job;
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
      VALUES ('${canal}','${owner}','lotti-agent',true,false,'5562900000001');
    INSERT INTO lotti_agent_conversations(id,channel_id,corretor_id,phone,mode,status)
      VALUES ('${conversa}','${canal}','${owner}','5562911110001','ai','open');
    -- Sem plano ativo o claim recusa antes de chegar no envio.
    INSERT INTO plan_entitlements VALUES ('${plano}','leads_qualificados_monthly',100,false,true);
    INSERT INTO subscriptions(corretor_id,plan_id,status,current_period_end)
      VALUES ('${owner}','${plano}','active',now()+interval '30 days');
  `);
}, 90_000);
afterAll(async () => db?.close());

describe('falha de envio com certeza', () => {
  it('a assinatura antiga de três argumentos deixa de existir', async () => {
    // Conviver com as duas tornaria a chamada de três argumentos ambígua.
    const r = await db.query<{ args: string }>(
      "select pg_get_function_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='lotti_agent_fail'");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].args).toContain('p_uncertain boolean DEFAULT true');
  });

  it('sem o parâmetro, continua exatamente como era: dúvida e conversa com a equipe', async () => {
    await comMensagemNova();
    const job = await ateOEnvio();
    await db.query('select public.lotti_agent_fail($1,$2,$3)', [job.id, job.token, 'delivery_failed_or_uncertain']);

    expect((await outbox())[0].status).toBe('uncertain');
    const depois = await estado();
    expect(depois.mode).toBe('human');
    expect(depois.last_error).toBe('delivery_failed_or_uncertain');
    expect(await alertas()).toBe(1);
  });

  it('falha comprovada não trava a conversa nem chama ninguém', async () => {
    await comMensagemNova();
    const job = await ateOEnvio();
    await db.query('select public.lotti_agent_fail($1,$2,$3,false)', [job.id, job.token, 'delivery_rejected']);

    const depois = await estado();
    expect(depois.mode).toBe('ai');
    expect(depois.last_error).toBe('delivery_rejected');
    expect(await alertas()).toBe(0);
  });

  it('falha comprovada APAGA o registro, para a IA poder tentar de novo', async () => {
    // Cancelar em vez de apagar seria pior do que não consertar nada:
    // `prepare` só atualiza registro em 'prepared', então um 'cancelled' faria
    // o `returning` voltar vazio e a IA nunca mais responderia essa mensagem.
    await comMensagemNova();
    const job = await ateOEnvio();
    await db.query('select public.lotti_agent_fail($1,$2,$3,false)', [job.id, job.token, 'delivery_rejected']);
    expect(await outbox()).toHaveLength(0);

    // E a tentativa seguinte realmente acontece, ponta a ponta.
    await db.exec(`update lotti_agent_conversations set next_attempt_at=now()-interval '1 minute' where id='${conversa}'`);
    const segundo = await ateOEnvio();
    expect(segundo.revision).toBe(5);
    expect((await outbox())[0].status).toBe('sending');
  });

  it('na quarta tentativa seguida, entrega para a equipe mesmo sem dúvida', async () => {
    await comMensagemNova(3);
    const job = await ateOEnvio();
    await db.query('select public.lotti_agent_fail($1,$2,$3,false)', [job.id, job.token, 'delivery_rejected']);
    expect((await estado()).mode).toBe('human');
    expect(await alertas()).toBe(1);
  });

  it('token errado não altera nada, com ou sem o parâmetro', async () => {
    await comMensagemNova();
    const job = await ateOEnvio();
    const r = await db.query<{ ok: boolean }>(
      "select public.lotti_agent_fail($1,'99999999-9999-4999-8999-999999999999',$2,false) as ok", [job.id, 'invasor']);
    expect(r.rows[0].ok).toBe(false);
    expect((await outbox())[0].status).toBe('sending');
    expect((await estado()).last_error).toBeNull();
  });
});

describe('botão "Não chegou" do Inbox', () => {
  it('apaga o registro em vez de cancelar, senão a conversa entra em laço', async () => {
    // Defeito encontrado com o botão já em produção. Um registro 'cancelled' na
    // revisão que falta responder faz o `prepare` devolver vazio para sempre:
    // o runtime desiste sem chamar `fail`, o lease expira, o `claim` pega de
    // novo, gasta outra chamada de IA — e o lead nunca é respondido.
    await comMensagemNova();
    const job = await ateOEnvio();
    await db.query('select public.lotti_agent_fail($1,$2,$3)', [job.id, job.token, 'delivery_failed_or_uncertain']);
    expect((await outbox())[0].status).toBe('uncertain');

    await db.exec(`set request.jwt.claim.sub='${user}'`);
    await db.query(`select public.lotti_agent_reconciliar_envio('${conversa}', false)`);
    expect(await outbox()).toHaveLength(0);

    // E a IA consegue mesmo responder depois.
    await db.exec(`update lotti_agent_conversations set mode='ai', next_attempt_at=now()-interval '1 minute' where id='${conversa}'`);
    const segundo = await ateOEnvio();
    expect(segundo.revision).toBe(5);
    expect((await outbox())[0].status).toBe('sending');
  });

  it('"chegou" continua fechando como entregue', async () => {
    await comMensagemNova();
    const job = await ateOEnvio();
    await db.query('select public.lotti_agent_fail($1,$2,$3)', [job.id, job.token, 'delivery_failed_or_uncertain']);
    await db.exec(`set request.jwt.claim.sub='${user}'`);
    await db.query(`select public.lotti_agent_reconciliar_envio('${conversa}', true)`);
    expect((await outbox())[0].status).toBe('sent');
  });

  it('não sobra nenhum registro cancelado no banco', async () => {
    // A migration limpa os que o botão antigo deixou para trás.
    const r = await db.query<{ total: number }>("select count(*)::int as total from lotti_agent_outbox where status='cancelled'");
    expect(r.rows[0].total).toBe(0);
  });
});

describe('freio da falha certa', () => {
  /** O lead escreve de novo, como quem não recebeu resposta. Isso zera `attempts`. */
  const leadEscreve = async (texto: string) => db.query(
    'select public.lotti_agent_ingest($1::jsonb)',
    [JSON.stringify({ instance: 'lotti-agent', phone: '5562911110001', text: texto, external_id: 'lead-' + texto })]);

  it('mensagem do lead não desarma o freio — este era o defeito', async () => {
    // `lotti_agent_ingest` faz `attempts=0` a cada mensagem recebida. Se a
    // escalada dependesse de `attempts`, um lead que insiste manteria a IA
    // tentando para sempre, sem nunca passar para a equipe e sem alerta.
    await comMensagemNova();
    for (let volta = 1; volta <= 3; volta += 1) {
      await db.exec(`update lotti_agent_conversations set next_attempt_at=now()-interval '1 minute' where id='${conversa}'`);
      const job = await ateOEnvio();
      await db.query('select public.lotti_agent_fail($1,$2,$3,false)', [job.id, job.token, 'delivery_rejected']);
      if (volta < 3) await leadEscreve(`alo ${volta}`);
    }
    const depois = await estado();
    expect(depois.mode).toBe('human');
    expect(await alertas()).toBeGreaterThanOrEqual(1);
  });

  it('envio que dá certo zera o contador', async () => {
    await comMensagemNova();
    const job = await ateOEnvio();
    await db.query('select public.lotti_agent_fail($1,$2,$3,false)', [job.id, job.token, 'delivery_rejected']);
    expect((await contador())).toBe(1);

    await db.exec(`update lotti_agent_conversations set next_attempt_at=now()-interval '1 minute' where id='${conversa}'`);
    const segundo = await ateOEnvio();
    await db.query('select public.lotti_agent_finish($1,$2,$3,$4)', [segundo.id, segundo.token, segundo.revision, 'id-do-provedor']);
    expect((await contador())).toBe(0);
  });

  it('religar a IA zera o contador', async () => {
    await comMensagemNova(0, 2);
    await db.exec(`set request.jwt.claim.sub='${user}'`);
    await db.query(`select public.lotti_agent_set_mode('${conversa}','human')`);
    await db.query(`select public.lotti_agent_set_mode('${conversa}','ai')`);
    expect((await contador())).toBe(0);
  });

  it('falha certa não deixa na tela um motivo que promete botão', async () => {
    // Se o runtime mandar um código da família "incerto" junto de
    // p_uncertain=false, o Inbox mostraria "A mensagem chegou / Não chegou"
    // sem registro nenhum para reconciliar: dois botões mudos.
    await comMensagemNova();
    const job = await ateOEnvio();
    await db.query('select public.lotti_agent_fail($1,$2,$3,false)', [job.id, job.token, 'delivery_failed_or_uncertain']);
    expect((await estado()).last_error).toBe('delivery_rejected');
  });
});

describe('arestas achadas na revisão do runtime', () => {
  /** Falha ANTES do envio: não existe registro em 'sending' para marcar. */
  const falhaAntesDoEnvio = async (incerta: boolean) => {
    const job = (await db.query<{ job: { id: string; token: string } | null }>(
      'select public.lotti_agent_claim() as job')).rows[0].job!;
    await db.query('select public.lotti_agent_fail($1,$2,$3,$4)',
      [job.id, job.token, 'delivery_upstream_error', incerta]);
  };

  it('falha incerta antes do envio não promete botão que não existe', async () => {
    // O Inbox decide pelos botões só pelo last_error. Deixar ali um motivo da
    // família "incerto" sem registro para reconciliar daria dois cliques mudos.
    await comMensagemNova();
    await falhaAntesDoEnvio(true);
    expect((await estado()).last_error).toBe('falha_antes_do_envio');
    expect(await outbox()).toHaveLength(0);
  });

  it('o freio não é zerado por falha incerta', async () => {
    // Era a brecha: alternar falha certa com falha incerta de pré-envio
    // mantinha o contador em 1 para sempre.
    await comMensagemNova();
    for (let volta = 0; volta < 3; volta += 1) {
      await db.exec(`update lotti_agent_conversations set next_attempt_at=now()-interval '1 minute' where id='${conversa}'`);
      if (volta % 2 === 0) {
        const job = await ateOEnvio();
        await db.query('select public.lotti_agent_fail($1,$2,$3,false)', [job.id, job.token, 'delivery_rejected']);
      } else {
        await falhaAntesDoEnvio(true);
      }
    }
    expect(await contador()).toBeGreaterThanOrEqual(3);
    expect((await estado()).mode).toBe('human');
  });

  it('o caminho automático apaga em vez de cancelar', async () => {
    // `prepare` só atualiza registro em 'prepared'; um 'cancelled' faria o
    // follow-up travar no mesmo laço mudo do caminho manual.
    await comMensagemNova();
    const job = await ateOEnvio();
    await db.query('select public.lotti_agent_auto_fail($1,$2,$3,false)', [job.id, job.token, 5]);
    expect(await outbox()).toHaveLength(0);
  });

  it('o caminho automático ainda marca dúvida quando há dúvida', async () => {
    await comMensagemNova();
    const job = await ateOEnvio();
    await db.query('select public.lotti_agent_auto_fail($1,$2,$3,true)', [job.id, job.token, 5]);
    expect((await outbox())[0].status).toBe('uncertain');
  });
});
