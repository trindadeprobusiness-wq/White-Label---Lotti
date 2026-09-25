import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

describe('pagamento confirmado → assinatura e período', () => {
  let db: PGlite;
  const user = '11111111-1111-4111-8111-111111111111';
  const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const order = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const apply = (payment: string, status: string, due: string, amount = 279) =>
    db.query(`select apply_checkout_payment('${order}','${payment}','cus_1','sub_1','${status}','${due}',${amount},'${user}')`);
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE TABLE corretores(id uuid PRIMARY KEY,user_id uuid);
      CREATE TABLE plans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text,active boolean DEFAULT true);
      CREATE TYPE billing_cycle AS ENUM('monthly','annual');
      CREATE TYPE subscription_status AS ENUM('trialing','active','past_due','canceled','expired','read_only');
      CREATE TABLE subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),corretor_id uuid,plan_id uuid,billing_cycle billing_cycle,status subscription_status,
        trial_started_at timestamptz,trial_ends_at timestamptz,current_period_start timestamptz,current_period_end timestamptz,external_subscription_id text,created_at timestamptz DEFAULT now());
      INSERT INTO auth.users VALUES('${user}'); INSERT INTO corretores VALUES('${owner}','${user}'); INSERT INTO plans(code) VALUES('essencial');
    `);
    for (const name of ['20260826090000_asaas_saas_checkout.sql','20260925120200_checkout_payment_ledger.sql']) {
      await db.exec(readFileSync(new URL(name, import.meta.url),'utf8'));
    }
    await db.exec(`insert into checkout_orders(id,access_token_hash,payer_name,payer_email,payer_document,payer_phone,plan_code,billing_cycle,payment_method,amount,asaas_customer_id,asaas_subscription_id)
      values('${order}','hash','Teste','teste@example.invalid','fixture','fixture','essencial','monthly','CREDIT_CARD',279,'cus_1','sub_1')`);
  },30_000);
  afterAll(async () => db?.close());
  it('ativa só o plano comprado e não duplica período em CONFIRMED/RECEIVED', async () => {
    await apply('pay_1','CONFIRMED','2030-01-31');
    const before = (await db.query(`select current_period_end from subscriptions`)).rows[0];
    await apply('pay_1','RECEIVED','2030-01-31');
    expect((await db.query(`select current_period_end from subscriptions`)).rows).toEqual([before]);
    expect((await db.query(`select count(*)::int n from checkout_payments`)).rows[0].n).toBe(1);
    expect(String(before.current_period_end)).toContain('2030');
    expect((await db.query(`select current_period_end::date::text d from subscriptions`)).rows[0].d).toBe('2030-02-28');
  });
  it('renova, e atraso ou estorno antigo não suspendem mês posterior pago', async () => {
    await apply('pay_2','CONFIRMED','2030-02-28');
    await apply('pay_1','REFUNDED','2030-01-31');
    const row = (await db.query(`select status,current_period_end::date::text d from subscriptions`)).rows[0];
    expect(row).toEqual({status:'active',d:'2030-03-28'});
    await apply('pay_0','OVERDUE','2029-12-31');
    expect((await db.query(`select status from subscriptions`)).rows[0].status).toBe('active');
  });
  it('não libera valores errados nem cobrança de outro cliente', async () => {
    await expect(apply('bad','RECEIVED','2030-04-01',1)).rejects.toThrow(/PAYMENT_MISMATCH/);
    await expect(db.query(`select apply_checkout_payment('${order}','bad','cus_other','sub_1','RECEIVED','2030-04-01',279,'${user}')`)).rejects.toThrow(/PAYMENT_MISMATCH/);
  });
  it('estorno de todos os pagamentos retira acesso', async () => {
    await apply('pay_2','REFUNDED','2030-02-28');
    expect((await db.query(`select status from subscriptions`)).rows[0].status).toBe('read_only');
  });
  it('operações internas não são executáveis pelo cliente', async () => {
    expect((await db.query(`select has_function_privilege('authenticated','apply_checkout_payment(uuid,text,text,text,text,date,numeric,uuid)','EXECUTE') ok`)).rows[0].ok).toBe(false);
  });
});
