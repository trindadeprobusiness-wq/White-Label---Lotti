import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// O caso de 2026-10-02: conta antiga, com 16 aluguéis ativos, ganha um teste
// do Essencial (limite de 5 aluguéis) para ligar a IA — e não consegue mais
// ativar contrato nenhum.
describe('conta antiga sem limite durante o teste', () => {
  let db: PGlite;
  const nova = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const antiga = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const outraNova = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  const cota = async (corretor: string, feature: string) =>
    (await db.query<{ permitido: boolean; limite: number | null; ilimitado: boolean }>(
      `select permitido, limite, ilimitado from checar_cota('${corretor}','${feature}')`)).rows[0];
  const assinatura = (corretor: string, campos: string) =>
    db.exec(`update subscriptions set ${campos} where corretor_id='${corretor}'`);
  const aluguel = (corretor: string, n = 1) =>
    db.exec(`insert into contratos(corretor_id,tipo,status) select '${corretor}','LOCACAO_RESIDENCIAL','ATIVO' from generate_series(1,${n})`);

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role') $$;
      CREATE TABLE corretores(id uuid PRIMARY KEY);
      CREATE FUNCTION get_corretor_id() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('teste.corretor',true),'')::uuid $$;
      CREATE TABLE plans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text);
      CREATE TABLE plan_entitlements(plan_id uuid,feature_key text,enabled boolean DEFAULT true,limit_value integer,unlimited boolean DEFAULT false,updated_at timestamptz,PRIMARY KEY(plan_id,feature_key));
      CREATE TABLE subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),corretor_id uuid,plan_id uuid,status text,trial_ends_at timestamptz,current_period_end timestamptz);
      CREATE TABLE subscription_addons(corretor_id uuid,addon_code text,quantity integer,status text);
      CREATE TABLE usage_counters(corretor_id uuid,feature_key text,used_quantity integer,period_start date,period_end date,updated_at timestamptz,PRIMARY KEY(corretor_id,feature_key,period_start));
      CREATE FUNCTION incrementar_uso(uuid,text,integer) RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
      CREATE TABLE imoveis(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),corretor_id uuid,ativo boolean);
      CREATE TABLE fachadas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),corretor_id uuid,ativo boolean);
      CREATE TABLE contratos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),corretor_id uuid,tipo text,status text);
      INSERT INTO corretores VALUES('${nova}'),('${antiga}');
      INSERT INTO plans(code) VALUES('essencial'),('profissional'),('imobiliaria');
      INSERT INTO plan_entitlements(plan_id,feature_key,limit_value)
      SELECT p.id,k,0 FROM plans p CROSS JOIN unnest(ARRAY['max_imoveis','max_contratos_locacao','max_fachadas','ai_contracts_monthly','leads_qualificados_monthly']) k;
      -- Quem já tinha assinatura quando a cobrança entrou não vira conta antiga.
      INSERT INTO subscriptions(corretor_id,plan_id,status,current_period_end)
      SELECT '${nova}',id,'active',now()+interval '1 month' FROM plans WHERE code='essencial';
    `);
    for (const name of [
      '20260925120000_billing_plan_enforcement.sql',
      '20260925120100_contract_quota_reservations.sql',
      '20260925120300_commercial_rent_and_checkout_rate.sql',
      '20261003120000_conta_antiga_sem_limite_no_teste.sql',
    ]) {
      await db.exec(readFileSync(new URL(name, import.meta.url), 'utf8'));
    }
    // Depois da cobrança: uma conta nova e o teste dado à conta antiga.
    await db.exec(`
      INSERT INTO corretores VALUES('${outraNova}');
      INSERT INTO subscriptions(corretor_id,plan_id,status,trial_ends_at)
      SELECT c,p.id,'trialing',now()+interval '30 days' FROM plans p, unnest(ARRAY['${antiga}','${outraNova}']::uuid[]) c
       WHERE p.code='essencial';
    `);
  }, 30_000);
  afterAll(async () => db?.close());

  it('conta antiga em teste ativa aluguel acima da cota do plano de teste', async () => {
    await aluguel(antiga, 16);
    await aluguel(antiga);
    await db.exec(`insert into fachadas(corretor_id,ativo) select '${antiga}',true from generate_series(1,16)`);
    expect(await cota(antiga, 'max_contratos_locacao')).toEqual({ permitido: true, limite: null, ilimitado: true });
    expect((await cota(antiga, 'max_imoveis')).ilimitado).toBe(true);
  });

  it('durante o teste, as cotas de IA seguem o plano de teste', async () => {
    expect(await cota(antiga, 'ai_contracts_monthly')).toEqual({ permitido: true, limite: 10, ilimitado: false });
    await db.exec(`insert into usage_counters values('${antiga}','ai_contracts_monthly',10,date_trunc('month', now() at time zone 'America/Sao_Paulo')::date,null,now())`);
    expect((await cota(antiga, 'ai_contracts_monthly')).permitido).toBe(false);
  });

  it('teste que acabou mantém a isenção, mas não a IA', async () => {
    await assinatura(antiga, `trial_ends_at=now()-interval '1 day'`);
    expect((await cota(antiga, 'max_contratos_locacao')).permitido).toBe(true);
    await aluguel(antiga);
    expect((await cota(antiga, 'leads_qualificados_monthly')).permitido).toBe(false);

    await assinatura(antiga, `status='expired'`);
    expect((await cota(antiga, 'max_fachadas')).permitido).toBe(true);
  });

  it('conta nova em teste continua presa ao plano de teste', async () => {
    await aluguel(outraNova, 5);
    await expect(aluguel(outraNova)).rejects.toThrow(/PLAN_LIMIT_REACHED/);
    expect((await cota(outraNova, 'max_contratos_locacao')).ilimitado).toBe(false);
  });

  it('a tela pergunta só pela própria conta', async () => {
    const pergunta = async (quem: string, sobre: string) => {
      await db.exec(`set request.jwt.claim.role='authenticated'; set teste.corretor='${quem}'`);
      try {
        const { rows } = await db.query<{ r: boolean }>(`select conta_antiga_sem_limite('${sobre}') r`);
        return rows[0].r;
      } finally {
        await db.exec(`set request.jwt.claim.role='service_role'; reset teste.corretor`);
      }
    };
    expect(await pergunta(antiga, antiga)).toBe(true);
    expect(await pergunta(nova, antiga)).toBe(false);
    expect(await pergunta(nova, nova)).toBe(false);
    const { rows } = await db.query(`select has_function_privilege('anon','conta_antiga_sem_limite(uuid)','EXECUTE') anon,
      has_function_privilege('authenticated','conta_antiga_sem_limite(uuid)','EXECUTE') autenticado`);
    expect(rows[0]).toEqual({ anon: false, autenticado: true });
  });

  it('pagar um plano encerra a isenção', async () => {
    // Acima da cota do Essencial (5) por conta própria, sem depender dos its anteriores.
    await assinatura(antiga, `status='trialing', trial_ends_at=now()+interval '1 day'`);
    await aluguel(antiga, 6);
    await assinatura(antiga, `status='active', current_period_end=now()+interval '1 month'`);
    expect(await cota(antiga, 'max_contratos_locacao')).toMatchObject({ permitido: false, limite: 5 });
    await expect(aluguel(antiga)).rejects.toThrow(/PLAN_LIMIT_REACHED/);
  });

  it('atraso, só leitura e cancelamento não viram acesso ilimitado', async () => {
    for (const status of ['past_due', 'read_only', 'canceled']) {
      await assinatura(antiga, `status='${status}'`);
      expect((await cota(antiga, 'max_imoveis')).permitido, status).toBe(false);
    }
  });
});
