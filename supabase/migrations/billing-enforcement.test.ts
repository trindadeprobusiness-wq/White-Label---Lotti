import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

describe('cotas de planos no PostgreSQL', () => {
  let db: PGlite;
  const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const legacy = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role') $$;
      CREATE TABLE corretores(id uuid PRIMARY KEY);
      CREATE FUNCTION get_corretor_id() RETURNS uuid LANGUAGE sql AS $$ SELECT '${owner}'::uuid $$;
      CREATE TABLE plans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text);
      CREATE TABLE plan_entitlements(plan_id uuid,feature_key text,enabled boolean DEFAULT true,limit_value integer,unlimited boolean DEFAULT false,updated_at timestamptz,PRIMARY KEY(plan_id,feature_key));
      CREATE TABLE subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),corretor_id uuid,plan_id uuid,status text,trial_ends_at timestamptz,current_period_end timestamptz);
      CREATE TABLE subscription_addons(corretor_id uuid,addon_code text,quantity integer,status text);
      CREATE TABLE usage_counters(corretor_id uuid,feature_key text,used_quantity integer,period_start date,period_end date,updated_at timestamptz,PRIMARY KEY(corretor_id,feature_key,period_start));
      CREATE FUNCTION incrementar_uso(uuid,text,integer) RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
      CREATE TABLE imoveis(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),corretor_id uuid,ativo boolean);
      CREATE TABLE fachadas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),corretor_id uuid,ativo boolean);
      CREATE TABLE contratos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),corretor_id uuid,tipo text,status text);
      INSERT INTO corretores VALUES('${owner}'),('${legacy}');
      INSERT INTO plans(code) VALUES('essencial'),('profissional'),('imobiliaria');
      INSERT INTO plan_entitlements(plan_id,feature_key,limit_value)
      SELECT p.id,k,0 FROM plans p CROSS JOIN unnest(ARRAY['max_imoveis','max_contratos_locacao','max_fachadas','ai_contracts_monthly','leads_qualificados_monthly']) k;
      INSERT INTO subscriptions(corretor_id,plan_id,status,current_period_end)
      SELECT '${owner}',id,'active',now()+interval '1 month' FROM plans WHERE code='essencial';
    `);
    for (const name of ['20260925120000_billing_plan_enforcement.sql','20260925120100_contract_quota_reservations.sql','20260925120300_commercial_rent_and_checkout_rate.sql','20261003120000_conta_antiga_sem_limite_no_teste.sql']) {
      await db.exec(readFileSync(new URL(name, import.meta.url),'utf8'));
    }
  }, 30_000);
  afterAll(async () => db?.close());
  it('aplica o catálogo aprovado e mantém ilimitados explícitos', async () => {
    const { rows } = await db.query(`select p.code,e.limit_value,e.unlimited from plans p join plan_entitlements e on e.plan_id=p.id where feature_key='max_imoveis' order by p.code`);
    expect(rows).toEqual([{code:'essencial',limit_value:250,unlimited:false},{code:'imobiliaria',limit_value:null,unlimited:true},{code:'profissional',limit_value:1500,unlimited:false}]);
  });
  it('bloqueia o sexto aluguel e a mudança de tipo que tentaria ultrapassar a cota', async () => {
    await db.exec(`insert into contratos(corretor_id,tipo,status) select '${owner}','LOCACAO_RESIDENCIAL','ATIVO' from generate_series(1,5)`);
    await expect(db.exec(`insert into contratos(corretor_id,tipo,status) values('${owner}','LOCACAO_RESIDENCIAL','ATIVO')`)).rejects.toThrow(/PLAN_LIMIT_REACHED/);
    await expect(db.exec(`insert into contratos(corretor_id,tipo,status) values('${owner}','LOCACAO_COMERCIAL','ATIVO')`)).rejects.toThrow(/PLAN_LIMIT_REACHED/);
    await db.exec(`update contratos set tipo='LOCACAO_COMERCIAL' where id=(select id from contratos limit 1)`);
    await db.exec(`insert into contratos(corretor_id,tipo,status) values('${owner}','VENDA','ATIVO')`);
    await expect(db.exec(`update contratos set tipo='LOCACAO_RESIDENCIAL' where tipo='VENDA'`)).rejects.toThrow(/PLAN_LIMIT_REACHED/);
  });
  it('reserva a última operação antes de chamar IA e devolve falha uma única vez', async () => {
    for(let i=0;i<9;i++) await db.query(`select * from reserve_contract_quota('${owner}')`);
    const a = (await db.query(`select * from reserve_contract_quota('${owner}')`)).rows[0];
    expect(a.allowed).toBe(true);
    expect((await db.query(`select * from reserve_contract_quota('${owner}')`)).rows[0].allowed).toBe(false);
    await db.query(`select finish_contract_quota('${a.reservation_id}',false)`);
    await db.query(`select finish_contract_quota('${a.reservation_id}',false)`);
    expect((await db.query(`select used_quantity from usage_counters`)).rows[0].used_quantity).toBe(9);
  });
  it('uma inserção em lote também respeita a cota de fachadas', async () => {
    await expect(db.exec(`insert into fachadas(corretor_id,ativo) select '${owner}',true from generate_series(1,16)`)).rejects.toThrow(/PLAN_LIMIT_REACHED/);
  });
  it('nega conta alheia, período expirado e feature desabilitada', async () => {
    await db.exec(`set request.jwt.claim.role='authenticated'`);
    expect((await db.query(`select * from checar_cota('${legacy}','max_imoveis')`)).rows[0].permitido).toBe(false);
    await db.exec(`set request.jwt.claim.role='service_role'; update subscriptions set current_period_end=now()-interval '1 day'`);
    expect((await db.query(`select * from checar_cota('${owner}','max_imoveis')`)).rows[0].permitido).toBe(false);
    await db.exec(`update subscriptions set current_period_end=now()+interval '1 month'; update plan_entitlements set enabled=false,unlimited=true where feature_key='max_imoveis'`);
    expect((await db.query(`select * from checar_cota('${owner}','max_imoveis')`)).rows[0].permitido).toBe(false);
  });
  it('preserva legado mas não transforma cancelamento em acesso ilimitado', async () => {
    expect((await db.query(`select * from checar_cota('${legacy}','max_fachadas')`)).rows[0].permitido).toBe(true);
    await db.exec(`insert into subscriptions(corretor_id,plan_id,status) select '${legacy}',id,'canceled' from plans where code='essencial'`);
    expect((await db.query(`select * from checar_cota('${legacy}','max_fachadas')`)).rows[0].permitido).toBe(false);
  });
  it('limita tentativas públicas de checkout no servidor', async () => {
    for(let i=0;i<10;i++) expect((await db.query(`select consume_checkout_rate_limit(repeat('a',64)) ok`)).rows[0].ok).toBe(true);
    expect((await db.query(`select consume_checkout_rate_limit(repeat('a',64)) ok`)).rows[0].ok).toBe(false);
  });
  it('impede o navegador de escrever assinatura e contador ou chamar RPC interna', async () => {
    const { rows } = await db.query(`select has_table_privilege('authenticated','subscriptions','UPDATE') as subscription,has_table_privilege('authenticated','usage_counters','UPDATE') as usage,has_function_privilege('authenticated','reserve_contract_quota(uuid)','EXECUTE') as reserve`);
    expect(rows[0]).toEqual({subscription:false,usage:false,reserve:false});
  });
});
