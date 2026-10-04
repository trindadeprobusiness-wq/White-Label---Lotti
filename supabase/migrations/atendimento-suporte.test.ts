import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const U = '10000000-0000-4000-8000-000000000003';
const V = '10000000-0000-4000-8000-000000000004';
const C = '20000000-0000-4000-8000-000000000003';
const D = '20000000-0000-4000-8000-000000000004';
const H = '50000000-0000-4000-8000-000000000001';

describe('atendimento real: escopo, prazo, auditoria e listagem', () => {
  let db: PGlite;
  async function como(uid: string, sql: string, role = 'authenticated', sessao?: string) {
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: uid, session_id: sessao })]);
    await db.exec(`SET ROLE ${role}`);
    try { return await db.query(sql); }
    finally { await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claims','{}',false)"); }
  }
  async function abrir(c = C, u = U) {
    const sid = crypto.randomUUID();
    await db.query('INSERT INTO auth.sessions VALUES ($1,$2)', [sid, u]);
    const r = await como(A, `SELECT public.suporte_criar_sessao('${A}','${c}','${sid}','token-teste') s`, 'service_role');
    return { ...(r.rows[0] as { s: { id: string } }).s, sid };
  }
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;
      CREATE SCHEMA auth;
      GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid);
      CREATE TABLE corretores(id uuid PRIMARY KEY,user_id uuid,nome text,email text,status text DEFAULT 'ativo',created_at timestamptz,ultimo_acesso_em timestamptz);
      CREATE TABLE clientes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),corretor_id uuid,nome text);
      ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
      CREATE POLICY propria_conta ON clientes TO authenticated USING (corretor_id IN (SELECT id FROM corretores WHERE user_id=auth.uid())) WITH CHECK (corretor_id IN (SELECT id FROM corretores WHERE user_id=auth.uid()));
      CREATE TABLE parceiros(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),nome text);
      CREATE TABLE parceiro_links(id uuid PRIMARY KEY,parceiro_id uuid,campanha text);
      CREATE TABLE parceiro_atribuicoes(id uuid PRIMARY KEY,corretor_id uuid,parceiro_id uuid,link_id uuid,visitante_id uuid,status text,primeiro_clique_em timestamptz);
      CREATE TABLE parceiro_cliques(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),visitante_id uuid,parceiro_id uuid);
      CREATE TABLE receita_eventos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),corretor_id uuid,valor_bruto numeric,status text);
      CREATE TABLE plans(id uuid PRIMARY KEY,name text);
      CREATE TABLE subscriptions(id uuid PRIMARY KEY,corretor_id uuid,status text,plan_id uuid,created_at timestamptz);
      CREATE TABLE onboarding_profiles(id uuid PRIMARY KEY,user_id uuid);
      CREATE TABLE onboarding_progress(id uuid PRIMARY KEY,profile_id uuid,completed_at timestamptz,current_step text);
      INSERT INTO auth.users VALUES ('${A}'),('${B}'),('${U}'),('${V}');
      INSERT INTO corretores(id,user_id,nome,email,created_at) VALUES
        ('${C}','${U}','Antigo','antigo@exemplo.test','2000-01-01'),
        ('${D}','${V}','Novo','novo@exemplo.test',now());
    `);
    await db.exec(readFileSync(new URL('./20260814100000_admin_papeis_auditoria.sql', import.meta.url), 'utf8'));
    await db.exec(`INSERT INTO user_roles(user_id,role) VALUES('${A}','admin'),('${B}','admin')`);
    await db.exec(readFileSync(new URL('./20261004170000_atendimento_suporte.sql', import.meta.url), 'utf8'));
    await db.exec(`
      INSERT INTO parceiros(id,nome) VALUES('${H}','Influenciador X');
      INSERT INTO parceiros(nome) SELECT 'Parceiro '||i FROM generate_series(1,30) i;
      INSERT INTO parceiro_links VALUES('${H}','${H}','stories');
      INSERT INTO parceiro_atribuicoes VALUES('${H}','${C}','${H}','${H}','${H}','convertida',now());
      INSERT INTO parceiro_cliques(visitante_id,parceiro_id) VALUES('${H}','${H}'),('${H}','${H}');
      INSERT INTO receita_eventos(corretor_id,valor_bruto,status) VALUES('${C}',129,'confirmado'),('${C}',100,'estornado');
    `);
  }, 60_000);
  afterAll(async () => { await db?.close(); });
  it('nega abertura e listagem para usuario comum e tokens para o navegador', async () => {
    await expect(como(U, `SELECT admin_preparar_suporte('${C}')`)).rejects.toThrow('acesso negado');
    await expect(como(U, 'SELECT admin_listar_atendimento()')).rejects.toThrow('acesso negado');
    await expect(como(A, 'SELECT * FROM suporte_privado.credenciais')).rejects.toThrow('permission denied');
    await expect(como(A, `SELECT suporte_obter_credenciais('${H}','${A}')`)).rejects.toThrow('permission denied');
  });
  it('inclui contas antigas e novas mesmo sem etapa de onboarding', async () => {
    const r = await como(A, 'SELECT admin_listar_atendimento() pagina');
    const p = (r.rows[0] as { pagina: { total: number; itens: { nome: string }[] } }).pagina;
    expect(p.total).toBe(2); expect(p.itens.map(i => i.nome)).toEqual(['Novo','Antigo']);
    expect((await como(A, `SELECT admin_preparar_suporte('${D}')`)).rows).toHaveLength(1);
  });
  it('filtra parceiro/campanha e inclui cliques e somente receita confirmada', async () => {
    const r = await como(A, `SELECT admin_listar_atendimento(p_parceiro_id=>'${H}',p_campanha=>'stories') pagina`);
    const p = (r.rows[0] as { pagina: { total: number; itens: { total_cliques: number; receita_confirmada: number }[] } }).pagina;
    expect(p.total).toBe(1); expect(p.itens[0]).toMatchObject({ total_cliques: 2, receita_confirmada: 129 });
    const vazia = await como(A, 'SELECT admin_listar_atendimento(p_offset=>99) pagina');
    expect((vazia.rows[0] as { pagina: unknown }).pagina).toEqual({ total: 2, itens: [] });
    expect((await como(A, 'SELECT admin_opcoes_parceiros() parceiros')).rows[0].parceiros).toHaveLength(31);
  });
  it('grava na conta selecionada, impede outra conta e registra o administrador', async () => {
    const s = await abrir();
    await como(U, `INSERT INTO clientes(corretor_id,nome) VALUES('${C}','Contato privado')`, 'authenticated', s.sid);
    await expect(como(U, `INSERT INTO clientes(corretor_id,nome) VALUES('${D}','Outra conta')`, 'authenticated', s.sid)).rejects.toThrow('row-level security');
    const r = await db.query<{ ator_user_id: string; dados_depois: { campos: string[] } }>("SELECT ator_user_id,dados_depois FROM admin_auditoria WHERE acao='suporte_insert' AND entidade='clientes'");
    expect(r.rows[0].ator_user_id).toBe(A); expect(r.rows[0].dados_depois.campos).toContain('nome');
    expect(JSON.stringify(r.rows)).not.toContain('Contato privado');
  });
  it('nega outra pessoa, prazo vencido, revogacao de papel e encerramento', async () => {
    const s = await abrir();
    await expect(como(B, `SELECT suporte_obter_credenciais('${s.id}','${B}')`, 'service_role')).rejects.toThrow('acesso revogado');
    await db.query('UPDATE admin_sessoes_suporte SET expira_em=now()-interval \'1 second\' WHERE id=$1', [s.id]);
    await expect(como(A, `SELECT suporte_obter_credenciais('${s.id}','${A}')`, 'service_role')).rejects.toThrow('acesso revogado');
    await expect(como(U, `UPDATE clientes SET nome='Nao permitido' WHERE corretor_id='${C}'`, 'authenticated', s.sid)).rejects.toThrow('expirado');
    const outra = await abrir();
    await db.exec(`UPDATE user_roles SET revogado_em=now() WHERE user_id='${A}'`);
    await expect(como(A, `SELECT suporte_obter_credenciais('${outra.id}','${A}')`, 'service_role')).rejects.toThrow('acesso revogado');
    await db.exec(`UPDATE user_roles SET revogado_em=NULL WHERE user_id='${A}'`);
    await como(A, `SELECT suporte_encerrar_sessao('${outra.id}','${A}')`, 'service_role');
    await expect(como(A, `SELECT suporte_obter_credenciais('${outra.id}','${A}')`, 'service_role')).rejects.toThrow('acesso revogado');
    expect((await db.query('SELECT * FROM suporte_privado.credenciais WHERE sessao_id=$1', [outra.id])).rows).toHaveLength(0);
  });
});
