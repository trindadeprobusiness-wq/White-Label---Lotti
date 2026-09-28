/**
 * Autorização e auditoria do back office executadas no PostgreSQL (PGlite).
 *
 * SCRUM-27 (endpoint administrativo bloqueado para usuário comum) e SCRUM-29
 * (alterações administrativas no histórico de auditoria). Relatório em
 * docs/jira/admin-backoffice.md.
 *
 * Os blocos "lacunas corrigidas" cobrem as brechas encontradas na auditoria e
 * fechadas pela migration 20260927090000_admin_acesso_e_auditoria.sql.
 *
 * O ambiente imita o Supabase: papéis anon/authenticated, `auth.uid()` lido de
 * `request.jwt.claim.sub`, e privilégios padrão (ALL em tabelas e funções do
 * schema public para anon/authenticated) — é sobre eles que os REVOKE das
 * migrations agem.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const migration = (nome: string) => readFileSync(new URL(`./${nome}`, import.meta.url), 'utf8');

const MIGRATIONS = [
  '20260814100000_admin_papeis_auditoria.sql',
  '20260814110000_atividade_e_config.sql',
  '20260814120000_parceiros_atribuicao.sql',
  '20260814130000_receita_comissoes.sql',
  '20260814140000_admin_rpcs.sql',
  '20260901160000_backoffice_operacao_saas.sql',
  '20260901160100_backoffice_operacao_saas_rpcs.sql',
  '20260901160200_backoffice_repasses_cancelamentos_rpcs.sql',
  '20260927090000_admin_acesso_e_auditoria.sql',
];

const SUPER = '10000000-0000-4000-8000-000000000001';
const ADMIN = '10000000-0000-4000-8000-000000000002';
const COMUM = '10000000-0000-4000-8000-000000000003';
const C_SUPER = '20000000-0000-4000-8000-000000000001';
const C_ADMIN = '20000000-0000-4000-8000-000000000002';
const C_COMUM = '20000000-0000-4000-8000-000000000003';
const P1 = '30000000-0000-4000-8000-000000000001';
const LINK = '40000000-0000-4000-8000-000000000001';
const VIS = '50000000-0000-4000-8000-000000000001';
const L1 = '60000000-0000-4000-8000-000000000001';
const ZERO = '00000000-0000-4000-8000-000000000000';
const MOTIVO = 'motivo suficientemente longo';

/** Toda RPC administrativa chamada pelo front (useAdminDados/useSaasDados). */
const RPCS_ADMIN: Record<string, string> = {
  admin_metricas_visao_geral: `admin_metricas_visao_geral('2026-01-01','2026-01-31')`,
  admin_listar_usuarios: `admin_listar_usuarios()`,
  admin_definir_status_corretor: `admin_definir_status_corretor('${C_SUPER}','suspenso','${MOTIVO}')`,
  admin_detalhe_usuario: `admin_detalhe_usuario('${C_SUPER}')`,
  admin_listar_auditoria: `admin_listar_auditoria()`,
  admin_listar_parceiros: `admin_listar_parceiros()`,
  admin_definir_percentual: `admin_definir_percentual('${P1}', 50, 'receita_bruta')`,
  admin_transicionar_comissao: `admin_transicionar_comissao('${ZERO}', 'aprovada')`,
  admin_listar_comissoes: `admin_listar_comissoes()`,
  admin_registrar_receita: `admin_registrar_receita('${C_COMUM}', 100, now(), 'assinatura', NULL, NULL, '${MOTIVO}')`,
  admin_estornar_receita: `admin_estornar_receita('${ZERO}', '${MOTIVO}')`,
  admin_listar_receita: `admin_listar_receita()`,
  admin_registrar_pagamento: `admin_registrar_pagamento('${P1}', ARRAY['${ZERO}']::uuid[])`,
  admin_metricas_saas: `admin_metricas_saas('2026-01-01','2026-01-31')`,
  admin_listar_assinaturas: `admin_listar_assinaturas()`,
  admin_listar_pagamentos: `admin_listar_pagamentos()`,
  admin_registrar_cancelamento: `admin_registrar_cancelamento('outro', NULL, 'Contato Teste')`,
  admin_listar_cancelamentos: `admin_listar_cancelamentos()`,
  admin_metricas_cancelamento: `admin_metricas_cancelamento('2026-01-01','2026-01-31')`,
  admin_parceiros_elegiveis_repasse: `admin_parceiros_elegiveis_repasse()`,
  admin_gerar_lote_repasse: `admin_gerar_lote_repasse(ARRAY['${P1}']::uuid[])`,
  admin_listar_lotes: `admin_listar_lotes()`,
  admin_detalhe_lote: `admin_detalhe_lote('${L1}')`,
  admin_marcar_lote_exportado: `admin_marcar_lote_exportado('${L1}')`,
  admin_marcar_lote_pago: `admin_marcar_lote_pago('${L1}', CURRENT_DATE, 'REF-123')`,
  admin_cancelar_lote: `admin_cancelar_lote('${L1}', '${MOTIVO}')`,
  admin_salvar_config: `admin_salvar_config('janela_atividade_dias', '30'::jsonb)`,
  admin_listar_config: `admin_listar_config()`,
  admin_status_integracoes: `admin_status_integracoes()`,
  registrar_auditoria_admin: `registrar_auditoria_admin('forjada', 'corretores')`,
};

/** Exigem super_admin: um `admin` operacional precisa receber 42501. */
const RPCS_SUPER_ADMIN = [
  RPCS_ADMIN.admin_registrar_receita,
  RPCS_ADMIN.admin_estornar_receita,
  RPCS_ADMIN.admin_registrar_pagamento,
  RPCS_ADMIN.admin_marcar_lote_pago,
  RPCS_ADMIN.admin_cancelar_lote,
  RPCS_ADMIN.admin_salvar_config,
  `admin_transicionar_comissao('${ZERO}', 'paga')`,
];

/** Tabelas só do back office: usuário comum não pode ler nenhuma linha. */
const TABELAS_ADMIN = [
  'user_roles', 'admin_auditoria', 'admin_config', 'parceiros', 'parceiro_percentuais',
  'parceiro_links', 'parceiro_cliques', 'parceiro_atribuicoes', 'receita_eventos',
  'parceiro_comissoes', 'parceiro_pagamentos', 'parceiro_lotes', 'parceiro_lote_itens',
  'cancelamento_feedback', 'atividade_eventos',
];

describe('back office: autorização e auditoria no PostgreSQL', () => {
  let db: PGlite;

  /** Executa um comando como `role`, com `auth.uid()` = uid. */
  async function como(uid: string | null, sql: string, role = 'authenticated') {
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
    await db.exec(`SET ROLE ${role}`);
    try {
      return await db.query<Record<string, unknown>>(sql);
    } finally {
      await db.exec('RESET ROLE');
      await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
    }
  }

  /** Igual a `como`, mas devolve o resultado em vez de lançar — a falha mostra o que vazou. */
  async function tentar(uid: string | null, sql: string, role = 'authenticated') {
    try {
      const r = await como(uid, sql, role);
      return { negado: false, linhas: r.rows, afetadas: r.affectedRows ?? 0 };
    } catch (e) {
      return { negado: true, erro: (e as Error).message };
    }
  }

  /** 'negado' quando o banco recusa; senão devolve o que vazou, para aparecer na falha. */
  async function negadoOuVazou(uid: string | null, sql: string, role = 'authenticated') {
    const r = await tentar(uid, sql, role);
    return r.negado ? 'negado' : { vazou: r.linhas };
  }

  const contarAuditoria = async (filtro: string) =>
    (await db.query<{ n: number }>(`SELECT count(*)::int n FROM public.admin_auditoria WHERE ${filtro}`)).rows[0].n;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
      CREATE SCHEMA auth;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, last_sign_in_at timestamptz, email_confirmed_at timestamptz);

      CREATE TABLE public.corretores(id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id),
        nome text, email text, telefone text, creci text, creci_estado text, created_at timestamptz DEFAULT now());
      ALTER TABLE public.corretores ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Corretor le proprio perfil" ON public.corretores FOR SELECT TO authenticated USING (auth.uid() = user_id);
      CREATE TABLE public.clientes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), corretor_id uuid);
      CREATE TABLE public.imoveis(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), corretor_id uuid);
      CREATE TABLE public.contratos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), corretor_id uuid);
      CREATE TABLE public.plans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE, name text,
        monthly_price numeric, annual_price numeric);
      CREATE TABLE public.subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), corretor_id uuid, plan_id uuid,
        billing_cycle text DEFAULT 'monthly', status text DEFAULT 'trialing', trial_ends_at timestamptz,
        current_period_start timestamptz, current_period_end timestamptz, cancel_at_period_end boolean DEFAULT false,
        canceled_at timestamptz, cancel_reason text, external_subscription_id text,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());

      INSERT INTO auth.users(id, email) VALUES
        ('${SUPER}', 'super@exemplo.test'), ('${ADMIN}', 'admin@exemplo.test'), ('${COMUM}', 'comum@exemplo.test');
      INSERT INTO public.corretores(id, user_id, nome, email) VALUES
        ('${C_SUPER}', '${SUPER}', 'Super Admin', 'super@exemplo.test'),
        ('${C_ADMIN}', '${ADMIN}', 'Admin Operacional', 'admin@exemplo.test'),
        ('${C_COMUM}', '${COMUM}', 'Corretor Comum', 'comum@exemplo.test');
    `);

    for (const nome of MIGRATIONS) await db.exec(migration(nome));

    await db.exec(`
      INSERT INTO public.user_roles(user_id, role) VALUES ('${SUPER}', 'super_admin'), ('${ADMIN}', 'admin');
      INSERT INTO public.admin_auditoria(ator_user_id, acao, entidade, entidade_id) VALUES ('${SUPER}', 'semente', 'teste', '1');
      INSERT INTO public.parceiros(id, nome, email, chave_pix, tipo_chave_pix)
        VALUES ('${P1}', 'Parceiro Teste', 'parceiro@exemplo.test', 'parceiro@exemplo.test', 'email');
      INSERT INTO public.parceiro_percentuais(parceiro_id, percentual, base_calculo, vigencia_inicio, motivo)
        VALUES ('${P1}', 12.5, 'receita_bruta', '2000-01-01', 'acordo comercial confidencial');
      INSERT INTO public.parceiro_links(id, parceiro_id, slug, principal) VALUES ('${LINK}', '${P1}', 'parceiro-teste', true);
      INSERT INTO public.parceiro_cliques(link_id, parceiro_id, visitante_id) VALUES ('${LINK}', '${P1}', '${VIS}');
      INSERT INTO public.parceiro_atribuicoes(parceiro_id, link_id, visitante_id, user_id, corretor_id, janela_dias, expira_em, status, convertido_em)
        VALUES ('${P1}', '${LINK}', '${VIS}', '${COMUM}', '${C_COMUM}', 90, now() + interval '90 days', 'convertida', now());
      INSERT INTO public.receita_eventos(corretor_id, origem, valor_bruto, confirmado_em, motivo)
        VALUES ('${C_COMUM}', 'manual_admin', 100, now(), 'semente');
      INSERT INTO public.parceiro_pagamentos(parceiro_id, valor_total) VALUES ('${P1}', 1);
      INSERT INTO public.parceiro_lotes(id, referencia) VALUES ('${L1}', 'LOTE-TESTE-0001');
      INSERT INTO public.parceiro_lote_itens(lote_id, parceiro_id, comissao_id, valor, nome_beneficiario, chave_pix, tipo_chave_pix)
        SELECT '${L1}', '${P1}', id, valor_comissao, 'Parceiro Teste', 'parceiro@exemplo.test', 'email'
          FROM public.parceiro_comissoes LIMIT 1;
      INSERT INTO public.cancelamento_feedback(contato_nome, motivo) VALUES ('Contato Teste', 'outro');
      INSERT INTO public.atividade_eventos(user_id, corretor_id, tipo) VALUES ('${SUPER}', '${C_SUPER}', 'login');
      INSERT INTO public.plans(code, name, monthly_price, annual_price) VALUES ('essencial', 'Lotti Essencial', 129, 1290);
      INSERT INTO public.subscriptions(corretor_id, plan_id, status)
        SELECT '${C_COMUM}', id, 'active' FROM public.plans WHERE code = 'essencial';
    `);
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  describe('SCRUM-26/27 — papel verificado no servidor', () => {
    it('meus_papeis devolve só os papéis do próprio usuário (base do AdminRoute)', async () => {
      expect((await como(COMUM, 'SELECT public.meus_papeis() p')).rows[0].p).toEqual([]);
      expect((await como(ADMIN, 'SELECT public.meus_papeis() p')).rows[0].p).toEqual(['admin']);
      expect((await como(SUPER, 'SELECT public.meus_papeis() p')).rows[0].p).toEqual(['super_admin']);
      expect((await como(null, 'SELECT public.meus_papeis() p', 'anon')).rows[0].p).toEqual([]);
    });

    it('a lista testada cobre toda função admin_* SECURITY DEFINER do catálogo', async () => {
      const catalogo = (await db.query<{ proname: string }>(`
        SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prosecdef AND p.proname LIKE 'admin\\_%' ORDER BY 1`)).rows.map((r) => r.proname);
      // Os dois helpers de configuração continuam SECURITY DEFINER, mas sem EXECUTE para anon/authenticated.
      const esperado = [...Object.keys(RPCS_ADMIN).filter((n) => n.startsWith('admin_')), 'admin_config_int', 'admin_config_texto'].sort();
      expect(catalogo).toEqual(esperado);
    });
  });

  describe('SCRUM-27 — RPCs administrativas recusam quem não tem papel', () => {
    it.each(Object.entries(RPCS_ADMIN))('usuário comum recebe 42501 em %s', async (_nome, chamada) => {
      await expect(como(COMUM, `SELECT public.${chamada}`)).rejects.toThrow(/acesso negado/);
    });

    it.each(Object.entries(RPCS_ADMIN))('visitante anônimo não executa %s', async (_nome, chamada) => {
      await expect(como(null, `SELECT public.${chamada}`, 'anon')).rejects.toThrow(/acesso negado|permission denied/);
    });

    it.each(RPCS_SUPER_ADMIN)('admin operacional recebe 42501 em ação de super_admin: %s', async (chamada) => {
      await expect(como(ADMIN, `SELECT public.${chamada}`)).rejects.toThrow(/acesso negado/);
    });

    it('com papel, a mesma RPC responde (o guard não bloqueia tudo)', async () => {
      const r = await como(ADMIN, 'SELECT public.admin_listar_usuarios() r');
      expect((r.rows[0].r as { total: number }).total).toBe(3);
    });

    it('bootstrap de super_admin não é exposto a anon nem a authenticated', async () => {
      await expect(como(COMUM, `SELECT public.promover_primeiro_super_admin('comum@exemplo.test')`)).rejects.toThrow(/permission denied/);
      await expect(como(null, `SELECT public.promover_primeiro_super_admin('comum@exemplo.test')`, 'anon')).rejects.toThrow(/permission denied/);
    });
  });

  describe('SCRUM-27 — tabelas do back office fechadas por RLS/GRANT', () => {
    it.each(TABELAS_ADMIN)('usuário comum não lê nenhuma linha de %s', async (tabela) => {
      const total = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM public.${tabela}`)).rows[0].n;
      expect(total).toBeGreaterThan(0);
      const visiveis = (await como(COMUM, `SELECT count(*)::int n FROM public.${tabela}`)).rows[0].n;
      expect(visiveis).toBe(0);
    });

    it('usuário comum não se promove, não cria parceiro e não escreve auditoria', async () => {
      await expect(como(COMUM, `INSERT INTO public.user_roles(user_id, role) VALUES ('${COMUM}', 'super_admin')`)).rejects.toThrow(/row-level security/);
      await expect(como(COMUM, `INSERT INTO public.parceiros(nome, email) VALUES ('Intruso', 'intruso@exemplo.test')`)).rejects.toThrow(/row-level security/);
      await expect(como(COMUM, `INSERT INTO public.admin_auditoria(acao, entidade) VALUES ('forjada', 'x')`)).rejects.toThrow(/permission denied/);
      await expect(como(COMUM, `UPDATE public.parceiro_comissoes SET status = 'paga'`)).rejects.toThrow(/permission denied/);
      await expect(como(COMUM, `DELETE FROM public.user_roles`)).rejects.toThrow(/permission denied/);
    });

    it('usuário comum não altera admin_config nem o próprio status de conta', async () => {
      const r = await como(COMUM, `UPDATE public.admin_config SET valor = '1'::jsonb WHERE chave = 'janela_atividade_dias'`);
      expect(r.affectedRows ?? 0).toBe(0);
      await expect(
        como(COMUM, `UPDATE public.corretores SET status = 'suspenso' WHERE user_id = auth.uid()`),
      ).rejects.toThrow(/ação administrativa/);
    });
  });

  describe('SCRUM-29 — ações administrativas gravam trilha append-only', () => {
    it('suspender e reativar conta grava ator, antes/depois e motivo', async () => {
      const antes = await contarAuditoria(`acao = 'definir_status_corretor' AND entidade_id = '${C_COMUM}'`);
      await como(ADMIN, `SELECT public.admin_definir_status_corretor('${C_COMUM}', 'suspenso', '${MOTIVO}')`);
      await como(ADMIN, `SELECT public.admin_definir_status_corretor('${C_COMUM}', 'ativo', '${MOTIVO}')`);
      const linhas = (await db.query<Record<string, unknown>>(`
        SELECT ator_user_id, dados_antes, dados_depois, motivo FROM public.admin_auditoria
         WHERE acao = 'definir_status_corretor' AND entidade_id = '${C_COMUM}' ORDER BY id`)).rows;
      expect(linhas.length - antes).toBe(2);
      expect(linhas.at(-2)).toMatchObject({
        ator_user_id: ADMIN, dados_antes: { status: 'ativo' }, dados_depois: { status: 'suspenso' }, motivo: MOTIVO,
      });
    });

    it('configuração salva pela RPC e cancelamento registrado entram na trilha', async () => {
      const cfg = await contarAuditoria(`acao = 'alterar_config'`);
      const canc = await contarAuditoria(`acao = 'registrar_cancelamento'`);
      await como(SUPER, `SELECT public.admin_salvar_config('janela_atividade_dias', '30'::jsonb)`);
      await como(ADMIN, `SELECT public.admin_registrar_cancelamento('outro', NULL, 'Contato Dois', NULL, NULL, NULL, 'comentario do cliente')`);
      expect(await contarAuditoria(`acao = 'alterar_config'`)).toBe(cfg + 1);
      expect(await contarAuditoria(`acao = 'registrar_cancelamento'`)).toBe(canc + 1);
      const ultima = (await db.query<{ dados_depois: Record<string, unknown> }>(
        `SELECT dados_depois FROM public.admin_auditoria WHERE acao = 'registrar_cancelamento' ORDER BY id DESC LIMIT 1`)).rows[0];
      expect(ultima.dados_depois).not.toHaveProperty('comentario');
    });

    it('a trilha é append-only até para o dono do banco', async () => {
      await expect(db.query(`UPDATE public.admin_auditoria SET motivo = 'alterado'`)).rejects.toThrow(/append-only/);
      await expect(db.query(`DELETE FROM public.admin_auditoria`)).rejects.toThrow(/append-only/);
    });

    it('admin lê a trilha pela RPC; usuário comum não', async () => {
      const r = await como(ADMIN, 'SELECT public.admin_listar_auditoria() r');
      expect((r.rows[0].r as { total: number }).total).toBeGreaterThan(0);
      await expect(como(COMUM, 'SELECT public.admin_listar_auditoria()')).rejects.toThrow(/acesso negado/);
    });
  });

  // ── Lacunas corrigidas (20260927090000_admin_acesso_e_auditoria.sql) ─────────
  describe('SCRUM-27 — helpers SECURITY DEFINER fechados para anon e authenticated', () => {
    it('admin_config_texto/admin_config_int não deveriam ler admin_config para usuário comum nem anônimo', async () => {
      // A RLS fecha a tabela (regressão acima), mas o helper roda como dono e contorna a policy.
      // Sem REVOKE de PUBLIC, o EXECUTE padrão alcança também o papel anon.
      expect([
        await negadoOuVazou(COMUM, `SELECT public.admin_config_texto('programa_comissao_padrao', NULL) v`),
        await negadoOuVazou(COMUM, `SELECT public.admin_config_int('programa_saldo_minimo', 0) v`),
        await negadoOuVazou(null, `SELECT public.admin_config_texto('portal_publicado', NULL) v`, 'anon'),
      ]).toEqual(['negado', 'negado', 'negado']);
    });

    it('percentual_vigente_em não deveria expor percentual e motivo do parceiro a usuário comum', async () => {
      expect(await negadoOuVazou(COMUM, `SELECT percentual, motivo FROM public.percentual_vigente_em('${P1}', CURRENT_DATE)`))
        .toBe('negado');
    });

    it('has_role não deveria servir de oráculo para descobrir quem é admin', async () => {
      expect(await negadoOuVazou(COMUM, `SELECT public.has_role('${ADMIN}', 'admin') v`)).toBe('negado');
    });
  });

  describe('SCRUM-29 — alterações administrativas diretas entram na trilha', () => {
    it('marcar lote como exportado deveria gravar auditoria', async () => {
      const antes = await contarAuditoria(`entidade = 'parceiro_lotes' AND entidade_id = '${L1}'`);
      await como(ADMIN, `SELECT public.admin_marcar_lote_exportado('${L1}')`);
      expect({ auditoriasNovas: (await contarAuditoria(`entidade = 'parceiro_lotes' AND entidade_id = '${L1}'`)) - antes })
        .toEqual({ auditoriasNovas: 1 });
    });

    it('criar/editar parceiro e criar/revogar link (caminho da UI) deveriam ser recusados ou auditados', async () => {
      const filtro = `entidade IN ('parceiros', 'parceiro_links')`;
      const antes = await contarAuditoria(filtro);
      const P2 = '30000000-0000-4000-8000-000000000002';
      const L2 = '40000000-0000-4000-8000-000000000002';
      const ops = [
        await tentar(ADMIN, `INSERT INTO public.parceiros(id, nome, email) VALUES ('${P2}', 'Parceiro Dois', 'p2@exemplo.test')`),
        await tentar(ADMIN, `UPDATE public.parceiros SET empresa = 'Nova Empresa' WHERE id = '${P2}'`),
        await tentar(ADMIN, `INSERT INTO public.parceiro_links(id, parceiro_id, slug) VALUES ('${L2}', '${P1}', 'parceiro-dois')`),
        await tentar(ADMIN, `UPDATE public.parceiro_links SET ativo = false, revogado_em = now() WHERE id = '${L2}'`),
      ];
      const aceitas = ops.filter((o) => !o.negado).length;
      expect({ aceitas, auditadas: (await contarAuditoria(filtro)) - antes }).toEqual({ aceitas, auditadas: aceitas });
    });

    it('UPDATE direto em admin_config (caminho de AdminConfiguracoes.tsx) deveria ser recusado ou auditado', async () => {
      const filtro = `entidade = 'admin_config' AND entidade_id = 'atribuicao_janela_dias'`;
      const antes = await contarAuditoria(filtro);
      const r = await tentar(SUPER, `UPDATE public.admin_config SET valor = '60'::jsonb WHERE chave = 'atribuicao_janela_dias'`);
      const aceita = !r.negado && r.afetadas > 0;
      expect({ aceita, auditada: (await contarAuditoria(filtro)) - antes > 0 }).toEqual({ aceita, auditada: aceita });
    });

    it('conceder papel (INSERT em user_roles por super_admin) deveria ser auditado', async () => {
      const filtro = `entidade = 'user_roles' AND entidade_id = '${COMUM}'`;
      const antes = await contarAuditoria(filtro);
      try {
        const r = await tentar(SUPER, `INSERT INTO public.user_roles(user_id, role, concedido_por) VALUES ('${COMUM}', 'admin', '${SUPER}')`);
        const aceita = !r.negado;
        expect({ aceita, auditada: (await contarAuditoria(filtro)) - antes > 0 }).toEqual({ aceita, auditada: aceita });
      } finally {
        await db.query(`DELETE FROM public.user_roles WHERE user_id = '${COMUM}'`);
      }
    });
  });
});
