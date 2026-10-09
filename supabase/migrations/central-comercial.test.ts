import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

describe('isolamento e integridade da Central Comercial', () => {
  let db: PGlite;
  const a='11111111-1111-4111-8111-111111111111';
  const b='22222222-2222-4222-8222-222222222222';
  beforeAll(async () => {
    db=new PGlite();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TABLE auth.users(id uuid primary key);
      INSERT INTO auth.users VALUES ('${a}'),('${b}');
      GRANT USAGE ON SCHEMA public,auth TO authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
    await db.exec(readFileSync(new URL('./20261008120000_central_comercial_prospeccao.sql',import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('./20261008130000_central_comercial_vendas_financeiro.sql',import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('./20261008140000_central_comercial_roteiros_relatorios.sql',import.meta.url),'utf8'));
    await db.exec(`GRANT SELECT,INSERT,UPDATE,DELETE ON public.central_comercial_leads,public.central_comercial_interacoes TO authenticated;`);
  });
  afterAll(async()=>db?.close());
  async function asUser(user:string,sql:string){await db.exec(`SET request.jwt.claim.sub='${user}'; SET ROLE authenticated;`);try{return await db.query(sql);}finally{await db.exec('RESET ROLE;');}}

  it('isola leads e histórico entre contas e impede ligar lead alheio',async()=>{
    const made=await asUser(a,`INSERT INTO public.central_comercial_leads(owner_id,nome_empresa) VALUES('${a}','Oficina Central') RETURNING id`);
    const id=made.rows[0].id as string;
    await asUser(a,`INSERT INTO public.central_comercial_interacoes(owner_id,lead_id,tipo,resultado) VALUES('${a}','${id}','ligacao','nao_atendeu')`);
    expect((await asUser(b,'SELECT * FROM public.central_comercial_leads')).rows).toHaveLength(0);
    expect((await asUser(b,'SELECT * FROM public.central_comercial_interacoes')).rows).toHaveLength(0);
    await expect(asUser(b,`INSERT INTO public.central_comercial_interacoes(owner_id,lead_id,tipo) VALUES('${b}','${id}','ligacao')`)).rejects.toThrow();
  });

  it('distingue site ausente de ausência confirmada e valida a faixa do score',async()=>{
    await asUser(a,`INSERT INTO public.central_comercial_leads(owner_id,nome_empresa,verificacao_site,score) VALUES('${a}','Sem pesquisa','nao_informado',0)`);
    await asUser(a,`INSERT INTO public.central_comercial_leads(owner_id,nome_empresa,verificacao_site,score) VALUES('${a}','Pesquisada','ausencia_confirmada',85)`);
    await expect(asUser(a,`INSERT INTO public.central_comercial_leads(owner_id,nome_empresa,score) VALUES('${a}','Score inválido',101)`)).rejects.toThrow();
    const result=await asUser(a,"SELECT verificacao_site FROM public.central_comercial_leads WHERE nome_empresa <> 'Oficina Central'");
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map(r=>r.verificacao_site)).toEqual(expect.arrayContaining(['nao_informado','ausencia_confirmada']));
  });

  it('mantém vendas e recebimentos dentro do mesmo proprietário',async()=>{
    const lead=await asUser(a,`INSERT INTO public.central_comercial_leads(owner_id,nome_empresa) VALUES('${a}','Cliente vendido') RETURNING id`);
    const leadId=lead.rows[0].id as string;
    const sale=await asUser(a,`INSERT INTO public.central_comercial_vendas(owner_id,lead_id,valor_contratado) VALUES('${a}','${leadId}',800) RETURNING id`);
    const saleId=sale.rows[0].id as string;
    await asUser(a,`INSERT INTO public.central_comercial_recebimentos(owner_id,venda_id,valor) VALUES('${a}','${saleId}',400)`);
    expect((await asUser(b,'SELECT * FROM public.central_comercial_vendas')).rows).toHaveLength(0);
    expect((await asUser(b,'SELECT * FROM public.central_comercial_recebimentos')).rows).toHaveLength(0);
    await expect(asUser(b,`INSERT INTO public.central_comercial_recebimentos(owner_id,venda_id,valor) VALUES('${b}','${saleId}',400)`)).rejects.toThrow();
  });

  it('isola roteiros A/B e impede vincular roteiro de outra conta',async()=>{
    const lead=await asUser(a,`INSERT INTO public.central_comercial_leads(owner_id,nome_empresa) VALUES('${a}','Lead de teste A/B') RETURNING id`);
    const leadId=lead.rows[0].id as string;
    const script=await asUser(a,`INSERT INTO public.central_comercial_roteiros(owner_id,nome,versao,texto) VALUES('${a}','Abertura','A','Texto de roteiro') RETURNING id`);
    const scriptId=script.rows[0].id as string;
    await asUser(a,`INSERT INTO public.central_comercial_interacoes(owner_id,lead_id,tipo,roteiro_id) VALUES('${a}','${leadId}','ligacao','${scriptId}')`);
    expect((await asUser(b,'SELECT * FROM public.central_comercial_roteiros')).rows).toHaveLength(0);
    await expect(asUser(b,`INSERT INTO public.central_comercial_interacoes(owner_id,lead_id,tipo,roteiro_id) VALUES('${b}','${leadId}','ligacao','${scriptId}')`)).rejects.toThrow();
  });
});
