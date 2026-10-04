-- 0_init: baseline da Lotti extraída do banco de produção (catálogo do Postgres 17).
-- Gerada em 2026-10-04 por api/scripts/schema/gerar-baseline.mjs. NÃO editar à mão.
-- Na produção (Supabase) está marcada como aplicada e nunca roda. Serve para criar
-- bancos novos idênticos ao de produção (ensaio no Railway, shadow DB).
-- Fora, de propósito:
--   - dados;
--   - storage (vai para R2);
--   - pg_cron, pg_net e Vault (agendamentos vão para @nestjs/schedule; segredos nunca vão ao repo);
--   - tabelas de backup _*;
--   - autovacuum desligado em 4 tabelas da produção;
--   - privilégio MAINTAIN (só existe no PG17+).

SET check_function_bodies = false;
SET client_min_messages = warning;

-- ===== Compatibilidade com o Supabase (só age fora dele) =====
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS suporte_privado;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- Colunas de auth.users que as funções do sistema leem. O login próprio (fase 5)
-- substitui esta tabela.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid NOT NULL PRIMARY KEY,
  aud character varying(255),
  role character varying(255),
  email character varying(255),
  encrypted_password character varying(255),
  email_confirmed_at timestamp with time zone,
  invited_at timestamp with time zone,
  last_sign_in_at timestamp with time zone,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  phone text,
  banned_until timestamp with time zone,
  is_anonymous boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone
);

DO $do$ BEGIN
  IF to_regprocedure('auth.jwt()') IS NULL THEN
    EXECUTE $f$CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $b$
      SELECT coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
    $b$$f$;
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    EXECUTE $f$CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $b$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $b$$f$;
  END IF;
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $f$CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $b$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')::text
    $b$$f$;
  END IF;
  IF to_regprocedure('auth.email()') IS NULL THEN
    EXECUTE $f$CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $b$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.email', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')::text
    $b$$f$;
  END IF;
END $do$;

-- ===== Enums =====

CREATE TYPE public.addon_status AS ENUM ('active', 'canceled');

CREATE TYPE public.app_role AS ENUM ('super_admin', 'admin', 'support');

CREATE TYPE public.billing_cycle AS ENUM ('monthly', 'annual');

CREATE TYPE public.canal_contato AS ENUM ('WHATSAPP', 'EMAIL', 'TELEFONE', 'PRESENCIAL', 'OUTRO');

CREATE TYPE public.direcao_contato AS ENUM ('IN', 'OUT');

CREATE TYPE public.discount_type AS ENUM ('percentage', 'fixed');

CREATE TYPE public.finalidade_imovel AS ENUM ('VENDA', 'LOCACAO', 'AMBOS');

CREATE TYPE public.prioridade_alerta AS ENUM ('ALTA', 'MEDIA', 'BAIXA');

CREATE TYPE public.status_funil AS ENUM ('QUALIFICACAO', 'VISITA_PROPOSTA', 'DOCUMENTACAO', 'FECHADO_GANHO', 'FECHADO_PERDIDO');

CREATE TYPE public.status_venda AS ENUM ('DISPONIVEL', 'VENDIDO', 'ALUGADO');

CREATE TYPE public.subscription_status AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'expired', 'read_only');

CREATE TYPE public.tipo_alerta AS ENUM ('FOLLOWUP', 'DOCUMENTO', 'EXCLUSIVIDADE', 'GERAL', 'LEAD_QUENTE', 'PAGAMENTO', 'TRANSFERENCIA');

CREATE TYPE public.tipo_contato AS ENUM ('LIGACAO', 'EMAIL', 'WHATSAPP', 'VISITA', 'PROPOSTA', 'NOTA');

CREATE TYPE public.tipo_contrato AS ENUM ('COMPRA_VENDA', 'LOCACAO_RESIDENCIAL', 'LOCACAO_COMERCIAL', 'EXCLUSIVIDADE_VENDA', 'EXCLUSIVIDADE_LOCACAO', 'DISTRATO', 'PROCURACAO');

CREATE TYPE public.tipo_imovel AS ENUM ('APARTAMENTO', 'CASA', 'COMERCIAL', 'TERRENO');

CREATE TYPE public.tipo_interesse AS ENUM ('COMPRA', 'LOCACAO', 'AMBOS');

-- ===== Tabelas =====

CREATE TABLE public.admin_auditoria (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  ator_user_id uuid,
  acao text NOT NULL,
  entidade text NOT NULL,
  entidade_id text,
  dados_antes jsonb,
  dados_depois jsonb,
  motivo text,
  ip_hash text,
  user_agent text,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.admin_config (
  chave text NOT NULL,
  valor jsonb NOT NULL,
  descricao text,
  atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
  atualizado_por uuid
);

CREATE TABLE public.admin_sessoes_suporte (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  ator_user_id uuid NOT NULL,
  user_id uuid NOT NULL,
  corretor_id uuid NOT NULL,
  auth_session_id uuid NOT NULL,
  criado_em timestamp with time zone DEFAULT now() NOT NULL,
  expira_em timestamp with time zone DEFAULT (now() + '00:30:00'::interval) NOT NULL,
  encerrado_em timestamp with time zone
);

CREATE TABLE public.ai_attachments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  message_id uuid NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size integer NOT NULL,
  storage_path text NOT NULL,
  extracted_text text,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.ai_conversations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid NOT NULL,
  title text DEFAULT 'Nova conversa'::text,
  model text DEFAULT 'grok-4.20-reasoning'::text,
  total_tokens integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  pinned boolean DEFAULT false NOT NULL
);

CREATE TABLE public.ai_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL,
  role text NOT NULL,
  content text DEFAULT ''::text NOT NULL,
  tool_calls jsonb,
  tool_name text,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.ai_rate_limits (
  corretor_id uuid NOT NULL,
  message_count integer DEFAULT 0,
  window_start timestamp with time zone DEFAULT now()
);

CREATE TABLE public.alertas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  cliente_id uuid,
  corretor_id uuid NOT NULL,
  tipo public.tipo_alerta NOT NULL,
  mensagem text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  lido boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  read_at timestamp with time zone,
  origem text,
  entidade_tipo text,
  entidade_id uuid
);

CREATE TABLE public.asaas_checkout_events (
  id text NOT NULL,
  event_type text NOT NULL,
  payment_id text,
  status text DEFAULT 'received'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  error_code text,
  received_at timestamp with time zone DEFAULT now() NOT NULL,
  processed_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.asaas_conexao_segredos (
  conexao_id uuid NOT NULL,
  api_key_ciphertext text,
  webhook_token_ciphertext text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.asaas_conexoes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid NOT NULL,
  ambiente text DEFAULT 'producao'::text NOT NULL,
  status text DEFAULT 'nao_conectada'::text NOT NULL,
  conta_nome text,
  conta_email text,
  conta_cpf_cnpj text,
  chave_final text,
  escopos_faltando text[] DEFAULT '{}'::text[] NOT NULL,
  validada_em timestamp with time zone,
  webhook_id text,
  webhook_slug text,
  webhook_configurado_em timestamp with time zone,
  passo_guia smallint DEFAULT 1 NOT NULL,
  rotacao_pendente boolean DEFAULT false NOT NULL,
  herdada_do_ambiente boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.asaas_webhook_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payment_id text,
  payload jsonb NOT NULL,
  status text DEFAULT 'RECEIVED'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  last_error text,
  corretor_id uuid,
  received_at timestamp with time zone DEFAULT now() NOT NULL,
  processed_at timestamp with time zone
);

CREATE TABLE public.atividade_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  corretor_id uuid,
  tipo text NOT NULL,
  rota text,
  metadata jsonb,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.auditoria_financeira (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  corretor_id uuid,
  entidade text NOT NULL,
  entidade_id uuid NOT NULL,
  acao text NOT NULL,
  dados_antes jsonb,
  dados_depois jsonb,
  calculo jsonb,
  origem text NOT NULL,
  ator text,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.billing_legacy_accounts (
  corretor_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.calendar_connections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  provider text DEFAULT 'google'::text NOT NULL,
  provider_account_id text,
  provider_email text,
  scopes text[] DEFAULT ARRAY[]::text[] NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_expires_at timestamp with time zone,
  oauth_state_hash text,
  pkce_verifier_ciphertext text,
  oauth_expires_at timestamp with time zone,
  privacy_mode text DEFAULT 'partial'::text NOT NULL,
  last_sync_at timestamp with time zone,
  last_error_code text,
  disconnected_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.calendar_event_mappings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  external_calendar_id uuid NOT NULL,
  routine_event_id uuid,
  google_event_id text NOT NULL,
  google_etag text,
  google_updated_at timestamp with time zone,
  sync_version bigint DEFAULT 1 NOT NULL,
  origin text DEFAULT 'google'::text NOT NULL,
  last_synced_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone
);

CREATE TABLE public.calendar_sync_states (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  external_calendar_id uuid NOT NULL,
  sync_token_ciphertext text,
  full_sync_started_at timestamp with time zone,
  last_incremental_sync_at timestamp with time zone,
  last_success_at timestamp with time zone,
  last_error_code text,
  retry_count integer DEFAULT 0 NOT NULL,
  next_retry_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.calendar_watch_channels (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  external_calendar_id uuid NOT NULL,
  channel_id text NOT NULL,
  resource_id text NOT NULL,
  resource_uri text,
  channel_token_hash text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.calendar_webhook_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  channel_id text NOT NULL,
  message_number bigint NOT NULL,
  resource_state text,
  received_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.cancelamento_feedback (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid,
  contato_nome text,
  contato_email text,
  contato_telefone text,
  plano_anterior text,
  motivo text NOT NULL,
  comentario text,
  origem text DEFAULT 'outro'::text NOT NULL,
  data_cancelamento date DEFAULT CURRENT_DATE NOT NULL,
  registrado_por uuid,
  criado_em timestamp with time zone DEFAULT now() NOT NULL,
  atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.checkout_orders (
  id uuid NOT NULL,
  access_token_hash text NOT NULL,
  payer_name text NOT NULL,
  payer_email text NOT NULL,
  payer_document text NOT NULL,
  payer_phone text NOT NULL,
  plan_code text NOT NULL,
  billing_cycle text NOT NULL,
  payment_method text NOT NULL,
  amount numeric(10,2) NOT NULL,
  status text DEFAULT 'creating'::text NOT NULL,
  asaas_customer_id text,
  asaas_subscription_id text,
  asaas_payment_id text,
  provisioned_user_id uuid,
  access_email_sent_at timestamp with time zone,
  provisioning_started_at timestamp with time zone,
  failure_code text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.checkout_payments (
  payment_id text NOT NULL,
  order_id uuid NOT NULL,
  status text NOT NULL,
  due_date date NOT NULL,
  amount numeric(10,2) NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.checkout_rate_limits (
  key_hash text NOT NULL,
  bucket timestamp with time zone NOT NULL,
  attempts integer NOT NULL
);

CREATE TABLE public.cliente_imovel (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  cliente_id uuid NOT NULL,
  imovel_id uuid NOT NULL,
  nivel_interesse integer DEFAULT 5,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.clientes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid NOT NULL,
  nome text NOT NULL,
  telefone text NOT NULL,
  email text,
  cpf text,
  rg text,
  nacionalidade text DEFAULT 'brasileiro(a)'::text,
  estado_civil text,
  profissao text,
  endereco_completo text,
  tipo_interesse public.tipo_interesse DEFAULT 'COMPRA'::public.tipo_interesse NOT NULL,
  status_funil public.status_funil DEFAULT 'QUALIFICACAO'::public.status_funil NOT NULL,
  ultimo_contato timestamp with time zone DEFAULT now(),
  proximo_followup timestamp with time zone,
  observacoes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  tracking_data jsonb DEFAULT '{}'::jsonb,
  asaas_customer_id text,
  is_sample_data boolean DEFAULT false NOT NULL
);

CREATE TABLE public.commercial_diagnostic_events (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  session_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  event text NOT NULL,
  step text
);

CREATE TABLE public.commercial_diagnostics (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  session_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  city text,
  company text,
  consent_at timestamp with time zone NOT NULL,
  answers jsonb NOT NULL,
  attribution jsonb DEFAULT '{}'::jsonb NOT NULL,
  scores jsonb NOT NULL,
  dominant_problem text NOT NULL,
  secondary_problems text[] DEFAULT '{}'::text[] NOT NULL,
  urgency_label text NOT NULL,
  profile_label text NOT NULL,
  recommended_next_step text NOT NULL,
  status text DEFAULT 'novo'::text NOT NULL,
  cta_clicked_at timestamp with time zone
);

CREATE TABLE public.contract_quota_reservations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid NOT NULL,
  period_start date NOT NULL,
  status text DEFAULT 'reserved'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone
);

CREATE TABLE public.contratos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid NOT NULL,
  cliente_id uuid,
  imovel_id uuid,
  tipo public.tipo_contrato NOT NULL,
  valor numeric(15,2) NOT NULL,
  data_inicio date NOT NULL,
  prazo_meses integer,
  dia_vencimento integer,
  indice_reajuste text,
  clausulas_adicionais text[],
  conteudo text NOT NULL,
  status text DEFAULT 'RASCUNHO'::text NOT NULL,
  taxa_administracao_percentual numeric(5,2) DEFAULT 10.00,
  dia_vencimento_aluguel integer DEFAULT 10 NOT NULL,
  dia_repasse_proprietario integer DEFAULT 15 NOT NULL,
  multa_atraso_percentual numeric(5,2) DEFAULT 10.00,
  juros_mora_diario_percentual numeric(5,4) DEFAULT 0.0333,
  dados_bancarios_repasse jsonb,
  vistoria_entrada_url text,
  garantia_tipo text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  arquivo_url text,
  data_proximo_reajuste date,
  data_encerramento date,
  data_fim date,
  observacoes text
);

CREATE TABLE public.contratos_renegociacoes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  contrato_id uuid NOT NULL,
  corretor_id uuid NOT NULL,
  tipo text NOT NULL,
  valores_antes jsonb NOT NULL,
  valores_depois jsonb NOT NULL,
  indice_aplicado text,
  percentual numeric(8,4),
  vigencia_inicio date NOT NULL,
  motivo text,
  criado_por uuid,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.corretores (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  nome text NOT NULL,
  creci text NOT NULL,
  creci_estado character(2) DEFAULT 'SP'::bpchar NOT NULL,
  email text NOT NULL,
  telefone text NOT NULL,
  endereco text,
  website text,
  razao_social text,
  cnpj_cpf text,
  endereco_completo text,
  foto_url text,
  preferencias jsonb DEFAULT '{"tema": "light", "sidebar_expandida": true}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  status text DEFAULT 'ativo'::text NOT NULL,
  suspenso_em timestamp with time zone,
  suspenso_motivo text,
  suspenso_por uuid,
  ultimo_acesso_em timestamp with time zone,
  cidade text,
  estado character(2),
  tipo_atuacao text,
  regioes_atendidas text[] DEFAULT ARRAY[]::text[] NOT NULL,
  especialidade text,
  fuso_horario text DEFAULT 'America/Sao_Paulo'::text NOT NULL,
  creci_status text DEFAULT 'nao_informado'::text NOT NULL
);

CREATE TABLE public.crm_etapas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid NOT NULL,
  nome text NOT NULL,
  ordem integer DEFAULT 0 NOT NULL,
  cor text DEFAULT 'slate'::text NOT NULL,
  tipo text DEFAULT 'ABERTA'::text NOT NULL,
  ativo boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.crm_oportunidades (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid NOT NULL,
  cliente_id uuid,
  imovel_id uuid,
  etapa_id uuid NOT NULL,
  titulo text NOT NULL,
  valor_estimado numeric(15,2) DEFAULT 0 NOT NULL,
  probabilidade integer DEFAULT 0 NOT NULL,
  data_prevista_fechamento date,
  motivo_perda text,
  origem text,
  ordem integer DEFAULT 0 NOT NULL,
  observacoes text,
  fechada_em timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  is_sample_data boolean DEFAULT false NOT NULL
);

CREATE TABLE public.crm_tarefas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid NOT NULL,
  oportunidade_id uuid,
  cliente_id uuid,
  titulo text NOT NULL,
  descricao text,
  tipo text DEFAULT 'OUTRO'::text NOT NULL,
  data_prevista timestamp with time zone,
  concluida boolean DEFAULT false NOT NULL,
  concluida_em timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  is_sample_data boolean DEFAULT false NOT NULL
);

CREATE TABLE public.documentos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  corretor_id uuid,
  cliente_id uuid,
  imovel_id uuid,
  nome text NOT NULL,
  tipo text NOT NULL,
  arquivo_path text NOT NULL,
  data_validade timestamp with time zone,
  observacoes text,
  validado boolean DEFAULT false,
  arquivo_url text
);

CREATE TABLE public.external_calendars (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  connection_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  external_calendar_id text NOT NULL,
  summary text NOT NULL,
  color text,
  access_role text,
  selected boolean DEFAULT true NOT NULL,
  is_primary boolean DEFAULT false NOT NULL,
  is_default boolean DEFAULT false NOT NULL,
  sync_direction text DEFAULT 'bidirectional'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.fachada_escaneamentos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  fachada_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  user_agent text,
  ip_hash text
);

CREATE TABLE public.fachada_leads (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  fachada_id uuid NOT NULL,
  nome text NOT NULL,
  telefone text NOT NULL,
  email text,
  convertido boolean DEFAULT false NOT NULL,
  cliente_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.fachada_templates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid,
  nome text NOT NULL,
  categoria text DEFAULT 'VENDA'::text NOT NULL,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  padrao boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.fachadas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid NOT NULL,
  imovel_id uuid NOT NULL,
  tipo_negocio text DEFAULT 'VENDA'::text NOT NULL,
  template_id text DEFAULT 'venda-classica'::text NOT NULL,
  cta_principal text DEFAULT 'WHATSAPP'::text NOT NULL,
  modo_conversao boolean DEFAULT false NOT NULL,
  mensagem_whatsapp text,
  logo_url text,
  foto_principal_url text,
  ativo boolean DEFAULT true NOT NULL,
  total_escaneamentos integer DEFAULT 0 NOT NULL,
  total_leads integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  mensagem_contato text
);

CREATE TABLE public.faturas_aluguel (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  contrato_id uuid NOT NULL,
  cliente_id uuid NOT NULL,
  imovel_id uuid NOT NULL,
  corretor_id uuid NOT NULL,
  mes_referencia character(7) NOT NULL,
  data_vencimento date NOT NULL,
  valor_aluguel numeric(15,2) NOT NULL,
  valor_condominio numeric(15,2) DEFAULT 0,
  valor_iptu numeric(15,2) DEFAULT 0,
  valor_extras numeric(15,2) DEFAULT 0,
  valor_desconto numeric(15,2) DEFAULT 0,
  valor_total numeric(15,2) GENERATED ALWAYS AS (((((valor_aluguel + valor_condominio) + valor_iptu) + valor_extras) - valor_desconto)) STORED,
  status text DEFAULT 'PENDENTE'::text NOT NULL,
  data_pagamento date,
  valor_pago numeric(15,2),
  comprovante_url text,
  boleto_url text,
  external_id character varying(255),
  asaas_status character varying(50),
  data_credito date,
  recibo_url text,
  boleto_url_asaas text,
  raw_payload jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  pix_qrcode_text text,
  valor_encargos_recebidos numeric(12,2) DEFAULT 0,
  motivo_cancelamento text,
  gerada_por text DEFAULT 'manual'::text
);

CREATE TABLE public.historico_contatos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  cliente_id uuid NOT NULL,
  tipo public.canal_contato DEFAULT 'WHATSAPP'::public.canal_contato NOT NULL,
  direcao public.direcao_contato NOT NULL,
  conteudo text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  data_contato timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.imoveis (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid NOT NULL,
  titulo text NOT NULL,
  tipo public.tipo_imovel NOT NULL,
  valor numeric(15,2) NOT NULL,
  area_m2 numeric(10,2),
  dormitorios integer DEFAULT 0,
  garagem integer DEFAULT 0,
  endereco text NOT NULL,
  bairro text,
  cidade text NOT NULL,
  estado character(2) DEFAULT 'SP'::bpchar,
  cep text,
  descricao text,
  exclusividade_ate date,
  proprietario_nome text NOT NULL,
  proprietario_cpf text,
  proprietario_telefone text,
  proprietario_email text,
  ativo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  tracking_data jsonb DEFAULT '{}'::jsonb,
  status_venda public.status_venda DEFAULT 'DISPONIVEL'::public.status_venda,
  anunciado boolean DEFAULT false,
  finalidade public.finalidade_imovel DEFAULT 'VENDA'::public.finalidade_imovel NOT NULL,
  banheiros integer DEFAULT 0,
  descricao_curta text,
  proprietario_id uuid,
  suites integer,
  is_sample_data boolean DEFAULT false NOT NULL
);

CREATE TABLE public.imovel_fotos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  imovel_id uuid NOT NULL,
  arquivo_path text NOT NULL,
  arquivo_url text NOT NULL,
  ordem integer DEFAULT 0,
  principal boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.job_queue (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  job_type text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  dedupe_key text,
  status text DEFAULT 'PENDING'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  max_attempts integer DEFAULT 5 NOT NULL,
  run_after timestamp with time zone DEFAULT now() NOT NULL,
  last_error text,
  corretor_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  started_at timestamp with time zone,
  finished_at timestamp with time zone
);

CREATE TABLE public.lancamentos_financeiros (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid NOT NULL,
  tipo text NOT NULL,
  categoria text NOT NULL,
  descricao text NOT NULL,
  valor numeric(15,2) NOT NULL,
  data timestamp with time zone NOT NULL,
  recorrente boolean DEFAULT false,
  contrato_id uuid,
  imovel_id uuid,
  comprovante_url text,
  created_at timestamp with time zone DEFAULT now(),
  fatura_id uuid
);

CREATE TABLE public.leads_sem_destino (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  nome text NOT NULL,
  telefone text NOT NULL,
  email text,
  mensagem text,
  tracking_data jsonb DEFAULT '{}'::jsonb NOT NULL,
  motivo text NOT NULL,
  atribuido_a uuid,
  atribuido_em timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.lotti_agent_bridge_endpoint (
  id boolean DEFAULT true NOT NULL,
  host text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.lotti_agent_channels (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid NOT NULL,
  instance text NOT NULL,
  enabled boolean DEFAULT false NOT NULL,
  sandbox boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  account_phone text,
  archived_at timestamp with time zone,
  company_name text,
  account_bound_at timestamp with time zone
);

CREATE TABLE public.lotti_agent_conversations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  channel_id uuid NOT NULL,
  corretor_id uuid NOT NULL,
  cliente_id uuid,
  phone text,
  mode text DEFAULT 'ai'::text NOT NULL,
  revision bigint DEFAULT 0 NOT NULL,
  processed_revision bigint DEFAULT 0 NOT NULL,
  lease_token uuid,
  lease_until timestamp with time zone,
  next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  qualification jsonb DEFAULT '{}'::jsonb NOT NULL,
  notified_stage text,
  last_error text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  status text DEFAULT 'open'::text NOT NULL,
  contact_name text,
  archived_at timestamp with time zone,
  opted_out_at timestamp with time zone,
  followup_step smallint DEFAULT 0 NOT NULL,
  followup_due_at timestamp with time zone,
  followup_revision bigint,
  lid text,
  contact_name_source text,
  pausa_ia_ate timestamp with time zone,
  falhas_de_envio integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.lotti_agent_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL,
  external_id text NOT NULL,
  direction text NOT NULL,
  sender text NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  media_path text
);

CREATE TABLE public.lotti_agent_outbox (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL,
  revision bigint NOT NULL,
  content text NOT NULL,
  status text DEFAULT 'prepared'::text NOT NULL,
  external_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.lotti_agent_settings (
  corretor_id uuid NOT NULL,
  settings jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid
);

CREATE TABLE public.lotti_agent_usage (
  corretor_id uuid NOT NULL,
  phone text NOT NULL,
  period_start date NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.lotti_automation_heartbeat (
  id smallint DEFAULT 1 NOT NULL,
  seen_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.lotti_broadcast_campaigns (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid NOT NULL,
  name text NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  body text DEFAULT ''::text NOT NULL,
  stage_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  starts_at timestamp with time zone,
  interval_seconds integer DEFAULT 60 NOT NULL,
  max_recipients integer DEFAULT 100 NOT NULL,
  reply_policy text DEFAULT 'preserve'::text NOT NULL,
  total integer DEFAULT 0 NOT NULL,
  excluded jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  started_at timestamp with time zone,
  finished_at timestamp with time zone
);

CREATE TABLE public.lotti_broadcast_deliveries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  campaign_id uuid NOT NULL,
  corretor_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  scheduled_at timestamp with time zone NOT NULL,
  content text NOT NULL,
  lease_token uuid,
  attempts integer DEFAULT 0 NOT NULL,
  reason text,
  external_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.lotti_broadcast_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  campaign_id uuid NOT NULL,
  kind text NOT NULL,
  detail jsonb DEFAULT '{}'::jsonb NOT NULL,
  actor_label text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.lotti_inbox_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL,
  kind text NOT NULL,
  from_label text,
  to_label text NOT NULL,
  subject_label text,
  actor_label text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.lotti_manual_sends (
  request_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  corretor_id uuid NOT NULL,
  fingerprint text NOT NULL,
  content text NOT NULL,
  media_path text,
  status text DEFAULT 'sending'::text NOT NULL,
  external_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.onboarding_checklist (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  minimized boolean DEFAULT false NOT NULL,
  dismissed_at timestamp with time zone,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.onboarding_events (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  profile_id uuid,
  event_name text NOT NULL,
  step_key text,
  source text DEFAULT 'onboarding'::text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.onboarding_preferences (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  tips_enabled boolean DEFAULT true NOT NULL,
  assistant_enabled boolean DEFAULT true NOT NULL,
  preferred_shortcuts text[] DEFAULT ARRAY[]::text[] NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.onboarding_profiles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  persona text,
  primary_goal text,
  data_entry_strategy text,
  creci_status text DEFAULT 'nao_informado'::text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  criado_em timestamp with time zone DEFAULT now() NOT NULL,
  atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.onboarding_progress (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  current_step text DEFAULT 'boas_vindas'::text NOT NULL,
  completed_steps text[] DEFAULT ARRAY[]::text[] NOT NULL,
  skipped_steps text[] DEFAULT ARRAY[]::text[] NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
  dismissed_at timestamp with time zone,
  first_value_at timestamp with time zone,
  onboarding_version integer DEFAULT 1 NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE public.onboarding_sample_data (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.onboarding_steps (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  step_key text NOT NULL,
  status text DEFAULT 'iniciado'::text NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE public.onboarding_tours (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid NOT NULL,
  tour_key text NOT NULL,
  current_step integer DEFAULT 0 NOT NULL,
  completed_at timestamp with time zone,
  dismissed_at timestamp with time zone,
  atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.organizacao_convites (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  email text NOT NULL,
  papel text DEFAULT 'corretor'::text NOT NULL,
  token_hash text NOT NULL,
  status text DEFAULT 'pendente'::text NOT NULL,
  expira_em timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
  criado_por uuid NOT NULL,
  aceito_por uuid,
  aceito_em timestamp with time zone,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.parceiro_atribuicoes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  parceiro_id uuid NOT NULL,
  link_id uuid,
  visitante_id uuid NOT NULL,
  user_id uuid,
  corretor_id uuid,
  modelo text DEFAULT 'primeiro_clique'::text NOT NULL,
  janela_dias integer NOT NULL,
  primeiro_clique_em timestamp with time zone DEFAULT now() NOT NULL,
  expira_em timestamp with time zone NOT NULL,
  convertido_em timestamp with time zone,
  status text DEFAULT 'pendente'::text NOT NULL,
  motivo_invalidacao text,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.parceiro_cliques (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  link_id uuid NOT NULL,
  parceiro_id uuid NOT NULL,
  visitante_id uuid NOT NULL,
  ip_hash text,
  user_agent text,
  referer text,
  utm jsonb,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.parceiro_comissoes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  parceiro_id uuid NOT NULL,
  atribuicao_id uuid NOT NULL,
  receita_evento_id uuid NOT NULL,
  corretor_id uuid,
  valor_base numeric(12,2) NOT NULL,
  percentual_aplicado numeric(5,2) NOT NULL,
  base_calculo text NOT NULL,
  percentual_id uuid,
  valor_comissao numeric(12,2) NOT NULL,
  status text DEFAULT 'pendente'::text NOT NULL,
  competencia date,
  gerada_em timestamp with time zone DEFAULT now() NOT NULL,
  aprovada_em timestamp with time zone,
  aprovada_por uuid,
  paga_em timestamp with time zone,
  pagamento_id uuid,
  cancelada_em timestamp with time zone,
  cancelada_por uuid,
  motivo_cancelamento text,
  atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.parceiro_links (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  parceiro_id uuid NOT NULL,
  slug text NOT NULL,
  campanha text,
  principal boolean DEFAULT false NOT NULL,
  ativo boolean DEFAULT true NOT NULL,
  revogado_em timestamp with time zone,
  criado_por uuid,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.parceiro_lote_itens (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lote_id uuid NOT NULL,
  parceiro_id uuid NOT NULL,
  comissao_id uuid NOT NULL,
  valor numeric(12,2) NOT NULL,
  nome_beneficiario text NOT NULL,
  documento_beneficiario text,
  chave_pix text NOT NULL,
  tipo_chave_pix text NOT NULL,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.parceiro_lotes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  referencia text NOT NULL,
  status text DEFAULT 'rascunho'::text NOT NULL,
  valor_total numeric(12,2) DEFAULT 0 NOT NULL,
  total_parceiros integer DEFAULT 0 NOT NULL,
  total_comissoes integer DEFAULT 0 NOT NULL,
  saldo_minimo numeric(12,2),
  exportado_em timestamp with time zone,
  pago_em date,
  referencia_pagamento text,
  comprovante_url text,
  observacoes text,
  motivo_cancelamento text,
  criado_por uuid,
  criado_em timestamp with time zone DEFAULT now() NOT NULL,
  atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.parceiro_pagamentos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  parceiro_id uuid NOT NULL,
  valor_total numeric(12,2) NOT NULL,
  metodo text,
  referencia text,
  competencia_inicio date,
  competencia_fim date,
  pago_em date DEFAULT CURRENT_DATE NOT NULL,
  comprovante_url text,
  observacoes text,
  registrado_por uuid,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.parceiro_percentuais (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  parceiro_id uuid NOT NULL,
  percentual numeric(5,2) NOT NULL,
  base_calculo text DEFAULT 'receita_bruta'::text NOT NULL,
  valor_fixo numeric(12,2),
  vigencia_inicio date DEFAULT CURRENT_DATE NOT NULL,
  vigencia_fim date,
  motivo text,
  criado_por uuid,
  criado_em timestamp with time zone DEFAULT now() NOT NULL,
  teto_renovacoes integer
);

CREATE TABLE public.parceiros (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  nome text NOT NULL,
  empresa text,
  documento text,
  email text NOT NULL,
  telefone text,
  responsavel text,
  status text DEFAULT 'ativo'::text NOT NULL,
  data_inicio date DEFAULT CURRENT_DATE NOT NULL,
  janela_atribuicao_dias integer DEFAULT 90 NOT NULL,
  observacoes text,
  user_id uuid,
  criado_por uuid,
  criado_em timestamp with time zone DEFAULT now() NOT NULL,
  atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
  chave_pix text,
  tipo_chave_pix text,
  cortesia_dias integer,
  cortesia_expira_em date,
  tipo text,
  documento_beneficiario text,
  convidado_em timestamp with time zone,
  convite_aceito_em timestamp with time zone,
  convite_status text DEFAULT 'nao_enviado'::text NOT NULL
);

CREATE TABLE public.plan_entitlements (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  plan_id uuid NOT NULL,
  feature_key text NOT NULL,
  feature_name text NOT NULL,
  category text DEFAULT 'geral'::text NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  limit_value integer,
  unlimited boolean DEFAULT false NOT NULL,
  display_order smallint DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.plans (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text DEFAULT ''::text NOT NULL,
  monthly_price numeric(10,2) NOT NULL,
  annual_price numeric(10,2) NOT NULL,
  active boolean DEFAULT true NOT NULL,
  highlighted boolean DEFAULT false NOT NULL,
  display_order smallint DEFAULT 0 NOT NULL,
  trial_days smallint DEFAULT 14 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.pricing_campaigns (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  discount_type public.discount_type DEFAULT 'percentage'::public.discount_type NOT NULL,
  discount_value numeric(10,2) NOT NULL,
  maximum_customers integer,
  current_customers integer DEFAULT 0 NOT NULL,
  starts_at timestamp with time zone NOT NULL,
  ends_at timestamp with time zone,
  duration_months integer DEFAULT 12 NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.proprietarios (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid NOT NULL,
  nome text NOT NULL,
  cpf_cnpj text,
  email text,
  telefone text,
  chave_pix text,
  tipo_chave_pix text,
  dados_bancarios jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.public_request_limits (
  scope text NOT NULL,
  subject_hash text NOT NULL,
  hits integer NOT NULL,
  expires_at timestamp with time zone NOT NULL
);

CREATE TABLE public.receita_eventos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid,
  subscription_id uuid,
  origem text NOT NULL,
  external_id text,
  tipo text DEFAULT 'assinatura'::text NOT NULL,
  valor_bruto numeric(12,2) NOT NULL,
  valor_liquido numeric(12,2),
  moeda text DEFAULT 'BRL'::text NOT NULL,
  status text DEFAULT 'confirmado'::text NOT NULL,
  confirmado_em timestamp with time zone DEFAULT now() NOT NULL,
  competencia date,
  registrado_por uuid,
  motivo text,
  estornado_em timestamp with time zone,
  estornado_por uuid,
  motivo_estorno text,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.repasses_proprietario (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  fatura_origem_id uuid,
  contrato_id uuid NOT NULL,
  corretor_id uuid NOT NULL,
  proprietario_nome text NOT NULL,
  data_prevista date NOT NULL,
  valor_bruto_recebido numeric(15,2) NOT NULL,
  valor_taxa_adm numeric(15,2) NOT NULL,
  valor_liquido_repasse numeric(15,2) NOT NULL,
  status text DEFAULT 'AGENDADO'::text NOT NULL,
  data_transferencia date,
  comprovante_transferencia_url text,
  external_id character varying(255),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  proprietario_id uuid,
  transferencia_status text,
  transferencia_efetivada_em timestamp with time zone,
  transferencia_payload jsonb,
  conciliacao_pendente text
);

CREATE TABLE public.routine_activity_log (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  organization_id uuid NOT NULL,
  actor_user_id uuid,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  changes jsonb DEFAULT '{}'::jsonb NOT NULL,
  source text DEFAULT 'user'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.routine_automation_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  automation_id uuid NOT NULL,
  source_event_id text,
  dedupe_key text NOT NULL,
  status text NOT NULL,
  result jsonb DEFAULT '{}'::jsonb NOT NULL,
  error_code text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone
);

CREATE TABLE public.routine_automations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  created_by uuid DEFAULT auth.uid() NOT NULL,
  name text NOT NULL,
  source_rule text NOT NULL,
  action_type text NOT NULL,
  assignee_strategy text DEFAULT 'entity_owner'::text NOT NULL,
  due_offset_minutes integer DEFAULT 0 NOT NULL,
  notification_channel text DEFAULT 'in_app'::text NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.routine_entity_links (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  event_id uuid,
  task_id uuid,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.routine_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  assigned_to uuid NOT NULL,
  created_by uuid DEFAULT auth.uid() NOT NULL,
  title text NOT NULL,
  description text,
  activity_type text DEFAULT 'outro'::text NOT NULL,
  status text DEFAULT 'confirmed'::text NOT NULL,
  priority text DEFAULT 'medium'::text NOT NULL,
  start_at timestamp with time zone NOT NULL,
  end_at timestamp with time zone NOT NULL,
  all_day boolean DEFAULT false NOT NULL,
  timezone text DEFAULT 'America/Sao_Paulo'::text NOT NULL,
  recurrence_rule text,
  location text,
  visibility text DEFAULT 'team'::text NOT NULL,
  source text DEFAULT 'lotti'::text NOT NULL,
  client_id uuid,
  property_id uuid,
  deal_id uuid,
  contract_id uuid,
  rental_id uuid,
  sync_status text DEFAULT 'local'::text NOT NULL,
  sync_version bigint DEFAULT 1 NOT NULL,
  completed_at timestamp with time zone,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.routine_inbox (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text DEFAULT 'note'::text NOT NULL,
  content text NOT NULL,
  attachment_url text,
  status text DEFAULT 'unprocessed'::text NOT NULL,
  extracted_data jsonb DEFAULT '{}'::jsonb NOT NULL,
  converted_event_id uuid,
  converted_task_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.routine_memberships (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text DEFAULT 'corretor'::text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  team_name text,
  unit_name text,
  display_name text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  job_role text
);

CREATE TABLE public.routine_organizations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  legacy_corretor_id uuid NOT NULL,
  name text NOT NULL,
  timezone text DEFAULT 'America/Sao_Paulo'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  trade_name text,
  cnpj text,
  phone text,
  email text,
  city text,
  state character(2),
  logo_url text,
  team_size text,
  operation_types text[] DEFAULT ARRAY[]::text[] NOT NULL,
  organization_type text DEFAULT 'individual'::text NOT NULL
);

CREATE TABLE public.routine_preferences (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  timezone text DEFAULT 'America/Sao_Paulo'::text NOT NULL,
  default_view text DEFAULT 'week'::text NOT NULL,
  workday_start time without time zone DEFAULT '08:00:00'::time without time zone NOT NULL,
  workday_end time without time zone DEFAULT '18:00:00'::time without time zone NOT NULL,
  default_event_minutes integer DEFAULT 60 NOT NULL,
  default_reminder_minutes integer DEFAULT 120 NOT NULL,
  quiet_hours_start time without time zone,
  quiet_hours_end time without time zone,
  daily_summary boolean DEFAULT true NOT NULL,
  weekly_summary boolean DEFAULT true NOT NULL,
  notification_channels text[] DEFAULT ARRAY['in_app'::text] NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.routine_reminders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_id uuid,
  task_id uuid,
  remind_at timestamp with time zone NOT NULL,
  minutes_before integer,
  channel text DEFAULT 'in_app'::text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.routine_task_checklists (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  task_id uuid NOT NULL,
  title text NOT NULL,
  completed boolean DEFAULT false NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.routine_tasks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  assigned_to uuid NOT NULL,
  created_by uuid DEFAULT auth.uid() NOT NULL,
  title text NOT NULL,
  description text,
  activity_type text DEFAULT 'tarefa_administrativa'::text NOT NULL,
  status text DEFAULT 'todo'::text NOT NULL,
  priority text DEFAULT 'medium'::text NOT NULL,
  due_at timestamp with time zone,
  estimated_minutes integer,
  timezone text DEFAULT 'America/Sao_Paulo'::text NOT NULL,
  recurrence_rule text,
  visibility text DEFAULT 'team'::text NOT NULL,
  source text DEFAULT 'lotti'::text NOT NULL,
  client_id uuid,
  property_id uuid,
  deal_id uuid,
  contract_id uuid,
  rental_id uuid,
  completed_at timestamp with time zone,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  is_sample_data boolean DEFAULT false NOT NULL
);

CREATE TABLE public.subscription_addons (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  subscription_id uuid NOT NULL,
  corretor_id uuid NOT NULL,
  addon_code text NOT NULL,
  addon_name text NOT NULL,
  quantity integer DEFAULT 1 NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  status public.addon_status DEFAULT 'active'::public.addon_status NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.subscriptions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  billing_cycle public.billing_cycle DEFAULT 'monthly'::public.billing_cycle NOT NULL,
  status public.subscription_status DEFAULT 'trialing'::public.subscription_status NOT NULL,
  trial_started_at timestamp with time zone,
  trial_ends_at timestamp with time zone,
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  cancel_at_period_end boolean DEFAULT false NOT NULL,
  canceled_at timestamp with time zone,
  cancel_reason text,
  external_subscription_id text,
  founder_campaign_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.usage_counters (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  corretor_id uuid NOT NULL,
  feature_key text NOT NULL,
  used_quantity integer DEFAULT 0 NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.user_roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  concedido_por uuid,
  concedido_em timestamp with time zone DEFAULT now() NOT NULL,
  revogado_em timestamp with time zone,
  revogado_por uuid,
  motivo text
);

CREATE TABLE public.webhook_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  provider character varying(50) DEFAULT 'ASAAS'::character varying NOT NULL,
  event_type character varying(100),
  payload jsonb,
  processed_at timestamp with time zone DEFAULT now(),
  status character varying(20)
);

CREATE TABLE suporte_privado.credenciais (
  sessao_id uuid NOT NULL,
  access_token text NOT NULL
);

-- ===== Funções =====

CREATE OR REPLACE FUNCTION private.routine_can_view_item(_organization_id uuid, _assigned_to uuid, _created_by uuid, _visibility text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT private.routine_is_member(_organization_id) AND (
        _assigned_to = (SELECT auth.uid())
        OR _created_by = (SELECT auth.uid())
        OR (
            coalesce(_visibility, 'team') <> 'private'
            AND private.routine_member_has_role(
                _organization_id,
                ARRAY['proprietario','administrador','gestor']
            )
        )
    )
$function$
;

CREATE OR REPLACE FUNCTION private.routine_can_write_event_id(_event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.routine_events e
        WHERE e.id = _event_id
          AND private.routine_can_write_item(e.organization_id, e.assigned_to, e.created_by, e.visibility)
    )
$function$
;

CREATE OR REPLACE FUNCTION private.routine_can_write_item(_organization_id uuid, _assigned_to uuid, _created_by uuid, _visibility text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT private.routine_is_member(_organization_id)
       AND private.routine_user_is_member(_organization_id, _assigned_to)
       AND (
          _assigned_to = (SELECT auth.uid())
          OR (
              coalesce(_visibility, 'team') <> 'private'
              AND private.routine_member_has_role(
                  _organization_id,
                  ARRAY['proprietario','administrador','gestor']
              )
          )
       )
$function$
;

CREATE OR REPLACE FUNCTION private.routine_can_write_task_id(_task_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.routine_tasks t
        WHERE t.id = _task_id
          AND private.routine_can_write_item(t.organization_id, t.assigned_to, t.created_by, t.visibility)
    )
$function$
;

CREATE OR REPLACE FUNCTION private.routine_connection_owned(_connection_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.calendar_connections c
        WHERE c.id = _connection_id
          AND c.user_id = (SELECT auth.uid())
          AND private.routine_is_member(c.organization_id)
    )
$function$
;

CREATE OR REPLACE FUNCTION private.routine_connection_owned_in_org(_connection_id uuid, _organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.calendar_connections c
        WHERE c.id = _connection_id
          AND c.organization_id = _organization_id
          AND c.user_id = (SELECT auth.uid())
          AND private.routine_is_member(c.organization_id)
    )
$function$
;

CREATE OR REPLACE FUNCTION private.routine_is_member(_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.routine_memberships m
        WHERE m.organization_id = _organization_id
          AND m.user_id = (SELECT auth.uid())
          AND m.status = 'active'
    )
$function$
;

CREATE OR REPLACE FUNCTION private.routine_member_has_role(_organization_id uuid, _roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.routine_memberships m
        WHERE m.organization_id = _organization_id
          AND m.user_id = (SELECT auth.uid())
          AND m.status = 'active'
          AND m.role = ANY (_roles)
    )
$function$
;

CREATE OR REPLACE FUNCTION private.routine_user_is_member(_organization_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT _user_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.routine_memberships m
        WHERE m.organization_id = _organization_id
          AND m.user_id = _user_id
          AND m.status = 'active'
    )
$function$
;

CREATE OR REPLACE FUNCTION public.aceitar_convite_organizacao(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_inv public.organizacao_convites%ROWTYPE;
    v_profile UUID;
    v_email TEXT;
    v_system_role TEXT;
BEGIN
    v_email := lower(COALESCE(auth.jwt()->>'email',''));
    SELECT * INTO v_inv FROM public.organizacao_convites
     WHERE token_hash = encode(extensions.digest(p_token,'sha256'),'hex') FOR UPDATE;
    IF v_inv.id IS NULL OR v_inv.status <> 'pendente' OR v_inv.expira_em <= now() THEN
        RAISE EXCEPTION 'convite inválido ou expirado';
    END IF;
    IF lower(v_inv.email) <> v_email THEN RAISE EXCEPTION 'este convite pertence a outro e-mail'; END IF;
    SELECT id INTO v_profile FROM public.onboarding_profiles WHERE user_id = auth.uid();
    v_system_role := CASE
        WHEN v_inv.papel IN ('gestor','corretor','financeiro','juridico') THEN v_inv.papel
        ELSE 'colaborador'
    END;

    UPDATE public.routine_memberships SET status='revoked', updated_at=now()
     WHERE user_id=auth.uid() AND status='active';
    INSERT INTO public.routine_memberships
        (organization_id,user_id,role,job_role,status,display_name)
    VALUES (
        v_inv.organization_id,
        auth.uid(),
        v_system_role,
        v_inv.papel,
        'active',
        (SELECT nome FROM public.corretores WHERE user_id=auth.uid())
    )
    ON CONFLICT (organization_id,user_id) DO UPDATE SET
        status='active',role=EXCLUDED.role,job_role=EXCLUDED.job_role,
        display_name=EXCLUDED.display_name,updated_at=now();
    UPDATE public.onboarding_profiles SET
        organization_id=v_inv.organization_id,persona='usuario_convidado',atualizado_em=now()
     WHERE id=v_profile;
    UPDATE public.organizacao_convites SET status='aceito',aceito_por=auth.uid(),aceito_em=now()
     WHERE id=v_inv.id;
    RETURN jsonb_build_object('organization_id',v_inv.organization_id,'papel',v_inv.papel);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_cancelar_lote(p_lote_id uuid, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_status TEXT;
    v_itens  INT;
BEGIN
    PERFORM public.exigir_super_admin();

    IF length(btrim(COALESCE(p_motivo, ''))) < 10 THEN
        RAISE EXCEPTION 'informe uma justificativa com ao menos 10 caracteres';
    END IF;

    SELECT status INTO v_status FROM public.parceiro_lotes WHERE id = p_lote_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'lote não encontrado'; END IF;
    IF v_status = 'pago' THEN
        -- Lote pago não volta atrás: o dinheiro saiu. O caminho é estornar as
        -- comissões individualmente, que deixa trilha própria.
        RAISE EXCEPTION 'lote já pago não pode ser cancelado; estorne as comissões';
    END IF;

    SELECT count(*) INTO v_itens FROM public.parceiro_lote_itens WHERE lote_id = p_lote_id;

    -- Apagar os itens é o que devolve as comissões ao conjunto elegível — a
    -- UNIQUE de `comissao_id` é global, então mantê-los travaria as comissões
    -- num lote morto para sempre. Os totais ficam congelados no lote como
    -- registro do que chegou a ser montado.
    DELETE FROM public.parceiro_lote_itens WHERE lote_id = p_lote_id;

    UPDATE public.parceiro_lotes
       SET status = 'cancelado', motivo_cancelamento = btrim(p_motivo)
     WHERE id = p_lote_id;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois, motivo)
    VALUES
        (auth.uid(), 'cancelar_lote', 'parceiro_lotes', p_lote_id::TEXT,
         jsonb_build_object('status', v_status, 'itens', v_itens),
         jsonb_build_object('status', 'cancelado'),
         btrim(p_motivo));

    RETURN json_build_object('status', 'cancelado', 'comissoes_liberadas', v_itens);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_conceder_papel(p_user_id uuid, p_papel text, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  PERFORM public.exigir_super_admin();

  IF p_papel NOT IN ('support', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'papel inválido: %', p_papel;
  END IF;
  IF length(btrim(COALESCE(p_motivo, ''))) < 10 THEN
    RAISE EXCEPTION 'informe uma justificativa com ao menos 10 caracteres';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'usuário não encontrado';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = p_user_id AND role::TEXT = p_papel AND revogado_em IS NULL
  ) THEN
    RAISE EXCEPTION 'o usuário já possui esse papel';
  END IF;

  INSERT INTO public.user_roles (user_id, role, concedido_por, motivo)
  VALUES (p_user_id, p_papel::public.app_role, auth.uid(), btrim(p_motivo))
  RETURNING id INTO v_id;

  INSERT INTO public.admin_auditoria
    (ator_user_id, acao, entidade, entidade_id, dados_depois, motivo)
  VALUES
    (auth.uid(), 'conceder_papel', 'user_roles', v_id::TEXT,
     jsonb_build_object('user_id', p_user_id, 'papel', p_papel), btrim(p_motivo));

  RETURN json_build_object('id', v_id, 'papel', p_papel);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_config_int(_chave text, _padrao integer)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT COALESCE(
        (SELECT (valor #>> '{}')::INT FROM public.admin_config WHERE chave = _chave),
        _padrao
    )
$function$
;

CREATE OR REPLACE FUNCTION public.admin_config_texto(_chave text, _padrao text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT COALESCE(
        (SELECT valor #>> '{}' FROM public.admin_config WHERE chave = _chave),
        _padrao
    )
$function$
;

CREATE OR REPLACE FUNCTION public.admin_criar_parceiro_completo(p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID := gen_random_uuid();
  v_slug TEXT := lower(btrim(p_dados #>> '{link,slug}'));
  v_email TEXT := lower(btrim(p_dados #>> '{parceiro,email}'));
  v_base TEXT := p_dados #>> '{comissao,base_calculo}';
  v_pct NUMERIC := NULLIF(p_dados #>> '{comissao,percentual}', '')::NUMERIC;
  v_teto INT := NULLIF(p_dados #>> '{comissao,teto_renovacoes}', '')::INT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'acesso negado' USING ERRCODE = '42501'; END IF;
  IF length(btrim(p_dados #>> '{parceiro,nome}')) < 2 OR v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'nome ou e-mail inválido';
  END IF;
  IF v_slug !~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$' THEN RAISE EXCEPTION 'identificador do link inválido'; END IF;
  IF v_pct IS NULL OR v_pct < 0 OR v_pct > 100 THEN RAISE EXCEPTION 'percentual inválido'; END IF;
  IF v_base IS NULL OR v_base NOT IN ('receita_bruta', 'primeiro_pagamento') THEN RAISE EXCEPTION 'regra de renovação inválida'; END IF;
  IF v_base = 'primeiro_pagamento' THEN v_teto := 0; END IF;

  INSERT INTO public.parceiros (id, nome, empresa, documento, email, telefone, responsavel,
    status, janela_atribuicao_dias, observacoes, criado_por, convite_status)
  VALUES (v_id, btrim(p_dados #>> '{parceiro,nome}'), nullif(btrim(p_dados #>> '{parceiro,empresa}'), ''),
    nullif(regexp_replace(p_dados #>> '{parceiro,documento}', '\D', '', 'g'), ''), v_email,
    nullif(btrim(p_dados #>> '{parceiro,telefone}'), ''), nullif(btrim(p_dados #>> '{parceiro,responsavel}'), ''),
    'ativo', COALESCE(NULLIF(p_dados #>> '{parceiro,janela_atribuicao_dias}', '')::INT, 90),
    nullif(btrim(p_dados #>> '{parceiro,observacoes}'), ''), auth.uid(), 'nao_enviado');

  INSERT INTO public.parceiro_percentuais (parceiro_id, percentual, base_calculo, teto_renovacoes, criado_por, motivo)
    VALUES (v_id, v_pct, v_base, v_teto, auth.uid(), 'Regra definida no convite inicial');
  INSERT INTO public.parceiro_links (parceiro_id, slug, campanha, principal, criado_por)
    VALUES (v_id, v_slug, nullif(btrim(p_dados #>> '{link,campanha}'), ''), true, auth.uid());
  RETURN jsonb_build_object('parceiro_id', v_id, 'slug', v_slug);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_definir_percentual(p_parceiro_id uuid, p_percentual numeric, p_base_calculo text, p_valor_fixo numeric DEFAULT NULL::numeric, p_vigencia_inicio date DEFAULT NULL::date, p_motivo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_inicio DATE := COALESCE(p_vigencia_inicio, CURRENT_DATE);
    v_atual  public.parceiro_percentuais;
    v_novo   UUID;
BEGIN
    PERFORM public.exigir_admin();

    IF p_base_calculo NOT IN ('receita_bruta','receita_liquida','primeiro_pagamento','valor_fixo') THEN
        RAISE EXCEPTION 'base de cálculo inválida: %', p_base_calculo;
    END IF;

    -- Vigência retroativa reescreveria a regra de comissões já geradas naquele
    -- intervalo, que é exatamente o que o versionamento existe para impedir.
    SELECT * INTO v_atual FROM public.parceiro_percentuais
     WHERE parceiro_id = p_parceiro_id AND vigencia_fim IS NULL;

    IF FOUND AND v_inicio <= v_atual.vigencia_inicio THEN
        RAISE EXCEPTION 'a nova vigência precisa começar depois de % (início da vigência atual)',
            to_char(v_atual.vigencia_inicio, 'DD/MM/YYYY');
    END IF;

    INSERT INTO public.parceiro_percentuais
        (parceiro_id, percentual, base_calculo, valor_fixo, vigencia_inicio, motivo, criado_por)
    VALUES
        (p_parceiro_id, p_percentual, p_base_calculo, p_valor_fixo, v_inicio, p_motivo, auth.uid())
    RETURNING id INTO v_novo;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois, motivo)
    VALUES
        (auth.uid(), 'definir_percentual', 'parceiros', p_parceiro_id::TEXT,
         CASE WHEN v_atual.id IS NULL THEN NULL
              ELSE jsonb_build_object('percentual', v_atual.percentual, 'base_calculo', v_atual.base_calculo) END,
         jsonb_build_object('percentual', p_percentual, 'base_calculo', p_base_calculo, 'vigencia_inicio', v_inicio),
         p_motivo);

    RETURN json_build_object('id', v_novo, 'vigencia_inicio', v_inicio);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_definir_status_corretor(p_corretor_id uuid, p_status text, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_antes public.corretores;
BEGIN
    PERFORM public.exigir_admin();

    IF p_status NOT IN ('ativo', 'suspenso', 'inativo') THEN
        RAISE EXCEPTION 'status inválido: %', p_status;
    END IF;

    -- Justificativa obrigatória: é ela que dá valor à trilha de auditoria.
    IF length(btrim(COALESCE(p_motivo, ''))) < 10 THEN
        RAISE EXCEPTION 'informe uma justificativa com ao menos 10 caracteres';
    END IF;

    SELECT * INTO v_antes FROM public.corretores WHERE id = p_corretor_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'corretor não encontrado';
    END IF;

    -- Suspender o próprio acesso derrubaria o operador para fora do painel na
    -- ação seguinte, sem ninguém para reverter.
    IF v_antes.user_id = auth.uid() THEN
        RAISE EXCEPTION 'você não pode alterar o status da própria conta';
    END IF;

    IF v_antes.status = p_status THEN
        RETURN json_build_object('alterado', false, 'status', p_status);
    END IF;

    UPDATE public.corretores
       SET status = p_status,
           suspenso_em     = CASE WHEN p_status = 'suspenso' THEN now() ELSE NULL END,
           suspenso_motivo = CASE WHEN p_status = 'suspenso' THEN btrim(p_motivo) ELSE NULL END,
           suspenso_por    = CASE WHEN p_status = 'suspenso' THEN auth.uid() ELSE NULL END
     WHERE id = p_corretor_id;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois, motivo)
    VALUES
        (auth.uid(), 'definir_status_corretor', 'corretores', p_corretor_id::TEXT,
         jsonb_build_object('status', v_antes.status),
         jsonb_build_object('status', p_status),
         btrim(p_motivo));

    RETURN json_build_object('alterado', true, 'status', p_status);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_detalhe_lote(p_lote_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_lote  JSON;
    v_itens JSON;
BEGIN
    PERFORM public.exigir_admin();

    SELECT json_build_object(
        'id', l.id, 'referencia', l.referencia, 'status', l.status,
        'valor_total', l.valor_total, 'total_parceiros', l.total_parceiros,
        'total_comissoes', l.total_comissoes, 'saldo_minimo', l.saldo_minimo,
        'exportado_em', l.exportado_em, 'pago_em', l.pago_em,
        'referencia_pagamento', l.referencia_pagamento, 'comprovante_url', l.comprovante_url,
        'observacoes', l.observacoes, 'motivo_cancelamento', l.motivo_cancelamento,
        'criado_em', l.criado_em
    ) INTO v_lote
    FROM public.parceiro_lotes l WHERE l.id = p_lote_id;

    IF v_lote IS NULL THEN
        RAISE EXCEPTION 'lote não encontrado';
    END IF;

    -- Agrupado por parceiro: é assim que o PIX é feito e é assim que o CSV
    -- precisa somar. Uma linha por comissão obrigaria quem paga a somar à mão.
    SELECT COALESCE(json_agg(linha ORDER BY linha->>'nome'), '[]'::JSON) INTO v_itens
    FROM (
        SELECT json_build_object(
            'parceiro_id', i.parceiro_id,
            'nome',        i.nome_beneficiario,
            'documento',   i.documento_beneficiario,
            'chave_pix',   i.chave_pix,
            'tipo_chave_pix', i.tipo_chave_pix,
            'comissoes',   count(*),
            'valor',       SUM(i.valor)
        ) AS linha
        FROM public.parceiro_lote_itens i
        WHERE i.lote_id = p_lote_id
        GROUP BY i.parceiro_id, i.nome_beneficiario, i.documento_beneficiario,
                 i.chave_pix, i.tipo_chave_pix
    ) sub;

    RETURN json_build_object('lote', v_lote, 'itens', v_itens);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_detalhe_organizacao(p_organizacao_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_resultado JSON;
BEGIN
  PERFORM public.exigir_backoffice();

  SELECT json_build_object(
    'organizacao', json_build_object(
      'id', o.id,
      'nome', o.name,
      'timezone', o.timezone,
      'criado_em', o.created_at,
      'atualizado_em', o.updated_at
    ),
    'responsavel', json_build_object(
      'corretor_id', c.id,
      'user_id', c.user_id,
      'nome', c.nome,
      'email', c.email,
      'telefone', c.telefone,
      'status', c.status,
      'ultimo_acesso_em', c.ultimo_acesso_em
    ),
    'assinatura', (
      SELECT json_build_object(
        'id', s.id,
        'plano', pl.name,
        'plano_codigo', pl.code,
        'status', s.status,
        'ciclo', s.billing_cycle,
        'trial_inicia_em', s.trial_started_at,
        'trial_termina_em', s.trial_ends_at,
        'periodo_inicia_em', s.current_period_start,
        'periodo_termina_em', s.current_period_end,
        'cancelar_no_fim', s.cancel_at_period_end,
        'cancelado_em', s.canceled_at,
        'id_externo', s.external_subscription_id
      )
      FROM public.subscriptions s
      LEFT JOIN public.plans pl ON pl.id = s.plan_id
      WHERE s.corretor_id = c.id
      ORDER BY CASE WHEN s.status IN ('trialing','active','past_due') THEN 0 ELSE 1 END,
               s.created_at DESC
      LIMIT 1
    ),
    'membros', COALESCE((
      SELECT json_agg(json_build_object(
        'id', m.id,
        'user_id', m.user_id,
        'nome', COALESCE(m.display_name, cm.nome, u.email),
        'email', u.email,
        'papel', m.role,
        'status', m.status,
        'ultimo_login_em', u.last_sign_in_at,
        'criado_em', m.created_at
      ) ORDER BY m.created_at)
      FROM public.routine_memberships m
      JOIN auth.users u ON u.id = m.user_id
      LEFT JOIN public.corretores cm ON cm.user_id = m.user_id
      WHERE m.organization_id = o.id
    ), '[]'::JSON),
    'atividade_recente', COALESCE((
      SELECT json_agg(json_build_object(
        'tipo', a.tipo,
        'rota', a.rota,
        'criado_em', a.criado_em
      ) ORDER BY a.criado_em DESC)
      FROM (
        SELECT tipo, rota, criado_em
          FROM public.atividade_eventos
         WHERE corretor_id = c.id
         ORDER BY criado_em DESC
         LIMIT 20
      ) a
    ), '[]'::JSON),
    'pagamentos', json_build_object(
      'disponivel', to_regclass('public.checkout_orders') IS NOT NULL,
      'mensagem', CASE
        WHEN to_regclass('public.checkout_orders') IS NULL
          THEN 'O módulo de checkout SaaS ainda não está instalado neste banco.'
        ELSE 'Consulte a área Pagamentos para os lançamentos da organização.'
      END
    )
  ) INTO v_resultado
  FROM public.routine_organizations o
  JOIN public.corretores c ON c.id = o.legacy_corretor_id
  WHERE o.id = p_organizacao_id;

  IF v_resultado IS NULL THEN
    RAISE EXCEPTION 'organização não encontrada';
  END IF;

  RETURN v_resultado;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_detalhe_usuario(p_corretor_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_janela INT := public.admin_config_int('janela_atividade_dias', 30);
    v_res    JSON;
BEGIN
    PERFORM public.exigir_backoffice();

    SELECT json_build_object(
        'corretor', json_build_object(
            'corretor_id', c.id,
            'user_id', c.user_id,
            'nome', c.nome,
            'email', c.email,
            'telefone', c.telefone,
            'creci', c.creci,
            'creci_estado', c.creci_estado,
            'status', c.status,
            'criado_em', c.created_at,
            'ultimo_acesso_em', c.ultimo_acesso_em,
            'atividade', public.classificar_atividade(c.ultimo_acesso_em, v_janela),
            'suspenso_em', c.suspenso_em,
            'suspenso_motivo', c.suspenso_motivo,
            -- last_sign_in_at do auth é o único dado histórico que existia antes
            -- do back office. Exposto como referência, separado de
            -- ultimo_acesso_em, que é o que a operação passa a medir.
            'ultimo_login_auth', (SELECT u.last_sign_in_at FROM auth.users u WHERE u.id = c.user_id),
            'email_confirmado_em', (SELECT u.email_confirmed_at FROM auth.users u WHERE u.id = c.user_id)
        ),
        'uso', json_build_object(
            'clientes',  (SELECT count(*) FROM public.clientes  WHERE corretor_id = c.id),
            'imoveis',   (SELECT count(*) FROM public.imoveis   WHERE corretor_id = c.id),
            'contratos', (SELECT count(*) FROM public.contratos WHERE corretor_id = c.id),
            'eventos_atividade', (SELECT count(*) FROM public.atividade_eventos WHERE corretor_id = c.id)
        ),
        'assinatura', (
            SELECT json_build_object(
                'status', s.status, 'plano', pl.name, 'ciclo', s.billing_cycle,
                'inicio_periodo', s.current_period_start, 'fim_periodo', s.current_period_end,
                'trial_termina_em', s.trial_ends_at
            )
            FROM public.subscriptions s
            LEFT JOIN public.plans pl ON pl.id = s.plan_id
            WHERE s.corretor_id = c.id
            -- Mesma ordenação da listagem: a assinatura vigente primeiro. Sem
            -- ORDER BY, o LIMIT 1 poderia trazer uma cancelada antiga e a tela
            -- mostraria o plano errado.
            ORDER BY CASE WHEN s.status IN ('trialing','active','past_due') THEN 0 ELSE 1 END,
                     s.created_at DESC
            LIMIT 1
        ),
        'parceiro', (
            SELECT json_build_object(
                'parceiro_id', p.id, 'nome', p.nome,
                'convertido_em', pa.convertido_em, 'modelo', pa.modelo
            )
            FROM public.parceiro_atribuicoes pa
            JOIN public.parceiros p ON p.id = pa.parceiro_id
            WHERE pa.corretor_id = c.id AND pa.status = 'convertida'
            LIMIT 1
        ),
        'atividade_recente', COALESCE((
            SELECT json_agg(json_build_object('tipo', a.tipo, 'rota', a.rota, 'criado_em', a.criado_em)
                            ORDER BY a.criado_em DESC)
            FROM (SELECT * FROM public.atividade_eventos
                   WHERE corretor_id = c.id ORDER BY criado_em DESC LIMIT 20) a
        ), '[]'::json)
    ) INTO v_res
    FROM public.corretores c
    WHERE c.id = p_corretor_id;

    IF v_res IS NULL THEN
        RAISE EXCEPTION 'corretor não encontrado';
    END IF;

    RETURN v_res;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_estornar_receita(p_receita_id uuid, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_atual public.receita_eventos;
BEGIN
    PERFORM public.exigir_super_admin();

    IF length(btrim(COALESCE(p_motivo, ''))) < 10 THEN
        RAISE EXCEPTION 'informe uma justificativa com ao menos 10 caracteres';
    END IF;

    SELECT * INTO v_atual FROM public.receita_eventos WHERE id = p_receita_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'evento de receita não encontrado';
    END IF;

    IF v_atual.status <> 'confirmado' THEN
        RAISE EXCEPTION 'só é possível estornar receita confirmada (atual: %)', v_atual.status;
    END IF;

    -- A trigger tr_estornar_comissao cuida da comissão vinculada.
    UPDATE public.receita_eventos
       SET status = 'estornado', estornado_em = now(),
           estornado_por = auth.uid(), motivo_estorno = btrim(p_motivo)
     WHERE id = p_receita_id;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois, motivo)
    VALUES
        (auth.uid(), 'estornar_receita', 'receita_eventos', p_receita_id::TEXT,
         jsonb_build_object('status', v_atual.status, 'valor_bruto', v_atual.valor_bruto),
         jsonb_build_object('status', 'estornado'), btrim(p_motivo));

    RETURN json_build_object('id', p_receita_id, 'status', 'estornado');
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_gerar_lote_repasse(p_parceiro_ids uuid[], p_saldo_minimo numeric DEFAULT NULL::numeric, p_observacoes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_minimo NUMERIC;
    v_hold   INT;
    v_lote_id UUID;
    v_ref    TEXT;
    v_seq    INT;
    v_total  NUMERIC(12,2);
    v_qtd    INT;
    v_parceiros INT;
BEGIN
    PERFORM public.exigir_admin();

    IF p_parceiro_ids IS NULL OR array_length(p_parceiro_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'selecione ao menos um parceiro';
    END IF;

    v_minimo := COALESCE(p_saldo_minimo,
                         (SELECT (valor #>> '{}')::NUMERIC FROM public.admin_config
                           WHERE chave = 'programa_saldo_minimo'), 0);
    v_hold   := public.admin_config_int('programa_hold_dias', 0);

    -- Referência legível e única por mês. O UNIQUE da coluna é quem garante;
    -- a contagem só escolhe o próximo número.
    SELECT count(*) + 1 INTO v_seq
    FROM public.parceiro_lotes
    WHERE date_trunc('month', criado_em) = date_trunc('month', now());

    v_ref := 'LOTE-' || to_char(now(), 'YYYY-MM') || '-' || lpad(v_seq::TEXT, 4, '0');

    INSERT INTO public.parceiro_lotes (referencia, saldo_minimo, observacoes, criado_por)
    VALUES (v_ref, v_minimo, NULLIF(btrim(COALESCE(p_observacoes, '')), ''), auth.uid())
    RETURNING id INTO v_lote_id;

    -- Um INSERT..SELECT só. Se duas gerações concorrerem pela mesma comissão,
    -- a UNIQUE de `comissao_id` derruba a segunda inteira — a função é
    -- atômica, então não sobra lote pela metade.
    WITH elegiveis AS (
        SELECT c.id AS comissao_id, c.parceiro_id, c.valor_comissao,
               p.nome, p.documento, p.chave_pix, p.tipo_chave_pix,
               SUM(c.valor_comissao) OVER (PARTITION BY c.parceiro_id) AS saldo_parceiro
        FROM public.parceiro_comissoes c
        JOIN public.parceiros p ON p.id = c.parceiro_id
        WHERE c.parceiro_id = ANY (p_parceiro_ids)
          AND c.status = 'aprovada'
          AND p.status = 'ativo'
          AND p.chave_pix IS NOT NULL
          AND p.tipo_chave_pix IS NOT NULL
          AND c.gerada_em <= now() - make_interval(days => v_hold)
          AND NOT EXISTS (
              SELECT 1 FROM public.parceiro_lote_itens i WHERE i.comissao_id = c.id
          )
    )
    INSERT INTO public.parceiro_lote_itens
        (lote_id, parceiro_id, comissao_id, valor,
         nome_beneficiario, documento_beneficiario, chave_pix, tipo_chave_pix)
    SELECT v_lote_id, e.parceiro_id, e.comissao_id, e.valor_comissao,
           e.nome, e.documento, e.chave_pix, e.tipo_chave_pix
    FROM elegiveis e
    WHERE e.saldo_parceiro >= v_minimo;

    SELECT COALESCE(SUM(valor), 0), count(*), count(DISTINCT parceiro_id)
    INTO v_total, v_qtd, v_parceiros
    FROM public.parceiro_lote_itens WHERE lote_id = v_lote_id;

    IF v_qtd = 0 THEN
        -- Lote vazio não é registro: é ruído no histórico e um CSV em branco
        -- que alguém vai tentar entender depois.
        DELETE FROM public.parceiro_lotes WHERE id = v_lote_id;
        RAISE EXCEPTION 'nenhuma comissão elegível para os parceiros selecionados';
    END IF;

    UPDATE public.parceiro_lotes
       SET valor_total = v_total, total_comissoes = v_qtd, total_parceiros = v_parceiros
     WHERE id = v_lote_id;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_depois)
    VALUES
        (auth.uid(), 'gerar_lote_repasse', 'parceiro_lotes', v_lote_id::TEXT,
         jsonb_build_object('referencia', v_ref, 'valor_total', v_total,
                            'comissoes', v_qtd, 'parceiros', v_parceiros));

    RETURN json_build_object(
        'id', v_lote_id, 'referencia', v_ref, 'valor_total', v_total,
        'total_comissoes', v_qtd, 'total_parceiros', v_parceiros
    );
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_listar_acessos(p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_busca TEXT := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_limite INT := LEAST(GREATEST(COALESCE(p_limite, 25), 1), 100);
  v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
  v_total BIGINT;
  v_itens JSON;
BEGIN
  PERFORM public.exigir_super_admin();

  SELECT COALESCE(json_agg(to_jsonb(x) - 'total_geral' ORDER BY x.nome), '[]'::JSON),
         COALESCE(max(x.total_geral), 0)
    INTO v_itens, v_total
    FROM (
      SELECT
        u.id AS user_id,
        COALESCE(c.nome, u.email, 'Usuário') AS nome,
        u.email,
        u.last_sign_in_at AS ultimo_login_em,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', r.id,
            'papel', r.role::TEXT,
            'concedido_em', r.concedido_em
          ) ORDER BY r.role::TEXT)
          FROM public.user_roles r
          WHERE r.user_id = u.id AND r.revogado_em IS NULL
        ), '[]'::JSON) AS papeis,
        count(*) OVER () AS total_geral
      FROM auth.users u
      LEFT JOIN public.corretores c ON c.user_id = u.id
      WHERE v_busca IS NULL
         OR COALESCE(c.nome, '') ILIKE '%' || v_busca || '%'
         OR COALESCE(u.email, '') ILIKE '%' || v_busca || '%'
      ORDER BY COALESCE(c.nome, u.email), u.id
      LIMIT v_limite OFFSET v_offset
    ) x;

  RETURN json_build_object('itens', v_itens, 'total', v_total);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_listar_assinaturas(p_busca text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_plano text DEFAULT NULL::text, p_ciclo text DEFAULT NULL::text, p_pagina integer DEFAULT 1, p_por_pagina integer DEFAULT 25)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_offset INT;
    v_limite INT;
    v_total  INT;
    v_itens  JSON;
BEGIN
    PERFORM public.exigir_backoffice();

    IF to_regclass('public.subscriptions') IS NULL
       OR to_regclass('public.plans') IS NULL THEN
        RETURN json_build_object('disponivel', FALSE, 'itens', '[]'::JSON, 'total', 0);
    END IF;

    v_limite := LEAST(GREATEST(COALESCE(p_por_pagina, 25), 1), 100);
    v_offset := (GREATEST(COALESCE(p_pagina, 1), 1) - 1) * v_limite;

    SELECT count(*) INTO v_total
    FROM public.subscriptions s
    JOIN public.plans p       ON p.id = s.plan_id
    JOIN public.corretores c  ON c.id = s.corretor_id
    WHERE (p_status IS NULL OR s.status::TEXT = p_status)
      AND (p_plano  IS NULL OR p.code = p_plano)
      AND (p_ciclo  IS NULL OR s.billing_cycle::TEXT = p_ciclo)
      AND (p_busca  IS NULL OR c.nome ILIKE '%' || p_busca || '%'
                            OR c.email ILIKE '%' || p_busca || '%');

    -- Ordena pela coluna, não pelo texto do JSON: `linha->>'criada_em'` sairia
    -- comparado como string, o que só coincide com a ordem real enquanto todos
    -- os timestamps tiverem o mesmo fuso na serialização.
    SELECT COALESCE(json_agg(linha ORDER BY ordem DESC), '[]'::JSON)
    INTO v_itens
    FROM (
        SELECT s.created_at AS ordem, json_build_object(
            'id',            s.id,
            'corretor_id',   c.id,
            'conta_nome',    c.nome,
            'conta_email',   c.email,
            'plano_codigo',  p.code,
            'plano_nome',    p.name,
            'status',        s.status,
            'ciclo',         s.billing_cycle,
            'valor_mensal',  public.mrr_da_assinatura(s.billing_cycle::TEXT, p.monthly_price, p.annual_price),
            'trial_termina_em',   s.trial_ends_at,
            'periodo_inicio',     s.current_period_start,
            'proxima_cobranca',   s.current_period_end,
            'cancelar_no_fim',    s.cancel_at_period_end,
            'cancelada_em',       s.canceled_at,
            'motivo_cancelamento', s.cancel_reason,
            -- ID externo é o que permite conferir a assinatura no painel do
            -- gateway quando cliente e cobrança discordam.
            'id_externo',    s.external_subscription_id,
            'criada_em',     s.created_at
        ) AS linha
        FROM public.subscriptions s
        JOIN public.plans p      ON p.id = s.plan_id
        JOIN public.corretores c ON c.id = s.corretor_id
        WHERE (p_status IS NULL OR s.status::TEXT = p_status)
          AND (p_plano  IS NULL OR p.code = p_plano)
          AND (p_ciclo  IS NULL OR s.billing_cycle::TEXT = p_ciclo)
          AND (p_busca  IS NULL OR c.nome ILIKE '%' || p_busca || '%'
                                OR c.email ILIKE '%' || p_busca || '%')
        ORDER BY s.created_at DESC
        LIMIT v_limite OFFSET v_offset
    ) sub;

    RETURN json_build_object('disponivel', TRUE, 'itens', v_itens, 'total', v_total);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_listar_atendimento(p_busca text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_parceiro_id uuid DEFAULT NULL::uuid, p_origem_direta boolean DEFAULT false, p_campanha text DEFAULT NULL::text, p_limite integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE itens JSONB; total BIGINT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'acesso negado' USING ERRCODE='42501'; END IF;
  WITH filtrados AS MATERIALIZED (
    SELECT c.id corretor_id,c.nome,c.email,c.status,c.created_at criado_em,c.ultimo_acesso_em,
      pa.parceiro_id,p.nome parceiro_nome,l.campanha,pa.visitante_id,
      pa.primeiro_clique_em,pa.link_id,c.user_id
    FROM public.corretores c
    LEFT JOIN public.parceiro_atribuicoes pa ON pa.corretor_id=c.id AND pa.status='convertida'
    LEFT JOIN public.parceiros p ON p.id=pa.parceiro_id
    LEFT JOIN public.parceiro_links l ON l.id=pa.link_id
    WHERE (NULLIF(btrim(p_busca),'') IS NULL OR c.nome ILIKE '%'||btrim(p_busca)||'%' OR c.email ILIKE '%'||btrim(p_busca)||'%')
      AND (p_status IS NULL OR c.status=p_status)
      AND (p_parceiro_id IS NULL OR pa.parceiro_id=p_parceiro_id)
      AND (NOT COALESCE(p_origem_direta,FALSE) OR pa.id IS NULL)
      AND (NULLIF(btrim(p_campanha),'') IS NULL OR l.campanha ILIKE '%'||btrim(p_campanha)||'%')
  ), pagina AS (
    SELECT * FROM filtrados ORDER BY criado_em DESC,corretor_id
      LIMIT LEAST(GREATEST(COALESCE(p_limite,25),1),100) OFFSET GREATEST(COALESCE(p_offset,0),0)
  )
  SELECT (SELECT count(*) FROM filtrados), COALESCE((
    SELECT jsonb_agg(to_jsonb(x)-'visitante_id'-'user_id' ORDER BY criado_em DESC,corretor_id) FROM (
      SELECT pg.*,pl.name plano_nome,s.status assinatura_status,
        (SELECT count(*) FROM public.parceiro_cliques cl WHERE cl.visitante_id=pg.visitante_id AND cl.parceiro_id=pg.parceiro_id) total_cliques,
        (SELECT COALESCE(sum(r.valor_bruto),0) FROM public.receita_eventos r WHERE r.corretor_id=pg.corretor_id AND r.status='confirmado') receita_confirmada,
        op.completed_at onboarding_concluido_em,op.current_step onboarding_etapa
      FROM pagina pg
      LEFT JOIN LATERAL (SELECT sub.status::TEXT status,sub.plan_id FROM public.subscriptions sub WHERE sub.corretor_id=pg.corretor_id
        ORDER BY CASE WHEN sub.status IN ('trialing','active','past_due') THEN 0 ELSE 1 END,sub.created_at DESC,sub.id LIMIT 1) s ON TRUE
      LEFT JOIN public.plans pl ON pl.id=s.plan_id
      LEFT JOIN public.onboarding_profiles pr ON pr.user_id=pg.user_id
      LEFT JOIN public.onboarding_progress op ON op.profile_id=pr.id
    ) x
  ),'[]'::JSONB) INTO total,itens;
  RETURN jsonb_build_object('itens',itens,'total',total);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_listar_auditoria(p_entidade text DEFAULT NULL::text, p_acao text DEFAULT NULL::text, p_de date DEFAULT NULL::date, p_ate date DEFAULT NULL::date, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_limite INT := LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200);
    v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
    v_total  BIGINT;
    v_itens  JSON;
BEGIN
    PERFORM public.exigir_admin();

    SELECT count(*) INTO v_total
      FROM public.admin_auditoria a
     WHERE (p_entidade IS NULL OR a.entidade = p_entidade)
       AND (p_acao     IS NULL OR a.acao = p_acao)
       AND (p_de       IS NULL OR a.criado_em >= p_de::TIMESTAMPTZ)
       AND (p_ate      IS NULL OR a.criado_em < (p_ate + 1)::TIMESTAMPTZ);

    SELECT COALESCE(json_agg(x ORDER BY x.criado_em DESC), '[]'::json) INTO v_itens
      FROM (
        SELECT a.id, a.ator_user_id, c.nome AS ator_nome, u.email AS ator_email,
               a.acao, a.entidade, a.entidade_id, a.dados_antes, a.dados_depois,
               a.motivo, a.criado_em
          FROM public.admin_auditoria a
          LEFT JOIN auth.users u      ON u.id = a.ator_user_id
          LEFT JOIN public.corretores c ON c.user_id = a.ator_user_id
         WHERE (p_entidade IS NULL OR a.entidade = p_entidade)
           AND (p_acao     IS NULL OR a.acao = p_acao)
           AND (p_de       IS NULL OR a.criado_em >= p_de::TIMESTAMPTZ)
           AND (p_ate      IS NULL OR a.criado_em < (p_ate + 1)::TIMESTAMPTZ)
         ORDER BY a.criado_em DESC
         LIMIT v_limite OFFSET v_offset
      ) x;

    RETURN json_build_object('itens', v_itens, 'total', v_total);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_listar_cancelamentos(p_motivo text DEFAULT NULL::text, p_origem text DEFAULT NULL::text, p_plano text DEFAULT NULL::text, p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date, p_pagina integer DEFAULT 1, p_por_pagina integer DEFAULT 25)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_offset INT;
    v_limite INT;
    v_total  INT;
    v_itens  JSON;
BEGIN
    PERFORM public.exigir_admin();

    v_limite := LEAST(GREATEST(COALESCE(p_por_pagina, 25), 1), 100);
    v_offset := (GREATEST(COALESCE(p_pagina, 1), 1) - 1) * v_limite;

    SELECT count(*) INTO v_total
    FROM public.cancelamento_feedback f
    WHERE (p_motivo IS NULL OR f.motivo = p_motivo)
      AND (p_origem IS NULL OR f.origem = p_origem)
      AND (p_plano  IS NULL OR f.plano_anterior = p_plano)
      AND (p_inicio IS NULL OR f.data_cancelamento >= p_inicio)
      AND (p_fim    IS NULL OR f.data_cancelamento <= p_fim);

    SELECT COALESCE(json_agg(linha), '[]'::JSON)
    INTO v_itens
    FROM (
        SELECT json_build_object(
            'id',      f.id,
            'corretor_id', f.corretor_id,
            -- COALESCE resolve os dois casos numa coluna só para a tela: conta
            -- identificada usa o cadastro, cancelamento avulso usa o que foi
            -- digitado no formulário.
            'nome',    COALESCE(c.nome, f.contato_nome),
            'email',   COALESCE(c.email, f.contato_email),
            'telefone',COALESCE(c.telefone, f.contato_telefone),
            'identificado', f.corretor_id IS NOT NULL,
            'plano_anterior', f.plano_anterior,
            'motivo',  f.motivo,
            'comentario', f.comentario,
            'origem',  f.origem,
            'data_cancelamento', f.data_cancelamento,
            'criado_em', f.criado_em
        ) AS linha
        FROM public.cancelamento_feedback f
        LEFT JOIN public.corretores c ON c.id = f.corretor_id
        WHERE (p_motivo IS NULL OR f.motivo = p_motivo)
          AND (p_origem IS NULL OR f.origem = p_origem)
          AND (p_plano  IS NULL OR f.plano_anterior = p_plano)
          AND (p_inicio IS NULL OR f.data_cancelamento >= p_inicio)
          AND (p_fim    IS NULL OR f.data_cancelamento <= p_fim)
        ORDER BY f.data_cancelamento DESC, f.criado_em DESC
        LIMIT v_limite OFFSET v_offset
    ) sub;

    RETURN json_build_object('itens', v_itens, 'total', v_total);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_listar_comissoes(p_parceiro_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_de date DEFAULT NULL::date, p_ate date DEFAULT NULL::date, p_limite integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_limite INT := LEAST(GREATEST(COALESCE(p_limite, 25), 1), 500);
    v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
    v_total  BIGINT;
    v_itens  JSON;
    v_totais JSON;
BEGIN
    PERFORM public.exigir_admin();

    SELECT count(*),
           json_build_object(
               'valor_total', COALESCE(sum(co.valor_comissao), 0),
               'valor_base_total', COALESCE(sum(co.valor_base), 0)
           )
      INTO v_total, v_totais
      FROM public.parceiro_comissoes co
     WHERE (p_parceiro_id IS NULL OR co.parceiro_id = p_parceiro_id)
       AND (p_status IS NULL OR co.status = p_status)
       AND (p_de  IS NULL OR co.gerada_em >= p_de::TIMESTAMPTZ)
       AND (p_ate IS NULL OR co.gerada_em < (p_ate + 1)::TIMESTAMPTZ);

    SELECT COALESCE(json_agg(x ORDER BY x.gerada_em DESC), '[]'::json) INTO v_itens
      FROM (
        SELECT co.id, co.parceiro_id, p.nome AS parceiro_nome,
               co.corretor_id, c.nome AS corretor_nome,
               co.receita_evento_id, co.valor_base, co.percentual_aplicado,
               co.base_calculo, co.valor_comissao, co.status, co.competencia,
               co.gerada_em, co.aprovada_em, co.paga_em, co.motivo_cancelamento
          FROM public.parceiro_comissoes co
          JOIN public.parceiros p    ON p.id = co.parceiro_id
          LEFT JOIN public.corretores c ON c.id = co.corretor_id
         WHERE (p_parceiro_id IS NULL OR co.parceiro_id = p_parceiro_id)
           AND (p_status IS NULL OR co.status = p_status)
           AND (p_de  IS NULL OR co.gerada_em >= p_de::TIMESTAMPTZ)
           AND (p_ate IS NULL OR co.gerada_em < (p_ate + 1)::TIMESTAMPTZ)
         ORDER BY co.gerada_em DESC
         LIMIT v_limite OFFSET v_offset
      ) x;

    RETURN json_build_object('itens', v_itens, 'total', v_total, 'totais', v_totais);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_listar_config()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    PERFORM public.exigir_admin();

    RETURN COALESCE((
        SELECT json_agg(json_build_object(
            'chave', chave, 'valor', valor, 'descricao', descricao,
            'atualizado_em', atualizado_em) ORDER BY chave)
        FROM public.admin_config
    ), '[]'::JSON);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_listar_lotes(p_status text DEFAULT NULL::text, p_pagina integer DEFAULT 1, p_por_pagina integer DEFAULT 25)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_offset INT;
    v_limite INT;
    v_total  INT;
    v_itens  JSON;
BEGIN
    PERFORM public.exigir_admin();

    v_limite := LEAST(GREATEST(COALESCE(p_por_pagina, 25), 1), 100);
    v_offset := (GREATEST(COALESCE(p_pagina, 1), 1) - 1) * v_limite;

    SELECT count(*) INTO v_total FROM public.parceiro_lotes
     WHERE (p_status IS NULL OR status = p_status);

    SELECT COALESCE(json_agg(linha), '[]'::JSON) INTO v_itens
    FROM (
        SELECT json_build_object(
            'id', l.id, 'referencia', l.referencia, 'status', l.status,
            'valor_total', l.valor_total, 'total_parceiros', l.total_parceiros,
            'total_comissoes', l.total_comissoes, 'saldo_minimo', l.saldo_minimo,
            'exportado_em', l.exportado_em, 'pago_em', l.pago_em,
            'referencia_pagamento', l.referencia_pagamento,
            'observacoes', l.observacoes, 'motivo_cancelamento', l.motivo_cancelamento,
            'criado_em', l.criado_em
        ) AS linha
        FROM public.parceiro_lotes l
        WHERE (p_status IS NULL OR l.status = p_status)
        ORDER BY l.criado_em DESC
        LIMIT v_limite OFFSET v_offset
    ) sub;

    RETURN json_build_object('itens', v_itens, 'total', v_total);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_listar_organizacoes(p_busca text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_plano text DEFAULT NULL::text, p_limite integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_busca TEXT := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_limite INT := LEAST(GREATEST(COALESCE(p_limite, 25), 1), 200);
  v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
  v_total BIGINT;
  v_itens JSON;
BEGIN
  PERFORM public.exigir_backoffice();

  SELECT COALESCE(json_agg(to_jsonb(x) - 'total_geral' ORDER BY x.criado_em DESC), '[]'::JSON),
         COALESCE(max(x.total_geral), 0)
    INTO v_itens, v_total
    FROM (
      SELECT
        o.id AS organizacao_id,
        o.name AS nome,
        c.id AS corretor_id,
        c.nome AS responsavel,
        c.email,
        c.telefone,
        c.status,
        o.created_at AS criado_em,
        c.ultimo_acesso_em,
        (SELECT count(*) FROM public.routine_memberships m
          WHERE m.organization_id = o.id) AS total_usuarios,
        (SELECT count(*) FROM public.routine_memberships m
          WHERE m.organization_id = o.id AND m.status = 'active') AS usuarios_ativos,
        pl.code AS plano_codigo,
        pl.name AS plano_nome,
        s.status::TEXT AS assinatura_status,
        s.billing_cycle::TEXT AS ciclo,
        s.trial_ends_at AS trial_termina_em,
        s.current_period_end AS proximo_vencimento,
        count(*) OVER () AS total_geral
      FROM public.routine_organizations o
      JOIN public.corretores c ON c.id = o.legacy_corretor_id
      LEFT JOIN LATERAL (
        SELECT sub.*
          FROM public.subscriptions sub
         WHERE sub.corretor_id = c.id
         ORDER BY CASE WHEN sub.status IN ('trialing','active','past_due') THEN 0 ELSE 1 END,
                  sub.created_at DESC
         LIMIT 1
      ) s ON TRUE
      LEFT JOIN public.plans pl ON pl.id = s.plan_id
      WHERE (
        v_busca IS NULL
        OR o.name ILIKE '%' || v_busca || '%'
        OR c.nome ILIKE '%' || v_busca || '%'
        OR c.email ILIKE '%' || v_busca || '%'
        OR COALESCE(c.telefone, '') ILIKE '%' || v_busca || '%'
      )
        AND (p_status IS NULL OR c.status = p_status)
        AND (p_plano IS NULL OR pl.code = p_plano)
      ORDER BY o.created_at DESC, o.id
      LIMIT v_limite OFFSET v_offset
    ) x;

  RETURN json_build_object('itens', v_itens, 'total', v_total);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_listar_pagamentos(p_busca text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_metodo text DEFAULT NULL::text, p_plano text DEFAULT NULL::text, p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date, p_pagina integer DEFAULT 1, p_por_pagina integer DEFAULT 25)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_offset INT;
    v_limite INT;
    v_total  INT;
    v_itens  JSON;
    v_totais JSON;
    v_ini_ts TIMESTAMPTZ;
    v_fim_ts TIMESTAMPTZ;
BEGIN
    PERFORM public.exigir_backoffice();

    IF to_regclass('public.checkout_orders') IS NULL THEN
        RETURN json_build_object(
            'disponivel', FALSE,
            'itens', '[]'::JSON,
            'total', 0,
            'totais', NULL
        );
    END IF;

    v_limite := LEAST(GREATEST(COALESCE(p_por_pagina, 25), 1), 100);
    v_offset := (GREATEST(COALESCE(p_pagina, 1), 1) - 1) * v_limite;
    v_ini_ts := CASE WHEN p_inicio IS NULL THEN NULL ELSE p_inicio::TIMESTAMPTZ END;
    v_fim_ts := CASE WHEN p_fim    IS NULL THEN NULL ELSE (p_fim + 1)::TIMESTAMPTZ END;

    SELECT count(*) INTO v_total
    FROM public.checkout_orders o
    WHERE (p_status IS NULL OR o.status = p_status)
      AND (p_metodo IS NULL OR o.payment_method = p_metodo)
      AND (p_plano  IS NULL OR o.plan_code = p_plano)
      AND (v_ini_ts IS NULL OR o.created_at >= v_ini_ts)
      AND (v_fim_ts IS NULL OR o.created_at <  v_fim_ts)
      AND (p_busca  IS NULL OR o.payer_name ILIKE '%' || p_busca || '%'
                            OR o.payer_email ILIKE '%' || p_busca || '%');

    SELECT json_build_object(
        'recebido',  COALESCE(SUM(amount) FILTER (WHERE status = 'active'), 0),
        'pendente',  COALESCE(SUM(amount) FILTER (WHERE status IN ('awaiting_payment', 'processing')), 0),
        'vencido',   COALESCE(SUM(amount) FILTER (WHERE status = 'overdue'), 0),
        'estornado', COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0)
    ) INTO v_totais
    FROM public.checkout_orders o
    WHERE (p_status IS NULL OR o.status = p_status)
      AND (p_metodo IS NULL OR o.payment_method = p_metodo)
      AND (p_plano  IS NULL OR o.plan_code = p_plano)
      AND (v_ini_ts IS NULL OR o.created_at >= v_ini_ts)
      AND (v_fim_ts IS NULL OR o.created_at <  v_fim_ts)
      AND (p_busca  IS NULL OR o.payer_name ILIKE '%' || p_busca || '%'
                            OR o.payer_email ILIKE '%' || p_busca || '%');

    SELECT COALESCE(json_agg(linha ORDER BY ordem DESC), '[]'::JSON)
    INTO v_itens
    FROM (
        SELECT o.created_at AS ordem, json_build_object(
            'id',           o.id,
            'pagador',      o.payer_name,
            'email',        o.payer_email,
            'plano',        o.plan_code,
            'ciclo',        o.billing_cycle,
            'metodo',       o.payment_method,
            'valor',        o.amount,
            'status',       o.status,
            'motivo_falha', o.failure_code,
            'id_cobranca',  o.asaas_payment_id,
            'id_assinatura',o.asaas_subscription_id,
            -- A conta provisionada é o elo entre o pedido e o corretor. Sem
            -- ela, o pedido foi pago e nunca virou acesso — caso que precisa
            -- ser visível, não escondido.
            'corretor_id',  c.id,
            'conta_nome',   c.nome,
            'acesso_enviado_em', o.access_email_sent_at,
            'criado_em',    o.created_at,
            'atualizado_em',o.updated_at
        ) AS linha
        FROM public.checkout_orders o
        LEFT JOIN public.corretores c ON c.user_id = o.provisioned_user_id
        WHERE (p_status IS NULL OR o.status = p_status)
          AND (p_metodo IS NULL OR o.payment_method = p_metodo)
          AND (p_plano  IS NULL OR o.plan_code = p_plano)
          AND (v_ini_ts IS NULL OR o.created_at >= v_ini_ts)
          AND (v_fim_ts IS NULL OR o.created_at <  v_fim_ts)
          AND (p_busca  IS NULL OR o.payer_name ILIKE '%' || p_busca || '%'
                                OR o.payer_email ILIKE '%' || p_busca || '%')
        ORDER BY o.created_at DESC
        LIMIT v_limite OFFSET v_offset
    ) sub;

    RETURN json_build_object(
        'disponivel', TRUE,
        'itens', v_itens,
        'total', v_total,
        'totais', v_totais
    );
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_listar_parceiros(p_busca text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_limite integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_limite INT := LEAST(GREATEST(COALESCE(p_limite, 25), 1), 200);
    v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
    v_busca  TEXT := NULLIF(btrim(COALESCE(p_busca, '')), '');
    v_total  BIGINT;
    v_itens  JSON;
BEGIN
    PERFORM public.exigir_admin();

    SELECT count(*) INTO v_total FROM public.parceiros p
     WHERE (v_busca IS NULL OR p.nome ILIKE '%'||v_busca||'%'
            OR COALESCE(p.empresa,'') ILIKE '%'||v_busca||'%'
            OR p.email ILIKE '%'||v_busca||'%')
       AND (p_status IS NULL OR p.status = p_status);

    SELECT COALESCE(json_agg(x ORDER BY x.criado_em DESC), '[]'::json) INTO v_itens
      FROM (
        SELECT p.id, p.nome, p.empresa, p.documento, p.email, p.telefone,
               p.responsavel, p.status, p.data_inicio, p.janela_atribuicao_dias,
               p.observacoes, p.user_id, p.criado_em, p.atualizado_em,
               v.percentual AS percentual_vigente,
               v.base_calculo AS base_calculo_vigente,
               (SELECT count(*) FROM public.parceiro_cliques cq WHERE cq.parceiro_id = p.id) AS total_cliques,
               (SELECT count(*) FROM public.parceiro_atribuicoes a WHERE a.parceiro_id = p.id) AS total_atribuicoes,
               (SELECT count(*) FROM public.parceiro_atribuicoes a WHERE a.parceiro_id = p.id AND a.status = 'convertida') AS total_conversoes,
               COALESCE((SELECT sum(co.valor_base) FROM public.parceiro_comissoes co WHERE co.parceiro_id = p.id AND co.status <> 'estornada'), 0) AS receita_atribuida,
               COALESCE((SELECT sum(co.valor_comissao) FROM public.parceiro_comissoes co WHERE co.parceiro_id = p.id AND co.status IN ('pendente','em_validacao')), 0) AS comissao_pendente,
               COALESCE((SELECT sum(co.valor_comissao) FROM public.parceiro_comissoes co WHERE co.parceiro_id = p.id AND co.status = 'aprovada'), 0) AS comissao_aprovada,
               COALESCE((SELECT sum(co.valor_comissao) FROM public.parceiro_comissoes co WHERE co.parceiro_id = p.id AND co.status = 'paga'), 0) AS comissao_paga
          FROM public.parceiros p
          LEFT JOIN LATERAL (
              SELECT * FROM public.parceiro_percentuais pp
               WHERE pp.parceiro_id = p.id AND pp.vigencia_fim IS NULL
               LIMIT 1
          ) v ON TRUE
         WHERE (v_busca IS NULL OR p.nome ILIKE '%'||v_busca||'%'
                OR COALESCE(p.empresa,'') ILIKE '%'||v_busca||'%'
                OR p.email ILIKE '%'||v_busca||'%')
           AND (p_status IS NULL OR p.status = p_status)
         ORDER BY p.criado_em DESC
         LIMIT v_limite OFFSET v_offset
      ) x;

    RETURN json_build_object('itens', v_itens, 'total', v_total);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_listar_receita(p_corretor_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_de date DEFAULT NULL::date, p_ate date DEFAULT NULL::date, p_limite integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_limite INT := LEAST(GREATEST(COALESCE(p_limite, 25), 1), 200);
    v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
    v_total  BIGINT;
    v_itens  JSON;
BEGIN
    PERFORM public.exigir_admin();

    SELECT count(*) INTO v_total FROM public.receita_eventos r
     WHERE (p_corretor_id IS NULL OR r.corretor_id = p_corretor_id)
       AND (p_status IS NULL OR r.status = p_status)
       AND (p_de  IS NULL OR r.confirmado_em >= p_de::TIMESTAMPTZ)
       AND (p_ate IS NULL OR r.confirmado_em < (p_ate + 1)::TIMESTAMPTZ);

    SELECT COALESCE(json_agg(x ORDER BY x.confirmado_em DESC), '[]'::json) INTO v_itens
      FROM (
        SELECT r.id, r.corretor_id, c.nome AS corretor_nome, r.origem, r.external_id,
               r.tipo, r.valor_bruto, r.valor_liquido, r.status, r.confirmado_em,
               r.competencia, r.motivo, r.criado_em
          FROM public.receita_eventos r
          LEFT JOIN public.corretores c ON c.id = r.corretor_id
         WHERE (p_corretor_id IS NULL OR r.corretor_id = p_corretor_id)
           AND (p_status IS NULL OR r.status = p_status)
           AND (p_de  IS NULL OR r.confirmado_em >= p_de::TIMESTAMPTZ)
           AND (p_ate IS NULL OR r.confirmado_em < (p_ate + 1)::TIMESTAMPTZ)
         ORDER BY r.confirmado_em DESC
         LIMIT v_limite OFFSET v_offset
      ) x;

    RETURN json_build_object('itens', v_itens, 'total', v_total);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_listar_usuarios(p_busca text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_atividade text DEFAULT NULL::text, p_parceiro_id uuid DEFAULT NULL::uuid, p_criado_de date DEFAULT NULL::date, p_criado_ate date DEFAULT NULL::date, p_ordenar text DEFAULT 'criado_em'::text, p_direcao text DEFAULT 'desc'::text, p_limite integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_janela INT := public.admin_config_int('janela_atividade_dias', 30);
    v_limite INT := LEAST(GREATEST(COALESCE(p_limite, 25), 1), 200);
    v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
    v_busca  TEXT := NULLIF(btrim(COALESCE(p_busca, '')), '');
    v_total  BIGINT;
    v_itens  JSON;
BEGIN
    PERFORM public.exigir_backoffice();

    -- Whitelist de ordenação. p_ordenar decide a ordem, então aceitar texto
    -- livre e concatenar seria injeção de SQL. Aqui ele nunca vira SQL: só
    -- escolhe qual CASE do ORDER BY fica não-nulo.
    IF p_ordenar NOT IN ('criado_em', 'nome', 'ultimo_acesso_em', 'status') THEN
        p_ordenar := 'criado_em';
    END IF;
    IF lower(COALESCE(p_direcao, 'desc')) NOT IN ('asc', 'desc') THEN
        p_direcao := 'desc';
    ELSE
        p_direcao := lower(p_direcao);
    END IF;

    -- Uma passagem só: `count(*) OVER ()` é avaliado antes do LIMIT, então
    -- devolve o total filtrado junto com a página. Duas queries separadas
    -- correriam o risco de discordar sob escrita concorrente — a página diria
    -- "1–25 de 40" com 41 linhas existindo.
    SELECT COALESCE(json_agg(to_jsonb(x) - 'total_geral'), '[]'::json),
           COALESCE(max(x.total_geral), 0)
      INTO v_itens, v_total
      FROM (
        SELECT
            c.id  AS corretor_id,
            c.user_id,
            c.nome,
            c.email,
            c.telefone,
            c.creci,
            c.status,
            c.created_at AS criado_em,
            c.ultimo_acesso_em,
            public.classificar_atividade(c.ultimo_acesso_em, v_janela) AS atividade,
            c.suspenso_em,
            c.suspenso_motivo,
            pl.name        AS plano_nome,
            s.status::TEXT AS assinatura_status,
            pa.parceiro_id,
            p.nome         AS parceiro_nome,
            (SELECT count(*) FROM public.clientes cl WHERE cl.corretor_id = c.id) AS total_clientes,
            (SELECT count(*) FROM public.imoveis  im WHERE im.corretor_id = c.id) AS total_imoveis,
            count(*) OVER () AS total_geral
        FROM public.corretores c
        -- LATERAL com LIMIT 1, não LEFT JOIN direto: o índice único de
        -- subscriptions(corretor_id) é PARCIAL (só trialing/active/past_due),
        -- então um corretor pode ter várias assinaturas canceladas ou expiradas
        -- e o join simples o duplicaria na listagem — inflando o total de
        -- usuários com linhas repetidas.
        LEFT JOIN LATERAL (
            SELECT sub.status, sub.plan_id
              FROM public.subscriptions sub
             WHERE sub.corretor_id = c.id
             ORDER BY CASE WHEN sub.status IN ('trialing','active','past_due') THEN 0 ELSE 1 END,
                      sub.created_at DESC
             LIMIT 1
        ) s ON TRUE
        LEFT JOIN public.plans pl        ON pl.id = s.plan_id
        -- parceiro_atribuicoes tem UNIQUE parcial em corretor_id, então aqui o
        -- join direto não duplica.
        LEFT JOIN public.parceiro_atribuicoes pa
               ON pa.corretor_id = c.id AND pa.status = 'convertida'
        LEFT JOIN public.parceiros p     ON p.id = pa.parceiro_id
        WHERE (v_busca IS NULL
               OR c.nome  ILIKE '%' || v_busca || '%'
               OR c.email ILIKE '%' || v_busca || '%'
               OR COALESCE(c.telefone, '') ILIKE '%' || v_busca || '%'
               OR COALESCE(c.creci, '')    ILIKE '%' || v_busca || '%')
          AND (p_status      IS NULL OR c.status = p_status)
          AND (p_atividade   IS NULL
               OR public.classificar_atividade(c.ultimo_acesso_em, v_janela) = p_atividade)
          AND (p_parceiro_id IS NULL OR pa.parceiro_id = p_parceiro_id)
          AND (p_criado_de   IS NULL OR c.created_at >= p_criado_de::TIMESTAMPTZ)
          AND (p_criado_ate  IS NULL OR c.created_at < (p_criado_ate + 1)::TIMESTAMPTZ)
        ORDER BY
            CASE WHEN p_ordenar = 'nome'             AND p_direcao = 'asc'  THEN c.nome END ASC,
            CASE WHEN p_ordenar = 'nome'             AND p_direcao = 'desc' THEN c.nome END DESC,
            CASE WHEN p_ordenar = 'status'           AND p_direcao = 'asc'  THEN c.status END ASC,
            CASE WHEN p_ordenar = 'status'           AND p_direcao = 'desc' THEN c.status END DESC,
            CASE WHEN p_ordenar = 'ultimo_acesso_em' AND p_direcao = 'asc'  THEN c.ultimo_acesso_em END ASC NULLS LAST,
            CASE WHEN p_ordenar = 'ultimo_acesso_em' AND p_direcao = 'desc' THEN c.ultimo_acesso_em END DESC NULLS LAST,
            CASE WHEN p_ordenar = 'criado_em'        AND p_direcao = 'asc'  THEN c.created_at END ASC,
            CASE WHEN p_ordenar = 'criado_em'        AND p_direcao = 'desc' THEN c.created_at END DESC,
            -- Desempate estável: sem ele, duas páginas podem repetir ou pular
            -- uma linha quando há empate no critério escolhido.
            c.id
        LIMIT v_limite OFFSET v_offset
      ) x;

    RETURN json_build_object('itens', v_itens, 'total', v_total);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_marcar_lote_exportado(p_lote_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_status TEXT;
BEGIN
    PERFORM public.exigir_admin();

    SELECT status INTO v_status FROM public.parceiro_lotes WHERE id = p_lote_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'lote não encontrado'; END IF;
    IF v_status <> 'rascunho' THEN
        RAISE EXCEPTION 'apenas lote em rascunho pode ser exportado';
    END IF;

    UPDATE public.parceiro_lotes
       SET status = 'exportado', exportado_em = now()
     WHERE id = p_lote_id;

    PERFORM public.registrar_auditoria_admin(
        'exportar_lote', 'parceiro_lotes', p_lote_id::TEXT,
        jsonb_build_object('status', v_status), jsonb_build_object('status', 'exportado'), NULL);

    RETURN json_build_object('status', 'exportado');
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_marcar_lote_pago(p_lote_id uuid, p_pago_em date, p_referencia text, p_comprovante_url text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_status TEXT;
    v_ref    TEXT;
    v_pagamentos INT := 0;
    v_divergentes INT;
    r RECORD;
    v_pagamento_id UUID;
BEGIN
    -- Confirmar pagamento é dinheiro que saiu. Mesmo nível de
    -- `admin_transicionar_comissao` para 'paga'.
    PERFORM public.exigir_super_admin();

    IF length(btrim(COALESCE(p_referencia, ''))) < 3 THEN
        RAISE EXCEPTION 'informe a referência ou o comprovante do pagamento';
    END IF;

    SELECT status, referencia INTO v_status, v_ref
    FROM public.parceiro_lotes WHERE id = p_lote_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'lote não encontrado'; END IF;
    IF v_status NOT IN ('rascunho', 'exportado', 'falhou') THEN
        RAISE EXCEPTION 'lote % não pode ser marcado como pago', v_status;
    END IF;

    -- Entre gerar e pagar, uma comissão do lote pode ter sido cancelada ou
    -- estornada. O valor do item está congelado, então o `parceiro_pagamentos`
    -- registraria um total que inclui dinheiro que não é mais devido — e o
    -- UPDATE seguinte, filtrado por `status = 'aprovada'`, silenciosamente não
    -- marcaria aquela comissão. Divergência em repasse não se resolve
    -- adivinhando: o lote precisa ser cancelado e gerado de novo.
    SELECT count(*) INTO v_divergentes
    FROM public.parceiro_lote_itens i
    JOIN public.parceiro_comissoes c ON c.id = i.comissao_id
    WHERE i.lote_id = p_lote_id AND c.status <> 'aprovada';

    IF v_divergentes > 0 THEN
        RAISE EXCEPTION
            '% comissão(ões) deste lote deixaram de estar aprovadas. Cancele o lote e gere outro.',
            v_divergentes;
    END IF;

    -- Um `parceiro_pagamentos` por parceiro, reaproveitando a tabela que já
    -- existe desde 20260814130000 — o histórico de repasse continua tendo um
    -- lugar só, com ou sem lote.
    FOR r IN
        SELECT i.parceiro_id, SUM(i.valor) AS valor
        FROM public.parceiro_lote_itens i
        WHERE i.lote_id = p_lote_id
        GROUP BY i.parceiro_id
    LOOP
        INSERT INTO public.parceiro_pagamentos
            (parceiro_id, valor_total, metodo, referencia, pago_em,
             comprovante_url, observacoes, registrado_por)
        VALUES
            (r.parceiro_id, r.valor, 'pix', btrim(p_referencia),
             COALESCE(p_pago_em, CURRENT_DATE), p_comprovante_url,
             'Lote ' || v_ref, auth.uid())
        RETURNING id INTO v_pagamento_id;

        -- Mesma semântica de `admin_transicionar_comissao` para 'paga'. Feito
        -- em lote e com UMA linha de auditoria para o lote inteiro: a trilha
        -- por comissão fica reconstruível por `parceiro_lote_itens`, e 200
        -- linhas de auditoria idênticas afogariam a tela de auditoria.
        UPDATE public.parceiro_comissoes c
           SET status = 'paga', paga_em = now(), pagamento_id = v_pagamento_id
          FROM public.parceiro_lote_itens i
         WHERE i.lote_id = p_lote_id
           AND i.comissao_id = c.id
           AND i.parceiro_id = r.parceiro_id
           AND c.status = 'aprovada';

        v_pagamentos := v_pagamentos + 1;
    END LOOP;

    UPDATE public.parceiro_lotes
       SET status = 'pago', pago_em = COALESCE(p_pago_em, CURRENT_DATE),
           referencia_pagamento = btrim(p_referencia),
           comprovante_url = p_comprovante_url
     WHERE id = p_lote_id;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois, motivo)
    VALUES
        (auth.uid(), 'marcar_lote_pago', 'parceiro_lotes', p_lote_id::TEXT,
         jsonb_build_object('status', v_status),
         jsonb_build_object('status', 'pago', 'pagamentos', v_pagamentos,
                            'referencia_pagamento', btrim(p_referencia)),
         p_referencia);

    RETURN json_build_object('status', 'pago', 'pagamentos', v_pagamentos);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_metricas_cancelamento(p_inicio date, p_fim date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_resultado JSON;
BEGIN
    PERFORM public.exigir_admin();

    SELECT json_build_object(
        'total_geral',  (SELECT count(*) FROM public.cancelamento_feedback),
        'no_periodo',   (SELECT count(*) FROM public.cancelamento_feedback
                          WHERE data_cancelamento BETWEEN p_inicio AND p_fim),
        'ultimos_30',   (SELECT count(*) FROM public.cancelamento_feedback
                          WHERE data_cancelamento >= CURRENT_DATE - 30),
        'motivo_principal', (
            SELECT f.motivo FROM public.cancelamento_feedback f
             WHERE f.data_cancelamento BETWEEN p_inicio AND p_fim
             GROUP BY f.motivo
             -- Desempate por nome do motivo: sem ele, dois motivos empatados
             -- alternariam a cada recarga e a tela pareceria instável.
             ORDER BY count(*) DESC, f.motivo ASC
             LIMIT 1
        ),
        'por_motivo', COALESCE((
            SELECT json_agg(json_build_object('motivo', m.motivo, 'total', m.total)
                            ORDER BY m.total DESC, m.motivo ASC)
            FROM (
                SELECT motivo, count(*) AS total
                FROM public.cancelamento_feedback
                WHERE data_cancelamento BETWEEN p_inicio AND p_fim
                GROUP BY motivo
            ) m
        ), '[]'::JSON),
        'por_origem', COALESCE((
            SELECT json_agg(json_build_object('origem', o.origem, 'total', o.total)
                            ORDER BY o.total DESC, o.origem ASC)
            FROM (
                SELECT origem, count(*) AS total
                FROM public.cancelamento_feedback
                WHERE data_cancelamento BETWEEN p_inicio AND p_fim
                GROUP BY origem
            ) o
        ), '[]'::JSON)
    ) INTO v_resultado;

    RETURN v_resultado;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_metricas_saas(p_inicio date, p_fim date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_ini_ts   TIMESTAMPTZ;
    v_fim_ts   TIMESTAMPTZ;
    v_mrr           NUMERIC(14,2) := 0;
    v_mrr_risco     NUMERIC(14,2) := 0;
    v_ativos_inicio INT := 0;
    v_cancelados    INT := 0;
    v_tem_assinaturas BOOLEAN;
    v_tem_checkout  BOOLEAN;
    v_assinaturas   JSON;
    v_mrr_json      JSON;
    v_inadimplencia JSON;
    v_churn         JSON;
    v_pagamentos    JSON;
    v_resultado     JSON;
BEGIN
    PERFORM public.exigir_backoffice();

    IF p_inicio > p_fim THEN
        RAISE EXCEPTION 'período inválido: início depois do fim';
    END IF;

    -- Limite superior exclusivo: `<= p_fim` perderia tudo que aconteceu depois
    -- da meia-noite do último dia.
    v_ini_ts := p_inicio::TIMESTAMPTZ;
    v_fim_ts := (p_fim + 1)::TIMESTAMPTZ;

    v_tem_assinaturas := to_regclass('public.subscriptions') IS NOT NULL
                     AND to_regclass('public.plans') IS NOT NULL;

    IF v_tem_assinaturas THEN
        -- MRR só de assinatura ativa. `past_due` continua contratada mas não
        -- está pagando: somá-la transformaria inadimplência em receita no
        -- gráfico, que é o erro que mais atrasa a percepção de um problema de
        -- cobrança. Ela aparece separada, como MRR em risco.
        SELECT
            COALESCE(SUM(CASE WHEN s.status::TEXT = 'active'
                              THEN public.mrr_da_assinatura(s.billing_cycle::TEXT, p.monthly_price, p.annual_price) END), 0),
            COALESCE(SUM(CASE WHEN s.status::TEXT = 'past_due'
                              THEN public.mrr_da_assinatura(s.billing_cycle::TEXT, p.monthly_price, p.annual_price) END), 0)
        INTO v_mrr, v_mrr_risco
        FROM public.subscriptions s
        JOIN public.plans p ON p.id = s.plan_id;

        -- Churn do período. Reconstrução aproximada, e vale saber por quê: a
        -- linha de `subscriptions` é atualizada no lugar pelo provisionamento
        -- do site, então não há histórico de status. Uma conta que cancelou e
        -- voltou aparece só no estado mais recente.
        SELECT count(*) INTO v_ativos_inicio
        FROM public.subscriptions s
        WHERE s.created_at < v_ini_ts
          AND (s.canceled_at IS NULL OR s.canceled_at >= v_ini_ts);

        SELECT count(*) INTO v_cancelados
        FROM public.subscriptions s
        WHERE s.canceled_at >= v_ini_ts AND s.canceled_at < v_fim_ts;

        SELECT json_build_object(
            'disponivel', TRUE,
            'total',     count(*),
            'ativas',    count(*) FILTER (WHERE status::TEXT = 'active'),
            'trials',    count(*) FILTER (WHERE status::TEXT = 'trialing'),
            'vencidas',  count(*) FILTER (WHERE status::TEXT = 'past_due'),
            'canceladas',count(*) FILTER (WHERE status::TEXT = 'canceled'),
            'expiradas', count(*) FILTER (WHERE status::TEXT = 'expired'),
            'somente_leitura', count(*) FILTER (WHERE status::TEXT = 'read_only'),
            'novas',     count(*) FILTER (WHERE created_at >= v_ini_ts AND created_at < v_fim_ts)
        ) INTO v_assinaturas
        FROM public.subscriptions;

        v_mrr_json := json_build_object(
            -- Sem nenhuma assinatura registrada a resposta certa é "ainda não
            -- há dado", não "R$ 0,00 de MRR".
            'tem_dados', EXISTS (SELECT 1 FROM public.subscriptions),
            'valor',     v_mrr,
            'em_risco',  v_mrr_risco
        );

        SELECT json_build_object(
            'assinaturas', count(*),
            'valor_mensal', v_mrr_risco
        ) INTO v_inadimplencia
        FROM public.subscriptions WHERE status::TEXT = 'past_due';

        v_churn := json_build_object(
            'ativos_inicio', v_ativos_inicio,
            'cancelados',    v_cancelados,
            -- NULL, não 0: sem base no início do período não existe taxa, e
            -- exibir 0% afirmaria retenção perfeita onde não houve medição.
            'taxa', CASE WHEN v_ativos_inicio > 0
                         THEN round((v_cancelados::NUMERIC / v_ativos_inicio) * 100, 2)
                         END
        );
    ELSE
        -- Diferente de zero: zero afirmaria que não há assinatura, e a verdade
        -- é que as tabelas de plano e assinatura não existem nesta base.
        v_assinaturas   := json_build_object('disponivel', FALSE);
        v_mrr_json      := json_build_object('tem_dados', FALSE, 'valor', 0, 'em_risco', 0);
        v_inadimplencia := json_build_object('assinaturas', 0, 'valor_mensal', 0);
        v_churn         := json_build_object('ativos_inicio', 0, 'cancelados', 0, 'taxa', NULL);
    END IF;

    v_tem_checkout := to_regclass('public.checkout_orders') IS NOT NULL;

    IF v_tem_checkout THEN
        SELECT json_build_object(
            'disponivel', TRUE,
            'recebido',  COALESCE(SUM(o.amount) FILTER (WHERE o.status = 'active'), 0),
            'pendente',  COALESCE(SUM(o.amount) FILTER (WHERE o.status IN ('awaiting_payment', 'processing')), 0),
            'vencido',   COALESCE(SUM(o.amount) FILTER (WHERE o.status = 'overdue'), 0),
            'estornado', COALESCE(SUM(o.amount) FILTER (WHERE o.status = 'refunded'), 0),
            'pedidos',   count(*)
        )
        INTO v_pagamentos
        FROM public.checkout_orders o
        WHERE o.created_at >= v_ini_ts AND o.created_at < v_fim_ts;
    ELSE
        v_pagamentos := json_build_object('disponivel', FALSE);
    END IF;

    SELECT json_build_object(
        'periodo', json_build_object('inicio', p_inicio, 'fim', p_fim),

        'contas', json_build_object(
            'total',     (SELECT count(*) FROM public.corretores),
            'novas',     (SELECT count(*) FROM public.corretores
                           WHERE created_at >= v_ini_ts AND created_at < v_fim_ts),
            'suspensas', (SELECT count(*) FROM public.corretores WHERE status = 'suspenso')
        ),

        'assinaturas',   v_assinaturas,
        'mrr',           v_mrr_json,
        'inadimplencia', v_inadimplencia,
        'churn',         v_churn,
        'pagamentos',    v_pagamentos,

        'parceiros', json_build_object(
            'ativos', (SELECT count(*) FROM public.parceiros WHERE status = 'ativo'),
            'receita_atribuida', COALESCE((
                SELECT SUM(c.valor_base) FROM public.parceiro_comissoes c
                 WHERE c.gerada_em >= v_ini_ts AND c.gerada_em < v_fim_ts
                   AND c.status NOT IN ('cancelada', 'estornada')), 0),
            'comissao_gerada', COALESCE((
                SELECT SUM(c.valor_comissao) FROM public.parceiro_comissoes c
                 WHERE c.gerada_em >= v_ini_ts AND c.gerada_em < v_fim_ts
                   AND c.status NOT IN ('cancelada', 'estornada')), 0),
            'saldo_a_pagar', COALESCE((
                SELECT SUM(c.valor_comissao) FROM public.parceiro_comissoes c
                 WHERE c.status = 'aprovada'), 0)
        ),

        'cancelamentos', json_build_object(
            'registrados', (SELECT count(*) FROM public.cancelamento_feedback
                             WHERE data_cancelamento BETWEEN p_inicio AND p_fim)
        )
    ) INTO v_resultado;

    RETURN v_resultado;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_metricas_visao_geral(p_inicio date, p_fim date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_janela   INT := public.admin_config_int('janela_atividade_dias', 30);
    v_dias     INT;
    v_ini_ant  DATE;
    v_fim_ant  DATE;
    v_ini_ts   TIMESTAMPTZ;
    v_fim_ts   TIMESTAMPTZ;
    v_ini_ant_ts TIMESTAMPTZ;
    v_fim_ant_ts TIMESTAMPTZ;
    v_resultado JSON;
BEGIN
    PERFORM public.exigir_backoffice();

    IF p_inicio > p_fim THEN
        RAISE EXCEPTION 'período inválido: início depois do fim';
    END IF;

    v_dias    := (p_fim - p_inicio) + 1;
    v_fim_ant := p_inicio - 1;
    v_ini_ant := v_fim_ant - (v_dias - 1);

    -- Comparação sempre em [início 00:00, fim+1 00:00) para incluir o último
    -- dia inteiro. Usar `<= p_fim` cortaria tudo que aconteceu depois da
    -- meia-noite do último dia.
    v_ini_ts     := p_inicio::TIMESTAMPTZ;
    v_fim_ts     := (p_fim + 1)::TIMESTAMPTZ;
    v_ini_ant_ts := v_ini_ant::TIMESTAMPTZ;
    v_fim_ant_ts := (v_fim_ant + 1)::TIMESTAMPTZ;

    SELECT json_build_object(
        'periodo', json_build_object('inicio', p_inicio, 'fim', p_fim),
        'periodo_anterior', json_build_object('inicio', v_ini_ant, 'fim', v_fim_ant),
        'janela_atividade_dias', v_janela,

        'usuarios', (
            SELECT json_build_object(
                'total',     count(*),
                'novos',     count(*) FILTER (WHERE c.created_at >= v_ini_ts AND c.created_at < v_fim_ts),
                'novos_anterior', count(*) FILTER (WHERE c.created_at >= v_ini_ant_ts AND c.created_at < v_fim_ant_ts),
                'ativos',    count(*) FILTER (WHERE c.status = 'ativo' AND public.classificar_atividade(c.ultimo_acesso_em, v_janela) = 'ativo'),
                'inativos',  count(*) FILTER (WHERE c.status = 'ativo' AND public.classificar_atividade(c.ultimo_acesso_em, v_janela) = 'inativo'),
                'sem_dados', count(*) FILTER (WHERE c.status = 'ativo' AND c.ultimo_acesso_em IS NULL),
                'suspensos', count(*) FILTER (WHERE c.status = 'suspenso')
            )
            FROM public.corretores c
        ),

        'assinaturas', COALESCE((
            SELECT json_build_object(
                'trialing',  count(*) FILTER (WHERE s.status = 'trialing'),
                'active',    count(*) FILTER (WHERE s.status = 'active'),
                'past_due',  count(*) FILTER (WHERE s.status = 'past_due'),
                'canceled',  count(*) FILTER (WHERE s.status = 'canceled'),
                'expired',   count(*) FILTER (WHERE s.status = 'expired'),
                'read_only', count(*) FILTER (WHERE s.status = 'read_only')
            )
            FROM public.subscriptions s
        ), json_build_object('trialing',0,'active',0,'past_due',0,'canceled',0,'expired',0,'read_only',0)),

        'receita', (
            SELECT json_build_object(
                -- tem_dados olha a tabela inteira, não o período: é a diferença
                -- entre "não faturamos neste mês" e "nunca registramos receita".
                -- A tela usa isso para não exibir R$ 0,00 como se fosse um fato.
                'tem_dados', EXISTS (SELECT 1 FROM public.receita_eventos WHERE status = 'confirmado'),
                'recebida',  COALESCE(sum(r.valor_bruto) FILTER (WHERE r.confirmado_em >= v_ini_ts AND r.confirmado_em < v_fim_ts), 0),
                'recebida_anterior', COALESCE(sum(r.valor_bruto) FILTER (WHERE r.confirmado_em >= v_ini_ant_ts AND r.confirmado_em < v_fim_ant_ts), 0),
                'eventos',   count(*) FILTER (WHERE r.confirmado_em >= v_ini_ts AND r.confirmado_em < v_fim_ts)
            )
            FROM public.receita_eventos r
            WHERE r.status = 'confirmado'
        ),

        'parceiros', json_build_object(
            'total',  (SELECT count(*) FROM public.parceiros),
            'ativos', (SELECT count(*) FROM public.parceiros WHERE status = 'ativo'),
            'cliques', (SELECT count(*) FROM public.parceiro_cliques WHERE criado_em >= v_ini_ts AND criado_em < v_fim_ts),
            'cliques_anterior', (SELECT count(*) FROM public.parceiro_cliques WHERE criado_em >= v_ini_ant_ts AND criado_em < v_fim_ant_ts),
            'atribuicoes', (SELECT count(*) FROM public.parceiro_atribuicoes WHERE criado_em >= v_ini_ts AND criado_em < v_fim_ts),
            'conversoes', (SELECT count(*) FROM public.parceiro_atribuicoes WHERE convertido_em >= v_ini_ts AND convertido_em < v_fim_ts),
            'conversoes_anterior', (SELECT count(*) FROM public.parceiro_atribuicoes WHERE convertido_em >= v_ini_ant_ts AND convertido_em < v_fim_ant_ts)
        ),

        'comissoes', (
            SELECT json_build_object(
                'valor_pendente',  COALESCE(sum(valor_comissao) FILTER (WHERE status IN ('pendente','em_validacao')), 0),
                'valor_aprovada',  COALESCE(sum(valor_comissao) FILTER (WHERE status = 'aprovada'), 0),
                'valor_paga',      COALESCE(sum(valor_comissao) FILTER (WHERE status = 'paga'), 0),
                'valor_estornada', COALESCE(sum(valor_comissao) FILTER (WHERE status IN ('estornada','cancelada')), 0),
                'quantidade',      count(*)
            )
            FROM public.parceiro_comissoes
        )
    ) INTO v_resultado;

    RETURN v_resultado;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_onboarding_metricas(p_inicio timestamp with time zone, p_fim timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'acesso negado' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object(
        'novos_cadastros',(SELECT count(*) FROM public.onboarding_events
                            WHERE event_name='signup_completed' AND criado_em>=p_inicio AND criado_em<p_fim),
        'iniciados',(SELECT count(*) FROM public.onboarding_events
                      WHERE event_name='onboarding_started' AND criado_em>=p_inicio AND criado_em<p_fim),
        'concluidos',(SELECT count(*) FROM public.onboarding_events
                       WHERE event_name='onboarding_completed' AND criado_em>=p_inicio AND criado_em<p_fim),
        'travados',(SELECT count(*) FROM public.onboarding_progress pr
                     JOIN public.onboarding_profiles op ON op.id=pr.profile_id
                    WHERE pr.completed_at IS NULL AND pr.dismissed_at IS NULL
                      AND COALESCE((op.metadata->>'legacy_account')::BOOLEAN,FALSE)=FALSE
                      AND pr.last_activity_at<now()-INTERVAL '48 hours'
                      AND EXISTS (SELECT 1 FROM public.onboarding_events ev
                                   WHERE ev.profile_id=op.id AND ev.event_name='onboarding_started')),
        'primeiro_valor',(SELECT count(*) FROM public.onboarding_events
                            WHERE event_name='first_value_reached' AND criado_em>=p_inicio AND criado_em<p_fim),
        'usaram_demonstracao',(SELECT count(DISTINCT organization_id) FROM public.onboarding_sample_data WHERE criado_em>=p_inicio AND criado_em<p_fim),
        'convites',(SELECT count(*) FROM public.organizacao_convites WHERE criado_em>=p_inicio AND criado_em<p_fim),
        'por_etapa',(SELECT COALESCE(jsonb_object_agg(current_step,total),'{}'::JSONB)
                       FROM (SELECT pr.current_step,count(*) total
                               FROM public.onboarding_progress pr
                               JOIN public.onboarding_profiles op ON op.id=pr.profile_id
                              WHERE pr.completed_at IS NULL AND pr.dismissed_at IS NULL
                                AND COALESCE((op.metadata->>'legacy_account')::BOOLEAN,FALSE)=FALSE
                                AND EXISTS (SELECT 1 FROM public.onboarding_events ev
                                             WHERE ev.profile_id=op.id AND ev.event_name='onboarding_started')
                              GROUP BY pr.current_step) q),
        'trials_encerrando',(SELECT count(*) FROM public.subscriptions
                              WHERE status='trialing' AND trial_ends_at BETWEEN now() AND now()+INTERVAL '7 days')
    );
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_opcoes_parceiros()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'acesso negado' USING ERRCODE='42501'; END IF;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome,id),'[]'::JSONB) FROM public.parceiros);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_papeis_usuario(p_user_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.exigir_backoffice();
  RETURN COALESCE((
    SELECT array_agg(r.role::TEXT ORDER BY r.role::TEXT)
      FROM public.user_roles r
     WHERE r.user_id = p_user_id AND r.revogado_em IS NULL
  ), ARRAY[]::TEXT[]);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_parceiros_elegiveis_repasse(p_saldo_minimo numeric DEFAULT NULL::numeric)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_minimo NUMERIC;
    v_hold   INT;
    v_itens  JSON;
BEGIN
    PERFORM public.exigir_admin();

    v_minimo := COALESCE(p_saldo_minimo,
                         (SELECT (valor #>> '{}')::NUMERIC FROM public.admin_config
                           WHERE chave = 'programa_saldo_minimo'), 0);
    v_hold   := public.admin_config_int('programa_hold_dias', 0);

    SELECT COALESCE(json_agg(linha ORDER BY linha->>'nome'), '[]'::JSON)
    INTO v_itens
    FROM (
        SELECT json_build_object(
            'parceiro_id', p.id,
            'nome',        p.nome,
            'email',       p.email,
            'documento',   p.documento,
            'chave_pix',   p.chave_pix,
            'tipo_chave_pix', p.tipo_chave_pix,
            'comissoes',   count(c.id),
            'valor',       COALESCE(SUM(c.valor_comissao), 0),
            'elegivel',    COALESCE(SUM(c.valor_comissao), 0) >= v_minimo
        ) AS linha
        FROM public.parceiros p
        JOIN public.parceiro_comissoes c ON c.parceiro_id = p.id
        WHERE p.status = 'ativo'
          -- Sem PIX não há como pagar. Aparecer na lista e falhar na exportação
          -- seria pior que não aparecer: a tela informa o motivo.
          AND p.chave_pix IS NOT NULL
          AND p.tipo_chave_pix IS NOT NULL
          AND c.status = 'aprovada'
          -- Hold: comissão recém-gerada ainda pode ser desfeita por estorno ou
          -- chargeback da receita que a originou. Pagar antes disso é dinheiro
          -- que sai e não volta.
          AND c.gerada_em <= now() - make_interval(days => v_hold)
          AND NOT EXISTS (
              SELECT 1 FROM public.parceiro_lote_itens i WHERE i.comissao_id = c.id
          )
        GROUP BY p.id, p.nome, p.email, p.documento, p.chave_pix, p.tipo_chave_pix
    ) sub;

    RETURN json_build_object(
        'saldo_minimo', v_minimo,
        'hold_dias',    v_hold,
        'itens',        v_itens
    );
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_preparar_suporte(p_corretor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c public.corretores;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'acesso negado' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.corretores WHERE id=p_corretor_id;
  IF c.id IS NULL OR c.status <> 'ativo' THEN
    RAISE EXCEPTION 'A conta precisa estar ativa para iniciar atendimento.' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=c.user_id
            AND role IN ('admin','super_admin') AND revogado_em IS NULL) THEN
    RAISE EXCEPTION 'Contas administrativas nao podem ser abertas em modo de atendimento.' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('corretor_id',c.id,'user_id',c.user_id,'nome',c.nome);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_registrar_cancelamento(p_motivo text, p_corretor_id uuid DEFAULT NULL::uuid, p_contato_nome text DEFAULT NULL::text, p_contato_email text DEFAULT NULL::text, p_contato_telefone text DEFAULT NULL::text, p_plano_anterior text DEFAULT NULL::text, p_comentario text DEFAULT NULL::text, p_origem text DEFAULT 'outro'::text, p_data date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_id    UUID;
    v_nome  TEXT := NULLIF(btrim(COALESCE(p_contato_nome, '')), '');
    v_email TEXT := NULLIF(btrim(COALESCE(p_contato_email, '')), '');
    v_fone  TEXT := NULLIF(btrim(COALESCE(p_contato_telefone, '')), '');
    v_plano TEXT := NULLIF(btrim(COALESCE(p_plano_anterior, '')), '');
BEGIN
    PERFORM public.exigir_admin();

    IF p_corretor_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.corretores WHERE id = p_corretor_id) THEN
            RAISE EXCEPTION 'conta não encontrada';
        END IF;
        -- Havendo conta, o contato sai do join. Descartar aqui é o que faz a
        -- constraint `cancelamento_feedback_sem_pii_duplicado` passar sem
        -- obrigar a tela a saber da regra — e evita uma segunda cópia de dado
        -- pessoal para localizar num pedido de exclusão.
        v_nome  := NULL;
        v_email := NULL;
        v_fone  := NULL;

        -- Plano anterior também é derivável, mas precisa ser congelado: a
        -- assinatura pode mudar de plano depois, e o feedback perderia o
        -- contexto de qual plano a pessoa estava pagando quando saiu.
        --
        -- O guard não é zelo excessivo: em 2026-09-02 o diagnóstico de
        -- produção mostrou `plans` e `subscriptions` ausentes. Sem ele,
        -- registrar um cancelamento de conta identificada estouraria 42P01 e
        -- o operador perderia o depoimento que acabou de colher.
        IF v_plano IS NULL
           AND to_regclass('public.subscriptions') IS NOT NULL
           AND to_regclass('public.plans') IS NOT NULL THEN
            SELECT p.code INTO v_plano
            FROM public.subscriptions s
            JOIN public.plans p ON p.id = s.plan_id
            WHERE s.corretor_id = p_corretor_id
            ORDER BY s.updated_at DESC
            LIMIT 1;
        END IF;
    END IF;

    INSERT INTO public.cancelamento_feedback
        (corretor_id, contato_nome, contato_email, contato_telefone,
         plano_anterior, motivo, comentario, origem, data_cancelamento, registrado_por)
    VALUES
        (p_corretor_id, v_nome, v_email, v_fone,
         v_plano, p_motivo, NULLIF(btrim(COALESCE(p_comentario, '')), ''),
         COALESCE(p_origem, 'outro'), COALESCE(p_data, CURRENT_DATE), auth.uid())
    RETURNING id INTO v_id;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_depois, motivo)
    VALUES
        (auth.uid(), 'registrar_cancelamento', 'cancelamento_feedback', v_id::TEXT,
         -- Sem o comentário: ele é a fala do cliente e já está na própria
         -- linha. Repeti-lo na trilha só multiplica onde o dado precisa ser
         -- apagado depois.
         jsonb_build_object('motivo', p_motivo, 'origem', COALESCE(p_origem, 'outro'),
                            'corretor_id', p_corretor_id),
         NULL);

    RETURN json_build_object('id', v_id);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_registrar_pagamento(p_parceiro_id uuid, p_comissao_ids uuid[], p_metodo text DEFAULT NULL::text, p_referencia text DEFAULT NULL::text, p_pago_em date DEFAULT NULL::date, p_observacoes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_total NUMERIC(12,2);
    v_qtd   INT;
    v_pag   UUID;
BEGIN
    PERFORM public.exigir_super_admin();

    IF p_comissao_ids IS NULL OR array_length(p_comissao_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'selecione ao menos uma comissão';
    END IF;

    -- Só comissão aprovada e do parceiro informado entra no lote. Sem este
    -- filtro, um id de outro parceiro entraria no pagamento por engano.
    SELECT COALESCE(sum(valor_comissao), 0), count(*)
      INTO v_total, v_qtd
      FROM public.parceiro_comissoes
     WHERE id = ANY(p_comissao_ids)
       AND parceiro_id = p_parceiro_id
       AND status = 'aprovada';

    IF v_qtd = 0 THEN
        RAISE EXCEPTION 'nenhuma comissão aprovada deste parceiro na seleção';
    END IF;

    IF v_qtd <> array_length(p_comissao_ids, 1) THEN
        RAISE EXCEPTION 'a seleção tem % comissões, mas só % estão aprovadas para este parceiro',
            array_length(p_comissao_ids, 1), v_qtd;
    END IF;

    INSERT INTO public.parceiro_pagamentos
        (parceiro_id, valor_total, metodo, referencia, pago_em, observacoes,
         registrado_por, competencia_inicio, competencia_fim)
    VALUES
        (p_parceiro_id, v_total, p_metodo, p_referencia,
         COALESCE(p_pago_em, CURRENT_DATE), p_observacoes, auth.uid(),
         (SELECT min(competencia) FROM public.parceiro_comissoes WHERE id = ANY(p_comissao_ids)),
         (SELECT max(competencia) FROM public.parceiro_comissoes WHERE id = ANY(p_comissao_ids)))
    RETURNING id INTO v_pag;

    UPDATE public.parceiro_comissoes
       SET status = 'paga', paga_em = now(), pagamento_id = v_pag
     WHERE id = ANY(p_comissao_ids) AND parceiro_id = p_parceiro_id AND status = 'aprovada';

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_depois, motivo)
    VALUES
        (auth.uid(), 'registrar_pagamento', 'parceiro_pagamentos', v_pag::TEXT,
         jsonb_build_object('valor_total', v_total, 'comissoes', v_qtd,
                            'parceiro_id', p_parceiro_id),
         p_observacoes);

    RETURN json_build_object('id', v_pag, 'valor_total', v_total, 'comissoes', v_qtd);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_registrar_receita(p_corretor_id uuid, p_valor_bruto numeric, p_confirmado_em timestamp with time zone, p_tipo text DEFAULT 'assinatura'::text, p_valor_liquido numeric DEFAULT NULL::numeric, p_competencia date DEFAULT NULL::date, p_motivo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_id UUID;
BEGIN
    -- Registrar receita à mão é o ponto onde alguém poderia inventar
    -- faturamento. Fica com super_admin e sempre com justificativa.
    PERFORM public.exigir_super_admin();

    IF p_valor_bruto IS NULL OR p_valor_bruto <= 0 THEN
        RAISE EXCEPTION 'o valor precisa ser maior que zero';
    END IF;

    IF p_confirmado_em > now() THEN
        RAISE EXCEPTION 'não é possível registrar receita com data futura';
    END IF;

    IF length(btrim(COALESCE(p_motivo, ''))) < 10 THEN
        RAISE EXCEPTION 'informe uma justificativa com ao menos 10 caracteres';
    END IF;

    INSERT INTO public.receita_eventos
        (corretor_id, origem, tipo, valor_bruto, valor_liquido, status,
         confirmado_em, competencia, registrado_por, motivo)
    VALUES
        (p_corretor_id, 'manual_admin', p_tipo, p_valor_bruto, p_valor_liquido,
         'confirmado', p_confirmado_em,
         COALESCE(p_competencia, date_trunc('month', p_confirmado_em)::DATE),
         auth.uid(), btrim(p_motivo))
    RETURNING id INTO v_id;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_depois, motivo)
    VALUES
        (auth.uid(), 'registrar_receita', 'receita_eventos', v_id::TEXT,
         jsonb_build_object('valor_bruto', p_valor_bruto, 'corretor_id', p_corretor_id),
         btrim(p_motivo));

    RETURN json_build_object('id', v_id);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_revogar_papel(p_user_role_id uuid, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_papel public.user_roles%ROWTYPE;
BEGIN
  PERFORM public.exigir_super_admin();

  IF length(btrim(COALESCE(p_motivo, ''))) < 10 THEN
    RAISE EXCEPTION 'informe uma justificativa com ao menos 10 caracteres';
  END IF;

  SELECT * INTO v_papel
    FROM public.user_roles
   WHERE id = p_user_role_id AND revogado_em IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'papel ativo não encontrado';
  END IF;

  IF v_papel.user_id = auth.uid() AND v_papel.role::TEXT = 'super_admin' THEN
    RAISE EXCEPTION 'você não pode revogar o próprio papel de super admin';
  END IF;
  IF v_papel.role::TEXT = 'super_admin'
     AND (SELECT count(*) FROM public.user_roles
           WHERE role::TEXT = 'super_admin' AND revogado_em IS NULL) <= 1 THEN
    RAISE EXCEPTION 'a plataforma precisa manter ao menos um super admin';
  END IF;

  UPDATE public.user_roles
     SET revogado_em = now(), revogado_por = auth.uid(), motivo = btrim(p_motivo)
   WHERE id = v_papel.id;

  INSERT INTO public.admin_auditoria
    (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois, motivo)
  VALUES
    (auth.uid(), 'revogar_papel', 'user_roles', v_papel.id::TEXT,
     jsonb_build_object('user_id', v_papel.user_id, 'papel', v_papel.role::TEXT),
     jsonb_build_object('revogado_em', now()), btrim(p_motivo));

  RETURN json_build_object('id', v_papel.id, 'revogado', true);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_salvar_config(p_chave text, p_valor jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_antes JSONB;
BEGIN
    PERFORM public.exigir_super_admin();

    SELECT valor INTO v_antes FROM public.admin_config WHERE chave = p_chave;
    IF NOT FOUND THEN
        -- Só chaves semeadas por migration. Aceitar chave livre transformaria
        -- `admin_config` em depósito de qualquer coisa vinda do navegador.
        RAISE EXCEPTION 'configuração desconhecida: %', p_chave;
    END IF;

    UPDATE public.admin_config
       SET valor = p_valor, atualizado_em = now(), atualizado_por = auth.uid()
     WHERE chave = p_chave;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois)
    VALUES
        (auth.uid(), 'alterar_config', 'admin_config', p_chave,
         jsonb_build_object('valor', v_antes), jsonb_build_object('valor', p_valor));

    RETURN json_build_object('chave', p_chave, 'valor', p_valor);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_status_integracoes()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_checkout   JSON;
    v_asaas      JSON;
    v_tracking   JSON;
    v_repasse    JSON;
    v_rls        JSON;
BEGIN
    PERFORM public.exigir_backoffice();

    -- Checkout do site (repositório irmão). Ausente não é erro: significa que
    -- a base ainda não recebeu a migration do site.
    IF to_regclass('public.checkout_orders') IS NULL THEN
        v_checkout := json_build_object('instalado', FALSE);
    ELSE
        SELECT json_build_object(
            'instalado', TRUE,
            'pedidos',   count(*),
            'pagos',     count(*) FILTER (WHERE status = 'active'),
            'aguardando',count(*) FILTER (WHERE status IN ('creating', 'awaiting_payment')),
            'falhados',  count(*) FILTER (WHERE status = 'failed'),
            -- Pedido pago sem acesso enviado é o pior estado possível: alguém
            -- pagou e não entrou. Precisa ser um número na tela.
            'pagos_sem_acesso', count(*) FILTER (
                WHERE status = 'active' AND access_email_sent_at IS NULL)
        ) INTO v_checkout FROM public.checkout_orders;
    END IF;

    IF to_regclass('public.asaas_checkout_events') IS NULL THEN
        v_asaas := json_build_object('instalado', FALSE);
    ELSE
        SELECT json_build_object(
            'instalado', TRUE,
            'eventos',   count(*),
            'processados', count(*) FILTER (WHERE status = 'processed'),
            'falhados',  count(*) FILTER (WHERE status = 'failed'),
            'ultimo_processado_em', max(processed_at) FILTER (WHERE status = 'processed'),
            'ultimo_erro', left(max(error_code) FILTER (WHERE status = 'failed'), 120)
        ) INTO v_asaas FROM public.asaas_checkout_events;
    END IF;

    SELECT json_build_object(
        'cliques_total',    (SELECT count(*) FROM public.parceiro_cliques),
        'cliques_30d',      (SELECT count(*) FROM public.parceiro_cliques
                              WHERE criado_em >= now() - INTERVAL '30 days'),
        'links_ativos',     (SELECT count(*) FROM public.parceiro_links WHERE ativo),
        'atribuicoes',      (SELECT count(*) FROM public.parceiro_atribuicoes),
        'ultimo_clique_em', (SELECT max(criado_em) FROM public.parceiro_cliques)
    ) INTO v_tracking;

    SELECT json_build_object(
        'parceiros_ativos', (SELECT count(*) FROM public.parceiros WHERE status = 'ativo'),
        'parceiros_com_pix',(SELECT count(*) FROM public.parceiros
                              WHERE status = 'ativo' AND chave_pix IS NOT NULL),
        'comissoes_aprovadas', (SELECT count(*) FROM public.parceiro_comissoes
                                 WHERE status = 'aprovada'),
        'lotes_abertos',    (SELECT count(*) FROM public.parceiro_lotes
                              WHERE status IN ('rascunho', 'exportado')),
        'portal_publicado', COALESCE(
            (SELECT (valor #>> '{}')::BOOLEAN FROM public.admin_config
              WHERE chave = 'portal_publicado'), FALSE)
    ) INTO v_repasse;

    -- RLS das tabelas novas, lida do catálogo. Uma tabela do back office sem
    -- RLS é vazamento entre inquilinos, e é o tipo de coisa que só aparece
    -- quando alguém olha — então a tela olha.
    SELECT json_agg(json_build_object(
        'tabela', c.relname,
        'rls',    c.relrowsecurity,
        'policies', (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)
    ) ORDER BY c.relname) INTO v_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('parceiro_lotes', 'parceiro_lote_itens', 'cancelamento_feedback',
                        'parceiros', 'parceiro_comissoes', 'receita_eventos',
                        'admin_config', 'admin_auditoria', 'user_roles');

    RETURN json_build_object(
        'checkout',  v_checkout,
        'webhook',   v_asaas,
        'tracking',  v_tracking,
        'repasse',   v_repasse,
        'rls',       COALESCE(v_rls, '[]'::JSON),
        'verificado_em', now()
    );
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_transicionar_comissao(p_comissao_id uuid, p_novo_status text, p_motivo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_atual public.parceiro_comissoes;
    v_ok    BOOLEAN;
BEGIN
    PERFORM public.exigir_admin();

    -- Pagar e estornar mexem em dinheiro que sai: sobem de nível.
    IF p_novo_status IN ('paga', 'estornada') THEN
        PERFORM public.exigir_super_admin();
    END IF;

    SELECT * INTO v_atual FROM public.parceiro_comissoes WHERE id = p_comissao_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'comissão não encontrada';
    END IF;

    -- Máquina de estados. Espelha transicaoValida() em src/lib/admin/comissao.ts;
    -- o TypeScript existe para a interface não oferecer um botão que aqui seria
    -- recusado, mas a decisão que vale é esta.
    v_ok := CASE
        WHEN v_atual.status = 'pendente'     AND p_novo_status IN ('em_validacao','aprovada','cancelada') THEN TRUE
        WHEN v_atual.status = 'em_validacao' AND p_novo_status IN ('aprovada','cancelada')                THEN TRUE
        WHEN v_atual.status = 'aprovada'     AND p_novo_status IN ('paga','cancelada')                    THEN TRUE
        WHEN v_atual.status = 'paga'         AND p_novo_status = 'estornada'                              THEN TRUE
        ELSE FALSE
    END;

    IF NOT v_ok THEN
        RAISE EXCEPTION 'transição inválida: % → %', v_atual.status, p_novo_status;
    END IF;

    IF p_novo_status IN ('cancelada','estornada')
       AND length(btrim(COALESCE(p_motivo, ''))) < 10 THEN
        RAISE EXCEPTION 'informe uma justificativa com ao menos 10 caracteres';
    END IF;

    UPDATE public.parceiro_comissoes
       SET status = p_novo_status,
           aprovada_em  = CASE WHEN p_novo_status = 'aprovada' THEN now() ELSE aprovada_em END,
           aprovada_por = CASE WHEN p_novo_status = 'aprovada' THEN auth.uid() ELSE aprovada_por END,
           paga_em      = CASE WHEN p_novo_status = 'paga' THEN now() ELSE paga_em END,
           cancelada_em = CASE WHEN p_novo_status IN ('cancelada','estornada') THEN now() ELSE cancelada_em END,
           cancelada_por= CASE WHEN p_novo_status IN ('cancelada','estornada') THEN auth.uid() ELSE cancelada_por END,
           motivo_cancelamento = CASE WHEN p_novo_status IN ('cancelada','estornada')
                                      THEN btrim(p_motivo) ELSE motivo_cancelamento END
     WHERE id = p_comissao_id;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois, motivo)
    VALUES
        (auth.uid(), 'transicionar_comissao', 'parceiro_comissoes', p_comissao_id::TEXT,
         jsonb_build_object('status', v_atual.status),
         jsonb_build_object('status', p_novo_status),
         p_motivo);

    RETURN json_build_object('status', p_novo_status);
END $function$
;

CREATE OR REPLACE FUNCTION public.apply_checkout_payment(p_order uuid, p_payment text, p_customer text, p_subscription text, p_status text, p_due date, p_amount numeric, p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE o public.checkout_orders; owner_id uuid; plan_uuid uuid; current_sub public.subscriptions; latest public.checkout_payments; starts timestamptz; ends timestamptz;
BEGIN
 SELECT * INTO o FROM public.checkout_orders WHERE id=p_order FOR UPDATE;
 IF o.id IS NULL OR o.asaas_customer_id IS DISTINCT FROM p_customer
    OR o.asaas_subscription_id IS DISTINCT FROM p_subscription
    OR p_subscription IS NULL OR o.amount IS DISTINCT FROM p_amount OR p_due IS NULL
    OR p_status NOT IN ('CONFIRMED','RECEIVED','OVERDUE','REFUNDED','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','PENDING','DELETED') THEN
  RAISE EXCEPTION 'PAYMENT_MISMATCH';
 END IF;
 IF EXISTS(SELECT 1 FROM public.checkout_payments WHERE payment_id=p_payment AND order_id<>p_order) THEN RAISE EXCEPTION 'PAYMENT_MISMATCH'; END IF;
 SELECT id INTO owner_id FROM public.corretores WHERE user_id=p_user;
 IF owner_id IS NULL THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text||':billing',0));
 SELECT id INTO plan_uuid FROM public.plans WHERE code=o.plan_code AND active;
 IF plan_uuid IS NULL THEN RAISE EXCEPTION 'PLAN_NOT_FOUND'; END IF;
 SELECT * INTO current_sub FROM public.subscriptions WHERE corretor_id=owner_id
 ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF current_sub.external_subscription_id IS NOT NULL AND current_sub.external_subscription_id<>p_subscription
    AND current_sub.status IN ('active','trialing','past_due','read_only') THEN RAISE EXCEPTION 'ANOTHER_SUBSCRIPTION_EXISTS'; END IF;

 -- Estorno integral e exclusão são terminais para o mesmo pagamento.
 IF p_status IN ('CONFIRMED','RECEIVED') AND EXISTS(
   SELECT 1 FROM public.checkout_payments WHERE payment_id=p_payment AND status IN ('REFUNDED','DELETED')
 ) THEN RETURN; END IF;
 INSERT INTO public.checkout_payments(payment_id,order_id,status,due_date,amount)
 VALUES(p_payment,p_order,p_status,p_due,p_amount)
 ON CONFLICT(payment_id) DO UPDATE SET status=excluded.status,due_date=excluded.due_date,amount=excluded.amount,updated_at=now();

 -- Um estorno/atraso antigo não revoga um período posterior já pago.
 SELECT * INTO latest FROM public.checkout_payments WHERE order_id=p_order
 AND status IN ('CONFIRMED','RECEIVED') ORDER BY due_date DESC LIMIT 1;
 starts:=latest.due_date::timestamp AT TIME ZONE 'America/Sao_Paulo';
 ends:=(latest.due_date::timestamp+CASE WHEN o.billing_cycle='annual' THEN interval '1 year' ELSE interval '1 month' END) AT TIME ZONE 'America/Sao_Paulo';
 IF latest.payment_id IS NOT NULL THEN
  IF current_sub.id IS NULL THEN
   INSERT INTO public.subscriptions(corretor_id,plan_id,billing_cycle,status,current_period_start,current_period_end,external_subscription_id)
   VALUES(owner_id,plan_uuid,o.billing_cycle::public.billing_cycle,'active',starts,ends,p_subscription);
  ELSE
   UPDATE public.subscriptions SET plan_id=plan_uuid,billing_cycle=o.billing_cycle::public.billing_cycle,
    status=CASE WHEN ends>now() THEN 'active'::public.subscription_status ELSE 'past_due'::public.subscription_status END,
    current_period_start=starts,current_period_end=ends,trial_started_at=NULL,trial_ends_at=NULL,
    external_subscription_id=p_subscription WHERE id=current_sub.id;
  END IF;
 ELSE
  UPDATE public.subscriptions SET status='read_only' WHERE id=current_sub.id AND external_subscription_id=p_subscription;
 END IF;
 UPDATE public.checkout_orders SET provisioned_user_id=p_user,
  status=CASE WHEN ends>now() THEN 'active' WHEN p_status='OVERDUE' THEN 'overdue' ELSE 'refunded' END,
  failure_code=NULL WHERE id=p_order;
END $function$
;

CREATE OR REPLACE FUNCTION public.auditar_escrita_direta_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_linha JSONB := to_jsonb(COALESCE(NEW, OLD));
BEGIN
    IF current_user <> 'authenticated' OR NOT public.is_admin() THEN
        RETURN NULL;
    END IF;
    PERFORM public.registrar_auditoria_admin(
        CASE TG_OP WHEN 'INSERT' THEN 'criar' WHEN 'UPDATE' THEN 'alterar' ELSE 'excluir' END || '_' || TG_TABLE_NAME,
        TG_TABLE_NAME,
        CASE TG_TABLE_NAME
            WHEN 'admin_config' THEN v_linha->>'chave'
            WHEN 'user_roles' THEN v_linha->>'user_id'
            ELSE v_linha->>'id'
        END,
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END,
        NULL
    );
    RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.auditar_mutacao_admin_direta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_antes JSONB;
  v_depois JSONB;
  v_id TEXT;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'parceiros' THEN
    v_id := COALESCE(NEW.id, OLD.id)::TEXT;
    v_antes := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE jsonb_build_object(
      'nome', OLD.nome, 'empresa', OLD.empresa, 'status', OLD.status,
      'janela_atribuicao_dias', OLD.janela_atribuicao_dias
    ) END;
    v_depois := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE jsonb_build_object(
      'nome', NEW.nome, 'empresa', NEW.empresa, 'status', NEW.status,
      'janela_atribuicao_dias', NEW.janela_atribuicao_dias
    ) END;
  ELSIF TG_TABLE_NAME = 'parceiro_links' THEN
    v_id := COALESCE(NEW.id, OLD.id)::TEXT;
    v_antes := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE jsonb_build_object(
      'slug', OLD.slug, 'campanha', OLD.campanha, 'principal', OLD.principal, 'ativo', OLD.ativo
    ) END;
    v_depois := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE jsonb_build_object(
      'slug', NEW.slug, 'campanha', NEW.campanha, 'principal', NEW.principal, 'ativo', NEW.ativo
    ) END;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.admin_auditoria
    (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois)
  VALUES
    ((SELECT auth.uid()), lower(TG_OP) || '_' || TG_TABLE_NAME,
     TG_TABLE_NAME, v_id, v_antes, v_depois);

  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.auditar_mutacao_suporte()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE s public.admin_sessoes_suporte; antes JSONB; depois JSONB; campos JSONB;
BEGIN
  SELECT * INTO s FROM public.admin_sessoes_suporte
    WHERE auth_session_id=NULLIF(auth.jwt()->>'session_id','')::UUID;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  IF s.user_id <> auth.uid() OR s.encerrado_em IS NOT NULL OR s.expira_em<=now() THEN
    RAISE EXCEPTION 'Atendimento expirado.' USING ERRCODE='42501';
  END IF;
  antes := CASE WHEN TG_OP='INSERT' THEN '{}'::JSONB ELSE to_jsonb(OLD) END;
  depois := CASE WHEN TG_OP='DELETE' THEN '{}'::JSONB ELSE to_jsonb(NEW) END;
  SELECT COALESCE(jsonb_agg(k),'[]'::JSONB) INTO campos FROM
    (SELECT key k FROM jsonb_each(antes||depois)) ch WHERE antes->k IS DISTINCT FROM depois->k;
  INSERT INTO public.admin_auditoria(ator_user_id,acao,entidade,entidade_id,dados_depois,motivo)
    VALUES(s.ator_user_id,'suporte_'||lower(TG_OP),TG_TABLE_NAME,
      COALESCE(depois->>'id',antes->>'id'),
      jsonb_build_object('sessao_id',s.id,'corretor_id',s.corretor_id,'campos',campos),'Atendimento pelo backoffice');
  RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.bloquear_mutacao_admin_auditoria()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN RAISE EXCEPTION 'admin_auditoria é append-only'; END $function$
;

CREATE OR REPLACE FUNCTION public.bloquear_mutacao_auditoria()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN RAISE EXCEPTION 'auditoria_financeira é append-only'; END $function$
;

CREATE OR REPLACE FUNCTION public.bloquear_recurso_acima_da_cota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_feature TEXT;
  v_deve_checar BOOLEAN := FALSE;
  v_permitido BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'imoveis' THEN
    v_feature := 'max_imoveis';
    IF TG_OP = 'INSERT' THEN
      v_deve_checar := NEW.ativo IS TRUE;
    ELSE
      v_deve_checar := NEW.ativo IS TRUE AND (OLD.ativo IS NOT TRUE OR NEW.corretor_id IS DISTINCT FROM OLD.corretor_id);
    END IF;
  ELSIF TG_TABLE_NAME = 'fachadas' THEN
    v_feature := 'max_fachadas';
    IF TG_OP = 'INSERT' THEN
      v_deve_checar := NEW.ativo IS TRUE;
    ELSE
      v_deve_checar := NEW.ativo IS TRUE AND (OLD.ativo IS NOT TRUE OR NEW.corretor_id IS DISTINCT FROM OLD.corretor_id);
    END IF;
  ELSIF TG_TABLE_NAME = 'contratos' THEN
    v_feature := 'max_contratos_locacao';
    IF TG_OP = 'INSERT' THEN
      v_deve_checar := NEW.tipo IN ('LOCACAO_RESIDENCIAL','LOCACAO_COMERCIAL') AND NEW.status = 'ATIVO';
    ELSE
      v_deve_checar := NEW.tipo IN ('LOCACAO_RESIDENCIAL','LOCACAO_COMERCIAL') AND NEW.status = 'ATIVO'
        AND (OLD.status IS DISTINCT FROM 'ATIVO' OR OLD.tipo NOT IN ('LOCACAO_RESIDENCIAL','LOCACAO_COMERCIAL')
          OR NEW.corretor_id IS DISTINCT FROM OLD.corretor_id);
    END IF;
  END IF;

  IF NOT v_deve_checar THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.corretor_id::TEXT || ':' || v_feature, 0));
  SELECT permitido INTO v_permitido
    FROM public.checar_cota(NEW.corretor_id, v_feature);
  IF NOT COALESCE(v_permitido, FALSE) THEN
    RAISE EXCEPTION 'PLAN_LIMIT_REACHED:%', v_feature USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.bootstrap_onboarding_corretor(_corretor_id uuid, _legacy boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_corretor public.corretores%ROWTYPE;
    v_org UUID;
    v_profile UUID;
BEGIN
    SELECT * INTO v_corretor FROM public.corretores WHERE id = _corretor_id;
    IF v_corretor.id IS NULL THEN RETURN NULL; END IF;

    INSERT INTO public.routine_organizations
        (legacy_corretor_id, name, trade_name, cnpj, phone, email, organization_type)
    VALUES
        (v_corretor.id, COALESCE(NULLIF(v_corretor.razao_social,''), v_corretor.nome),
         v_corretor.nome, v_corretor.cnpj_cpf, v_corretor.telefone, v_corretor.email, 'individual')
    ON CONFLICT (legacy_corretor_id) DO UPDATE SET
        name=EXCLUDED.name,
        trade_name=COALESCE(public.routine_organizations.trade_name,EXCLUDED.trade_name),
        cnpj=COALESCE(public.routine_organizations.cnpj,EXCLUDED.cnpj),
        phone=COALESCE(public.routine_organizations.phone,EXCLUDED.phone),
        email=COALESCE(public.routine_organizations.email,EXCLUDED.email),
        updated_at=now()
    RETURNING id INTO v_org;

    INSERT INTO public.routine_memberships
        (organization_id, user_id, role, status, display_name)
    VALUES (v_org, v_corretor.user_id, 'proprietario', 'active', v_corretor.nome)
    ON CONFLICT (organization_id, user_id) DO UPDATE
        SET status = 'active', role = 'proprietario', display_name = EXCLUDED.display_name, updated_at = now();

    INSERT INTO public.onboarding_profiles
        (organization_id, user_id, persona, creci_status, metadata)
    VALUES
        (v_org, v_corretor.user_id, CASE WHEN _legacy THEN 'corretor_autonomo' END,
         COALESCE(v_corretor.creci_status, 'nao_informado'),
         CASE WHEN _legacy THEN '{"legacy_account":true}'::JSONB ELSE '{}'::JSONB END)
    ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id
    RETURNING id INTO v_profile;

    INSERT INTO public.onboarding_progress
        (profile_id, current_step, completed_steps, completed_at, onboarding_version, metadata)
    VALUES
        (v_profile,
         CASE WHEN _legacy THEN 'conclusao' ELSE 'boas_vindas' END,
         CASE WHEN _legacy THEN ARRAY['legacy_account']::TEXT[] ELSE ARRAY[]::TEXT[] END,
         CASE WHEN _legacy THEN now() END,
         1,
         CASE WHEN _legacy THEN '{"migration":"existing_user"}'::JSONB ELSE '{}'::JSONB END)
    ON CONFLICT (profile_id) DO NOTHING;

    INSERT INTO public.onboarding_preferences (profile_id) VALUES (v_profile)
    ON CONFLICT (profile_id) DO NOTHING;
    INSERT INTO public.onboarding_checklist (profile_id) VALUES (v_profile)
    ON CONFLICT (profile_id) DO NOTHING;

    IF NOT _legacy AND NOT EXISTS (
        SELECT 1 FROM public.onboarding_events
         WHERE profile_id = v_profile AND event_name = 'signup_completed'
    ) THEN
        INSERT INTO public.onboarding_events
            (organization_id, user_id, profile_id, event_name, source, metadata)
        VALUES (v_org, v_corretor.user_id, v_profile, 'signup_completed', 'auth', '{}'::JSONB)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_profile;
END $function$
;

CREATE OR REPLACE FUNCTION public.checar_cota(_corretor_id uuid, _feature_key text)
 RETURNS TABLE(permitido boolean, usado integer, limite integer, ilimitado boolean, habilitado boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plano uuid;
  v_ent record;
  v_usado int := 0;
  v_extra int := 0;
begin
  if auth.role() = 'authenticated'
     and public.get_corretor_id() is distinct from _corretor_id then
    return query select false, 0, 0, false, false;
    return;
  end if;

  -- Antes de olhar o plano: a conta antiga em teste também tem plano válido,
  -- e era aí que a isenção se perdia.
  if _feature_key in ('max_imoveis', 'max_fachadas', 'max_contratos_locacao')
     and public.conta_antiga_sem_limite(_corretor_id) then
    return query select true, 0, null::integer, true, true;
    return;
  end if;

  select s.plan_id into v_plano
    from public.subscriptions s
   where s.corretor_id = _corretor_id
     and ((s.status = 'trialing' and s.trial_ends_at > now())
       or (s.status = 'active' and s.current_period_end > now()))
   limit 1;

  if v_plano is null then
    return query select false, 0, 0, false, false;
    return;
  end if;

  select e.enabled, e.limit_value, e.unlimited into v_ent
    from public.plan_entitlements e
   where e.plan_id = v_plano and e.feature_key = _feature_key;

  if not found then
    return query select false, 0, 0, false, false;
    return;
  end if;

  if not v_ent.enabled then
    return query select false, 0, v_ent.limit_value, v_ent.unlimited, false;
    return;
  end if;

  if v_ent.unlimited then
    return query select true, 0, null::int, true, true;
    return;
  end if;

  if v_ent.limit_value is null then
    return query select v_ent.enabled, 0, null::int, false, v_ent.enabled;
    return;
  end if;

  case _feature_key
    when 'max_imoveis' then
      select count(*)::int into v_usado from public.imoveis
       where corretor_id = _corretor_id and ativo is true;
    when 'max_contratos_locacao' then
      select count(*)::int into v_usado from public.contratos
       where corretor_id = _corretor_id
         and tipo in ('LOCACAO_RESIDENCIAL', 'LOCACAO_COMERCIAL') and status = 'ATIVO';
    when 'max_fachadas' then
      select count(*)::int into v_usado from public.fachadas
       where corretor_id = _corretor_id and ativo is true;
    else
      select coalesce(u.used_quantity, 0) into v_usado
        from public.usage_counters u
       where u.corretor_id = _corretor_id
         and u.feature_key = _feature_key
         and u.period_start = date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
      v_usado := coalesce(v_usado, 0);
  end case;

  select coalesce(sum(
    case a.addon_code
      when 'extra_user' then case when _feature_key = 'max_users' then a.quantity else 0 end
      when 'extra_fachadas_25' then case when _feature_key = 'max_fachadas' then 25 * a.quantity else 0 end
      when 'extra_ai_100' then case when _feature_key = 'ai_contracts_monthly' then 100 * a.quantity else 0 end
      when 'extra_leads_50' then case when _feature_key = 'leads_qualificados_monthly' then 50 * a.quantity else 0 end
      when 'extra_storage_50' then case when _feature_key = 'storage_gb' then 50 * a.quantity else 0 end
      else 0
    end
  ), 0)::int into v_extra
    from public.subscription_addons a
   where a.corretor_id = _corretor_id and a.status = 'active';

  return query select
    v_ent.enabled and v_usado < v_ent.limit_value + v_extra,
    v_usado,
    v_ent.limit_value + v_extra,
    false,
    v_ent.enabled;
end $function$
;

CREATE OR REPLACE FUNCTION public.checkout_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_asaas_checkout_event(p_event_id text, p_event_type text, p_payment_id text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  claimed BOOLEAN := FALSE;
BEGIN
  INSERT INTO public.asaas_checkout_events (id, event_type, payment_id)
  VALUES (p_event_id, p_event_type, p_payment_id)
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.asaas_checkout_events
     SET status = 'processing',
         attempts = attempts + 1,
         error_code = NULL
   WHERE id = p_event_id
     AND (
       status IN ('received', 'failed')
       OR (status = 'processing' AND updated_at < NOW() - INTERVAL '5 minutes')
     )
  RETURNING TRUE INTO claimed;

  RETURN COALESCE(claimed, FALSE);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_checkout_order_provisioning(p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  claimed BOOLEAN := FALSE;
BEGIN
  UPDATE public.checkout_orders
     SET status = 'processing',
         provisioning_started_at = NOW(),
         failure_code = NULL
   WHERE id = p_order_id
     AND access_email_sent_at IS NULL
     AND status <> 'refunded'
     AND (
       provisioning_started_at IS NULL
       OR provisioning_started_at < NOW() - INTERVAL '5 minutes'
     )
  RETURNING TRUE INTO claimed;

  RETURN COALESCE(claimed, FALSE);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_jobs(p_limit integer DEFAULT 10)
 RETURNS SETOF public.job_queue
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    UPDATE job_queue j SET status = 'PROCESSING', started_at = now(), attempts = attempts + 1
    WHERE j.id IN (
        SELECT id FROM job_queue
        WHERE status IN ('PENDING','RETRYING') AND run_after <= now()
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT p_limit
    )
    RETURNING j.*;
$function$
;

CREATE OR REPLACE FUNCTION public.classificar_atividade(_ultimo_acesso timestamp with time zone, _janela_dias integer)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
    SELECT CASE
        WHEN _ultimo_acesso IS NULL THEN 'sem_dados'
        WHEN _ultimo_acesso >= now() - make_interval(days => _janela_dias) THEN 'ativo'
        ELSE 'inativo'
    END
$function$
;

CREATE OR REPLACE FUNCTION public.clientes_phone_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_key text:=public.lotti_phone_key_confiavel(new.telefone); v_existing uuid;
begin
  if v_key is null then return new; end if;
  -- A signed-in user writing a row for another account is refused by RLS,
  -- which runs after this trigger: answering first would tell them whether
  -- that account has the phone.
  -- Ingest and the other service paths run without a user.
  if auth.uid() is not null and not exists(select 1 from public.corretores r where r.id=new.corretor_id and r.user_id=auth.uid()) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.corretor_id::text||':'||v_key,716));
  select id into v_existing from public.clientes
   where corretor_id=new.corretor_id and public.lotti_phone_key(telefone)=v_key and id<>new.id
   order by created_at limit 1;
  if v_existing is not null then
    -- The front end shows "Este telefone já é do cliente X" from this id.
    raise exception 'duplicate_client_phone' using detail=v_existing::text;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.conciliar_transferencia_repasse(_corretor_id uuid, _transfer_id text, _external_ref text, _valor numeric, _chave_pix text)
 RETURNS TABLE(repasse_id uuid, criterio text, ambiguidade integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_id    UUID;
    v_qtd   INT;
BEGIN
    -- 1. Transferência criada pelo sistema.
    IF _transfer_id IS NOT NULL THEN
        SELECT id INTO v_id FROM public.repasses_proprietario
         WHERE external_id = _transfer_id
           AND (_corretor_id IS NULL OR corretor_id = _corretor_id)
         LIMIT 1;
        IF v_id IS NOT NULL THEN
            RETURN QUERY SELECT v_id, 'external_id'::TEXT, 1;
            RETURN;
        END IF;
    END IF;

    -- 2. Referência externa preenchida à mão no Asaas.
    IF _external_ref IS NOT NULL AND _external_ref ~ '^[0-9a-f-]{36}$' THEN
        SELECT id INTO v_id FROM public.repasses_proprietario
         WHERE id = _external_ref::UUID
           AND (_corretor_id IS NULL OR corretor_id = _corretor_id)
         LIMIT 1;
        IF v_id IS NOT NULL THEN
            RETURN QUERY SELECT v_id, 'external_reference'::TEXT, 1;
            RETURN;
        END IF;
    END IF;

    -- 3. Heurística: valor exato + chave PIX, SÓ com inquilino conhecido.
    IF _corretor_id IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, 'heuristica_sem_inquilino'::TEXT, 0;
        RETURN;
    END IF;

    IF _valor IS NOT NULL AND _chave_pix IS NOT NULL THEN
        SELECT count(*) INTO v_qtd
          FROM public.repasses_proprietario r
          JOIN public.proprietarios p ON p.id = r.proprietario_id
         WHERE r.status IN ('AGENDADO', 'ENVIADO')
           AND round(r.valor_liquido_repasse, 2) = round(_valor, 2)
           AND regexp_replace(COALESCE(p.chave_pix, ''), '\D', '', 'g')
             = regexp_replace(_chave_pix, '\D', '', 'g')
           AND r.corretor_id = _corretor_id;

        IF v_qtd = 1 THEN
            SELECT r.id INTO v_id
              FROM public.repasses_proprietario r
              JOIN public.proprietarios p ON p.id = r.proprietario_id
             WHERE r.status IN ('AGENDADO', 'ENVIADO')
               AND round(r.valor_liquido_repasse, 2) = round(_valor, 2)
               AND regexp_replace(COALESCE(p.chave_pix, ''), '\D', '', 'g')
                 = regexp_replace(_chave_pix, '\D', '', 'g')
               AND r.corretor_id = _corretor_id
             LIMIT 1;
            RETURN QUERY SELECT v_id, 'valor_e_chave_pix'::TEXT, 1;
            RETURN;
        END IF;

        IF v_qtd > 1 THEN
            RETURN QUERY SELECT NULL::UUID, 'ambiguo'::TEXT, v_qtd;
            RETURN;
        END IF;
    END IF;

    RETURN QUERY SELECT NULL::UUID, 'sem_correspondencia'::TEXT, 0;
END $function$
;

CREATE OR REPLACE FUNCTION public.consume_checkout_rate_limit(p_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE used integer;
BEGIN
 IF p_key !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 DELETE FROM public.checkout_rate_limits WHERE bucket<now()-interval '2 days';
 INSERT INTO public.checkout_rate_limits(key_hash,bucket,attempts) VALUES(p_key,date_trunc('minute',now()),1)
 ON CONFLICT(key_hash,bucket) DO UPDATE SET attempts=public.checkout_rate_limits.attempts+1 RETURNING attempts INTO used;
 RETURN used<=10;
END $function$
;

CREATE OR REPLACE FUNCTION public.consume_public_lead_limit(_subject_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF _subject_hash IS NULL OR _subject_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Identificador inválido'; END IF;
  IF NOT public.consume_public_request_limit('lead-global','global',300,60) THEN RETURN false; END IF;
  RETURN public.consume_public_request_limit('lead-phone',_subject_hash,5,600);
END $function$
;

CREATE OR REPLACE FUNCTION public.consume_public_request_limit(_scope text, _subject_hash text, _limit integer, _seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE accepted boolean := false;
BEGIN
  IF _limit < 1 OR _limit > 10000 OR _seconds < 1 OR _seconds > 3600
     OR _scope IS NULL OR length(_scope) > 80 OR _subject_hash IS NULL
     OR length(_subject_hash) > 128 THEN
    RAISE EXCEPTION 'Configuração de limite inválida';
  END IF;
  DELETE FROM public.public_request_limits WHERE expires_at <= clock_timestamp();
  INSERT INTO public.public_request_limits AS limits(scope,subject_hash,hits,expires_at)
    VALUES (_scope,_subject_hash,1,clock_timestamp()+make_interval(secs => _seconds))
  ON CONFLICT(scope,subject_hash) DO UPDATE
    SET hits=limits.hits+1
    WHERE limits.hits < _limit
  RETURNING true INTO accepted;
  RETURN coalesce(accepted,false);
END $function$
;

CREATE OR REPLACE FUNCTION public.conta_antiga_sem_limite(_corretor_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Mesma guarda de checar_cota: pelo navegador, só a própria conta.
  if auth.role() = 'authenticated'
     and public.get_corretor_id() is distinct from _corretor_id then
    return false;
  end if;

  return exists (select 1 from public.billing_legacy_accounts b
                  where b.corretor_id = _corretor_id)
     and not exists (select 1 from public.subscriptions s
                      where s.corretor_id = _corretor_id
                        and s.status not in ('trialing', 'expired'));
end $function$
;

CREATE OR REPLACE FUNCTION public.criar_convite_organizacao(p_email text, p_papel text DEFAULT 'corretor'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_org UUID; v_token TEXT; v_id UUID; v_profile UUID;
BEGIN
    SELECT organization_id INTO v_org FROM public.routine_memberships
     WHERE user_id = auth.uid() AND status='active'
       AND role IN ('proprietario','administrador','gestor') LIMIT 1;
    IF v_org IS NULL THEN RAISE EXCEPTION 'somente gestores podem convidar'; END IF;
    IF p_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'e-mail inválido'; END IF;
    IF p_papel NOT IN ('gestor','corretor','financeiro','juridico','locacoes','marketing','suporte') THEN
        RAISE EXCEPTION 'papel inválido';
    END IF;
    v_token := gen_random_uuid()::TEXT || gen_random_uuid()::TEXT;
    UPDATE public.organizacao_convites SET status='revogado'
     WHERE organization_id=v_org AND lower(email)=lower(BTRIM(p_email)) AND status='pendente';
    INSERT INTO public.organizacao_convites (organization_id,email,papel,token_hash,criado_por)
    VALUES (v_org,lower(BTRIM(p_email)),p_papel,encode(extensions.digest(v_token,'sha256'),'hex'),auth.uid())
    RETURNING id INTO v_id;
    SELECT id INTO v_profile FROM public.onboarding_profiles WHERE user_id=auth.uid();
    IF v_profile IS NOT NULL THEN
        INSERT INTO public.onboarding_events
            (organization_id,user_id,profile_id,event_name,step_key,source,metadata)
        VALUES (v_org,auth.uid(),v_profile,'team_member_invited','equipe','onboarding',jsonb_build_object('role',p_papel))
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN jsonb_build_object('id',v_id,'token',v_token,'expires_in_days',7);
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_candidatos_cliente(p_owner uuid, p_telefone text, p_email text DEFAULT NULL::text, p_cpf text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_key text:=public.lotti_phone_key_confiavel(p_telefone);
  v_email text:=nullif(lower(btrim(coalesce(p_email,''))),'');
  v_cpf text:=regexp_replace(coalesce(p_cpf,''),'[^0-9]','','g');
  v_result jsonb;
begin
  if length(v_cpf) not in (11,14) then v_cpf:=null; end if;
  if p_owner is null or (v_key is null and v_email is null and v_cpf is null) then return '[]'::jsonb; end if;
  -- One branch per reason, so the phone lookup uses clientes_corretor_phone_key_idx.
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'nome',t.nome,'motivo',t.motivo) order by t.prioridade,t.created_at),'[]'::jsonb)
    into v_result
    from (select * from (
            select distinct on (m.id) m.* from (
              select k.id,k.nome,k.created_at,1 prioridade,'telefone' motivo from public.clientes k
               where v_key is not null and k.corretor_id=p_owner and public.lotti_phone_key(k.telefone)=v_key
              union all
              select k.id,k.nome,k.created_at,2,'cpf' from public.clientes k
               where v_cpf is not null and k.corretor_id=p_owner and regexp_replace(coalesce(k.cpf,''),'[^0-9]','','g')=v_cpf
              union all
              select k.id,k.nome,k.created_at,3,'email' from public.clientes k
               where v_email is not null and k.corretor_id=p_owner and lower(btrim(k.email))=v_email) m
             order by m.id,m.prioridade) d
          order by d.prioridade,d.created_at limit 5) t;
  return v_result;
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_clientes_por_telefone(p_telefone text, p_email text DEFAULT NULL::text, p_cpf text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid:=public.get_corretor_id();
begin
  if v_owner is null then raise exception 'forbidden'; end if;
  return public.crm_candidatos_cliente(v_owner,p_telefone,p_email,p_cpf);
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_converter_lead(p_lead uuid, p_etapa uuid, p_dados jsonb DEFAULT '{}'::jsonb, p_cliente uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid:=public.get_corretor_id();
  v_dados jsonb:=coalesce(p_dados,'{}'::jsonb);
  v_lead record; v_nome text; v_telefone text; v_email text; v_key text; v_candidatos jsonb; v_result jsonb;
  v_cliente uuid:=p_cliente; v_created boolean:=false; v_oportunidade uuid;
begin
  if v_owner is null then raise exception 'forbidden'; end if;
  -- Same predicate as the policy "Corretor atualiza leads das suas fachadas".
  select l.id,l.nome,l.telefone,l.email,l.convertido,l.cliente_id into v_lead
    from public.fachada_leads l
   where l.id=p_lead and l.fachada_id in (select f.id from public.fachadas f
     where f.corretor_id in (select r.id from public.corretores r where r.user_id=auth.uid()))
   for update;
  if not found then raise exception 'forbidden'; end if;
  if v_lead.convertido then
    return jsonb_build_object('status','ja_convertido','cliente_id',v_lead.cliente_id);
  end if;
  if p_etapa is not null and not exists(select 1 from public.crm_etapas where id=p_etapa and corretor_id=v_owner) then
    raise exception 'invalid_stage';
  end if;
  v_nome:=coalesce(nullif(btrim(v_dados->>'nome'),''),nullif(btrim(v_lead.nome),''),'Lead da fachada');
  if v_cliente is not null then
    if not exists(select 1 from public.clientes where id=v_cliente and corretor_id=v_owner) then raise exception 'forbidden'; end if;
  else
    v_telefone:=coalesce(nullif(btrim(v_dados->>'telefone'),''),v_lead.telefone,'');
    v_email:=coalesce(nullif(btrim(v_dados->>'email'),''),nullif(btrim(v_lead.email),''));
    v_key:=public.lotti_phone_key(v_telefone);
    if v_key is not null then perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':'||v_key,716)); end if;
    v_candidatos:=public.crm_candidatos_cliente(v_owner,v_telefone,v_email);
    if jsonb_array_length(v_candidatos)>0 then
      return jsonb_build_object('status','duplicate','candidatos',v_candidatos);
    end if;
    v_result:=public.lotti_find_or_create_cliente(v_owner,v_telefone,v_nome,
      jsonb_build_object('tipo_interesse','COMPRA','status_funil','QUALIFICACAO','observacoes','Convertido de lead da fachada.')
      ||(v_dados-'nome'-'telefone'-'email')||jsonb_build_object('email',v_email));
    v_cliente:=(v_result->>'cliente_id')::uuid;
    v_created:=(v_result->>'created')::boolean;
  end if;
  if p_etapa is not null then
    -- An open deal of the client stays where it is (never moved back).
    v_oportunidade:=public.crm_oportunidade_aberta(v_owner,v_cliente);
    if v_oportunidade is null then
      insert into public.crm_oportunidades(corretor_id,cliente_id,etapa_id,titulo,origem)
      values(v_owner,v_cliente,p_etapa,v_nome,'fachada') returning id into v_oportunidade;
    end if;
  end if;
  update public.fachada_leads set convertido=true,cliente_id=v_cliente where id=p_lead;
  return jsonb_build_object('status','converted','cliente_id',v_cliente,'created',v_created,'oportunidade_id',v_oportunidade);
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_criar_cliente(p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid:=public.get_corretor_id();
  v_nome text:=btrim(coalesce(p_dados->>'nome',''));
  v_telefone text:=btrim(coalesce(p_dados->>'telefone',''));
  v_result jsonb;
begin
  if v_owner is null then raise exception 'forbidden'; end if;
  if v_nome='' then raise exception 'invalid_name'; end if;
  v_result:=public.lotti_find_or_create_cliente(v_owner,v_telefone,v_nome,coalesce(p_dados,'{}'::jsonb)-'nome'-'telefone',true);
  if not (v_result->>'created')::boolean then
    return jsonb_build_object('status','duplicate','candidatos',public.crm_candidatos_cliente(v_owner,v_telefone));
  end if;
  return jsonb_build_object('status','created','cliente_id',v_result->'cliente_id');
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_oportunidade_aberta(p_owner uuid, p_cliente uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_cliente::text,717));
  select id into v_id from public.crm_oportunidades
   where cliente_id=p_cliente and corretor_id=p_owner and fechada_em is null
   order by updated_at desc limit 1;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_seed_etapas_novo_corretor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    INSERT INTO public.crm_etapas (corretor_id, nome, ordem, cor, tipo)
    SELECT NEW.id, e.nome, e.ordem, e.cor, e.tipo
    FROM (VALUES
        ('Novo lead',         1, 'slate',  'ABERTA'),
        ('Primeiro contato',  2, 'sky',    'ABERTA'),
        ('Em qualificação',   3, 'blue',   'ABERTA'),
        ('Qualificado',       4, 'indigo', 'ABERTA'),
        ('Visita agendada',   5, 'amber',  'ABERTA'),
        ('Proposta enviada',  6, 'orange', 'ABERTA'),
        ('Negociação',        7, 'violet', 'ABERTA'),
        ('Fechado — ganho',   8, 'green',  'GANHO'),
        ('Fechado — perdido', 9, 'red',    'PERDIDO')
    ) AS e(nome, ordem, cor, tipo)
    ON CONFLICT (corretor_id, nome) DO NOTHING;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.decrement_contador_fachada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF TG_TABLE_NAME = 'fachada_leads' THEN
        UPDATE public.fachadas SET total_leads = GREATEST(0, total_leads - 1)
         WHERE id = OLD.fachada_id;
    ELSE
        UPDATE public.fachadas SET total_escaneamentos = GREATEST(0, total_escaneamentos - 1)
         WHERE id = OLD.fachada_id;
    END IF;
    RETURN OLD;
END $function$
;

CREATE OR REPLACE FUNCTION public.ensure_routine_organization_for_corretor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_organization_id UUID;
BEGIN
    INSERT INTO public.routine_organizations (legacy_corretor_id, name)
    VALUES (NEW.id, coalesce(nullif(NEW.razao_social, ''), nullif(NEW.nome, ''), 'Minha organização'))
    ON CONFLICT (legacy_corretor_id) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_organization_id;

    INSERT INTO public.routine_memberships
        (organization_id, user_id, role, status, display_name)
    VALUES (v_organization_id, NEW.user_id, 'proprietario', 'active', NEW.nome)
    ON CONFLICT (organization_id, user_id) DO UPDATE
    SET status = 'active', display_name = EXCLUDED.display_name;
    RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.estornar_comissao_da_receita()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.status = 'confirmado' OR OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    UPDATE public.parceiro_comissoes
       SET status = 'estornada',
           cancelada_em = now(),
           cancelada_por = auth.uid(),
           motivo_cancelamento = COALESCE(
               NEW.motivo_estorno,
               'Receita de origem passou para ' || NEW.status
           ),
           atualizado_em = now()
     WHERE receita_evento_id = NEW.id
       -- Comissão já paga não volta atrás sozinha: o dinheiro saiu, e desfazer
       -- isso é decisão humana (acerto no próximo pagamento), não automática.
       AND status <> 'paga';

    RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.estornar_pagamento_fatura(p_fatura_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_fatura RECORD;
    v_novo_status text;
BEGIN
    -- SECURITY DEFINER ignora RLS → validar a posse manualmente pelo JWT.
    SELECT f.* INTO v_fatura
    FROM public.faturas_aluguel f
    JOIN public.corretores c ON c.id = f.corretor_id
    WHERE f.id = p_fatura_id AND c.user_id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fatura não encontrada ou sem permissão.';
    END IF;

    IF v_fatura.status <> 'PAGO' THEN
        RAISE EXCEPTION 'Só é possível desfazer o pagamento de faturas pagas.';
    END IF;

    -- Se o repasse ao proprietário já saiu (não está mais AGENDADO), não desfazer
    -- automaticamente — evita inconsistência com dinheiro já movimentado.
    IF EXISTS (
        SELECT 1 FROM public.repasses_proprietario
        WHERE fatura_origem_id = p_fatura_id AND status <> 'AGENDADO'
    ) THEN
        RAISE EXCEPTION 'O repasse ao proprietário desta fatura já foi executado — não é possível desfazer automaticamente.';
    END IF;

    -- Remove a comissão e o repasse AGENDADO criados pelo trigger.
    DELETE FROM public.lancamentos_financeiros
    WHERE fatura_id = p_fatura_id AND categoria = 'COMISSAO_LOCACAO';

    DELETE FROM public.repasses_proprietario
    WHERE fatura_origem_id = p_fatura_id AND status = 'AGENDADO';

    -- Volta a fatura ao estado anterior (não paga).
    v_novo_status := CASE WHEN v_fatura.data_vencimento < CURRENT_DATE THEN 'ATRASADO' ELSE 'PENDENTE' END;
    UPDATE public.faturas_aluguel
    SET status = v_novo_status, data_pagamento = NULL, valor_pago = NULL
    WHERE id = p_fatura_id;

    INSERT INTO public.auditoria_financeira (corretor_id, entidade, entidade_id, acao, dados_depois, origem, ator)
    VALUES (v_fatura.corretor_id, 'faturas_aluguel', p_fatura_id, 'ESTORNO_PAGAMENTO',
            jsonb_build_object('de', 'PAGO', 'para', v_novo_status), 'ui', auth.uid()::text);

    RETURN v_novo_status;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.exigir_admin()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'acesso negado' USING ERRCODE = '42501';
    END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.exigir_backoffice()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_backoffice_user() THEN
    RAISE EXCEPTION 'acesso negado' USING ERRCODE = '42501';
  END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.exigir_super_admin()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'acesso negado' USING ERRCODE = '42501';
    END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.fachada_esta_ativa(_fachada_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT EXISTS (SELECT 1 FROM public.fachadas WHERE id = _fachada_id AND ativo = TRUE) $function$
;

CREATE OR REPLACE FUNCTION public.fechar_vigencia_percentual_anterior()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    UPDATE public.parceiro_percentuais
       SET vigencia_fim = GREATEST(
               vigencia_inicio,
               NEW.vigencia_inicio - INTERVAL '1 day'
           )::DATE
     WHERE parceiro_id = NEW.parceiro_id
       AND id <> NEW.id
       AND vigencia_fim IS NULL;
    RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.finish_asaas_checkout_event(p_event_id text, p_status text, p_error_code text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_status NOT IN ('processed', 'ignored', 'failed') THEN
    RAISE EXCEPTION 'invalid event status';
  END IF;

  UPDATE public.asaas_checkout_events
     SET status = p_status,
         error_code = p_error_code,
         processed_at = CASE WHEN p_status IN ('processed', 'ignored') THEN NOW() ELSE NULL END
   WHERE id = p_event_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.finish_contract_quota(p_id uuid, p_success boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r public.contract_quota_reservations;
BEGIN
 SELECT * INTO r FROM public.contract_quota_reservations WHERE id=p_id FOR UPDATE;
 IF r.id IS NULL OR r.status<>'reserved' THEN RETURN; END IF;
 IF NOT p_success THEN
  UPDATE public.usage_counters SET used_quantity=greatest(0,used_quantity-1),updated_at=now()
  WHERE corretor_id=r.corretor_id AND feature_key='ai_contracts_monthly' AND period_start=r.period_start;
 END IF;
 UPDATE public.contract_quota_reservations SET status=CASE WHEN p_success THEN 'succeeded' ELSE 'released' END,finished_at=now() WHERE id=p_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.generate_monthly_rent_bills(reference_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    contract RECORD;
    bills_created INTEGER := 0;
    target_month_str CHAR(7);
    due_date DATE;
BEGIN
    target_month_str := TO_CHAR(reference_date, 'MM/YYYY');

    FOR contract IN
        SELECT * FROM public.contratos
        WHERE status = 'ATIVO'
          AND tipo IN ('LOCACAO_RESIDENCIAL', 'LOCACAO_COMERCIAL')
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.faturas_aluguel
            WHERE contrato_id = contract.id
              AND mes_referencia = target_month_str
        ) THEN
            -- Dia de vencimento: o mesmo que a UI usa (dia_vencimento). Fallbacks
            -- para a coluna legada e, por fim, 10. Mês curto (ex.: dia 31 em fev)
            -- cai no fallback abaixo.
            BEGIN
                due_date := MAKE_DATE(
                    CAST(EXTRACT(YEAR FROM reference_date) AS INTEGER),
                    CAST(EXTRACT(MONTH FROM reference_date) AS INTEGER),
                    COALESCE(contract.dia_vencimento, contract.dia_vencimento_aluguel, 10)
                );
            EXCEPTION WHEN OTHERS THEN
                due_date := (date_trunc('month', reference_date) + interval '1 month - 1 day')::date;
            END;

            INSERT INTO public.faturas_aluguel (
                contrato_id,
                cliente_id,
                imovel_id,
                corretor_id,
                mes_referencia,
                data_vencimento,
                valor_aluguel,
                valor_condominio,
                valor_iptu,
                status
            ) VALUES (
                contract.id,
                contract.cliente_id,
                contract.imovel_id,
                contract.corretor_id,
                target_month_str,
                due_date,
                contract.valor,
                0,
                0,
                'PENDENTE'
            );

            bills_created := bills_created + 1;
        END IF;
    END LOOP;

    RETURN bills_created;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.gerar_alertas_vencimento_contratos()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    c            RECORD;
    t           INT;
    alerta_date DATE;
    dias        INT;
    prio        prioridade_alerta;
    criados     INT := 0;
    thresholds  INT[] := ARRAY[20, 15, 10, 0];
BEGIN
    FOR c IN
        SELECT ct.id, ct.corretor_id, ct.imovel_id, ct.data_fim, ct.tipo,
               i.titulo AS imovel_titulo
        FROM public.contratos ct
        LEFT JOIN public.imoveis i ON i.id = ct.imovel_id
        WHERE ct.data_fim IS NOT NULL
          AND ct.data_fim >= CURRENT_DATE - 1
          AND ct.tipo IN ('EXCLUSIVIDADE_VENDA', 'EXCLUSIVIDADE_LOCACAO', 'COMPRA_VENDA')
          AND COALESCE(ct.status, '') NOT IN ('ARQUIVADO', 'RESCINDIDO', 'CANCELADO')
    LOOP
        -- Degraus de antecedência
        FOREACH t IN ARRAY thresholds LOOP
            alerta_date := c.data_fim - t;
            IF CURRENT_DATE >= alerta_date AND CURRENT_DATE <= c.data_fim THEN
                dias := (c.data_fim - CURRENT_DATE);
                prio := (CASE WHEN dias <= 10 THEN 'ALTA'
                              WHEN dias <= 20 THEN 'MEDIA'
                              ELSE 'BAIXA' END)::prioridade_alerta;
                IF NOT EXISTS (
                    SELECT 1 FROM public.alertas a
                    WHERE a.contrato_id = c.id AND a.tipo = 'EXCLUSIVIDADE'
                      AND a.data_alerta = alerta_date
                ) THEN
                    INSERT INTO public.alertas
                        (corretor_id, contrato_id, imovel_id, tipo, prioridade, data_alerta, mensagem, lido)
                    VALUES
                        (c.corretor_id, c.id, c.imovel_id, 'EXCLUSIVIDADE', prio, alerta_date,
                         'Contrato "' || COALESCE(c.imovel_titulo, 'imóvel') || '" vence em ' || dias
                         || ' dia(s) — ' || to_char(c.data_fim, 'DD/MM/YYYY') || '. Trabalhe até essa data.',
                         false);
                    criados := criados + 1;
                END IF;
            END IF;
        END LOOP;

        -- Vencido (uma vez, no dia seguinte)
        IF CURRENT_DATE = c.data_fim + 1 THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.alertas a
                WHERE a.contrato_id = c.id AND a.tipo = 'EXCLUSIVIDADE'
                  AND a.data_alerta = c.data_fim + 1
            ) THEN
                INSERT INTO public.alertas
                    (corretor_id, contrato_id, imovel_id, tipo, prioridade, data_alerta, mensagem, lido)
                VALUES
                    (c.corretor_id, c.id, c.imovel_id, 'EXCLUSIVIDADE', 'ALTA', c.data_fim + 1,
                     'Contrato "' || COALESCE(c.imovel_titulo, 'imóvel') || '" VENCEU em '
                     || to_char(c.data_fim, 'DD/MM/YYYY') || '.', false);
                criados := criados + 1;
            END IF;
        END IF;
    END LOOP;

    RETURN criados;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.gerar_comissao_de_receita()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_atribuicao public.parceiro_atribuicoes;
  v_regra public.parceiro_percentuais;
  v_parceiro public.parceiros;
  v_base NUMERIC(12,2);
  v_valor NUMERIC(12,2);
  v_ja_houve BOOLEAN;
  v_comissoes_existentes INT;
BEGIN
  IF NEW.status <> 'confirmado' OR NEW.corretor_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_atribuicao FROM public.parceiro_atribuicoes
    WHERE corretor_id = NEW.corretor_id AND status = 'convertida';
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT * INTO v_parceiro FROM public.parceiros WHERE id = v_atribuicao.parceiro_id;
  IF v_parceiro.status = 'encerrado' THEN RETURN NEW; END IF;
  v_regra := public.percentual_vigente_em(v_atribuicao.parceiro_id, NEW.confirmado_em::DATE);
  IF v_regra.id IS NULL THEN RETURN NEW; END IF;

  PERFORM 1 FROM public.parceiro_percentuais WHERE id = v_regra.id FOR UPDATE;
  IF v_regra.base_calculo = 'primeiro_pagamento' THEN
    SELECT EXISTS (SELECT 1 FROM public.receita_eventos
      WHERE corretor_id = NEW.corretor_id AND status = 'confirmado'
        AND id <> NEW.id AND confirmado_em < NEW.confirmado_em) INTO v_ja_houve;
    IF v_ja_houve THEN RETURN NEW; END IF;
  END IF;
  SELECT count(*) INTO v_comissoes_existentes FROM public.parceiro_comissoes
    WHERE atribuicao_id = v_atribuicao.id AND status <> 'estornada';
  IF v_regra.base_calculo <> 'primeiro_pagamento' AND v_regra.teto_renovacoes IS NOT NULL
      AND v_comissoes_existentes >= v_regra.teto_renovacoes + 1 THEN RETURN NEW; END IF;

  v_base := CASE WHEN v_regra.base_calculo = 'receita_liquida'
    THEN COALESCE(NEW.valor_liquido, NEW.valor_bruto) ELSE NEW.valor_bruto END;
  v_valor := CASE WHEN v_regra.base_calculo = 'valor_fixo'
    THEN v_regra.valor_fixo ELSE round(v_base * v_regra.percentual / 100, 2) END;
  INSERT INTO public.parceiro_comissoes (parceiro_id, atribuicao_id, receita_evento_id, corretor_id,
    valor_base, percentual_aplicado, base_calculo, percentual_id, valor_comissao, status, competencia)
  VALUES (v_atribuicao.parceiro_id, v_atribuicao.id, NEW.id, NEW.corretor_id,
    v_base, v_regra.percentual, v_regra.base_calculo, v_regra.id, v_valor, 'pendente',
    COALESCE(NEW.competencia, date_trunc('month', NEW.confirmado_em)::DATE))
  ON CONFLICT (receita_evento_id) DO NOTHING;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.get_corretor_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
            SELECT o.legacy_corretor_id
              FROM public.onboarding_profiles p
              JOIN public.routine_memberships m
                ON m.organization_id = p.organization_id
               AND m.user_id = p.user_id
               AND m.status = 'active'
              JOIN public.routine_organizations o ON o.id = p.organization_id
              JOIN public.corretores c ON c.id = o.legacy_corretor_id
             WHERE p.user_id = (SELECT auth.uid())
               AND c.status = 'ativo'
        $function$
;

CREATE OR REPLACE FUNCTION public.get_onboarding_contexto()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_profile public.onboarding_profiles%ROWTYPE;
    v_progress public.onboarding_progress%ROWTYPE;
    v_org public.routine_organizations%ROWTYPE;
    v_corretor public.corretores%ROWTYPE;
    v_owner UUID;
    v_result JSONB;
BEGIN
    IF auth.uid() IS NULL THEN RETURN NULL; END IF;

    SELECT * INTO v_profile FROM public.onboarding_profiles WHERE user_id = auth.uid();
    IF v_profile.id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO v_progress FROM public.onboarding_progress WHERE profile_id = v_profile.id;
    SELECT * INTO v_org FROM public.routine_organizations WHERE id = v_profile.organization_id;
    SELECT * INTO v_corretor FROM public.corretores WHERE user_id = auth.uid();
    v_owner := v_org.legacy_corretor_id;

    SELECT jsonb_build_object(
        'profile', to_jsonb(v_profile),
        'progress', to_jsonb(v_progress),
        'organization', jsonb_build_object(
            'id', v_org.id,
            'nome', v_org.name,
            'nome_comercial', v_org.trade_name,
            'tipo_organizacao', v_org.organization_type,
            'fuso_horario', v_org.timezone
        ),
        'membership', COALESCE((SELECT jsonb_build_object(
                                      'papel',COALESCE(m.job_role,m.role),
                                      'status',m.status,
                                      'user_id',m.user_id
                                  )
                                  FROM public.routine_memberships m
                                 WHERE m.organization_id = v_org.id AND m.user_id = auth.uid()
                                   AND m.status = 'active'), '{}'::JSONB),
        'members', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'user_id',m.user_id,
                'nome',COALESCE(NULLIF(m.display_name,''),'Membro da equipe'),
                'papel',COALESCE(m.job_role,m.role)
            ) ORDER BY m.display_name)
              FROM public.routine_memberships m
             WHERE m.organization_id=v_org.id AND m.status='active'
        ), '[]'::JSONB),
        'checklist', COALESCE((SELECT to_jsonb(c) FROM public.onboarding_checklist c
                               WHERE c.profile_id = v_profile.id), '{}'::JSONB),
        'tours', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.onboarding_tours t
                           WHERE t.profile_id = v_profile.id), '[]'::JSONB),
        'subscription', COALESCE((
            SELECT jsonb_build_object('status', s.status, 'trial_ends_at', s.trial_ends_at,
                                      'plan_name', p.name, 'plan_code', p.code)
              FROM public.subscriptions s JOIN public.plans p ON p.id = s.plan_id
             WHERE s.corretor_id = v_owner
               AND s.status IN ('trialing','active','past_due','read_only') LIMIT 1
        ), '{}'::JSONB),
        'evidence', jsonb_build_object(
            'perfil_completo', (
                NULLIF(BTRIM(v_corretor.nome),'') IS NOT NULL
                AND NULLIF(BTRIM(v_corretor.telefone),'') IS NOT NULL
                AND NULLIF(BTRIM(COALESCE(v_corretor.cidade,'')),'') IS NOT NULL
            ),
            'total_imoveis_reais', (SELECT count(*) FROM public.imoveis WHERE corretor_id = v_owner AND NOT is_sample_data),
            'total_clientes_reais', (SELECT count(*) FROM public.clientes WHERE corretor_id = v_owner AND NOT is_sample_data),
            'total_oportunidades_reais', (SELECT count(*) FROM public.crm_oportunidades WHERE corretor_id = v_owner AND NOT is_sample_data),
            'total_tarefas_reais', (SELECT count(*) FROM public.routine_tasks
                                     WHERE organization_id = v_org.id AND deleted_at IS NULL AND NOT is_sample_data),
            'total_imoveis_demo', (SELECT count(*) FROM public.imoveis WHERE corretor_id = v_owner AND is_sample_data),
            'total_clientes_demo', (SELECT count(*) FROM public.clientes WHERE corretor_id = v_owner AND is_sample_data),
            'total_registros_demo', (SELECT count(*) FROM public.onboarding_sample_data
                                      WHERE organization_id=v_org.id),
            'calendario_conectado', EXISTS (
                SELECT 1 FROM public.calendar_connections cc
                 WHERE cc.organization_id = v_org.id AND cc.user_id = auth.uid()
                   AND cc.status = 'connected'
            ),
            'whatsapp_configurado', COALESCE((v_profile.metadata #>> '{integrations,whatsapp}')::BOOLEAN, FALSE),
            'total_convites', (SELECT count(*) FROM public.organizacao_convites WHERE organization_id = v_org.id AND status IN ('pendente','aceito')),
            'ia_usada', EXISTS (SELECT 1 FROM public.ai_conversations WHERE corretor_id = v_owner)
        )
    ) INTO v_result;

    RETURN v_result;
END $function$
;

CREATE OR REPLACE FUNCTION public.guard_public_fachada_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE phone text;
BEGIN
  IF NOT public.public_fachada_active(NEW.fachada_id) THEN RAISE EXCEPTION 'Fachada indisponível'; END IF;
  IF TG_TABLE_NAME = 'fachada_leads' THEN
    IF NEW.nome IS NULL OR length(trim(NEW.nome)) NOT BETWEEN 2 AND 120
       OR NEW.telefone IS NULL OR length(NEW.telefone)>32
       OR (NEW.email IS NOT NULL AND NEW.email <> '' AND (length(NEW.email)>254 OR NEW.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')) THEN
      RAISE EXCEPTION 'Dados de contato inválidos';
    END IF;
    phone := regexp_replace(NEW.telefone,'[^0-9]','','g');
    IF length(phone) IN (12,13) AND left(phone,2)='55' THEN phone := substr(phone,3); END IF;
    IF phone !~ '^[1-9][0-9]{9,10}$' THEN RAISE EXCEPTION 'Telefone inválido'; END IF;
    IF NOT public.consume_public_request_limit('qr-lead-global','global',300,60)
       OR NOT public.consume_public_request_limit('qr-lead-phone',encode(sha256(convert_to(phone,'UTF8')),'hex'),5,600) THEN
      RAISE EXCEPTION 'Muitas tentativas. Aguarde alguns minutos.';
    END IF;
    -- Visitante não pode forjar conversão, vínculo com cliente ou data.
    IF current_setting('role',true) IN ('anon','authenticated') THEN
      NEW.convertido := false;
      NEW.cliente_id := NULL;
      NEW.created_at := clock_timestamp();
    END IF;
    NEW.nome := trim(NEW.nome);
  ELSE
    -- Não aceitar IP/hash declarado pelo visitante como dado confiável.
    NEW.ip_hash := NULL;
    IF length(NEW.user_agent)>500 THEN NEW.user_agent := left(NEW.user_agent,500); END IF;
    NEW.created_at := clock_timestamp();
    IF NOT public.consume_public_request_limit('qr-scan-global','global',1200,60)
       OR NOT public.consume_public_request_limit('qr-scan-fachada',NEW.fachada_id::text,120,60) THEN
      RAISE EXCEPTION 'Muitas tentativas. Aguarde alguns minutos.';
    END IF;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.handle_bill_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_contract RECORD;
    v_admin_fee DECIMAL(15,2);
    v_owner_net DECIMAL(15,2);
    v_repasse_date DATE;
    v_taxa_pct DECIMAL(8,4);
BEGIN
    IF OLD.status != 'PAGO' AND NEW.status = 'PAGO' THEN
        -- Idempotência: se a fatura já gerou repasse (webhook + UI, reentrega,
        -- dupla transição), não duplica o split.
        IF EXISTS (SELECT 1 FROM public.repasses_proprietario WHERE fatura_origem_id = NEW.id) THEN
            RETURN NEW;
        END IF;

        SELECT * INTO v_contract FROM public.contratos WHERE id = NEW.contrato_id;
        v_taxa_pct  := COALESCE(v_contract.taxa_administracao_percentual, 10.00);
        v_admin_fee := NEW.valor_aluguel * (v_taxa_pct / 100);
        v_owner_net := (NEW.valor_aluguel - v_admin_fee)
                       + COALESCE(NEW.valor_condominio, 0)
                       + COALESCE(NEW.valor_iptu, 0)
                       + COALESCE(NEW.valor_extras, 0);

        BEGIN
            v_repasse_date := MAKE_DATE(
                CAST(EXTRACT(YEAR FROM NEW.data_pagamento) AS INTEGER),
                CAST(EXTRACT(MONTH FROM NEW.data_pagamento) AS INTEGER),
                v_contract.dia_repasse_proprietario);
        EXCEPTION WHEN OTHERS THEN v_repasse_date := NEW.data_pagamento; END;
        IF v_repasse_date < NEW.data_pagamento THEN
            v_repasse_date := NEW.data_pagamento + INTEGER '1';
        END IF;

        INSERT INTO public.repasses_proprietario
            (fatura_origem_id, contrato_id, corretor_id, proprietario_id, proprietario_nome,
             data_prevista, valor_bruto_recebido, valor_taxa_adm, valor_liquido_repasse, status)
        VALUES
            (NEW.id, v_contract.id, NEW.corretor_id,
             (SELECT proprietario_id FROM public.imoveis WHERE id = NEW.imovel_id),
             (SELECT proprietario_nome FROM public.imoveis WHERE id = NEW.imovel_id),
             v_repasse_date, NEW.valor_pago, v_admin_fee, v_owner_net, 'AGENDADO')
        ON CONFLICT (fatura_origem_id) WHERE fatura_origem_id IS NOT NULL DO NOTHING;

        -- Guard de repasse acima já garante execução única; a comissão vincula a
        -- fatura (fatura_id) e o índice parcial uq_lancamento_comissao_fatura é o
        -- backstop rígido contra qualquer duplicata futura.
        INSERT INTO public.lancamentos_financeiros
            (corretor_id, tipo, categoria, descricao, valor, data, recorrente,
             contrato_id, imovel_id, comprovante_url, fatura_id)
        VALUES
            (NEW.corretor_id, 'RECEITA', 'COMISSAO_LOCACAO',
             'Taxa Adm - Fatura ' || NEW.mes_referencia, v_admin_fee, NEW.data_pagamento,
             FALSE, NEW.contrato_id, NEW.imovel_id, NEW.comprovante_url, NEW.id);

        -- Snapshot auditável do cálculo do split
        INSERT INTO public.auditoria_financeira
            (corretor_id, entidade, entidade_id, acao, dados_antes, dados_depois, calculo, origem, ator)
        VALUES
            (NEW.corretor_id, 'faturas_aluguel', NEW.id, 'PAGO',
             jsonb_build_object('status', OLD.status),
             jsonb_build_object('status', NEW.status, 'valor_pago', NEW.valor_pago,
                                'data_pagamento', NEW.data_pagamento),
             jsonb_build_object('taxa_adm_pct', v_taxa_pct, 'base', NEW.valor_aluguel,
                                'valor_taxa', v_admin_fee, 'liquido_repasse', v_owner_net,
                                'data_repasse_prevista', v_repasse_date),
             'trigger', COALESCE(auth.uid()::text, 'system'));
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.corretores (
    user_id,
    nome,
    email,
    creci,
    telefone,
    cnpj_cpf
  )
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(BTRIM(NEW.raw_user_meta_data->>'nome'), ''),
      NULLIF(BTRIM(NEW.raw_user_meta_data->>'full_name'), ''),
      NULLIF(BTRIM(NEW.raw_user_meta_data->>'name'), ''),
      NULLIF(SPLIT_PART(COALESCE(NEW.email, ''), '@', 1), ''),
      'Usuário'
    ),
    COALESCE(
      NULLIF(BTRIM(NEW.email), ''),
      NULLIF(BTRIM(NEW.raw_user_meta_data->>'email'), ''),
      ''
    ),
    COALESCE(
      NULLIF(BTRIM(NEW.raw_user_meta_data->>'creci'), ''),
      'PENDENTE'
    ),
    COALESCE(
      NULLIF(BTRIM(NEW.raw_user_meta_data->>'telefone'), ''),
      ''
    ),
    NULLIF(BTRIM(NEW.raw_user_meta_data->>'cnpj'), '')
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = _user_id AND role = _role AND revogado_em IS NULL
    )
$function$
;

CREATE OR REPLACE FUNCTION public.increment_escaneamentos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.fachadas
  SET total_escaneamentos = total_escaneamentos + 1
  WHERE id = NEW.fachada_id;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.increment_leads()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.fachadas
  SET total_leads = total_leads + 1
  WHERE id = NEW.fachada_id;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.incrementar_uso(_corretor_id uuid, _feature_key text, _quantidade integer DEFAULT 1)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_inicio DATE := date_trunc('month', now())::DATE;
    v_fim    DATE := (date_trunc('month', now()) + INTERVAL '1 month - 1 day')::DATE;
    v_total  INT;
BEGIN
    IF _corretor_id IS NULL OR _quantidade <= 0 THEN
        RETURN 0;
    END IF;

    INSERT INTO public.usage_counters
        (corretor_id, feature_key, used_quantity, period_start, period_end)
    VALUES
        (_corretor_id, _feature_key, _quantidade, v_inicio, v_fim)
    ON CONFLICT (corretor_id, feature_key, period_start) DO UPDATE
        SET used_quantity = public.usage_counters.used_quantity + EXCLUDED.used_quantity
    RETURNING used_quantity INTO v_total;

    RETURN v_total;
END $function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()
          AND role IN ('admin', 'super_admin')
          AND revogado_em IS NULL
    )
$function$
;

CREATE OR REPLACE FUNCTION public.is_backoffice_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.user_roles r
        WHERE r.user_id = (SELECT auth.uid())
          AND r.revogado_em IS NULL
          AND r.role::TEXT IN ('support', 'admin', 'super_admin')
     )
$function$
;

CREATE OR REPLACE FUNCTION public.is_organization_manager(_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT private.routine_member_has_role(
        _organization_id,
        ARRAY['proprietario','administrador','gestor']
    )
$function$
;

CREATE OR REPLACE FUNCTION public.is_organization_member(_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT private.routine_is_member(_organization_id)
$function$
;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid() AND role = 'super_admin' AND revogado_em IS NULL
    )
$function$
;

CREATE OR REPLACE FUNCTION public.lead_capture_upsert_cliente(p_corretor uuid, p_nome text, p_telefone text, p_email text, p_tracking jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text:=nullif(btrim(coalesce(p_email,'')),'');
  v_tracking jsonb:=coalesce(p_tracking,'{}'::jsonb);
  v_result jsonb;
begin
  v_result:=public.lotti_find_or_create_cliente(p_corretor,p_telefone,p_nome,
    jsonb_build_object('email',v_email,'tipo_interesse','AMBOS','status_funil','QUALIFICACAO','tracking_data',v_tracking,'ultimo_contato',now()));
  if not (v_result->>'created')::boolean then
    update public.clientes set ultimo_contato=now(),
      tracking_data=coalesce(tracking_data,'{}'::jsonb)||jsonb_build_object('ultimo_retorno',v_tracking||jsonb_strip_nulls(jsonb_build_object('email_informado',v_email)))
     where id=(v_result->>'cliente_id')::uuid;
  end if;
  return v_result;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_auto_begin(p_id uuid, p_token uuid, p_revision bigint, p_content text, p_kind text, p_live boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations; ch public.lotti_agent_channels; v_revision bigint; v_outbox uuid;
  v_text text := left(btrim(coalesce(p_content, '')), 2500);
begin
  if p_kind not in ('followup', 'broadcast') then raise exception 'invalid_kind'; end if;
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null or cv.lease_token is distinct from p_token or cv.lease_until < now() then
    return jsonb_build_object('cancelled', true, 'reason', 'lease_lost');
  end if;
  select * into ch from public.lotti_agent_channels where id = cv.channel_id;
  if cv.revision <> p_revision then return jsonb_build_object('cancelled', true, 'reason', 'conversation_changed'); end if;
  if v_text = '' then return jsonb_build_object('cancelled', true, 'reason', 'empty_message'); end if;
  if cv.opted_out_at is not null then return jsonb_build_object('cancelled', true, 'reason', 'opted_out'); end if;
  if cv.archived_at is not null or cv.status <> 'open' or cv.phone is null
     or ch.sandbox or ch.archived_at is not null then
    return jsonb_build_object('cancelled', true, 'reason', 'conversation_unavailable');
  end if;
  if p_kind = 'followup' and (cv.mode <> 'ai' or not ch.enabled) then
    return jsonb_build_object('cancelled', true, 'reason', 'ai_not_in_charge');
  end if;
  if p_kind = 'broadcast' and cv.mode = 'paused' then
    return jsonb_build_object('cancelled', true, 'reason', 'conversation_paused');
  end if;
  if exists(select 1 from public.lotti_agent_outbox where conversation_id = p_id and status in ('sending', 'uncertain'))
     or exists(select 1 from public.lotti_manual_sends where conversation_id = p_id and status in ('sending', 'uncertain')) then
    return jsonb_build_object('cancelled', true, 'reason', 'delivery_pending');
  end if;
  if not p_live then return jsonb_build_object('blocked', 'live_send_disabled'); end if;
  v_revision := cv.revision + 1;
  -- A revisão nova já nasce processada: a fila do agente não a trata como
  -- mensagem do lead. O follow-up acompanha a revisão do próprio envio e o
  -- toque em andamento consome o vencimento: se a ponte cair antes de agendar
  -- o próximo, o ciclo termina em vez de repetir o toque.
  update public.lotti_agent_conversations set revision = v_revision, processed_revision = v_revision,
    followup_revision = case when p_kind = 'followup' then v_revision else followup_revision end,
    followup_due_at = case when p_kind = 'followup' then null else followup_due_at end,
    updated_at = now()
  where id = p_id;
  update public.lotti_agent_outbox set status = 'cancelled' where conversation_id = p_id and status = 'prepared';
  insert into public.lotti_agent_outbox(conversation_id, revision, content, status)
  values (p_id, v_revision, v_text, 'sending') returning id into v_outbox;
  return jsonb_build_object('outbox_id', v_outbox, 'revision', v_revision, 'instance', ch.instance, 'phone', cv.phone, 'content', v_text);
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_auto_fail(p_id uuid, p_token uuid, p_revision bigint, p_uncertain boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations; v_sandbox boolean;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null or cv.lease_token is distinct from p_token then return false; end if;

  if p_uncertain then
    update public.lotti_agent_outbox set status = 'uncertain'
     where conversation_id = p_id and revision = p_revision and status = 'sending';
  else
    delete from public.lotti_agent_outbox
     where conversation_id = p_id and revision = p_revision and status = 'sending';
  end if;

  update public.lotti_agent_conversations set lease_token = null, lease_until = null, followup_due_at = null,
    last_error = case when p_uncertain then 'delivery_uncertain' else 'automatic_send_failed' end,
    mode = case when p_uncertain and mode = 'ai' then 'human' else mode end
  where id = p_id;

  select sandbox into v_sandbox from public.lotti_agent_channels where id = cv.channel_id;
  if p_uncertain and not coalesce(v_sandbox, true) then
    insert into public.alertas(corretor_id, cliente_id, tipo, mensagem, metadata, origem)
    values (cv.corretor_id, cv.cliente_id, 'GERAL', 'Conversa precisa de revisão: não foi possível confirmar uma mensagem automática',
      jsonb_build_object('source', 'lotti_agent', 'conversation_id', cv.id, 'priority', 'alta'), 'ia');
  end if;
  return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_auto_finish(p_id uuid, p_token uuid, p_revision bigint, p_external_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations; ob public.lotti_agent_outbox; v_message uuid;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null or cv.lease_token is distinct from p_token then return false; end if;
  select * into ob from public.lotti_agent_outbox where conversation_id = p_id and revision = p_revision and status = 'sending' for update;
  if ob.id is null or nullif(p_external_id, '') is null then return false; end if;
  update public.lotti_agent_outbox set status = 'sent', external_id = p_external_id where id = ob.id;
  -- O eco pode ter chegado antes e sido gravado como "equipe": corrige o remetente.
  insert into public.lotti_agent_messages(conversation_id, external_id, direction, sender, content)
  values (p_id, p_external_id, 'out', 'ai', ob.content)
  on conflict (conversation_id, external_id) do update set sender = 'ai' returning id into v_message;
  if cv.cliente_id is not null then
    insert into public.historico_contatos(cliente_id, tipo, direcao, conteudo, metadata)
    values (cv.cliente_id, 'WHATSAPP', 'OUT', ob.content, jsonb_build_object('source', 'lotti_agent', 'message_id', v_message));
  end if;
  update public.lotti_agent_conversations set lease_token = null, lease_until = null, last_error = null, updated_at = now() where id = p_id;
  return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_begin_send(p_id uuid, p_token uuid, p_revision bigint, p_live boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations; ch public.lotti_agent_channels; ob public.lotti_agent_outbox;
begin
 select * into cv from public.lotti_agent_conversations where id=p_id for update;
 select * into ch from public.lotti_agent_channels where id=cv.channel_id;
 select * into ob from public.lotti_agent_outbox where conversation_id=p_id and revision=p_revision for update;
 if cv.lease_token is distinct from p_token or cv.lease_until<now() or cv.mode<>'ai' or cv.revision<>p_revision or not ch.enabled or ob.status is distinct from 'prepared' then
   update public.lotti_agent_outbox set status='cancelled' where id=ob.id and status='prepared';
   return jsonb_build_object('cancelled',true);
 end if;
 if ch.sandbox then
   update public.lotti_agent_outbox set status='simulated' where id=ob.id;
   insert into public.lotti_agent_messages(conversation_id,external_id,direction,sender,content) values(p_id,'simulation:'||ob.id,'out','ai',ob.content);
   update public.lotti_agent_conversations set processed_revision=p_revision,lease_token=null,lease_until=null,attempts=0 where id=p_id;
   return jsonb_build_object('simulated',true);
 end if;
 if not p_live then return jsonb_build_object('blocked','live_send_disabled'); end if;
 update public.lotti_agent_outbox set status='sending' where id=ob.id;
 return jsonb_build_object('outbox_id',ob.id,'content',ob.content,'instance',ch.instance,'phone',cv.phone,'lid',cv.lid);
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_bind_account(p_channel uuid, p_account text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare ch public.lotti_agent_channels; archive_id uuid; v_previous uuid;
begin
  if p_account is null then return; end if;
  if p_account !~ '^[0-9]{8,15}$' then raise exception 'invalid_account'; end if;
  select * into ch from public.lotti_agent_channels where id=p_channel for update;
  if ch.id is null or ch.account_phone is not distinct from p_account then return; end if;
  -- Same lock as start, update_contact and resolve: nobody creates a conversation
  -- in the channel while its conversations are archived and restored.
  perform pg_advisory_xact_lock(hashtextextended(ch.id::text,715));
  -- First identified number also archives legacy conversations of unknown origin;
  -- the connected number's history is re-imported on pairing.
  if exists(select 1 from public.lotti_agent_conversations where channel_id=ch.id) then
    insert into public.lotti_agent_channels(corretor_id,instance,enabled,sandbox,account_phone,archived_at)
    values(ch.corretor_id,'archived-'||ch.id||'-'||floor(extract(epoch from clock_timestamp())*1000)::bigint,false,true,ch.account_phone,now())
    returning id into archive_id;
    update public.lotti_agent_conversations set channel_id=archive_id,archived_at=now(),lease_token=null,lease_until=null
    where channel_id=ch.id;
    update public.lotti_agent_outbox o set status='cancelled' from public.lotti_agent_conversations c
    where o.conversation_id=c.id and c.channel_id=archive_id and o.status='prepared';
  end if;
  select x.id into v_previous from public.lotti_agent_channels x
   where x.corretor_id=ch.corretor_id and x.archived_at is not null and x.account_phone=p_account and x.id<>ch.id
   order by x.archived_at desc,x.created_at desc limit 1;
  if v_previous is not null then
    update public.lotti_agent_conversations set channel_id=ch.id,archived_at=null,lease_token=null,lease_until=null,
      processed_revision=greatest(processed_revision,revision),followup_due_at=null
    where channel_id=v_previous;
  end if;
  update public.lotti_agent_channels set account_phone=p_account,
    account_bound_at=case when ch.account_phone is not null then now() else account_bound_at end
  where id=ch.id;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations; ch public.lotti_agent_channels; token uuid:=gen_random_uuid();
  pstart date:=date_trunc('month',now() at time zone 'America/Sao_Paulo')::date; allowance int; unlimited_flag boolean; used int;
begin
 update public.lotti_agent_outbox o set status='uncertain' from public.lotti_agent_conversations c
 where o.conversation_id=c.id and o.status='sending' and c.lease_until<now();
 update public.lotti_agent_conversations c set mode='human',last_error='delivery_uncertain'
 where c.mode='ai' and exists(select 1 from public.lotti_agent_outbox o where o.conversation_id=c.id and o.status='uncertain');

 select c.* into cv from public.lotti_agent_conversations c
   join public.lotti_agent_channels h on h.id=c.channel_id
  where h.enabled and c.mode='ai' and c.revision>c.processed_revision and c.next_attempt_at<=now()
    and (c.lease_until is null or c.lease_until<now())
    -- Pausa automática: a IA fica quieta pelo prazo e volta sozinha.
    and (c.pausa_ia_ate is null or c.pausa_ia_ate<=now())
    and not exists(select 1 from public.lotti_agent_outbox o where o.conversation_id=c.id and o.status in ('sending','uncertain'))
  order by c.next_attempt_at for update of c skip locked limit 1;
 if cv.id is null then return null; end if;

 -- Modo de atendimento. Não é erro nem bloqueio: é a vez do corretor. A
 -- conversa continua na fila, para ser reavaliada no próximo ciclo.
 if not public.lotti_agent_pode_atender(cv.id) then
   update public.lotti_agent_conversations set next_attempt_at=now()+interval '60 seconds' where id=cv.id;
   return jsonb_build_object('skipped','attend_mode');
 end if;

 select * into ch from public.lotti_agent_channels where id=cv.channel_id;
 if not ch.sandbox then
   perform pg_advisory_xact_lock(hashtextextended(ch.corretor_id::text, 714));
   select e.limit_value,e.unlimited into allowance,unlimited_flag from public.subscriptions s
   join public.plan_entitlements e on e.plan_id=s.plan_id and e.feature_key='leads_qualificados_monthly' and e.enabled
   where s.corretor_id=ch.corretor_id and s.status in ('active','trialing')
   and (case when s.status='trialing' then s.trial_ends_at else s.current_period_end end)>now()
   order by s.created_at desc limit 1;
   if allowance is null and not coalesce(unlimited_flag,false) then
     update public.lotti_agent_conversations set mode='human',last_error='no_active_entitlement' where id=cv.id;
     insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem) values(cv.corretor_id,cv.cliente_id,'GERAL','Novo contato aguardando atendimento: plano de IA indisponível',jsonb_build_object('source','lotti_agent','conversation_id',cv.id),'ia');
     return jsonb_build_object('blocked','no_active_entitlement');
   end if;
   if not exists(select 1 from public.lotti_agent_usage where corretor_id=ch.corretor_id and phone=cv.phone and period_start=pstart) then
     select coalesce(max(used_quantity),0) into used from public.usage_counters where corretor_id=ch.corretor_id and feature_key='leads_qualificados_monthly' and period_start=pstart;
     if not coalesce(unlimited_flag,false) and used>=allowance then
       update public.lotti_agent_conversations set mode='human',last_error='quota_exhausted' where id=cv.id;
       insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem) values(cv.corretor_id,cv.cliente_id,'GERAL','Novo contato aguardando atendimento: franquia de IA atingida',jsonb_build_object('source','lotti_agent','conversation_id',cv.id),'ia');
       return jsonb_build_object('blocked','quota_exhausted');
     end if;
     insert into public.lotti_agent_usage(corretor_id,phone,period_start) values(ch.corretor_id,cv.phone,pstart);
     insert into public.usage_counters(corretor_id,feature_key,used_quantity,period_start,period_end)
     values(ch.corretor_id,'leads_qualificados_monthly',1,pstart,(pstart+interval '1 month'-interval '1 day')::date)
     on conflict(corretor_id,feature_key,period_start) do update set used_quantity=public.usage_counters.used_quantity+1,updated_at=now();
   end if;
 end if;
 update public.lotti_agent_conversations set lease_token=token,lease_until=now()+interval '2 minutes',attempts=attempts+1 where id=cv.id;
 return jsonb_build_object('id',cv.id,'token',token,'revision',cv.revision,'corretor_id',cv.corretor_id,'instance',ch.instance,'phone',cv.phone,'sandbox',ch.sandbox,'profile',cv.qualification);
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_contact_name(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  -- Locale-independent: reject number-only fallbacks instead of matching letters.
  select case when v !~ '^[0-9 +().-]+$' and char_length(v) <= 120 then v end
  from (select nullif(btrim(regexp_replace(coalesce(p_value,''),'\s+',' ','g')),'') v) s
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_conversation_phone_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_existing uuid;
begin
  if new.phone is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.channel_id::text,715));
  select id into v_existing from public.lotti_agent_conversations
   where channel_id=new.channel_id and phone is not null and archived_at is null and id<>new.id
     and public.lotti_conversation_phone_key(phone)=public.lotti_conversation_phone_key(new.phone)
   limit 1;
  if v_existing is not null then
    raise exception 'duplicate_conversation_phone' using detail=v_existing::text;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_defer(p_id uuid, p_token uuid, p_until timestamp with time zone, p_skip boolean, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  cv public.lotti_agent_conversations; v jsonb; v_keys text[]; v_removed int;
  pstart date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null or cv.lease_token is distinct from p_token then return false; end if;
  update public.lotti_agent_conversations set lease_token = null, lease_until = null, attempts = greatest(attempts - 1, 0),
    next_attempt_at = case when p_skip then next_attempt_at else coalesce(p_until, now()) end,
    processed_revision = case when p_skip then revision else processed_revision end,
    last_error = left(p_reason, 100)
  where id = p_id;
  if p_skip and not exists(select 1 from public.lotti_agent_messages where conversation_id = p_id and sender = 'ai') then
    v := to_jsonb(cv);
    v_keys := array_remove(array[v->>'phone', case when v->>'lid' is not null then 'lid:' || (v->>'lid') end], null);
    delete from public.lotti_agent_usage where corretor_id = cv.corretor_id and period_start = pstart and phone = any(v_keys);
    get diagnostics v_removed = row_count;
    if v_removed > 0 then
      update public.usage_counters set used_quantity = greatest(used_quantity - v_removed, 0), updated_at = now()
      where corretor_id = cv.corretor_id and feature_key = 'leads_qualificados_monthly' and period_start = pstart;
    end if;
  end if;
  return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_detect_opt_out()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations; v_sandbox boolean;
begin
 if new.direction<>'in' or new.sender<>'lead' or not public.lotti_agent_is_opt_out(new.content) then return null; end if;
 if exists(select 1 from public.lotti_agent_messages m where m.conversation_id=new.conversation_id and m.direction='in' and m.created_at>new.created_at) then return null; end if;
 select * into cv from public.lotti_agent_conversations where id=new.conversation_id;
 if cv.id is null or cv.opted_out_at>=new.created_at then return null; end if;
 if cv.opted_out_at is not null and not exists(select 1 from public.lotti_agent_messages m
    where m.conversation_id=cv.id and m.direction='in' and m.sender='lead'
      and m.created_at>cv.opted_out_at and m.created_at<new.created_at
      and not public.lotti_agent_is_opt_out(m.content)) then
  update public.lotti_agent_conversations set opted_out_at=new.created_at where id=cv.id;
  return null;
 end if;
 -- O lease fica como está: prepare/begin_send cancelam quando a conversa sai da IA.
 update public.lotti_agent_conversations set opted_out_at=new.created_at,mode=case when mode='ai' then 'human' else mode end where id=cv.id;
 update public.lotti_agent_outbox set status='cancelled' where conversation_id=cv.id and status='prepared';
 insert into public.lotti_inbox_events(conversation_id,kind,to_label,actor_label,created_at)
 values(cv.id,'consent','Pediu para não receber mensagens','Contato',new.created_at);
 select sandbox into v_sandbox from public.lotti_agent_channels where id=cv.channel_id;
 if not coalesce(v_sandbox,true) and new.created_at>now()-interval '1 day' then
  insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem,entidade_tipo,entidade_id)
  values(cv.corretor_id,cv.cliente_id,'GERAL','Contato pediu para não receber mais mensagens: a IA foi desligada nesta conversa',
   jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','media'),'ia',
   case when cv.cliente_id is not null then 'cliente' end,cv.cliente_id);
 end if;
 return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_escalate_stalled()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv record; total int:=0;
begin
 for cv in
  select c.id,c.corretor_id,c.cliente_id,h.sandbox
  from public.lotti_agent_conversations c join public.lotti_agent_channels h on h.id=c.channel_id
  where h.enabled and c.mode='ai' and c.attempts>=3 and c.lease_until<now()
  -- Envio em andamento com lease vencido é tratado pelo claim (vira incerto).
  and not exists(select 1 from public.lotti_agent_outbox o where o.conversation_id=c.id and o.status='sending')
  for update of c skip locked
 loop
  update public.lotti_agent_conversations set mode='human',lease_token=null,lease_until=null,last_error='processing_stalled' where id=cv.id;
  update public.lotti_agent_outbox set status='cancelled' where conversation_id=cv.id and status='prepared';
  if not cv.sandbox then
   insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem,entidade_tipo,entidade_id)
   values(cv.corretor_id,cv.cliente_id,'GERAL','Conversa aguardando a equipe: o atendimento automático não concluiu',
    jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','alta'),'ia',
    case when cv.cliente_id is not null then 'cliente' end,cv.cliente_id);
  end if;
  total:=total+1;
 end loop;
 return total;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_fail(p_id uuid, p_token uuid, p_error text, p_uncertain boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations; uncertain_send boolean; v_falhas int; v_motivo text;
  c_familia_incerta constant text[] := array[
    'delivery_uncertain','delivery_failed_or_uncertain','delivery_upstream_error','delivery_commit_failed'];
begin
  select * into cv from public.lotti_agent_conversations where id=p_id for update;
  if cv.lease_token is distinct from p_token then return false; end if;

  if coalesce(p_uncertain, true) then
    update public.lotti_agent_outbox set status='uncertain'
     where conversation_id=p_id and status='sending';
    uncertain_send := found;
  else
    delete from public.lotti_agent_outbox
     where conversation_id=p_id and status='sending';
    uncertain_send := false;
  end if;

  -- Toda falha conta. Zerar aqui reabria o laço; quem zera é o sucesso.
  v_falhas := cv.falhas_de_envio + 1;

  -- O motivo só pode prometer os botões de confirmação quando existe mesmo um
  -- envio pendurado para confirmar, isto é, quando um registro foi marcado.
  v_motivo := left(p_error,100);
  if not uncertain_send and v_motivo = any(c_familia_incerta) then
    v_motivo := case when coalesce(p_uncertain,true) then 'falha_antes_do_envio' else 'delivery_rejected' end;
  end if;

  update public.lotti_agent_conversations set
    last_error=v_motivo, lease_until=null, lease_token=null,
    falhas_de_envio=v_falhas,
    next_attempt_at=now()+interval '30 seconds',
    mode=case when uncertain_send or attempts>=3 or v_falhas>=3 then 'human' else mode end
  where id=p_id;

  if (uncertain_send or cv.attempts>=3 or v_falhas>=3)
     and not (select sandbox from public.lotti_agent_channels where id=cv.channel_id) then
    insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem)
    values(cv.corretor_id,cv.cliente_id,'GERAL','Conversa precisa de revisão humana após falha no atendimento',
           jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','alta'),'ia');
  end if;

  return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_finish(p_id uuid, p_token uuid, p_revision bigint, p_external_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations; ob public.lotti_agent_outbox; mid uuid;
begin
 select * into cv from public.lotti_agent_conversations where id=p_id for update;
 if cv.lease_token is distinct from p_token then return false; end if;
 select * into ob from public.lotti_agent_outbox where conversation_id=p_id and revision=p_revision and status='sending' for update;
 if ob.id is null or nullif(p_external_id,'') is null then return false; end if;
 update public.lotti_agent_outbox set status='sent',external_id=p_external_id where id=ob.id;
 insert into public.lotti_agent_messages(conversation_id,external_id,direction,sender,content) values(p_id,p_external_id,'out','ai',ob.content)
 on conflict(conversation_id,external_id) do update set sender='ai' returning id into mid;
 if cv.cliente_id is not null then
   insert into public.historico_contatos(cliente_id,tipo,direcao,conteudo,metadata) values(cv.cliente_id,'WHATSAPP','OUT',ob.content,jsonb_build_object('source','lotti_agent','message_id',mid));
 end if;
 update public.lotti_agent_conversations set processed_revision=p_revision,lease_token=null,lease_until=null,attempts=0,falhas_de_envio=0,last_error=null,
 mode=case when exists(select 1 from public.lotti_agent_messages where conversation_id=p_id and sender='human' and created_at>=ob.created_at and external_id<>p_external_id) then 'human' else mode end where id=p_id;
 return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_followup_advance(p_id uuid, p_revision bigint, p_step smallint, p_due timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  update public.lotti_agent_conversations set followup_step = p_step,
    followup_due_at = case when p_due > now() and p_due < now() + interval '3 days' then p_due end
  where id = p_id and revision = p_revision and followup_revision = p_revision and mode = 'ai';
  return found;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_followup_arm(p_id uuid, p_revision bigint, p_due timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_due is null or p_due <= now() or p_due > now() + interval '3 days' then return false; end if;
  update public.lotti_agent_conversations set followup_step = 0, followup_due_at = p_due, followup_revision = p_revision
  where id = p_id and revision = p_revision and processed_revision = p_revision and mode = 'ai'
    and status = 'open' and opted_out_at is null and archived_at is null;
  return found;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_followup_claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations; ch public.lotti_agent_channels; v_token uuid := gen_random_uuid();
  v_in timestamptz; v_out timestamptz;
begin
  -- Ciclo desarmado por mensagem nova, equipe, pausa, fechamento ou opt-out.
  update public.lotti_agent_conversations set followup_due_at = null
  where followup_due_at is not null
    and (revision is distinct from followup_revision or mode <> 'ai' or status <> 'open'
         or opted_out_at is not null or archived_at is not null);
  select c.* into cv from public.lotti_agent_conversations c join public.lotti_agent_channels h on h.id = c.channel_id
  where c.followup_due_at <= now() and c.mode = 'ai' and c.status = 'open'
    and c.revision = c.followup_revision and c.revision = c.processed_revision
    and c.opted_out_at is null and c.archived_at is null and c.phone is not null
    and h.enabled and not h.sandbox and h.archived_at is null
    and (c.lease_until is null or c.lease_until < now())
    and not exists(select 1 from public.lotti_agent_outbox o where o.conversation_id = c.id and o.status in ('sending', 'uncertain'))
    and not exists(select 1 from public.lotti_manual_sends m where m.conversation_id = c.id and m.status in ('sending', 'uncertain'))
  order by c.followup_due_at for update of c skip locked limit 1;
  if cv.id is null then return null; end if;
  select * into ch from public.lotti_agent_channels where id = cv.channel_id;
  select max(created_at) filter (where direction = 'in'), max(created_at) filter (where direction = 'out')
  into v_in, v_out from public.lotti_agent_messages where conversation_id = cv.id;
  update public.lotti_agent_conversations set lease_token = v_token, lease_until = now() + interval '2 minutes' where id = cv.id;
  return jsonb_build_object('id', cv.id, 'token', v_token, 'revision', cv.revision, 'corretor_id', cv.corretor_id,
    'instance', ch.instance, 'step', cv.followup_step, 'due_at', cv.followup_due_at,
    'last_inbound_at', v_in, 'last_outbound_at', v_out, 'profile', cv.qualification);
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_followup_close(p_id uuid, p_token uuid, p_revision bigint, p_close boolean, p_stage uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null or (p_token is not null and cv.lease_token is distinct from p_token) then return false; end if;
  if cv.revision <> p_revision or cv.followup_revision is distinct from p_revision or cv.mode <> 'ai' or cv.status <> 'open' then
    update public.lotti_agent_conversations set followup_due_at = null,
      lease_token = case when p_token is not null then null else lease_token end,
      lease_until = case when p_token is not null then null else lease_until end
    where id = p_id;
    return false;
  end if;
  update public.lotti_agent_conversations set followup_due_at = null, lease_token = null, lease_until = null,
    status = case when p_close then 'closed' else status end, updated_at = now()
  where id = p_id;
  perform public.lotti_agent_move_stage(p_id, p_stage);
  return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_followup_release(p_id uuid, p_token uuid, p_step smallint, p_due timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null or cv.lease_token is distinct from p_token then return false; end if;
  update public.lotti_agent_conversations set lease_token = null, lease_until = null,
    followup_step = coalesce(p_step, followup_step),
    followup_due_at = case when revision = followup_revision and p_due > now() - interval '1 minute' and p_due < now() + interval '3 days'
      then p_due end
  where id = p_id;
  return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_handoff(p_id uuid, p_token uuid, p_revision bigint, p_result jsonb, p_stage uuid, p_silent boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations; v_sandbox boolean;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null then return false; end if;
  if p_silent then
    if cv.lease_token is distinct from p_token or cv.revision <> p_revision then return false; end if;
    update public.lotti_agent_conversations set qualification = coalesce(p_result, qualification), processed_revision = p_revision,
      lease_token = null, lease_until = null, attempts = 0, mode = 'human' where id = p_id;
    select sandbox into v_sandbox from public.lotti_agent_channels where id = cv.channel_id;
    if not coalesce(v_sandbox, true) then
      insert into public.alertas(corretor_id, cliente_id, tipo, mensagem, metadata, origem, entidade_tipo, entidade_id)
      values (cv.corretor_id, cv.cliente_id, 'GERAL', 'Contato solicitou atendimento do corretor',
        jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','alta','qualification',p_result), 'ia',
        case when cv.cliente_id is not null then 'cliente' end, cv.cliente_id);
    end if;
  else
    if cv.processed_revision < p_revision then return false; end if;
    update public.lotti_agent_conversations set mode = 'human' where id = p_id and mode = 'ai';
  end if;
  perform public.lotti_agent_move_stage(p_id, p_stage);
  return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_import_history(p_instance text, p_messages jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  ch public.lotti_agent_channels;
  cv public.lotti_agent_conversations;
  item jsonb;
  v_phone text;
  v_lid text;
  v_external_id text;
  v_name text;
  v_profile text;
  body text;
  stamp timestamptz;
  imported int := 0;
begin
  if jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) > 200 then
    raise exception 'invalid_history_batch';
  end if;
  select * into ch from public.lotti_agent_channels where instance = p_instance;
  if ch.id is null then raise exception 'unknown_channel'; end if;
  perform public.lotti_agent_bind_account(ch.id,(
    select i->>'account' from jsonb_array_elements(p_messages) i where i->>'account' ~ '^[0-9]{8,15}$' limit 1));
  for item in select value from jsonb_array_elements(p_messages) loop
    v_phone := nullif(item->>'phone','');
    v_lid := nullif(item->>'lid','');
    v_external_id := item->>'external_id';
    body := item->>'text';
    if (v_phone is null and v_lid is null) or v_phone !~ '^[0-9]{8,15}$' or v_lid !~ '^[0-9]{6,20}$'
       or v_external_id is null or length(v_external_id) > 128
       or length(v_external_id) = 0 or body is null or length(body) > 8000
       or jsonb_typeof(item->'from_me') <> 'boolean' then
      raise exception 'invalid_history_message';
    end if;
    stamp := (item->>'created_at')::timestamptz;
    if stamp < '2000-01-01'::timestamptz or stamp > now() + interval '1 day' then
      raise exception 'invalid_history_timestamp';
    end if;
    v_name := case when not (item->>'from_me')::boolean then public.lotti_agent_contact_name(item->>'name') end;
    v_profile := public.lotti_agent_contact_name(item->>'profile');
    cv := public.lotti_agent_resolve_conversation(ch.id,v_phone,v_lid,'human',stamp);
    if v_name is not null and cv.contact_name is distinct from v_name and cv.contact_name_source is distinct from 'typed' then
      update public.lotti_agent_conversations set contact_name=v_name,contact_name_source='saved' where id=cv.id;
    elsif v_name is null and v_profile is not null and cv.contact_name is null then
      update public.lotti_agent_conversations set contact_name=v_profile,contact_name_source='profile' where id=cv.id;
    end if;
    insert into public.lotti_agent_messages(conversation_id,external_id,direction,sender,content,created_at)
    values(cv.id,v_external_id,case when (item->>'from_me')::boolean then 'out' else 'in' end,
      case when (item->>'from_me')::boolean then 'human' else 'lead' end,body,stamp)
    on conflict(conversation_id,external_id) do nothing;
    if found then
      imported := imported+1;
      update public.lotti_agent_conversations set updated_at=greatest(updated_at,stamp) where id=cv.id;
      -- Whoever has history already existed when the number was connected: the
      -- team attends them, not the AI, even if a live message arrived first.
      if cv.mode='ai' then
        update public.lotti_agent_conversations set mode='human' where id=cv.id;
        update public.lotti_agent_outbox set status='cancelled' where conversation_id=cv.id and status='prepared';
      end if;
    end if;
  end loop;
  return jsonb_build_object('imported',imported);
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_ingest(p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare ch public.lotti_agent_channels; cv public.lotti_agent_conversations; msg_id uuid; client_id uuid; is_out boolean:=coalesce((p_event->>'from_me')::boolean,false); is_ai boolean;
  v_account text:=case when p_event->>'account' ~ '^[0-9]{8,15}$' then p_event->>'account' end;
  v_name text:=case when not coalesce((p_event->>'from_me')::boolean,false) then public.lotti_agent_contact_name(p_event->>'name') end;
  v_profile text:=public.lotti_agent_contact_name(p_event->>'profile');
begin
 select * into ch from public.lotti_agent_channels where instance=p_event->>'instance';
 if ch.id is null then return jsonb_build_object('accepted',false,'reason','unregistered_channel'); end if;
 perform public.lotti_agent_bind_account(ch.id,v_account);
 cv:=public.lotti_agent_resolve_conversation(ch.id,p_event->>'phone',p_event->>'lid');
 if v_name is not null and cv.contact_name is distinct from v_name and cv.contact_name_source is distinct from 'typed' then
   update public.lotti_agent_conversations set contact_name=v_name,contact_name_source='saved' where id=cv.id;
   cv.contact_name:=v_name;
 elsif v_name is null and v_profile is not null and cv.contact_name is null then
   update public.lotti_agent_conversations set contact_name=v_profile,contact_name_source='profile' where id=cv.id;
   cv.contact_name:=v_profile;
 end if;
 is_ai:=is_out and exists(select 1 from public.lotti_agent_outbox where conversation_id=cv.id and external_id=p_event->>'external_id');
 insert into public.lotti_agent_messages(conversation_id,external_id,direction,sender,content)
 values(cv.id,p_event->>'external_id',case when is_out then 'out' else 'in' end,case when is_ai then 'ai' when is_out then 'human' else 'lead' end,left(p_event->>'text',8000))
 on conflict(conversation_id,external_id) do nothing returning id into msg_id;
 if msg_id is null then return jsonb_build_object('accepted',true,'duplicate',true); end if;
 if is_ai then return jsonb_build_object('accepted',true,'echo',true); end if;
 -- Provider can echo our outbound before sendText returns its ID. Hold it for
 -- reconciliation in finish; a different ID is a real human intervention.
 if is_out and exists(select 1 from public.lotti_agent_outbox where conversation_id=cv.id and status='sending') then
   return jsonb_build_object('accepted',true,'pending_echo',true);
 end if;
 -- Capture cannot be lost when a legacy CRM insert is rejected by a plan trigger.
 if cv.cliente_id is null and not ch.sandbox and cv.phone is not null then
   begin
     client_id:=(public.lotti_find_or_create_cliente(ch.corretor_id,cv.phone,coalesce(cv.contact_name,'Contato WhatsApp'),
       jsonb_build_object('status_funil','QUALIFICACAO','tipo_interesse','AMBOS'))->>'cliente_id')::uuid;
   exception when others then client_id:=null;
   end;
   update public.lotti_agent_conversations set cliente_id=client_id,last_error=case when client_id is null then 'crm_capture_pending' else last_error end where id=cv.id;
 else client_id:=cv.cliente_id;
 end if;
 -- Replace only the placeholder this function created; never a name typed by the user.
 if client_id is not null and cv.contact_name is not null then
   update public.clientes set nome=cv.contact_name where id=client_id and nome='Contato WhatsApp';
 end if;
 if client_id is not null then
   insert into public.historico_contatos(cliente_id,tipo,direcao,conteudo,metadata)
   values(client_id,'WHATSAPP',case when is_out then 'OUT'::public.direcao_contato else 'IN'::public.direcao_contato end,p_event->>'text',jsonb_build_object('source','lotti_agent','message_id',msg_id));
 end if;
 update public.lotti_agent_conversations set revision=revision+1,updated_at=now(),next_attempt_at=now()+interval '3 seconds',
   -- Mídia sem suporte continua sendo caso de gente: ali a IA não tem o que
   -- responder. Resposta pelo celular vira silêncio com prazo.
   mode=case when coalesce((p_event->>'unsupported')::boolean,false) then 'human' else mode end,
   pausa_ia_ate=case when is_out and not coalesce((p_event->>'unsupported')::boolean,false)
     then now()+public.lotti_agent_pausa_padrao() else pausa_ia_ate end,
   attempts=0 where id=cv.id;
 if is_out or coalesce((p_event->>'unsupported')::boolean,false) then
   update public.lotti_agent_outbox set status='cancelled' where conversation_id=cv.id and status='prepared';
   -- No race: ingest is serialized per channel by lock 715 (resolve_conversation).
   if not is_out and not ch.sandbox and not exists(select 1 from public.alertas a
      where a.corretor_id=cv.corretor_id and a.lido is not true and a.origem='ia'
        and a.metadata->>'conversation_id'=cv.id::text
        and a.mensagem='Mensagem de áudio ou mídia: atendimento humano necessário') then
     insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem)
     values(cv.corretor_id,client_id,'GERAL','Mensagem de áudio ou mídia: atendimento humano necessário',jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','alta'),'ia');
   end if;
 end if;
 return jsonb_build_object('accepted',true,'conversation_id',cv.id);
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_is_opt_out(p_text text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 with src as (select left(coalesce(p_text,''),500) raw),
 norm as (
  select
   btrim(regexp_replace(lower(translate(raw,'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç','AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),'[^a-z0-9]+',' ','g')) full_text,
   btrim(regexp_replace(lower(translate(coalesce(substring(raw from '^[^.!?\n\r]*'),''),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç','AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),'[^a-z0-9]+',' ','g')) first_part
  from src)
 select full_text in ('sair','parar','pare','stop','descadastrar','descadastre','sair da lista','me tire da lista','me tira da lista','me remova da lista')
  or first_part in ('sair','parar','pare','stop','descadastrar','descadastre')
  or full_text ~ '(^| )nao quero (mais )?receber (mais )?(mensagem|mensagens|msg|msgs|nada)( |$)'
  or full_text ~ '(^| )(para|pare|parem) de (me )?(mandar|enviar) (mensagem|mensagens|msg|msgs)( |$)'
  or full_text ~ '(^| )nao (me )?(mande|mandem|envie|enviem) mais (mensagem|mensagens|msg|msgs|nada)( |$)'
  or full_text ~ '(^| )(me )?(sair|tire|tira|tirem|remova|removam|exclua|excluam|retire|retirem) (me |meu numero |meu contato )?(da|dessa|desta|da sua) lista( |$)'
  or full_text ~ 'descadastr'
 from norm
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_merge_conversation(p_keep uuid, p_drop uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare keep_row public.lotti_agent_conversations; drop_row public.lotti_agent_conversations; v_opted timestamptz; v_mode text;
begin
  if p_keep=p_drop then return; end if;
  select * into keep_row from public.lotti_agent_conversations where id=p_keep for update;
  select * into drop_row from public.lotti_agent_conversations where id=p_drop for update;
  if keep_row.id is null or drop_row.id is null or keep_row.channel_id<>drop_row.channel_id then
    raise exception 'invalid_merge';
  end if;
  delete from public.lotti_agent_messages d using public.lotti_agent_messages k
    where d.conversation_id=p_drop and k.conversation_id=p_keep and k.external_id=d.external_id;
  update public.lotti_agent_messages set conversation_id=p_keep where conversation_id=p_drop;
  update public.lotti_manual_sends set conversation_id=p_keep where conversation_id=p_drop;
  update public.lotti_inbox_events set conversation_id=p_keep where conversation_id=p_drop;
  delete from public.lotti_broadcast_deliveries k using public.lotti_broadcast_deliveries d
    where k.conversation_id=p_keep and d.conversation_id=p_drop and d.campaign_id=k.campaign_id
      and k.status in ('pending','cancelled','skipped','failed') and d.status in ('sending','sent','uncertain');
  update public.lotti_broadcast_deliveries d set conversation_id=p_keep
    where d.conversation_id=p_drop
      and not exists(select 1 from public.lotti_broadcast_deliveries k where k.conversation_id=p_keep and k.campaign_id=d.campaign_id);
  delete from public.lotti_agent_conversations where id=p_drop;
  v_opted:=greatest(keep_row.opted_out_at,drop_row.opted_out_at);
  -- Mode first: the opt-out guard refuses an opted-out conversation in 'ai', and
  -- mode is only written when it changes, so the manual-send guard is not triggered needlessly.
  v_mode:=case when keep_row.mode='ai' and drop_row.mode<>'ai' then drop_row.mode
               when keep_row.mode='ai' and v_opted is not null then 'human' else keep_row.mode end;
  if v_mode is distinct from keep_row.mode then
    update public.lotti_agent_conversations set mode=v_mode,lease_token=null,lease_until=null where id=p_keep;
  end if;
  update public.lotti_agent_conversations set
    lid=coalesce(keep_row.lid,drop_row.lid),
    contact_name=coalesce(keep_row.contact_name,drop_row.contact_name),
    contact_name_source=case when keep_row.contact_name is not null then keep_row.contact_name_source else drop_row.contact_name_source end,
    cliente_id=coalesce(keep_row.cliente_id,drop_row.cliente_id),
    qualification=case when keep_row.qualification='{}'::jsonb then drop_row.qualification else keep_row.qualification end,
    notified_stage=coalesce(keep_row.notified_stage,drop_row.notified_stage),
    status=case when 'open' in (keep_row.status,drop_row.status) then 'open' else keep_row.status end,
    opted_out_at=v_opted,
    followup_step=greatest(keep_row.followup_step,drop_row.followup_step),
    updated_at=greatest(keep_row.updated_at,drop_row.updated_at)
  where id=p_keep;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_move_stage(p_conversation uuid, p_stage uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations; v_opportunity uuid; v_key text; v_others uuid[]; v_other_client uuid;
begin
  select * into cv from public.lotti_agent_conversations where id = p_conversation;
  if p_stage is null or cv.cliente_id is null
     or not exists(select 1 from public.crm_etapas where id = p_stage and corretor_id = cv.corretor_id) then
    return false;
  end if;
  v_opportunity := public.crm_oportunidade_aberta(cv.corretor_id, cv.cliente_id);
  if v_opportunity is null then
    v_key := public.lotti_phone_key(cv.phone);
    if v_key ~ '^[1-9][1-9][mf][0-9]{8}$' then
      select array_agg(o.id order by o.updated_at desc), (array_agg(o.cliente_id))[1] into v_others, v_other_client
      from public.crm_oportunidades o join public.clientes k on k.id = o.cliente_id
      where o.corretor_id = cv.corretor_id and o.fechada_em is null and o.cliente_id <> cv.cliente_id
        and k.corretor_id = cv.corretor_id and public.lotti_phone_key(k.telefone) = v_key;
      if cardinality(v_others) = 1 then
        v_opportunity := v_others[1];
        insert into public.alertas(corretor_id, cliente_id, tipo, mensagem, metadata, origem, entidade_tipo, entidade_id)
        select cv.corretor_id, cv.cliente_id, 'GERAL', 'Possível cliente duplicado: o mesmo telefone está em outro cadastro do CRM',
          jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','media','outro_cliente_id',v_other_client,'oportunidade_id',v_opportunity),
          'ia', 'cliente', cv.cliente_id
        where not exists(select 1 from public.alertas a where a.corretor_id = cv.corretor_id and a.origem = 'ia'
          and a.metadata->>'conversation_id' = cv.id::text
          and a.mensagem = 'Possível cliente duplicado: o mesmo telefone está em outro cadastro do CRM');
      end if;
    end if;
  end if;
  if v_opportunity is null then
    insert into public.crm_oportunidades(corretor_id, cliente_id, etapa_id, titulo, origem)
    select cv.corretor_id, cv.cliente_id, p_stage, coalesce(nullif(k.nome, ''), 'Contato WhatsApp'), 'whatsapp_ia'
    from public.clientes k where k.id = cv.cliente_id;
  else
    update public.crm_oportunidades set etapa_id = p_stage, updated_at = now() where id = v_opportunity and etapa_id is distinct from p_stage;
  end if;
  return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_opt_out_mode_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if new.mode='ai' and new.opted_out_at is not null then raise exception 'contact_opted_out'; end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_pausa_padrao()
 RETURNS interval
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ select interval '24 hours' $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_pode_atender(p_conversa uuid, p_agora timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid; v_cfg jsonb; v_minutos int; v_houve_humano boolean;
  v_fora_do_horario boolean; v_espera_equipe boolean;
  v_tz text; v_local timestamp; v_dia jsonb; v_hora time;
  v_dias constant text[] := array['sun','mon','tue','wed','thu','fri','sat'];
begin
  select corretor_id into v_owner from public.lotti_agent_conversations where id = p_conversa;
  if v_owner is null then return false; end if;

  select settings into v_cfg from public.lotti_agent_settings where corretor_id = v_owner;

  -- Formato novo quando existe; senão, converte o antigo.
  if jsonb_typeof(v_cfg #> '{behavior,attend}') = 'object' then
    v_fora_do_horario := coalesce((v_cfg #>> '{behavior,attend,outsideHours}')::boolean, false);
    v_espera_equipe   := coalesce((v_cfg #>> '{behavior,attend,afterDelay}')::boolean, false);
  else
    v_fora_do_horario := coalesce(v_cfg #>> '{behavior,attendMode}', 'always') = 'outside_hours';
    v_espera_equipe   := coalesce(v_cfg #>> '{behavior,attendMode}', 'always') = 'after_delay';
  end if;

  -- Sem restrição marcada, a IA atende tudo.
  if not v_fora_do_horario and not v_espera_equipe then return true; end if;

  -- Fora do expediente da aba Agendamento: um horário por dia, no fuso dali.
  if v_fora_do_horario then
    v_tz    := coalesce(nullif(v_cfg #>> '{schedule,timezone}', ''), 'America/Sao_Paulo');
    v_local := p_agora at time zone v_tz;
    v_dia   := v_cfg #> array['schedule', 'week', v_dias[extract(dow from v_local)::int + 1]];
    if v_dia is null or coalesce((v_dia->>'enabled')::boolean, false) is not true then
      return true; -- dia sem expediente é turno inteiro da IA
    end if;
    v_hora := v_local::time;
    if v_hora < coalesce(nullif(v_dia->>'start', ''), '09:00')::time
       or v_hora >= coalesce(nullif(v_dia->>'end', ''), '18:00')::time then
      return true;
    end if;
  end if;

  -- Equipe calada pelo tempo configurado. Se alguém falou há pouco, a conversa
  -- é dessa pessoa: entrar por cima seria falar junto.
  if v_espera_equipe then
    v_minutos := coalesce((v_cfg #>> '{behavior,attendDelayMinutes}')::int, 5);
    select exists(
      select 1 from public.lotti_agent_messages m
       where m.conversation_id = p_conversa
         and m.sender = 'human'
         and m.created_at >= p_agora - make_interval(mins => v_minutos)
    ) into v_houve_humano;
    if not v_houve_humano then return true; end if;
  end if;

  return false;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_prepare(p_id uuid, p_token uuid, p_revision bigint, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations; ch public.lotti_agent_channels; out_id uuid; stage text:=p_result->>'stage';
begin
 select * into cv from public.lotti_agent_conversations where id=p_id for update;
 select * into ch from public.lotti_agent_channels where id=cv.channel_id;
 if cv.id is null or cv.lease_token is distinct from p_token or cv.lease_until<now() then return jsonb_build_object('cancelled',true); end if;
 if cv.mode<>'ai' or cv.revision<>p_revision or not ch.enabled then
   update public.lotti_agent_conversations set lease_until=null,lease_token=null where id=p_id;
   return jsonb_build_object('cancelled',true);
 end if;
 update public.lotti_agent_conversations set qualification=p_result where id=p_id;
 if not ch.sandbox and (stage in ('qualificado_busca','qualificado_visita') or (p_result->>'humanRequested')::boolean) and cv.notified_stage is distinct from stage then
   insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem,entidade_tipo,entidade_id)
   values(cv.corretor_id,cv.cliente_id,'GERAL',case when stage like 'qualificado%' then 'Lead qualificado: pronto para atendimento do corretor' else 'Contato solicitou atendimento do corretor' end,
     jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority',p_result->>'priority','qualification',p_result), 'ia','cliente',cv.cliente_id);
   update public.lotti_agent_conversations set notified_stage=stage where id=p_id;
 end if;
 insert into public.lotti_agent_outbox(conversation_id,revision,content) values(p_id,p_revision,p_result->>'response')
 on conflict(conversation_id,revision) do update set content=excluded.content where public.lotti_agent_outbox.status='prepared' returning id into out_id;
 return jsonb_build_object('outbox_id',out_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_reconciliar_envio(p_id uuid, p_chegou boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cv public.lotti_agent_conversations; ob public.lotti_agent_outbox;
  v_mid uuid; v_total int := 0; v_revisao bigint := 0;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null then raise exception 'not_found'; end if;
  if not exists (select 1 from public.corretores where id = cv.corretor_id and user_id = auth.uid()) then
    raise exception 'forbidden';
  end if;

  for ob in
    select * from public.lotti_agent_outbox
     where conversation_id = p_id and status = 'uncertain'
     order by revision for update
  loop
    v_total := v_total + 1;
    v_revisao := greatest(v_revisao, ob.revision);

    if p_chegou then
      update public.lotti_agent_outbox set status = 'sent' where id = ob.id;

      -- Se o eco do provedor já entrou, veio rotulado como humano: o
      -- `external_id` do nosso registro estava vazio quando a mensagem voltou,
      -- e `ingest` só reconhece o próprio envio por esse campo. Corrigir o
      -- rótulo é melhor do que gravar a mesma frase duas vezes na conversa.
      update public.lotti_agent_messages set sender = 'ai'
       where conversation_id = p_id and direction = 'out' and sender = 'human'
         and content = ob.content and created_at >= ob.created_at;

      if not found then
        insert into public.lotti_agent_messages(conversation_id, external_id, direction, sender, content)
        values (p_id, 'reconciliado:' || ob.id, 'out', 'ai', ob.content)
        on conflict (conversation_id, external_id) do nothing
        returning id into v_mid;

        if v_mid is not null and cv.cliente_id is not null then
          insert into public.historico_contatos(cliente_id, tipo, direcao, conteudo, metadata)
          values (cv.cliente_id, 'WHATSAPP', 'OUT', ob.content,
                  jsonb_build_object('source', 'lotti_agent', 'message_id', v_mid, 'reconciliado', true));
        end if;
      end if;
    else
      -- APAGA. Ver o cabeçalho: marcar 'cancelled' aqui travava a conversa num
      -- laço silencioso, que é pior do que o problema que o botão resolve.
      delete from public.lotti_agent_outbox where id = ob.id;
    end if;
  end loop;

  if v_total = 0 then return jsonb_build_object('reconciliados', 0); end if;

  update public.lotti_agent_conversations set
    last_error = null, lease_token = null, lease_until = null,
    attempts = 0, next_attempt_at = now(),
    -- `greatest` e não `cv.revision`: mensagem que o lead mandou depois do
    -- envio travado continua sem resposta, e não pode ser engolida aqui.
    processed_revision = case when p_chegou then greatest(processed_revision, v_revisao) else processed_revision end
  where id = p_id;

  return jsonb_build_object('reconciliados', v_total, 'chegou', p_chegou);
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_register_bridge(p_host text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_host is null or p_host !~ '^[a-z0-9-]+\.trycloudflare\.com$' then raise exception 'invalid_bridge_host'; end if;
  insert into public.lotti_agent_bridge_endpoint(id,host,updated_at) values(true,p_host,now())
  on conflict(id) do update set host=excluded.host,updated_at=excluded.updated_at;
  return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_resolve_conversation(p_channel uuid, p_phone text, p_lid text, p_mode text DEFAULT NULL::text, p_updated_at timestamp with time zone DEFAULT now())
 RETURNS public.lotti_agent_conversations
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  ch public.lotti_agent_channels; by_phone public.lotti_agent_conversations; by_lid public.lotti_agent_conversations;
  v_phone text:=nullif(p_phone,''); v_lid text:=nullif(p_lid,''); v_id uuid; result public.lotti_agent_conversations;
begin
  if (v_phone is null and v_lid is null) or v_phone !~ '^[0-9]{8,15}$' or v_lid !~ '^[0-9]{6,20}$' then
    raise exception 'invalid_contact';
  end if;
  select * into ch from public.lotti_agent_channels where id=p_channel;
  if ch.id is null then raise exception 'unknown_channel'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_channel::text,715));
  if v_phone is not null then
    select * into by_phone from public.lotti_agent_conversations where channel_id=p_channel and phone=v_phone for update;
    if by_phone.id is null and public.lotti_conversation_phone_key(v_phone)<>v_phone then
      select * into by_phone from public.lotti_agent_conversations
       where channel_id=p_channel and phone is not null
         and public.lotti_conversation_phone_key(phone)=public.lotti_conversation_phone_key(v_phone)
       order by (lid is null or v_lid is null or lid=v_lid) desc,(lid is not null) desc,updated_at desc
       limit 1 for update;
      if by_phone.id is not null and (by_phone.lid is null or v_lid is null or by_phone.lid=v_lid) then
        update public.lotti_agent_conversations set phone=v_phone where id=by_phone.id;
        by_phone.phone:=v_phone;
      end if;
    end if;
  end if;
  if v_lid is not null then
    select * into by_lid from public.lotti_agent_conversations where channel_id=p_channel and lid=v_lid for update;
  end if;
  if by_phone.id is not null and by_lid.id is not null and by_phone.id<>by_lid.id then
    if by_phone.lid is null and not exists(select 1 from public.lotti_agent_outbox
       where conversation_id=by_lid.id and status in ('sending','uncertain')) then
      perform public.lotti_agent_merge_conversation(by_phone.id,by_lid.id);
    end if;
    -- Found only by the line (other spelling) and bound to another LID: that is
    -- another WhatsApp account, and the event's LID already has its conversation.
    v_id:=case when by_phone.lid is not null and by_phone.lid<>v_lid and by_phone.phone<>v_phone then by_lid.id else by_phone.id end;
  elsif by_phone.id is not null then
    if v_lid is not null and by_phone.lid is null then
      update public.lotti_agent_conversations set lid=v_lid where id=by_phone.id;
    end if;
    v_id:=by_phone.id;
  elsif by_lid.id is not null then
    if v_phone is not null and by_lid.phone is null then
      update public.lotti_agent_conversations set phone=v_phone where id=by_lid.id;
    end if;
    v_id:=by_lid.id;
  else
    if p_mode is null then
      insert into public.lotti_agent_conversations(channel_id,corretor_id,phone,lid,updated_at)
      values(p_channel,ch.corretor_id,v_phone,v_lid,p_updated_at) on conflict do nothing returning id into v_id;
    else
      insert into public.lotti_agent_conversations(channel_id,corretor_id,phone,lid,mode,updated_at)
      values(p_channel,ch.corretor_id,v_phone,v_lid,p_mode,p_updated_at) on conflict do nothing returning id into v_id;
    end if;
    if v_id is null then -- created concurrently outside this lock
      select id into v_id from public.lotti_agent_conversations
      where channel_id=p_channel and ((v_phone is not null and phone=v_phone) or (v_lid is not null and lid=v_lid))
      order by phone is null limit 1;
    end if;
  end if;
  select * into result from public.lotti_agent_conversations where id=v_id for update;
  return result;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_save_settings(p_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid; v_at timestamptz;
begin
  select id into v_owner from public.corretores where user_id = auth.uid() order by id limit 1;
  if v_owner is null then raise exception 'forbidden'; end if;
  perform public.lotti_agent_validate_settings(p_settings);
  insert into public.lotti_agent_settings(corretor_id, settings, updated_at, updated_by)
  values (v_owner, p_settings, now(), auth.uid())
  on conflict (corretor_id) do update set settings = excluded.settings, updated_at = now(), updated_by = auth.uid()
  returning updated_at into v_at;
  update public.lotti_agent_channels set enabled = (p_settings->>'active')::boolean
  where corretor_id = v_owner and archived_at is null and enabled is distinct from (p_settings->>'active')::boolean;
  return jsonb_build_object('updated_at', v_at);
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_set_mode(p_id uuid, p_mode text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations;
begin
 if p_mode not in ('ai','human','paused') then raise exception 'invalid mode'; end if;
 select * into cv from public.lotti_agent_conversations where id=p_id for update;
 if not exists(select 1 from public.corretores where id=cv.corretor_id and user_id=auth.uid()) then raise exception 'forbidden'; end if;
 if p_mode='ai' and exists(select 1 from public.lotti_agent_outbox where conversation_id=p_id and status in ('sending','uncertain')) then raise exception 'reconcile uncertain delivery first'; end if;
 update public.lotti_agent_conversations set mode=p_mode,
 lease_token=case when exists(select 1 from public.lotti_agent_outbox where conversation_id=p_id and status='sending') then lease_token else null end,
 lease_until=case when exists(select 1 from public.lotti_agent_outbox where conversation_id=p_id and status='sending') then lease_until else null end,
 pausa_ia_ate=case when p_mode='ai' then null else pausa_ia_ate end,
 updated_at=now() where id=p_id;
 update public.lotti_agent_outbox set status='cancelled' where conversation_id=p_id and status='prepared';
 if p_mode='ai' then
   delete from public.lotti_agent_outbox where conversation_id=p_id and status='cancelled' and revision=cv.revision;
   update public.lotti_agent_conversations set attempts=0,falhas_de_envio=0,next_attempt_at=now() where id=p_id;
   -- Religar com a última palavra sendo do cliente: a IA responde já.
   -- Depois de um handoff a revisão fica marcada como processada; religar só
   -- armava a IA para a PRÓXIMA mensagem, e o corretor via "IA ligada" sem
   -- resposta nenhuma. Parecia lentidão, era espera.
   -- Abre uma revisão nova em vez de rebaixar processed_revision: a revisão
   -- antiga pode ter registro no outbox, e `prepare` só grava por cima de
   -- registro em 'prepared' — rebaixar travaria a conversa no laço mudo.
   if cv.revision = cv.processed_revision and (
     select m.sender from public.lotti_agent_messages m
      where m.conversation_id = p_id order by m.created_at desc, m.id desc limit 1
   ) = 'lead' then
     update public.lotti_agent_conversations set revision = revision + 1 where id = p_id;
   end if;
 end if;
 return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_validate_settings(p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v_len int;
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text) > 32768 then raise exception 'invalid_settings'; end if;
  if p->'version' is distinct from '2'::jsonb or jsonb_typeof(p->'active') is distinct from 'boolean' then raise exception 'invalid_settings'; end if;
  if coalesce(p->>'model','') !~ '^[a-z][a-z0-9.-]{2,60}$' then raise exception 'invalid_model'; end if;
  if jsonb_typeof(p->'identity') is distinct from 'object' or jsonb_typeof(p->'behavior') is distinct from 'object' then raise exception 'invalid_settings'; end if;
  v_len := char_length(btrim(coalesce(p#>>'{identity,name}','')));
  if v_len < 1 or v_len > 40 then raise exception 'invalid_identity'; end if;
  if char_length(coalesce(p#>>'{identity,company}','')) > 80 or char_length(coalesce(p#>>'{identity,intro}','')) > 400 then raise exception 'invalid_identity'; end if;
  if char_length(coalesce(p->>'prompt','')) > 3000 then raise exception 'invalid_prompt'; end if;

  -- Aceita o formato novo (dois booleanos) ou o antigo (um modo). Exigir os
  -- dois quebraria quem ainda não salvou depois desta versão; exigir só o
  -- antigo quebraria a tela nova.
  if jsonb_typeof(p#>'{behavior,attend}') = 'object' then
    if jsonb_typeof(p#>'{behavior,attend,outsideHours}') is distinct from 'boolean'
       or jsonb_typeof(p#>'{behavior,attend,afterDelay}') is distinct from 'boolean' then raise exception 'invalid_behavior'; end if;
  elsif coalesce(p#>>'{behavior,attendMode}','') not in ('always','outside_hours','after_delay') then
    raise exception 'invalid_behavior';
  end if;

  if coalesce(p#>>'{behavior,handoff,mode}','') not in ('message','silent') then raise exception 'invalid_behavior'; end if;
  if char_length(coalesce(p#>>'{behavior,handoff,messageInHours}','')) > 500
     or char_length(coalesce(p#>>'{behavior,handoff,messageOutOfHours}','')) > 500 then raise exception 'invalid_behavior'; end if;
  if jsonb_typeof(p#>'{behavior,guards,aggregationSeconds}') is distinct from 'number'
     or (p#>>'{behavior,guards,aggregationSeconds}')::numeric not between 0 and 60 then raise exception 'invalid_behavior'; end if;
  if jsonb_typeof(p#>'{behavior,attendDelayMinutes}') is distinct from 'number'
     or (p#>>'{behavior,attendDelayMinutes}')::numeric not between 1 and 1440 then raise exception 'invalid_behavior'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_broadcast_activate(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid := public.lotti_broadcast_owner(); b public.lotti_broadcast_campaigns; v_total int;
begin
  select * into b from public.lotti_broadcast_campaigns where id = p_id and corretor_id = v_owner for update;
  if b.id is null then raise exception 'forbidden'; end if;
  if b.status <> 'draft' then raise exception 'not_editable'; end if;
  if b.starts_at is not null and b.starts_at > now() then
    update public.lotti_broadcast_campaigns set status = 'scheduled', updated_at = now() where id = p_id;
    perform public.lotti_broadcast_log(p_id, 'scheduled', jsonb_build_object('starts_at', b.starts_at));
    return jsonb_build_object('status', 'scheduled', 'startsAt', b.starts_at);
  end if;
  if not exists (select 1 from public.lotti_broadcast_audience(v_owner, b.stage_ids, b.body) a where a.reason is null) then
    raise exception 'no_eligible_contacts';
  end if;
  v_total := public.lotti_broadcast_start(p_id);
  return jsonb_build_object('status', case when v_total > 0 then 'running' else 'completed' end, 'total', v_total);
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_broadcast_audience(p_owner uuid, p_stage_ids uuid[], p_body text)
 RETURNS TABLE(conversation_id uuid, contact text, last_inbound_at timestamp with time zone, content text, reason text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with base as (
    select c.id, c.cliente_id, c.opted_out_at, c.mode, c.status,
      coalesce(nullif(nullif(btrim(k.nome), ''), 'Contato WhatsApp'), c.contact_name) as contact,
      (select max(m.created_at) from public.lotti_agent_messages m where m.conversation_id = c.id and m.direction = 'in') as last_in
    from public.lotti_agent_conversations c
    join public.lotti_agent_channels h on h.id = c.channel_id
    left join public.clientes k on k.id = c.cliente_id
    where c.corretor_id = p_owner and h.corretor_id = p_owner and not h.sandbox and h.archived_at is null
      and c.archived_at is null and c.phone is not null
      and (coalesce(cardinality(p_stage_ids), 0) = 0 or exists (
        select 1 from public.crm_oportunidades o
        where o.cliente_id = c.cliente_id and o.corretor_id = p_owner and o.fechada_em is null and o.etapa_id = any(p_stage_ids)))
  )
  select b.id, b.contact, b.last_in,
    public.lotti_broadcast_render(p_body, b.contact, (select r.nome from public.corretores r where r.id = p_owner)),
    case
      when b.opted_out_at is not null then 'opted_out'
      when b.mode = 'paused' or b.status <> 'open' then 'paused_or_closed'
      when b.last_in is null or b.last_in < now() - interval '24 hours' then 'outside_window'
      when public.lotti_broadcast_render(p_body, b.contact, 'x') is null then 'missing_name'
    end
  from base b
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_broadcast_claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_campaign uuid; d public.lotti_broadcast_deliveries; cv public.lotti_agent_conversations; ch public.lotti_agent_channels;
  b public.lotti_broadcast_campaigns; v_token uuid := gen_random_uuid(); v_in timestamptz; v_reason text; v_outbox text; v_skipped int := 0;
begin
  insert into public.lotti_automation_heartbeat(id, seen_at) values (1, now())
  on conflict (id) do update set seen_at = excluded.seen_at;
  for v_campaign in select id from public.lotti_broadcast_campaigns where status = 'scheduled' and starts_at <= now() order by starts_at limit 5 loop
    perform public.lotti_broadcast_start(v_campaign);
  end loop;

  -- A ponte caiu no meio: o que já saiu fica enviado, o que ficou em dúvida
  -- fica incerto e o que nem começou volta para a fila (até 3 tentativas).
  for d in select * from public.lotti_broadcast_deliveries x where x.status = 'sending' and x.updated_at < now() - interval '3 minutes' for update skip locked loop
    select o.status into v_outbox from public.lotti_agent_outbox o
    where o.conversation_id = d.conversation_id and o.created_at >= d.updated_at order by o.created_at limit 1;
    update public.lotti_broadcast_deliveries set updated_at = now(), lease_token = null,
      status = case when v_outbox = 'sent' then 'sent' when v_outbox is not null then 'uncertain' when d.attempts >= 3 then 'failed' else 'pending' end,
      reason = case when v_outbox is null and d.attempts >= 3 then 'bridge_interrupted' else reason end
    where id = d.id;
    perform public.lotti_broadcast_finish_campaign(d.campaign_id);
  end loop;

  loop
    select x.* into d from public.lotti_broadcast_deliveries x
    join public.lotti_broadcast_campaigns c on c.id = x.campaign_id and c.status = 'running'
    join public.lotti_agent_conversations v on v.id = x.conversation_id
    where x.status = 'pending' and x.scheduled_at <= now()
      and (v.lease_until is null or v.lease_until < now())
      -- Espaçamento mínimo por número conectado, somando todas as campanhas.
      and not exists (select 1 from public.lotti_broadcast_deliveries y join public.lotti_agent_conversations z on z.id = y.conversation_id
        where z.channel_id = v.channel_id and y.status in ('sending', 'sent') and y.updated_at > now() - interval '20 seconds')
    order by x.scheduled_at for update of x skip locked limit 1;
    if d.id is null then return case when v_skipped > 0 then jsonb_build_object('skipped', v_skipped) end; end if;
    select * into b from public.lotti_broadcast_campaigns where id = d.campaign_id;
    select * into cv from public.lotti_agent_conversations where id = d.conversation_id for update;
    select * into ch from public.lotti_agent_channels where id = cv.channel_id;
    select max(created_at) into v_in from public.lotti_agent_messages where conversation_id = cv.id and direction = 'in';
    v_reason := case
      when cv.opted_out_at is not null then 'opted_out'
      when cv.archived_at is not null or ch.archived_at is not null or ch.sandbox or cv.phone is null then 'conversation_unavailable'
      when cv.mode = 'paused' or cv.status <> 'open' then 'paused_or_closed'
      when v_in is null or v_in < now() - interval '24 hours' then 'outside_window'
      when exists (select 1 from public.lotti_agent_messages m where m.conversation_id = cv.id and m.created_at > d.created_at
                   and (m.direction = 'in' or m.sender = 'human')) then 'conversation_moved'
    end;
    if v_reason is not null then
      update public.lotti_broadcast_deliveries set status = 'skipped', reason = v_reason, updated_at = now() where id = d.id;
      perform public.lotti_broadcast_finish_campaign(d.campaign_id);
      v_skipped := v_skipped + 1;
      continue;
    end if;
    -- Agente respondendo ou envio em andamento: tenta de novo em 30 s.
    if (cv.mode = 'ai' and cv.revision > cv.processed_revision)
       or exists (select 1 from public.lotti_agent_outbox o where o.conversation_id = cv.id and o.status in ('prepared', 'sending', 'uncertain'))
       or exists (select 1 from public.lotti_manual_sends m where m.conversation_id = cv.id and m.status in ('sending', 'uncertain')) then
      update public.lotti_broadcast_deliveries set scheduled_at = now() + interval '30 seconds', updated_at = now() where id = d.id;
      return case when v_skipped > 0 then jsonb_build_object('skipped', v_skipped) end;
    end if;
    update public.lotti_agent_conversations set lease_token = v_token, lease_until = now() + interval '2 minutes' where id = cv.id;
    update public.lotti_broadcast_deliveries set status = 'sending', lease_token = v_token, attempts = attempts + 1, updated_at = now() where id = d.id;
    return jsonb_build_object('delivery_id', d.id, 'id', cv.id, 'token', v_token, 'revision', cv.revision, 'content', d.content, 'reply_policy', b.reply_policy);
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_broadcast_complete(p_delivery uuid, p_status text, p_reason text, p_external_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d public.lotti_broadcast_deliveries; v_policy text;
begin
  if p_status not in ('sent', 'skipped', 'failed', 'uncertain') then raise exception 'invalid_status'; end if;
  select * into d from public.lotti_broadcast_deliveries where id = p_delivery for update;
  if d.id is null or d.status <> 'sending' then return false; end if;
  update public.lotti_broadcast_deliveries set status = p_status, reason = left(p_reason, 100), external_id = p_external_id, lease_token = null, updated_at = now()
  where id = d.id;
  -- Sem envio (cancelado no início): devolve a conversa.
  update public.lotti_agent_conversations set lease_token = null, lease_until = null where id = d.conversation_id and lease_token = d.lease_token;
  if p_status = 'sent' then
    select reply_policy into v_policy from public.lotti_broadcast_campaigns where id = d.campaign_id;
    if v_policy = 'ai' then
      -- Só com o Agente ativo no número: senão a resposta ficaria sem ninguém.
      update public.lotti_agent_conversations c set mode = 'ai' where c.id = d.conversation_id and c.mode = 'human' and c.opted_out_at is null
        and exists (select 1 from public.lotti_agent_channels h where h.id = c.channel_id and h.enabled)
        and not exists (select 1 from public.lotti_manual_sends m where m.conversation_id = c.id and m.status in ('sending', 'uncertain'))
        and not exists (select 1 from public.lotti_agent_outbox o where o.conversation_id = c.id and o.status = 'uncertain');
    elsif v_policy = 'human' then
      update public.lotti_agent_conversations set mode = 'human' where id = d.conversation_id and mode = 'ai';
    end if;
  end if;
  perform public.lotti_broadcast_finish_campaign(d.campaign_id);
  return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_broadcast_control(p_id uuid, p_action text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid := public.lotti_broadcast_owner(); b public.lotti_broadcast_campaigns; v_status text;
begin
  select * into b from public.lotti_broadcast_campaigns where id = p_id and corretor_id = v_owner for update;
  if b.id is null then raise exception 'forbidden'; end if;
  if p_action = 'pause' and b.status in ('scheduled', 'running') then
    v_status := 'paused';
  elsif p_action = 'resume' and b.status = 'paused' then
    v_status := case when b.started_at is null then 'scheduled' else 'running' end;
    update public.lotti_broadcast_deliveries d set scheduled_at = now() + (x.n - 1) * b.interval_seconds * interval '1 second', updated_at = now()
    from (select id, row_number() over (order by scheduled_at, id) n from public.lotti_broadcast_deliveries where campaign_id = p_id and status = 'pending') x
    where d.id = x.id;
  elsif p_action = 'cancel' and b.status in ('draft', 'scheduled', 'running', 'paused') then
    v_status := 'cancelled';
    update public.lotti_broadcast_deliveries set status = 'cancelled', reason = 'campaign_cancelled', updated_at = now()
    where campaign_id = p_id and status = 'pending';
  else
    raise exception 'invalid_action';
  end if;
  update public.lotti_broadcast_campaigns set status = v_status, updated_at = now(),
    finished_at = case when v_status = 'cancelled' then now() else finished_at end
  where id = p_id;
  perform public.lotti_broadcast_log(p_id, case p_action when 'pause' then 'paused' when 'resume' then 'resumed' else 'cancelled' end);
  return v_status;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_broadcast_delete_draft(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  delete from public.lotti_broadcast_campaigns where id = p_id and corretor_id = public.lotti_broadcast_owner() and status = 'draft';
  if not found then raise exception 'not_editable'; end if;
  return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_broadcast_duplicate(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid := public.lotti_broadcast_owner(); v_id uuid;
begin
  insert into public.lotti_broadcast_campaigns(corretor_id, name, body, stage_ids, interval_seconds, max_recipients, reply_policy)
  select corretor_id, left('Cópia de ' || name, 120), body, stage_ids, interval_seconds, max_recipients, reply_policy
  from public.lotti_broadcast_campaigns where id = p_id and corretor_id = v_owner
  returning id into v_id;
  if v_id is null then raise exception 'forbidden'; end if;
  perform public.lotti_broadcast_log(v_id, 'duplicated', jsonb_build_object('from', p_id));
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_broadcast_finish_campaign(p_campaign uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.lotti_broadcast_deliveries where campaign_id = p_campaign and status in ('pending', 'sending')) then
    update public.lotti_broadcast_campaigns set status = 'completed', finished_at = now(), updated_at = now()
    where id = p_campaign and status = 'running';
    if found then perform public.lotti_broadcast_log(p_campaign, 'completed'); end if;
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_broadcast_log(p_campaign uuid, p_kind text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  insert into public.lotti_broadcast_events(campaign_id, kind, detail, actor_label)
  values (p_campaign, p_kind, coalesce(p_detail, '{}'::jsonb), public.lotti_inbox_event_actor())
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_broadcast_owner()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select id from public.corretores where user_id = (select auth.uid()) order by id limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_broadcast_preview(p_campaign jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid := public.lotti_broadcast_owner(); v_max int; v_result jsonb;
begin
  if v_owner is null then raise exception 'forbidden'; end if;
  perform public.lotti_broadcast_validate(v_owner, p_campaign);
  v_max := (p_campaign->>'maxRecipients')::int;
  with a as (select * from public.lotti_broadcast_audience(v_owner, public.lotti_broadcast_stage_ids(p_campaign), btrim(p_campaign->>'body'))),
  eligible as (select count(*)::int n from a where reason is null)
  select jsonb_build_object(
    'eligible', least((select n from eligible), v_max),
    'overLimit', greatest((select n from eligible) - v_max, 0),
    'excluded', coalesce((select jsonb_object_agg(reason, n) from (select reason, count(*)::int n from a where reason is not null group by reason) x), '{}'::jsonb),
    'samples', coalesce((select jsonb_agg(jsonb_build_object('contact', contact, 'text', content)) from (
      select contact, content from a where reason is null order by last_inbound_at desc limit 3) s), '[]'::jsonb))
  into v_result;
  return v_result;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_broadcast_render(p_body text, p_name text, p_broker text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v_first text := nullif(split_part(btrim(coalesce(p_name, '')), ' ', 1), '');
begin
  if p_body ~ '\{\{\s*nome\s*\}\}' and v_first is null then return null; end if;
  -- Barra invertida no nome não pode virar referência do regexp_replace.
  return regexp_replace(regexp_replace(p_body, '\{\{\s*nome\s*\}\}', replace(coalesce(v_first, ''), '\', '\\'), 'g'),
    '\{\{\s*corretor\s*\}\}', replace(coalesce(nullif(btrim(p_broker), ''), 'a equipe'), '\', '\\'), 'g');
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_broadcast_save(p_campaign jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid := public.lotti_broadcast_owner(); v_id uuid;
begin
  if v_owner is null then raise exception 'forbidden'; end if;
  perform public.lotti_broadcast_validate(v_owner, p_campaign);
  v_id := case when coalesce(p_campaign->>'id', '') ~* '^[0-9a-f-]{36}$' then (p_campaign->>'id')::uuid end;
  if v_id is not null then
    update public.lotti_broadcast_campaigns set
      name = btrim(p_campaign->>'name'), body = btrim(p_campaign->>'body'), stage_ids = public.lotti_broadcast_stage_ids(p_campaign),
      starts_at = nullif(p_campaign->>'startsAt', '')::timestamptz, interval_seconds = (p_campaign->>'intervalSeconds')::int,
      max_recipients = (p_campaign->>'maxRecipients')::int, reply_policy = coalesce(p_campaign->>'replyPolicy', 'preserve'), updated_at = now()
    where id = v_id and corretor_id = v_owner and status = 'draft';
    if not found then raise exception 'not_editable'; end if;
    perform public.lotti_broadcast_log(v_id, 'updated');
    return v_id;
  end if;
  insert into public.lotti_broadcast_campaigns(corretor_id, name, body, stage_ids, starts_at, interval_seconds, max_recipients, reply_policy)
  values (v_owner, btrim(p_campaign->>'name'), btrim(p_campaign->>'body'), public.lotti_broadcast_stage_ids(p_campaign),
    nullif(p_campaign->>'startsAt', '')::timestamptz, (p_campaign->>'intervalSeconds')::int, (p_campaign->>'maxRecipients')::int,
    coalesce(p_campaign->>'replyPolicy', 'preserve'))
  returning id into v_id;
  perform public.lotti_broadcast_log(v_id, 'created');
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_broadcast_stage_ids(p jsonb)
 RETURNS uuid[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(array_agg(value::uuid), '{}') from jsonb_array_elements_text(coalesce(p->'stageIds', '[]'::jsonb))
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_broadcast_start(p_campaign uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b public.lotti_broadcast_campaigns; v_room int; v_total int; v_eligible int; v_excluded jsonb;
begin
  select * into b from public.lotti_broadcast_campaigns where id = p_campaign for update;
  if b.id is null or b.status not in ('draft', 'scheduled') then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended(b.corretor_id::text, 915));
  select greatest(300 - count(*), 0)::int into v_room from public.lotti_broadcast_deliveries
  where corretor_id = b.corretor_id and created_at > now() - interval '24 hours' and status in ('pending', 'sending', 'sent', 'uncertain');
  with a as materialized (
    select * from public.lotti_broadcast_audience(b.corretor_id, b.stage_ids, b.body)
  ), created as (
    insert into public.lotti_broadcast_deliveries(campaign_id, corretor_id, conversation_id, scheduled_at, content)
    select b.id, b.corretor_id, e.conversation_id, now() + (e.n - 1) * b.interval_seconds * interval '1 second', e.content
    from (select a.*, row_number() over (order by a.last_inbound_at, a.conversation_id) n from a where a.reason is null) e
    where e.n <= least(b.max_recipients, v_room)
    returning 1
  )
  select (select count(*)::int from created), (select count(*)::int from a where reason is null),
    coalesce((select jsonb_object_agg(reason, n) from (select reason, count(*)::int n from a where reason is not null group by reason) x), '{}'::jsonb)
  into v_total, v_eligible, v_excluded;
  v_excluded := v_excluded || jsonb_build_object('over_limit', greatest(v_eligible - v_total, 0));
  update public.lotti_broadcast_campaigns set status = case when v_total > 0 then 'running' else 'completed' end,
    total = v_total, excluded = v_excluded, started_at = now(), finished_at = case when v_total > 0 then null else now() end, updated_at = now()
  where id = b.id;
  perform public.lotti_broadcast_log(b.id, 'started', jsonb_build_object('total', v_total, 'excluded', v_excluded));
  if v_total = 0 then perform public.lotti_broadcast_log(b.id, 'completed', jsonb_build_object('reason', 'no_eligible_contacts')); end if;
  return v_total;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_broadcast_validate(p_owner uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v_body text := coalesce(p->>'body', ''); v_start timestamptz; v_stage text;
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'invalid_campaign'; end if;
  if char_length(btrim(coalesce(p->>'name', ''))) not between 1 and 120 then raise exception 'invalid_name'; end if;
  if char_length(btrim(v_body)) not between 1 and 1000 then raise exception 'invalid_body'; end if;
  if exists (select 1 from regexp_matches(v_body, '\{\{\s*([^{}]*?)\s*\}\}', 'g') as m where m[1] not in ('nome', 'corretor')) then
    raise exception 'invalid_variable';
  end if;
  if coalesce(p->>'replyPolicy', 'preserve') not in ('ai', 'human', 'preserve') then raise exception 'invalid_reply_policy'; end if;
  if jsonb_typeof(p->'intervalSeconds') is distinct from 'number' or (p->>'intervalSeconds')::numeric not between 30 and 3600
     or jsonb_typeof(p->'maxRecipients') is distinct from 'number' or (p->>'maxRecipients')::numeric not between 1 and 300 then
    raise exception 'invalid_limits';
  end if;
  if nullif(p->>'startsAt', '') is not null then
    begin v_start := (p->>'startsAt')::timestamptz; exception when others then raise exception 'invalid_schedule'; end;
    if v_start > now() + interval '30 days' then raise exception 'invalid_schedule'; end if;
  end if;
  if jsonb_typeof(coalesce(p->'stageIds', '[]'::jsonb)) is distinct from 'array' or jsonb_array_length(coalesce(p->'stageIds', '[]'::jsonb)) > 20 then
    raise exception 'invalid_stage';
  end if;
  for v_stage in select jsonb_array_elements_text(coalesce(p->'stageIds', '[]'::jsonb)) loop
    if v_stage !~* '^[0-9a-f-]{36}$' or not exists (select 1 from public.crm_etapas where id = v_stage::uuid and corretor_id = p_owner) then
      raise exception 'invalid_stage';
    end if;
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_channel_reset_company_on_number_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.account_phone is distinct from old.account_phone then
    new.company_name := null;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_channel_set_company_name(p_phone text, p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if nullif(trim(p_name), '') is null or char_length(trim(p_name)) > 80 then
    raise exception 'invalid_company_name';
  end if;
  update public.lotti_agent_channels ch
     set company_name = trim(p_name)
   where ch.account_phone = p_phone and ch.archived_at is null
     and ch.corretor_id in (
       select c.id from public.corretores c where c.user_id = (select auth.uid())
     );
  return found;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_conversa_no_crm()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb; v_titulo text;
begin
  if new.cliente_id is null and new.phone is not null
     and not exists(select 1 from public.lotti_agent_channels ch where ch.id=new.channel_id and ch.sandbox) then
    begin
      v_result:=public.lotti_find_or_create_cliente(new.corretor_id,new.phone,
        coalesce(new.contact_name,'Contato WhatsApp'),
        jsonb_build_object('status_funil','QUALIFICACAO','tipo_interesse','AMBOS'));
      new.cliente_id:=(v_result->>'cliente_id')::uuid;
      if new.last_error='crm_capture_pending' then new.last_error:=null; end if;
    exception when others then
      new.last_error:=coalesce(new.last_error,'crm_capture_pending');
    end;
  end if;
  if new.cliente_id is not null and new.contact_name is not null then
    update public.clientes set nome=new.contact_name
     where id=new.cliente_id and nome='Contato WhatsApp';
  end if;
  -- O card no funil é o que o corretor enxerga. Falhar aqui também não pode
  -- custar a mensagem.
  if new.cliente_id is not null
     and not exists(select 1 from public.lotti_agent_channels ch where ch.id=new.channel_id and ch.sandbox) then
    begin
      v_titulo:=coalesce(
        nullif(btrim(new.contact_name),''),
        public.lotti_telefone_legivel(new.phone),
        'Contato WhatsApp');
      perform public.lotti_inbox_abrir_negocio(new.corretor_id,new.cliente_id,v_titulo);
    exception when others then null;
    end;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_conversation_phone_key(p_phone text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when p_phone ~ '^55[1-9][1-9][0-9]{8,9}$' then public.lotti_phone_key(p_phone) else p_phone end
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_crm_primeira_etapa(p_owner uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select e.id from public.crm_etapas e
   where e.corretor_id=p_owner and coalesce(e.tipo,'ABERTA')='ABERTA' and coalesce(e.ativo,true)
   order by e.ordem, e.nome limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_find_or_create_cliente(p_owner uuid, p_phone text, p_name text, p_dados jsonb DEFAULT '{}'::jsonb, p_criar boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_key text:=public.lotti_phone_key_confiavel(p_phone); v_id uuid; v_cols text; v_dados jsonb;
begin
  if p_owner is null then raise exception 'forbidden'; end if;
  if v_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':'||v_key,716));
    select id into v_id from public.clientes
     where corretor_id=p_owner and public.lotti_phone_key(telefone)=v_key order by created_at limit 1;
    if v_id is not null then return jsonb_build_object('cliente_id',v_id,'created',false); end if;
  end if;
  if not p_criar then return jsonb_build_object('cliente_id',null,'created',false); end if;
  select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb),string_agg(quote_ident(e.key),',' order by e.key) into v_dados,v_cols
    from jsonb_each(coalesce(p_dados,'{}'::jsonb)) e
   where e.key in ('email','cpf','tipo_interesse','status_funil','observacoes','tracking_data','ultimo_contato')
     and jsonb_typeof(e.value)<>'null';
  execute format('insert into public.clientes(corretor_id,nome,telefone%s) select $1,$2,$3%s from jsonb_populate_record(null::public.clientes,$4) r returning id',
      coalesce(','||v_cols,''),coalesce(',r.'||replace(v_cols,',',',r.'),''))
    into v_id using p_owner,coalesce(nullif(btrim(p_name),''),'Contato WhatsApp'),coalesce(p_phone,''),v_dados;
  return jsonb_build_object('cliente_id',v_id,'created',true);
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_inbox_abrir_negocio(p_owner uuid, p_cliente uuid, p_titulo text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_etapa uuid;
begin
  if p_owner is null or p_cliente is null then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_cliente::text,717));
  select id into v_id from public.crm_oportunidades
   where cliente_id=p_cliente and corretor_id=p_owner and fechada_em is null
   order by updated_at desc limit 1;
  if v_id is not null then return v_id; end if;
  v_etapa:=public.lotti_crm_primeira_etapa(p_owner);
  -- Conta sem funil configurado não é motivo para perder a conversa.
  if v_etapa is null then return null; end if;
  insert into public.crm_oportunidades(corretor_id,cliente_id,etapa_id,titulo,origem)
  values(p_owner,p_cliente,v_etapa,coalesce(nullif(btrim(p_titulo),''),'Contato WhatsApp'),'whatsapp')
  returning id into v_id;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_inbox_add_to_crm(p_conversation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid;
begin
  select c.corretor_id into v_owner from public.lotti_agent_conversations c where c.id=p_conversation;
  if v_owner is null or not exists(select 1 from public.corretores r where r.id=v_owner and r.user_id=auth.uid()) then
    raise exception 'forbidden';
  end if;
  return public.lotti_inbox_link_cliente(p_conversation);
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_inbox_clear_opt_out(p_conversation uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid; v_opted timestamptz;
begin
 select corretor_id,opted_out_at into v_owner,v_opted from public.lotti_agent_conversations where id=p_conversation for update;
 if not exists(select 1 from public.corretores where id=v_owner and user_id=auth.uid()) then raise exception 'forbidden'; end if;
 if v_opted is null then return false; end if;
 update public.lotti_agent_conversations set opted_out_at=null,updated_at=now() where id=p_conversation;
 insert into public.lotti_inbox_events(conversation_id,kind,from_label,to_label,actor_label)
 values(p_conversation,'consent','Pediu para não receber mensagens','Contato liberado',public.lotti_inbox_event_actor());
 return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_inbox_event_actor()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select nullif(c.nome, '') from public.corretores c where c.user_id = (select auth.uid()) limit 1), 'Sistema')
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_inbox_link_cliente(p_conversation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid; v_phone text; v_name text; v_client uuid; v_result jsonb;
begin
  select c.corretor_id,c.phone,c.contact_name,c.cliente_id into v_owner,v_phone,v_name,v_client
    from public.lotti_agent_conversations c where c.id=p_conversation for update;
  if v_owner is null then raise exception 'conversation_not_found'; end if;
  if v_client is not null then
    perform public.lotti_inbox_abrir_negocio(v_owner,v_client,coalesce(v_name,'Contato WhatsApp'));
    return jsonb_build_object('cliente_id',v_client,'created',false);
  end if;
  if v_phone is null then raise exception 'phone_required'; end if;
  v_result:=public.lotti_find_or_create_cliente(v_owner,v_phone,coalesce(v_name,'Contato WhatsApp'),
    jsonb_build_object('status_funil','QUALIFICACAO','tipo_interesse','AMBOS'));
  update public.lotti_agent_conversations
    set cliente_id=(v_result->>'cliente_id')::uuid,
        last_error=case when last_error='crm_capture_pending' then null else last_error end
    where id=p_conversation;
  perform public.lotti_inbox_abrir_negocio(v_owner,(v_result->>'cliente_id')::uuid,coalesce(v_name,'Contato WhatsApp'));
  return v_result;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_inbox_merge_conversations(p_keep uuid, p_drop uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_channel uuid; keep_row public.lotti_agent_conversations; drop_row public.lotti_agent_conversations; swap public.lotti_agent_conversations;
begin
  if p_keep is null or p_drop is null or p_keep=p_drop then raise exception 'invalid_merge'; end if;
  select c.channel_id into v_channel from public.lotti_agent_conversations c
   where c.id=p_keep and exists(select 1 from public.corretores r where r.id=c.corretor_id and r.user_id=auth.uid());
  if v_channel is null then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_channel::text,715));
  select * into keep_row from public.lotti_agent_conversations where id=p_keep for update;
  select * into drop_row from public.lotti_agent_conversations where id=p_drop for update;
  if drop_row.id is null or drop_row.corretor_id<>keep_row.corretor_id then raise exception 'forbidden'; end if;
  if drop_row.channel_id<>keep_row.channel_id then raise exception 'invalid_merge'; end if;
  -- Two LIDs are two WhatsApp accounts.
  if keep_row.lid is not null and drop_row.lid is not null then raise exception 'different_contacts'; end if;
  if (drop_row.lid is not null and keep_row.lid is null)
     or (keep_row.lid is null and drop_row.lid is null
         and exists(select 1 from public.lotti_agent_messages m where m.conversation_id=drop_row.id and m.direction='in')
         and not exists(select 1 from public.lotti_agent_messages m where m.conversation_id=keep_row.id and m.direction='in')) then
    swap:=keep_row; keep_row:=drop_row; drop_row:=swap;
  end if;
  if exists(select 1 from public.lotti_agent_outbox where conversation_id=drop_row.id and status in ('sending','uncertain'))
     or exists(select 1 from public.lotti_manual_sends where conversation_id=drop_row.id and status='sending') then
    raise exception 'delivery_pending';
  end if;
  perform public.lotti_agent_merge_conversation(keep_row.id,drop_row.id);
  return jsonb_build_object('conversation_id',keep_row.id,'merged_id',drop_row.id);
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_inbox_record_crm_stage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old_name text; new_name text;
begin
  if new.etapa_id is not distinct from old.etapa_id or new.cliente_id is null then return new; end if;
  select nome into old_name from public.crm_etapas where id = old.etapa_id;
  select nome into new_name from public.crm_etapas where id = new.etapa_id;
  insert into public.lotti_inbox_events(conversation_id, kind, from_label, to_label, subject_label, actor_label)
  select cv.id, 'stage', coalesce(old_name, 'Etapa anterior'), coalesce(new_name, 'Nova etapa'), new.titulo, public.lotti_inbox_event_actor()
  from public.lotti_agent_conversations cv
  where cv.cliente_id = new.cliente_id and cv.corretor_id = new.corretor_id and cv.archived_at is null;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_inbox_record_legacy_stage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status_funil is not distinct from old.status_funil then return new; end if;
  insert into public.lotti_inbox_events(conversation_id, kind, from_label, to_label, actor_label)
  select cv.id, 'stage', coalesce(old.status_funil, 'Sem etapa'), coalesce(new.status_funil, 'Sem etapa'), public.lotti_inbox_event_actor()
  from public.lotti_agent_conversations cv
  where cv.cliente_id = new.id and cv.corretor_id = new.corretor_id and cv.archived_at is null;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_inbox_record_mode()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Closing also pauses the IA, but the event people need to see is the closure.
  if new.status = 'closed' and new.status is distinct from old.status then return new; end if;
  if new.mode is distinct from old.mode then
    insert into public.lotti_inbox_events(conversation_id, kind, from_label, to_label, actor_label)
    values (new.id, 'mode', old.mode, case new.mode when 'ai' then 'IA' when 'human' then 'Equipe' else 'Pausada' end, public.lotti_inbox_event_actor());
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_inbox_record_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status is distinct from old.status then
    insert into public.lotti_inbox_events(conversation_id, kind, from_label, to_label, actor_label)
    values (new.id, 'status', case old.status when 'closed' then 'Fechada' else 'Aberta' end,
      case new.status when 'closed' then 'Fechada' else 'Aberta' end, public.lotti_inbox_event_actor());
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_inbox_rename_client(p_conversation uuid, p_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid; v_client uuid; v_name text:=left(trim(coalesce(p_name,'')),120);
begin
  if length(v_name)<1 then raise exception 'invalid_name'; end if;
  select c.corretor_id,c.cliente_id into v_owner,v_client from public.lotti_agent_conversations c where c.id=p_conversation;
  if v_client is null or not exists(select 1 from public.corretores r where r.id=v_owner and r.user_id=auth.uid()) then raise exception 'forbidden'; end if;
  update public.clientes set nome=v_name where id=v_client and corretor_id=v_owner;
  if not found then raise exception 'forbidden'; end if;
  return v_name;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_inbox_reopen_on_inbound()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.direction='in' then
    update public.lotti_agent_conversations
    set status=case when new.created_at>=now()-interval '1 hour' then 'open' else status end,
        updated_at=greatest(updated_at,new.created_at)
    where id=new.conversation_id;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_inbox_set_status(p_conversation uuid, p_status text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid;
begin
  if p_status not in ('open','closed') then raise exception 'invalid_status'; end if;
  select corretor_id into v_owner from public.lotti_agent_conversations where id=p_conversation;
  if not exists(select 1 from public.corretores where id=v_owner and user_id=auth.uid()) then raise exception 'forbidden'; end if;
  update public.lotti_agent_conversations set status=p_status,mode=case when p_status='closed' then 'paused' else mode end,updated_at=now() where id=p_conversation;
  return p_status;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_inbox_start_conversation(p_phone text, p_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid; v_channel uuid; v_client uuid; v_conversation uuid;
  v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  v_name text:=nullif(left(trim(coalesce(p_name,'')),120),'');
begin
  if length(v_phone) in (10,11) then v_phone:='55'||v_phone; end if;
  if length(v_phone)<12 or length(v_phone)>15 then raise exception 'invalid_phone'; end if;
  select id into v_owner from public.corretores where user_id=auth.uid() order by id limit 1;
  if v_owner is null then raise exception 'forbidden'; end if;
  select id into v_channel from public.lotti_agent_channels where corretor_id=v_owner and archived_at is null and not sandbox order by created_at desc limit 1;
  if v_channel is null then raise exception 'channel_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_channel::text,715));
  select c.id,c.cliente_id into v_conversation,v_client from public.lotti_agent_conversations c
   where c.channel_id=v_channel and c.phone is not null
     and public.lotti_conversation_phone_key(c.phone)=public.lotti_conversation_phone_key(v_phone)
   order by c.phone=v_phone desc,c.lid is not null desc,
     exists(select 1 from public.lotti_agent_messages m where m.conversation_id=c.id and m.direction='in') desc,c.updated_at desc
   limit 1 for update of c;
  if v_conversation is null then
    insert into public.lotti_agent_conversations(channel_id,corretor_id,phone,mode,status)
    values(v_channel,v_owner,v_phone,'human','open') returning id into v_conversation;
  else
    update public.lotti_agent_conversations set status='open',updated_at=now() where id=v_conversation;
  end if;
  if v_client is null then
    v_client:=(public.lotti_find_or_create_cliente(v_owner,v_phone,coalesce(v_name,'Contato WhatsApp'),
      jsonb_build_object('status_funil','QUALIFICACAO','tipo_interesse','AMBOS'))->>'cliente_id')::uuid;
    update public.lotti_agent_conversations set cliente_id=v_client where id=v_conversation;
  end if;
  if v_name is not null then
    update public.clientes set nome=v_name where id=v_client and nome='Contato WhatsApp';
  end if;
  return v_conversation;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_inbox_update_contact(p_conversation uuid, p_name text, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid; v_client uuid; v_current_phone text; v_lid text; v_channel uuid; v_other uuid; v_client_phone text; v_key text;
  v_name text:=left(trim(coalesce(p_name,'')),120);
  v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
begin
  if length(v_name)<1 then raise exception 'invalid_name'; end if;
  select c.corretor_id,c.channel_id into v_owner,v_channel from public.lotti_agent_conversations c where c.id=p_conversation;
  if v_owner is null or not exists(select 1 from public.corretores r where r.id=v_owner and r.user_id=auth.uid()) then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_channel::text,715));
  select c.corretor_id,c.cliente_id,c.phone,c.lid,c.channel_id into v_owner,v_client,v_current_phone,v_lid,v_channel
    from public.lotti_agent_conversations c where c.id=p_conversation for update;
  if length(v_phone) in (10,11) then v_phone:='55'||v_phone; end if;
  if v_current_phone is not null and public.lotti_conversation_phone_key(v_phone)=public.lotti_conversation_phone_key(v_current_phone) then
    v_phone:=v_current_phone;
  elsif v_lid is not null then
    if v_phone<>'' then raise exception 'phone_managed_by_whatsapp'; end if;
    v_phone:=v_current_phone;
  elsif length(v_phone)<12 or length(v_phone)>15 then
    raise exception 'invalid_phone';
  end if;
  if v_current_phone is distinct from v_phone then
    select o.id into v_other from public.lotti_agent_conversations o
     where o.channel_id=v_channel and o.id<>p_conversation and o.phone is not null and o.archived_at is null
       and public.lotti_conversation_phone_key(o.phone)=public.lotti_conversation_phone_key(v_phone)
     limit 1;
    if v_other is not null then raise exception 'phone_in_other_conversation' using detail=v_other::text; end if;
    if exists(select 1 from public.lotti_agent_outbox where conversation_id=p_conversation and status in ('sending','uncertain'))
       or exists(select 1 from public.lotti_manual_sends where conversation_id=p_conversation and status in ('sending','uncertain')) then
      raise exception 'delivery_pending';
    end if;
    update public.lotti_agent_outbox set status='cancelled' where conversation_id=p_conversation and status='prepared';
  end if;
  update public.lotti_agent_conversations set phone=v_phone,contact_name=v_name,contact_name_source='typed',mode=case when v_current_phone is distinct from v_phone then 'human' else mode end,
    lease_token=case when v_current_phone is distinct from v_phone then null else lease_token end,lease_until=case when v_current_phone is distinct from v_phone then null else lease_until end,updated_at=now()
    where id=p_conversation and corretor_id=v_owner;
  if v_client is not null then
    select telefone into v_client_phone from public.clientes where id=v_client and corretor_id=v_owner;
    if not found then raise exception 'forbidden'; end if;
    v_key:=public.lotti_phone_key(v_phone);
    if v_key is not null and v_key is distinct from public.lotti_phone_key(v_client_phone) then
      perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':'||v_key,716));
      select id into v_other from public.clientes
       where corretor_id=v_owner and id<>v_client and public.lotti_phone_key(telefone)=v_key order by created_at limit 1;
      if v_other is not null then
        update public.lotti_agent_conversations set cliente_id=v_other where id=p_conversation;
        update public.clientes set nome=v_name where id=v_other and nome='Contato WhatsApp';
        return jsonb_build_object('name',v_name,'phone',v_phone,'cliente_id',v_other,'relinked',true);
      end if;
    end if;
    update public.clientes set nome=v_name,telefone=coalesce(v_phone,telefone) where id=v_client and corretor_id=v_owner;
  end if;
  return jsonb_build_object('name',v_name,'phone',v_phone);
exception when unique_violation then
  raise exception 'phone_already_in_use';
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_manual_adopt_remote(p_request uuid, p_remote text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_channel uuid; cv public.lotti_agent_conversations;
begin
  if p_remote is null or p_remote !~ '^[0-9]{8,15}$' then raise exception 'invalid_phone'; end if;
  select c.channel_id into v_channel from public.lotti_manual_sends s
    join public.lotti_agent_conversations c on c.id=s.conversation_id where s.request_id=p_request;
  if v_channel is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_channel::text,715));
  select c.* into cv from public.lotti_manual_sends s
    join public.lotti_agent_conversations c on c.id=s.conversation_id where s.request_id=p_request for update of c;
  if cv.id is null or cv.phone is null or cv.phone=p_remote
     or public.lotti_conversation_phone_key(cv.phone)<>public.lotti_conversation_phone_key(p_remote)
     or exists(select 1 from public.lotti_agent_conversations o where o.channel_id=cv.channel_id and o.phone=p_remote) then
    return false;
  end if;
  update public.lotti_agent_conversations set phone=p_remote where id=cv.id;
  return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_manual_begin(p_owner uuid, p_conversation uuid, p_request uuid, p_fingerprint text, p_content text, p_media text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations; ch public.lotti_agent_channels; prior public.lotti_manual_sends;
begin
 select * into cv from public.lotti_agent_conversations where id=p_conversation and corretor_id=p_owner for update;
 if cv.id is null then raise exception 'forbidden'; end if;
 select * into ch from public.lotti_agent_channels where id=cv.channel_id;
 if ch.sandbox then raise exception 'sandbox'; end if;
 update public.lotti_manual_sends set status='uncertain' where conversation_id=cv.id and status='sending' and created_at<now()-interval '2 minutes';
 select * into prior from public.lotti_manual_sends where request_id=p_request;
 if prior.request_id is not null then
  if prior.corretor_id<>p_owner or prior.conversation_id<>p_conversation or prior.fingerprint<>p_fingerprint then raise exception 'request_conflict'; end if;
  return jsonb_build_object('status',prior.status,'duplicate',true);
 end if;
 if exists(select 1 from public.lotti_agent_outbox where conversation_id=cv.id and status in ('sending','uncertain'))
 or exists(select 1 from public.lotti_manual_sends where conversation_id=cv.id and status='sending') then return jsonb_build_object('status','busy'); end if;
 update public.lotti_agent_conversations set mode='human',lease_token=null,lease_until=null,updated_at=now() where id=cv.id;
 update public.lotti_agent_outbox set status='cancelled' where conversation_id=cv.id and status='prepared';
 insert into public.lotti_manual_sends(request_id,conversation_id,corretor_id,fingerprint,content,media_path)
 values(p_request,cv.id,p_owner,p_fingerprint,p_content,p_media);
 return jsonb_build_object('status','ready','instance',ch.instance,'phone',cv.phone,'lid',cv.lid);
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_manual_finish(p_request uuid, p_status text, p_external text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare item public.lotti_manual_sends;
begin
 select * into item from public.lotti_manual_sends where request_id=p_request for update;
 if item.request_id is null then return false; end if;
 if item.status='sent' then return true; end if;
 if p_status not in ('sent','uncertain','failed') then raise exception 'invalid_status'; end if;
 if p_status='sent' and nullif(p_external,'') is null then raise exception 'missing_id'; end if;
 update public.lotti_manual_sends set status=p_status,external_id=p_external where request_id=p_request;
 if p_status='sent' then
  insert into public.lotti_agent_messages(conversation_id,external_id,direction,sender,content,media_path)
  values(item.conversation_id,p_external,'out','human',item.content,item.media_path)
  on conflict(conversation_id,external_id) do update set content=excluded.content,media_path=excluded.media_path,sender='human';
  -- Respondeu pelo Inbox: a IA se cala pelo prazo e retoma sozinha depois.
  update public.lotti_agent_conversations
     set updated_at=now(), pausa_ia_ate=now()+public.lotti_agent_pausa_padrao()
   where id=item.conversation_id;
 end if;
 return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_manual_mode_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if new.mode='ai' and exists(select 1 from public.lotti_manual_sends where conversation_id=new.id and status in ('sending','uncertain')) then raise exception 'manual_delivery_pending'; end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_manual_opt_out_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_opted timestamptz;
begin
 select opted_out_at into v_opted from public.lotti_agent_conversations where id=new.conversation_id;
 if v_opted is not null and not exists(select 1 from public.lotti_agent_messages m
   where m.conversation_id=new.conversation_id and m.direction='in' and m.created_at>v_opted) then
  raise exception 'contact_opted_out';
 end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.lotti_phone_key(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when n is null then nullif(d,'')
    when length(n)=11 or substr(n,3,1) between '6' and '9' then left(n,2)||'m'||right(n,8)
    else left(n,2)||'f'||right(n,8)
  end
  from (
    select d, case
      when d ~ '^55[1-9][1-9](9[0-9]{8}|[2-9][0-9]{7})$' then substr(d,3)
      when not intl and d ~ '^[1-9][1-9](9[0-9]{8}|[2-9][0-9]{7})$' then d
    end as n
    from (
      select case when v ~ '^\s*00' then substr(digits,3) else digits end as d, v ~ '^\s*(\+|00)' as intl
      from (select coalesce(p_value,'') as v, regexp_replace(coalesce(p_value,''),'[^0-9]','','g') as digits) raw
    ) parts
  ) national
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_phone_key_confiavel(p_phone text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when k ~ '^[1-9][1-9][mf][0-9]{8}$' then k
              when k ~ '^[0-9]{10,15}$' and k !~ '^([0-9])\1+$' then k end
    from (select public.lotti_phone_key(p_phone) k) s
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_telefone_legivel(p_telefone text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  -- Mesmo formato do `formatContactPhone` do front, para o número não aparecer
  -- de dois jeitos diferentes em telas vizinhas.
  select case
    when d ~ '^55\d{11}$' then '+55 (' || substr(d,3,2) || ') ' || substr(d,5,5) || '-' || substr(d,10,4)
    when d ~ '^55\d{10}$' then '+55 (' || substr(d,3,2) || ') ' || substr(d,5,4) || '-' || substr(d,9,4)
    when d = '' then null
    else '+' || d
  end
  from (select regexp_replace(coalesce(p_telefone,''), '\D', '', 'g') as d) t
$function$
;

CREATE OR REPLACE FUNCTION public.marcar_alertas_lidos(_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_corretor UUID := public.get_corretor_id();
    v_qtd INT;
BEGIN
    IF v_corretor IS NULL THEN
        RETURN 0;
    END IF;

    -- A RLS de alertas já limita ao corretor; o filtro explícito é defesa em
    -- profundidade, não substituto dela.
    UPDATE public.alertas
       SET lido = TRUE
     WHERE corretor_id = v_corretor
       AND lido = FALSE
       AND (_ids IS NULL OR id = ANY(_ids));

    GET DIAGNOSTICS v_qtd = ROW_COUNT;
    RETURN v_qtd;
END $function$
;

CREATE OR REPLACE FUNCTION public.meus_papeis()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT COALESCE(array_agg(role::TEXT ORDER BY role::TEXT), ARRAY[]::TEXT[])
    FROM public.user_roles
    WHERE user_id = auth.uid() AND revogado_em IS NULL
$function$
;

CREATE OR REPLACE FUNCTION public.mrr_da_assinatura(p_ciclo text, p_mensal numeric, p_anual numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
    SELECT CASE WHEN p_ciclo = 'annual'
                THEN round(COALESCE(p_anual, 0) / 12, 2)
                ELSE COALESCE(p_mensal, 0)
           END
$function$
;

CREATE OR REPLACE FUNCTION public.onboarding_executar_acao(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_profile public.onboarding_profiles%ROWTYPE;
    v_progress public.onboarding_progress%ROWTYPE;
    v_corretor UUID;
    v_id UUID;
    v_cliente UUID;
    v_imovel UUID;
    v_oportunidade UUID;
    v_etapa UUID;
    v_sample BOOLEAN := COALESCE((p_payload->>'is_sample_data')::BOOLEAN,FALSE);
    v_base_action TEXT;
    v_existing TEXT;
    v_first_value BOOLEAN := FALSE;
    v_due TIMESTAMPTZ;
    v_assigned UUID;
    v_reminder INTEGER;
BEGIN
    SELECT * INTO v_profile FROM public.onboarding_profiles WHERE user_id=auth.uid();
    IF v_profile.id IS NULL THEN RAISE EXCEPTION 'onboarding não encontrado'; END IF;
    SELECT * INTO v_progress FROM public.onboarding_progress WHERE profile_id=v_profile.id FOR UPDATE;
    v_corretor := public.get_corretor_id();
    IF v_corretor IS NULL THEN RAISE EXCEPTION 'organização indisponível'; END IF;
    v_sample := v_sample OR p_action LIKE 'sample_%';
    v_base_action := CASE
        WHEN p_action LIKE 'sample_%' THEN replace(p_action,'sample_','first_')
        ELSE p_action
    END;

    v_existing := v_progress.metadata #>> ARRAY['action_ids',p_action];
    IF v_existing IS NOT NULL AND p_action <> 'remove_samples' THEN
        RETURN jsonb_build_object('id',v_existing::UUID,'reused',TRUE);
    END IF;

    IF v_base_action = 'first_property' THEN
        IF NULLIF(BTRIM(p_payload->>'titulo'),'') IS NULL OR NULLIF(BTRIM(p_payload->>'cidade'),'') IS NULL
           OR COALESCE((p_payload->>'valor')::NUMERIC,0) <= 0 THEN
            RAISE EXCEPTION 'título, cidade e valor são obrigatórios';
        END IF;
        INSERT INTO public.imoveis
            (corretor_id,titulo,tipo,finalidade,valor,endereco,bairro,cidade,estado,
             proprietario_nome,ativo,is_sample_data,tracking_data)
        VALUES
            (v_corretor,BTRIM(p_payload->>'titulo'),
             CASE WHEN p_payload->>'tipo' IN ('APARTAMENTO','CASA','COMERCIAL','TERRENO')
                  THEN (p_payload->>'tipo')::public.tipo_imovel ELSE 'CASA'::public.tipo_imovel END,
             CASE WHEN p_payload->>'finalidade' IN ('VENDA','ALUGUEL')
                  THEN (p_payload->>'finalidade')::public.finalidade_imovel ELSE 'VENDA'::public.finalidade_imovel END,
             (p_payload->>'valor')::NUMERIC,
             COALESCE(NULLIF(BTRIM(p_payload->>'endereco'),''),'Endereço a completar'),
             NULLIF(BTRIM(p_payload->>'bairro'),''),BTRIM(p_payload->>'cidade'),
             COALESCE(NULLIF(BTRIM(p_payload->>'estado'),''),'SP'),
             'A informar',TRUE,v_sample,
             jsonb_build_object('origem','onboarding','is_sample_data',v_sample))
        RETURNING id INTO v_id;

    ELSIF v_base_action = 'first_client' THEN
        IF NULLIF(BTRIM(p_payload->>'nome'),'') IS NULL
           OR (NULLIF(BTRIM(p_payload->>'telefone'),'') IS NULL AND NULLIF(BTRIM(p_payload->>'email'),'') IS NULL) THEN
            RAISE EXCEPTION 'nome e telefone ou e-mail são obrigatórios';
        END IF;
        INSERT INTO public.clientes
            (corretor_id,nome,telefone,email,tipo_interesse,status_funil,observacoes,
             is_sample_data,tracking_data)
        VALUES
            (v_corretor,BTRIM(p_payload->>'nome'),COALESCE(BTRIM(p_payload->>'telefone'),''),
             NULLIF(BTRIM(p_payload->>'email'),''),
             CASE WHEN p_payload->>'tipo_interesse' IN ('COMPRA','LOCACAO','AMBOS')
                  THEN (p_payload->>'tipo_interesse')::public.tipo_interesse ELSE 'COMPRA'::public.tipo_interesse END,
             'QUALIFICACAO'::public.status_funil,
             concat_ws(' · ',NULLIF(p_payload->>'regiao',''),NULLIF(p_payload->>'faixa_preco','')),
             v_sample,
             jsonb_build_object('origem',COALESCE(NULLIF(p_payload->>'origem',''),'onboarding'),'is_sample_data',v_sample))
        RETURNING id INTO v_id;

    ELSIF v_base_action = 'first_deal' THEN
        v_cliente := COALESCE(NULLIF(p_payload->>'cliente_id','')::UUID,
                              NULLIF(v_progress.metadata #>> ARRAY['action_ids',CASE WHEN v_sample THEN 'sample_client' ELSE 'first_client' END],'')::UUID);
        v_imovel := COALESCE(NULLIF(p_payload->>'imovel_id','')::UUID,
                             NULLIF(v_progress.metadata #>> ARRAY['action_ids',CASE WHEN v_sample THEN 'sample_property' ELSE 'first_property' END],'')::UUID);
        IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id=v_cliente AND corretor_id=v_corretor) THEN
            RAISE EXCEPTION 'cliente inválido';
        END IF;
        IF v_imovel IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.imoveis WHERE id=v_imovel AND corretor_id=v_corretor) THEN
            RAISE EXCEPTION 'imóvel inválido';
        END IF;
        SELECT id INTO v_etapa FROM public.crm_etapas
         WHERE corretor_id=v_corretor AND ativo ORDER BY ordem LIMIT 1;
        IF v_etapa IS NULL THEN RAISE EXCEPTION 'pipeline não configurado'; END IF;
        INSERT INTO public.crm_oportunidades
            (corretor_id,cliente_id,imovel_id,etapa_id,titulo,valor_estimado,origem,is_sample_data)
        VALUES
            (v_corretor,v_cliente,v_imovel,v_etapa,
             COALESCE(NULLIF(BTRIM(p_payload->>'titulo'),''),'Primeira oportunidade'),
             COALESCE((p_payload->>'valor_estimado')::NUMERIC,0),'onboarding',v_sample)
        RETURNING id INTO v_id;
        IF v_imovel IS NOT NULL THEN
            INSERT INTO public.cliente_imovel (cliente_id,imovel_id)
            VALUES (v_cliente,v_imovel) ON CONFLICT (cliente_id,imovel_id) DO NOTHING;
        END IF;

    ELSIF v_base_action = 'first_task' THEN
        v_cliente := COALESCE(NULLIF(p_payload->>'cliente_id','')::UUID,
                              NULLIF(v_progress.metadata #>> ARRAY['action_ids',CASE WHEN v_sample THEN 'sample_client' ELSE 'first_client' END],'')::UUID);
        v_oportunidade := COALESCE(NULLIF(p_payload->>'oportunidade_id','')::UUID,
                                   NULLIF(v_progress.metadata #>> ARRAY['action_ids',CASE WHEN v_sample THEN 'sample_deal' ELSE 'first_deal' END],'')::UUID);
        IF v_cliente IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clientes WHERE id=v_cliente AND corretor_id=v_corretor) THEN
            RAISE EXCEPTION 'cliente inválido';
        END IF;
        v_due := COALESCE(NULLIF(p_payload->>'data_prevista','')::TIMESTAMPTZ,now()+INTERVAL '1 day');
        v_assigned := COALESCE(NULLIF(p_payload->>'responsavel_id','')::UUID,auth.uid());
        v_reminder := LEAST(GREATEST(COALESCE((p_payload->>'lembrete_minutos')::INTEGER,0),0),525600);
        IF NOT EXISTS (
            SELECT 1 FROM public.routine_memberships
             WHERE organization_id=v_profile.organization_id AND user_id=v_assigned AND status='active'
        ) THEN RAISE EXCEPTION 'responsável inválido'; END IF;
        INSERT INTO public.routine_tasks
            (organization_id,assigned_to,created_by,title,description,activity_type,due_at,
             timezone,recurrence_rule,source,client_id,deal_id,is_sample_data)
        VALUES
            (v_profile.organization_id,v_assigned,auth.uid(),
             COALESCE(NULLIF(BTRIM(p_payload->>'titulo'),''),'Fazer follow-up'),
             NULLIF(BTRIM(p_payload->>'descricao'),''),
             CASE p_payload->>'tipo'
                  WHEN 'LIGACAO' THEN 'ligacao'
                  WHEN 'WHATSAPP' THEN 'whatsapp'
                  WHEN 'EMAIL' THEN 'email'
                  WHEN 'REUNIAO' THEN 'reuniao'
                  WHEN 'VISITA' THEN 'visita_imovel'
                  WHEN 'PROPOSTA' THEN 'proposta'
                  ELSE 'tarefa_administrativa' END,
             v_due,
             COALESCE(NULLIF(p_payload->>'timezone',''),'America/Sao_Paulo'),
             CASE p_payload->>'frequencia'
                  WHEN 'diaria' THEN 'FREQ=DAILY'
                  WHEN 'semanal' THEN 'FREQ=WEEKLY'
                  WHEN 'mensal' THEN 'FREQ=MONTHLY'
                  ELSE NULL END,
             'lotti',v_cliente,v_oportunidade,v_sample)
        RETURNING id INTO v_id;
        IF v_reminder > 0 AND NOT v_sample THEN
            INSERT INTO public.routine_reminders
                (organization_id,user_id,task_id,remind_at,minutes_before,channel)
            VALUES (
                v_profile.organization_id,
                v_assigned,
                v_id,
                GREATEST(now(),v_due-make_interval(mins=>v_reminder)),
                v_reminder,
                'in_app'
            );
        END IF;
        IF v_cliente IS NOT NULL THEN
            UPDATE public.clientes SET proximo_followup=(SELECT due_at FROM public.routine_tasks WHERE id=v_id)
             WHERE id=v_cliente AND corretor_id=v_corretor;
        END IF;

    ELSIF p_action = 'remove_samples' THEN
        DELETE FROM public.routine_tasks WHERE organization_id=v_profile.organization_id AND is_sample_data;
        DELETE FROM public.crm_tarefas WHERE corretor_id=v_corretor AND is_sample_data;
        DELETE FROM public.crm_oportunidades WHERE corretor_id=v_corretor AND is_sample_data;
        DELETE FROM public.clientes WHERE corretor_id=v_corretor AND is_sample_data;
        DELETE FROM public.imoveis WHERE corretor_id=v_corretor AND is_sample_data;
        DELETE FROM public.onboarding_sample_data WHERE organization_id=v_profile.organization_id;
        UPDATE public.onboarding_progress SET
            metadata = jsonb_set(metadata,'{action_ids}',COALESCE(metadata->'action_ids','{}'::JSONB) -
                       ARRAY['sample_property','sample_client','sample_deal','sample_task'],TRUE)
         WHERE id=v_progress.id;
        RETURN jsonb_build_object('removed',TRUE);
    ELSE
        RAISE EXCEPTION 'ação de onboarding inválida';
    END IF;

    UPDATE public.onboarding_progress SET
        metadata=jsonb_set(
            metadata,
            '{action_ids}',
            COALESCE(metadata->'action_ids','{}'::JSONB) || jsonb_build_object(p_action,v_id::TEXT),
            TRUE
        ),
        last_activity_at=now()
     WHERE id=v_progress.id;

    IF v_sample THEN
        INSERT INTO public.onboarding_sample_data
            (organization_id,user_id,entity_type,entity_id)
        VALUES (v_profile.organization_id,auth.uid(),
                CASE v_base_action WHEN 'first_property' THEN 'imovel' WHEN 'first_client' THEN 'cliente'
                                   WHEN 'first_deal' THEN 'oportunidade' ELSE 'tarefa' END,v_id)
        ON CONFLICT DO NOTHING;
    END IF;

    IF NOT v_sample THEN
        INSERT INTO public.onboarding_events
            (organization_id,user_id,profile_id,event_name,step_key,source,metadata)
        VALUES (
            v_profile.organization_id,
            auth.uid(),
            v_profile.id,
            CASE v_base_action
                WHEN 'first_property' THEN 'first_property_created'
                WHEN 'first_client' THEN 'first_client_created'
                WHEN 'first_deal' THEN 'first_deal_created'
                ELSE 'first_task_created'
            END,
            p_action,
            'onboarding',
            '{}'::JSONB
        ) ON CONFLICT DO NOTHING;

        UPDATE public.onboarding_progress SET first_value_at=now()
         WHERE id=v_progress.id AND first_value_at IS NULL
           AND EXISTS (SELECT 1 FROM public.imoveis WHERE corretor_id=v_corretor AND NOT is_sample_data)
           AND EXISTS (SELECT 1 FROM public.clientes WHERE corretor_id=v_corretor AND NOT is_sample_data)
           AND EXISTS (SELECT 1 FROM public.crm_oportunidades WHERE corretor_id=v_corretor AND NOT is_sample_data)
           AND EXISTS (SELECT 1 FROM public.routine_tasks
                        WHERE organization_id=v_profile.organization_id AND deleted_at IS NULL AND NOT is_sample_data)
        RETURNING TRUE INTO v_first_value;

        IF v_first_value THEN
            INSERT INTO public.onboarding_events
                (organization_id,user_id,profile_id,event_name,step_key,source,metadata)
            VALUES
                (v_profile.organization_id,auth.uid(),v_profile.id,'first_value_reached',p_action,'onboarding','{}'::JSONB)
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    RETURN jsonb_build_object('id',v_id,'reused',FALSE);
END $function$
;

CREATE OR REPLACE FUNCTION public.parceiro_portal_registrar_aceite()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_email TEXT := lower(coalesce(auth.jwt() ->> 'email', '')); v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL OR v_email = '' THEN RAISE EXCEPTION 'autenticacao necessaria' USING ERRCODE = '42501'; END IF;
  UPDATE public.parceiros SET convite_aceito_em = coalesce(convite_aceito_em, now()),
    convite_status = 'aceito', atualizado_em = now()
   WHERE (user_id = v_user OR (user_id IS NULL AND lower(email) = v_email)) AND lower(email) = v_email;
  IF NOT FOUND THEN RAISE EXCEPTION 'parceiro nao encontrado' USING ERRCODE = '42501'; END IF;
  UPDATE public.parceiros SET user_id = v_user WHERE lower(email) = v_email AND user_id IS NULL;
  RETURN TRUE;
END $function$
;

CREATE OR REPLACE FUNCTION public.parceiro_portal_resumo()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_email TEXT := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_parceiro public.parceiros;
  v_regra public.parceiro_percentuais;
  v_cliques BIGINT;
  v_cliques_30 BIGINT;
  v_cadastros BIGINT;
  v_comissoes JSONB;
  v_pagamentos JSONB;
  v_campanhas JSONB;
  v_link TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'autenticacao necessaria' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_parceiro FROM public.parceiros
   WHERE user_id = v_user OR (user_id IS NULL AND lower(email) = v_email)
   ORDER BY (user_id = v_user) DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'parceiro nao encontrado' USING ERRCODE = '42501'; END IF;
  IF lower(v_parceiro.email) <> v_email THEN RAISE EXCEPTION 'email divergente' USING ERRCODE = '42501'; END IF;

  UPDATE public.parceiros SET user_id = v_user, convite_aceito_em = coalesce(convite_aceito_em, now())
   WHERE id = v_parceiro.id AND user_id IS NULL;
  SELECT * INTO v_parceiro FROM public.parceiros WHERE id = v_parceiro.id;
  SELECT * INTO v_regra FROM public.parceiro_percentuais
   WHERE parceiro_id = v_parceiro.id AND vigencia_fim IS NULL LIMIT 1;

  SELECT count(*), count(*) FILTER (WHERE criado_em >= now() - interval '30 days')
    INTO v_cliques, v_cliques_30 FROM public.parceiro_cliques WHERE parceiro_id = v_parceiro.id;
  SELECT count(*) INTO v_cadastros FROM public.parceiro_atribuicoes
   WHERE parceiro_id = v_parceiro.id AND status = 'convertida';

  SELECT coalesce(jsonb_object_agg(status, valor), '{}'::jsonb) INTO v_comissoes FROM (
    SELECT CASE WHEN l.status IN ('rascunho', 'exportado') THEN 'em_repasse' ELSE c.status END AS status,
           sum(c.valor_comissao)::numeric(12,2) AS valor
      FROM public.parceiro_comissoes c
      LEFT JOIN public.parceiro_lote_itens i ON i.comissao_id = c.id
      LEFT JOIN public.parceiro_lotes l ON l.id = i.lote_id
     WHERE c.parceiro_id = v_parceiro.id
     GROUP BY 1
  ) totais;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'valor_total', p.valor_total, 'pago_em', p.pago_em,
    'referencia', p.referencia, 'competencia_inicio', p.competencia_inicio,
    'competencia_fim', p.competencia_fim
  ) ORDER BY p.pago_em DESC), '[]'::jsonb) INTO v_pagamentos
    FROM (SELECT * FROM public.parceiro_pagamentos WHERE parceiro_id = v_parceiro.id
          ORDER BY pago_em DESC LIMIT 50) p;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'campanha', coalesce(l.campanha, 'Sem identificador'), 'cliques', x.cliques,
    'indicacoes', x.indicacoes, 'assinaturas', x.assinaturas
  ) ORDER BY x.cliques DESC), '[]'::jsonb) INTO v_campanhas
    FROM public.parceiro_links l
    CROSS JOIN LATERAL (
      SELECT (SELECT count(*) FROM public.parceiro_cliques c WHERE c.link_id = l.id) AS cliques,
             (SELECT count(*) FROM public.parceiro_atribuicoes a WHERE a.link_id = l.id AND a.status = 'convertida') AS indicacoes,
             (SELECT count(*) FROM public.parceiro_comissoes c WHERE c.parceiro_id = l.parceiro_id AND c.atribuicao_id IN
                (SELECT a.id FROM public.parceiro_atribuicoes a WHERE a.link_id = l.id)) AS assinaturas
    ) x WHERE l.parceiro_id = v_parceiro.id AND l.ativo AND l.revogado_em IS NULL;
  SELECT slug INTO v_link FROM public.parceiro_links
   WHERE parceiro_id = v_parceiro.id AND principal AND ativo AND revogado_em IS NULL LIMIT 1;

  RETURN jsonb_build_object(
    'parceiro', jsonb_build_object('id', v_parceiro.id, 'nome', v_parceiro.nome,
      'email', v_parceiro.email, 'status', v_parceiro.status, 'comissao', coalesce(v_regra.percentual, 0),
      'valor_fixo', v_regra.valor_fixo,
      'base_calculo', coalesce(v_regra.base_calculo, 'receita_bruta'), 'renovacoes',
      CASE WHEN v_regra.id IS NULL THEN 'sem_regra' WHEN v_regra.base_calculo = 'primeiro_pagamento'
        THEN 'primeiro_pagamento' ELSE 'recorrente' END,
      'teto_renovacoes', NULL, 'documento', v_parceiro.documento_beneficiario,
      'chave_pix', v_parceiro.chave_pix, 'tipo_chave_pix', v_parceiro.tipo_chave_pix),
    'cliques_30_dias', v_cliques_30, 'cliques_total', v_cliques, 'cadastros', v_cadastros,
    'comissoes', v_comissoes, 'pagamentos', v_pagamentos, 'campanhas', v_campanhas,
    'link_principal', v_link
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.parceiro_portal_salvar_repasse(p_documento text, p_tipo_chave text, p_chave text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_parceiro public.parceiros; v_documento TEXT := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
BEGIN
  SELECT * INTO v_parceiro FROM public.parceiros
   WHERE user_id = auth.uid() OR (user_id IS NULL AND lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
   LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR lower(v_parceiro.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) THEN
    RAISE EXCEPTION 'parceiro nao encontrado' USING ERRCODE = '42501';
  END IF;
  IF p_tipo_chave NOT IN ('cpf','cnpj','email','telefone','aleatoria') OR length(btrim(coalesce(p_chave,''))) < 3 THEN
    RAISE EXCEPTION 'chave pix invalida' USING ERRCODE = '22023';
  END IF;
  IF length(v_documento) NOT IN (11,14) THEN RAISE EXCEPTION 'documento invalido' USING ERRCODE = '22023'; END IF;
  IF (p_tipo_chave = 'cpf' AND (length(regexp_replace(p_chave, '\D', '', 'g')) <> 11 OR regexp_replace(p_chave, '\D', '', 'g') <> v_documento))
     OR (p_tipo_chave = 'cnpj' AND (length(regexp_replace(p_chave, '\D', '', 'g')) <> 14 OR regexp_replace(p_chave, '\D', '', 'g') <> v_documento)) THEN
    RAISE EXCEPTION 'a chave precisa pertencer ao titular do documento' USING ERRCODE = '22023';
  END IF;
  UPDATE public.parceiros SET documento_beneficiario = v_documento,
    tipo_chave_pix = p_tipo_chave, chave_pix = btrim(p_chave), user_id = auth.uid(),
    convite_aceito_em = coalesce(convite_aceito_em, now()), atualizado_em = now()
   WHERE id = v_parceiro.id;
  RETURN TRUE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.parceiro_portal_teto_renovacoes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_email TEXT := lower(coalesce(auth.jwt() ->> 'email', '')); v_teto INT;
BEGIN
  SELECT r.teto_renovacoes INTO v_teto FROM public.parceiros p
  JOIN public.parceiro_percentuais r ON r.parceiro_id = p.id AND r.vigencia_fim IS NULL
  WHERE (p.user_id = auth.uid() OR (p.user_id IS NULL AND lower(p.email) = v_email))
    AND lower(p.email) = v_email LIMIT 1;
  RETURN v_teto;
END $function$
;

CREATE OR REPLACE FUNCTION public.percentual_vigente_em(_parceiro_id uuid, _data date)
 RETURNS public.parceiro_percentuais
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT *
      FROM public.parceiro_percentuais
     WHERE parceiro_id = _parceiro_id
       AND vigencia_inicio <= _data
       AND (vigencia_fim IS NULL OR vigencia_fim >= _data)
     ORDER BY vigencia_inicio DESC
     LIMIT 1
$function$
;

CREATE OR REPLACE FUNCTION public.promover_primeiro_super_admin(_email text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id UUID;
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE role = 'super_admin' AND revogado_em IS NULL
    ) THEN
        RAISE EXCEPTION 'Já existe super_admin. Use o back office para conceder papéis.';
    END IF;

    SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(trim(_email));

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Nenhum usuário com o e-mail %. Crie a conta pelo /auth antes.', _email;
    END IF;

    INSERT INTO public.user_roles (user_id, role, motivo)
    VALUES (v_user_id, 'super_admin', 'Primeiro super_admin da plataforma (bootstrap).');

    INSERT INTO public.admin_auditoria (ator_user_id, acao, entidade, entidade_id, dados_depois, motivo)
    VALUES (v_user_id, 'conceder_papel', 'user_roles', v_user_id::TEXT,
            jsonb_build_object('role', 'super_admin'),
            'Bootstrap via promover_primeiro_super_admin()');

    RETURN 'super_admin concedido a ' || _email;
END $function$
;

CREATE OR REPLACE FUNCTION public.proteger_id_fachada()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION
            'O identificador da fachada é o QR Code impresso na placa e não pode mudar. Para um QR novo, exclua a fachada e crie outra.'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.proteger_status_corretor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- auth.uid() nulo = service_role, cron ou migration: contexto de servidor,
    -- que já não passa por RLS. anon não tem policy de UPDATE aqui e nunca chega.
    IF NEW.status IS DISTINCT FROM OLD.status
       AND auth.uid() IS NOT NULL
       AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'Alterar o status da conta é ação administrativa'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.public_fachada_active(_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS(SELECT 1 FROM public.fachadas WHERE id=_id AND ativo=true);
$function$
;

CREATE OR REPLACE FUNCTION public.registrar_alerta_financeiro(_corretor_id uuid, _tipo text, _mensagem text, _entidade_tipo text, _entidade_id uuid, _metadata jsonb DEFAULT NULL::jsonb, _prioridade text DEFAULT 'MEDIA'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_id UUID;
BEGIN
    IF _corretor_id IS NULL THEN
        RETURN NULL; -- sem dono, o alerta não seria visível por ninguém
    END IF;

    INSERT INTO public.alertas
        (corretor_id, tipo, prioridade, mensagem, lido,
         origem, entidade_tipo, entidade_id, metadata)
    VALUES
        (_corretor_id, _tipo::public.tipo_alerta, _prioridade::public.prioridade_alerta,
         _mensagem, FALSE, 'asaas', _entidade_tipo, _entidade_id, _metadata)
    RETURNING id INTO v_id;

    RETURN v_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.registrar_atividade(p_tipo text DEFAULT 'sessao'::text, p_rota text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_corretor_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN; -- sem sessão não há o que registrar
    END IF;

    IF p_tipo NOT IN ('login', 'sessao', 'acao') THEN
        RAISE EXCEPTION 'tipo de atividade inválido: %', p_tipo;
    END IF;

    -- Não usa get_corretor_id(): um corretor suspenso deve continuar sendo
    -- medido. Se o acesso dele parasse de aparecer, a operação perderia
    -- justamente o sinal de que alguém suspenso segue tentando entrar.
    SELECT id INTO v_corretor_id FROM public.corretores WHERE user_id = auth.uid();

    INSERT INTO public.atividade_eventos (user_id, corretor_id, tipo, rota)
    VALUES (auth.uid(), v_corretor_id, p_tipo, left(coalesce(p_rota, ''), 200));

    IF v_corretor_id IS NOT NULL THEN
        UPDATE public.corretores
           SET ultimo_acesso_em = now()
         WHERE id = v_corretor_id;
    END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.registrar_auditoria_admin(p_acao text, p_entidade text, p_entidade_id text DEFAULT NULL::text, p_dados_antes jsonb DEFAULT NULL::jsonb, p_dados_depois jsonb DEFAULT NULL::jsonb, p_motivo text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_id BIGINT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'acesso negado' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois, motivo)
    VALUES
        (auth.uid(), p_acao, p_entidade, p_entidade_id, p_dados_antes, p_dados_depois, p_motivo)
    RETURNING id INTO v_id;

    RETURN v_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.registrar_onboarding_evento(p_event_name text, p_step_key text DEFAULT NULL::text, p_source text DEFAULT 'onboarding'::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_profile public.onboarding_profiles%ROWTYPE;
BEGIN
    IF p_event_name IS NULL OR p_event_name NOT IN (
        'signup_completed','onboarding_started','persona_selected','organization_created',
        'profile_completed','first_property_created','first_client_created','first_deal_created',
        'first_task_created','calendar_connected','team_member_invited','ai_first_used',
        'onboarding_step_skipped','onboarding_completed','onboarding_abandoned','first_value_reached'
    ) THEN RAISE EXCEPTION 'evento de onboarding inválido'; END IF;
    SELECT * INTO v_profile FROM public.onboarding_profiles WHERE user_id = auth.uid();
    IF v_profile.id IS NULL THEN RETURN; END IF;

    INSERT INTO public.onboarding_events
        (organization_id,user_id,profile_id,event_name,step_key,source,metadata)
    VALUES
        (v_profile.organization_id,auth.uid(),v_profile.id,p_event_name,left(p_step_key,80),left(COALESCE(p_source,'onboarding'),40),
         -- Allowlist fechada: nenhuma chave livre ou PII entra no analytics.
         jsonb_strip_nulls(jsonb_build_object(
             'persona',p_metadata->'persona',
             'organization_type',p_metadata->'organization_type',
             'source',p_metadata->'source',
             'step',p_metadata->'step',
             'role',p_metadata->'role',
             'action',p_metadata->'action',
             'reused',p_metadata->'reused'
         )))
    ON CONFLICT DO NOTHING;
END $function$
;

CREATE OR REPLACE FUNCTION public.reserve_contract_quota(p_corretor uuid)
 RETURNS TABLE(allowed boolean, reservation_id uuid, used integer, quota integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE q record; reservation uuid; pstart date:=date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_corretor::text||':ai_contracts_monthly',0));
 SELECT * INTO q FROM public.checar_cota(p_corretor,'ai_contracts_monthly');
 IF NOT coalesce(q.permitido,false) THEN
  RETURN QUERY SELECT false,NULL::uuid,q.usado,q.limite; RETURN;
 END IF;
 INSERT INTO public.contract_quota_reservations(corretor_id,period_start) VALUES(p_corretor,pstart) RETURNING id INTO reservation;
 INSERT INTO public.usage_counters(corretor_id,feature_key,used_quantity,period_start,period_end)
 VALUES(p_corretor,'ai_contracts_monthly',1,pstart,(pstart+interval '1 month - 1 day')::date)
 ON CONFLICT(corretor_id,feature_key,period_start) DO UPDATE
 SET used_quantity=public.usage_counters.used_quantity+1,updated_at=now();
 RETURN QUERY SELECT true,reservation,q.usado+1,q.limite;
END $function$
;

CREATE OR REPLACE FUNCTION public.routine_detect_conflicts(p_assigned_to uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_exclude_event_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(event_id uuid, title text, start_at timestamp with time zone, end_at timestamp with time zone, is_private boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_org UUID;
BEGIN
    IF (SELECT auth.uid()) IS NULL OR p_end_at <= p_start_at THEN
        RAISE EXCEPTION 'solicitação inválida' USING ERRCODE = '22023';
    END IF;

    SELECT m.organization_id INTO v_org
    FROM public.routine_memberships m
    WHERE m.user_id = p_assigned_to AND m.status = 'active'
      AND private.routine_is_member(m.organization_id)
    LIMIT 1;

    IF v_org IS NULL THEN
        RAISE EXCEPTION 'acesso negado' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT e.id,
           CASE WHEN e.visibility = 'private'
                     AND e.assigned_to <> (SELECT auth.uid())
                     AND e.created_by <> (SELECT auth.uid())
                THEN 'Horário ocupado' ELSE e.title END,
           e.start_at, e.end_at, e.visibility = 'private'
    FROM public.routine_events e
    WHERE e.organization_id = v_org
      AND e.assigned_to = p_assigned_to
      AND e.deleted_at IS NULL
      AND e.status NOT IN ('cancelled','draft')
      AND e.id IS DISTINCT FROM p_exclude_event_id
      AND tstzrange(e.start_at, e.end_at, '[)') && tstzrange(p_start_at, p_end_at, '[)')
    ORDER BY e.start_at;
END $function$
;

CREATE OR REPLACE FUNCTION public.routine_log_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_organization_id UUID;
    v_entity_id UUID;
    v_source TEXT;
    v_updated_at TIMESTAMPTZ;
    v_action TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_organization_id := OLD.organization_id;
        v_entity_id := OLD.id;
        v_source := OLD.source;
        v_updated_at := OLD.updated_at;
    ELSE
        v_organization_id := NEW.organization_id;
        v_entity_id := NEW.id;
        v_source := NEW.source;
        v_updated_at := NEW.updated_at;
    END IF;
    v_action := lower(TG_OP);
    IF TG_OP = 'UPDATE' AND NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
        v_action := 'complete';
    ELSIF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        v_action := 'delete';
    ELSIF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'routine_events'
       AND (to_jsonb(NEW)->>'start_at', to_jsonb(NEW)->>'end_at')
           IS DISTINCT FROM (to_jsonb(OLD)->>'start_at', to_jsonb(OLD)->>'end_at') THEN
        v_action := 'reschedule';
    END IF;

    INSERT INTO public.routine_activity_log
        (organization_id, actor_user_id, entity_type, entity_id, action, changes, source)
    VALUES (
        v_organization_id,
        (SELECT auth.uid()),
        CASE WHEN TG_TABLE_NAME = 'routine_events' THEN 'event' ELSE 'task' END,
        v_entity_id,
        v_action,
        CASE WHEN TG_OP = 'UPDATE'
             THEN jsonb_build_object('updated_at', v_updated_at)
             ELSE '{}'::jsonb END,
        coalesce(v_source, 'user')
    );
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.routine_register_completion(p_item_type text, p_item_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_organization_id UUID;
    v_client_id UUID;
    v_property_id UUID;
    v_activity_type TEXT;
    v_title TEXT;
    v_corretor_id UUID;
BEGIN
    IF p_item_type = 'event' THEN
        SELECT organization_id, client_id, property_id, activity_type, title
        INTO v_organization_id, v_client_id, v_property_id, v_activity_type, v_title
        FROM public.routine_events WHERE id = p_item_id;
        IF NOT private.routine_can_write_event_id(p_item_id) THEN
            RAISE EXCEPTION 'routine_item_forbidden' USING ERRCODE = '42501';
        END IF;
    ELSIF p_item_type = 'task' THEN
        SELECT organization_id, client_id, property_id, activity_type, title
        INTO v_organization_id, v_client_id, v_property_id, v_activity_type, v_title
        FROM public.routine_tasks WHERE id = p_item_id;
        IF NOT private.routine_can_write_task_id(p_item_id) THEN
            RAISE EXCEPTION 'routine_item_forbidden' USING ERRCODE = '42501';
        END IF;
    ELSE
        RAISE EXCEPTION 'routine_item_type_invalid' USING ERRCODE = '22023';
    END IF;

    IF v_client_id IS NULL THEN RETURN FALSE; END IF;
    SELECT legacy_corretor_id INTO v_corretor_id
    FROM public.routine_organizations WHERE id = v_organization_id;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'historico_contatos' AND column_name = 'conteudo'
    ) THEN
        EXECUTE $sql$
            INSERT INTO public.historico_contatos
                (cliente_id, tipo, direcao, conteudo, data_contato, metadata)
            VALUES ($1, $2::public.canal_contato, $3::public.direcao_contato, $4, now(), $5)
        $sql$ USING
            v_client_id,
            CASE WHEN v_activity_type = 'visita_imovel' THEN 'PRESENCIAL' ELSE 'OUTRO' END,
            'OUT',
            'Atividade concluída na Rotina: ' || v_title,
            jsonb_build_object('origem', 'routine', 'routine_id', p_item_id, 'tipo_ui', CASE WHEN v_activity_type = 'visita_imovel' THEN 'VISITA' ELSE 'NOTA' END);
    ELSE
        INSERT INTO public.historico_contatos
            (cliente_id, corretor_id, tipo, descricao, data, imovel_relacionado_id)
        VALUES (
            v_client_id, v_corretor_id,
            CASE WHEN v_activity_type = 'visita_imovel' THEN 'VISITA'::public.tipo_contato ELSE 'NOTA'::public.tipo_contato END,
            'Atividade concluída na Rotina: ' || v_title,
            now(), v_property_id
        );
    END IF;
    UPDATE public.clientes SET ultimo_contato = now() WHERE id = v_client_id AND corretor_id = v_corretor_id;
    RETURN TRUE;
END $function$
;

CREATE OR REPLACE FUNCTION public.routine_touch_and_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    NEW.updated_at = now();
    IF TG_TABLE_NAME = 'routine_events' THEN
        IF (
            NEW.title, NEW.description, NEW.activity_type, NEW.status, NEW.priority,
            NEW.start_at, NEW.end_at, NEW.all_day, NEW.timezone,
            NEW.recurrence_rule, NEW.location, NEW.visibility, NEW.assigned_to,
            NEW.client_id, NEW.property_id, NEW.deal_id, NEW.contract_id,
            NEW.rental_id, NEW.deleted_at
        ) IS DISTINCT FROM (
            OLD.title, OLD.description, OLD.activity_type, OLD.status, OLD.priority,
            OLD.start_at, OLD.end_at, OLD.all_day, OLD.timezone,
            OLD.recurrence_rule, OLD.location, OLD.visibility, OLD.assigned_to,
            OLD.client_id, OLD.property_id, OLD.deal_id, OLD.contract_id,
            OLD.rental_id, OLD.deleted_at
        ) THEN
            NEW.sync_version = coalesce(OLD.sync_version, 0) + 1;
        ELSE
            NEW.sync_version = OLD.sync_version;
        END IF;
        IF NEW.source <> 'google' AND NEW.sync_version > OLD.sync_version THEN
            NEW.sync_status = CASE WHEN NEW.sync_status = 'local' THEN 'local' ELSE 'pending' END;
        END IF;
    END IF;
    RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.routine_validate_item_entities()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_corretor_id UUID;
BEGIN
    SELECT legacy_corretor_id INTO v_corretor_id
    FROM public.routine_organizations
    WHERE id = NEW.organization_id;

    IF v_corretor_id IS NULL THEN
        RAISE EXCEPTION 'routine_organization_invalid' USING ERRCODE = '42501';
    END IF;
    IF NEW.client_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.clientes WHERE id = NEW.client_id AND corretor_id = v_corretor_id
    ) THEN
        RAISE EXCEPTION 'routine_client_outside_organization' USING ERRCODE = '42501';
    END IF;
    IF NEW.property_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.imoveis WHERE id = NEW.property_id AND corretor_id = v_corretor_id
    ) THEN
        RAISE EXCEPTION 'routine_property_outside_organization' USING ERRCODE = '42501';
    END IF;
    IF NEW.deal_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.crm_oportunidades WHERE id = NEW.deal_id AND corretor_id = v_corretor_id
    ) THEN
        RAISE EXCEPTION 'routine_deal_outside_organization' USING ERRCODE = '42501';
    END IF;
    IF NEW.contract_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.contratos WHERE id = NEW.contract_id AND corretor_id = v_corretor_id
    ) THEN
        RAISE EXCEPTION 'routine_contract_outside_organization' USING ERRCODE = '42501';
    END IF;
    IF NEW.rental_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.contratos WHERE id = NEW.rental_id AND corretor_id = v_corretor_id
    ) THEN
        RAISE EXCEPTION 'routine_rental_outside_organization' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.salvar_conexao_asaas(p_corretor_id uuid, p_ambiente text, p_status text, p_conta_nome text, p_conta_email text, p_conta_cpf_cnpj text, p_chave_final text, p_escopos_faltando text[], p_webhook_id text, p_webhook_slug text, p_api_key_ciphertext text, p_webhook_token_ciphertext text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_conexao UUID;
BEGIN
    IF p_corretor_id IS NULL
       OR p_api_key_ciphertext IS NULL
       OR p_webhook_token_ciphertext IS NULL
       OR p_webhook_id IS NULL
       OR p_webhook_slug IS NULL THEN
        RAISE EXCEPTION 'conexão Asaas incompleta';
    END IF;

    INSERT INTO public.asaas_conexoes (
        corretor_id, ambiente, status, conta_nome, conta_email,
        conta_cpf_cnpj, chave_final, escopos_faltando, validada_em,
        webhook_id, webhook_slug, webhook_configurado_em, passo_guia,
        rotacao_pendente, herdada_do_ambiente
    ) VALUES (
        p_corretor_id, p_ambiente, p_status, p_conta_nome, p_conta_email,
        p_conta_cpf_cnpj, p_chave_final, COALESCE(p_escopos_faltando, '{}'), now(),
        p_webhook_id, p_webhook_slug, now(), 4,
        false, false
    )
    ON CONFLICT (corretor_id) DO UPDATE SET
        ambiente = EXCLUDED.ambiente,
        status = EXCLUDED.status,
        conta_nome = EXCLUDED.conta_nome,
        conta_email = EXCLUDED.conta_email,
        conta_cpf_cnpj = EXCLUDED.conta_cpf_cnpj,
        chave_final = EXCLUDED.chave_final,
        escopos_faltando = EXCLUDED.escopos_faltando,
        validada_em = EXCLUDED.validada_em,
        webhook_id = EXCLUDED.webhook_id,
        webhook_slug = EXCLUDED.webhook_slug,
        webhook_configurado_em = EXCLUDED.webhook_configurado_em,
        passo_guia = 4,
        rotacao_pendente = false,
        herdada_do_ambiente = false,
        updated_at = now()
    RETURNING id INTO v_conexao;

    INSERT INTO public.asaas_conexao_segredos (
        conexao_id, api_key_ciphertext, webhook_token_ciphertext
    ) VALUES (
        v_conexao, p_api_key_ciphertext, p_webhook_token_ciphertext
    )
    ON CONFLICT (conexao_id) DO UPDATE SET
        api_key_ciphertext = EXCLUDED.api_key_ciphertext,
        webhook_token_ciphertext = EXCLUDED.webhook_token_ciphertext,
        updated_at = now();

    RETURN v_conexao;
END $function$
;

CREATE OR REPLACE FUNCTION public.salvar_onboarding(p_profile jsonb DEFAULT '{}'::jsonb, p_progress jsonb DEFAULT '{}'::jsonb, p_step_key text DEFAULT NULL::text, p_step_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_profile public.onboarding_profiles%ROWTYPE;
    v_progress public.onboarding_progress%ROWTYPE;
BEGIN
    SELECT * INTO v_profile FROM public.onboarding_profiles WHERE user_id = auth.uid();
    IF v_profile.id IS NULL THEN RAISE EXCEPTION 'perfil de onboarding não encontrado'; END IF;
    SELECT * INTO v_progress FROM public.onboarding_progress WHERE profile_id = v_profile.id FOR UPDATE;

    UPDATE public.onboarding_profiles SET
        persona = COALESCE(NULLIF(p_profile->>'persona',''), persona),
        primary_goal = COALESCE(NULLIF(p_profile->>'primary_goal',''), primary_goal),
        data_entry_strategy = COALESCE(NULLIF(p_profile->>'data_entry_strategy',''), data_entry_strategy),
        creci_status = COALESCE(NULLIF(p_profile->>'creci_status',''), creci_status),
        metadata = metadata || COALESCE(p_profile->'metadata', '{}'::JSONB),
        atualizado_em = now()
    WHERE id = v_profile.id;

    UPDATE public.onboarding_progress SET
        current_step = COALESCE(NULLIF(p_progress->>'current_step',''), current_step),
        completed_steps = CASE WHEN p_progress ? 'completed_steps'
            THEN ARRAY(SELECT jsonb_array_elements_text(p_progress->'completed_steps')) ELSE completed_steps END,
        skipped_steps = CASE WHEN p_progress ? 'skipped_steps'
            THEN ARRAY(SELECT jsonb_array_elements_text(p_progress->'skipped_steps')) ELSE skipped_steps END,
        completed_at = CASE WHEN COALESCE((p_progress->>'complete')::BOOLEAN,FALSE) THEN COALESCE(completed_at,now()) ELSE completed_at END,
        dismissed_at = CASE WHEN COALESCE((p_progress->>'dismiss')::BOOLEAN,FALSE) THEN COALESCE(dismissed_at,now()) ELSE dismissed_at END,
        last_activity_at = now(),
        metadata = metadata || COALESCE(p_progress->'metadata','{}'::JSONB)
    WHERE id = v_progress.id;

    IF p_step_key IS NOT NULL AND p_step_status IN ('iniciado','concluido','pulado','erro') THEN
        INSERT INTO public.onboarding_steps (profile_id, step_key, status, completed_at)
        VALUES (v_profile.id, left(p_step_key,80), p_step_status,
                CASE WHEN p_step_status IN ('concluido','pulado') THEN now() END)
        ON CONFLICT (profile_id,step_key) DO UPDATE SET
            status = EXCLUDED.status,
            completed_at = EXCLUDED.completed_at;
    END IF;

    IF p_step_status='concluido' AND p_step_key IN ('boas_vindas','persona','perfil') THEN
        INSERT INTO public.onboarding_events
            (organization_id,user_id,profile_id,event_name,step_key,source,metadata)
        VALUES (
            v_profile.organization_id,
            auth.uid(),
            v_profile.id,
            CASE p_step_key
                WHEN 'boas_vindas' THEN 'onboarding_started'
                WHEN 'persona' THEN 'persona_selected'
                ELSE 'profile_completed'
            END,
            p_step_key,
            'onboarding',
            CASE WHEN p_step_key='persona'
                 THEN jsonb_build_object('persona',COALESCE(p_profile->>'persona',v_profile.persona))
                 ELSE '{}'::JSONB END
        ) ON CONFLICT DO NOTHING;
    END IF;

    IF COALESCE((p_progress->>'complete')::BOOLEAN,FALSE) THEN
        INSERT INTO public.onboarding_events
            (organization_id,user_id,profile_id,event_name,step_key,source,metadata)
        VALUES (v_profile.organization_id,auth.uid(),v_profile.id,'onboarding_completed','conclusao','onboarding','{}'::JSONB)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN public.get_onboarding_contexto();
END $function$
;

CREATE OR REPLACE FUNCTION public.salvar_onboarding_tour(p_tour_key text, p_status text, p_current_step integer DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_profile UUID;
BEGIN
    SELECT id INTO v_profile FROM public.onboarding_profiles WHERE user_id=auth.uid();
    INSERT INTO public.onboarding_tours (profile_id,tour_key,current_step,completed_at,dismissed_at)
    VALUES (v_profile,left(p_tour_key,80),GREATEST(p_current_step,0),
            CASE WHEN p_status='concluido' THEN now() END,
            CASE WHEN p_status='dispensado' THEN now() END)
    ON CONFLICT (profile_id,tour_key) DO UPDATE SET
        current_step=EXCLUDED.current_step,
        completed_at=COALESCE(public.onboarding_tours.completed_at,EXCLUDED.completed_at),
        dismissed_at=COALESCE(public.onboarding_tours.dismissed_at,EXCLUDED.dismissed_at),
        atualizado_em=now();
END $function$
;

CREATE OR REPLACE FUNCTION public.seed_routine_automations_for_organization()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO public.routine_automations
        (organization_id, created_by, name, source_rule, action_type, due_offset_minutes, enabled, config)
    SELECT NEW.id, c.user_id, seed.name, seed.source_rule, seed.action_type,
           seed.due_offset, FALSE, seed.config
    FROM public.corretores c
    CROSS JOIN (VALUES
      ('Primeiro contato de novo lead', 'new_lead', 'suggestion', 15, '{"activity_type":"primeiro_atendimento"}'::jsonb),
      ('Follow-up de lead sem resposta', 'lead_without_reply', 'suggestion', 1440, '{"activity_type":"follow_up","sla_hours":24}'::jsonb),
      ('Feedback após visita', 'visit_completed', 'suggestion', 60, '{"activity_type":"follow_up"}'::jsonb),
      ('Retorno de proposta', 'proposal_sent', 'suggestion', 2880, '{"activity_type":"negociacao"}'::jsonb),
      ('Renovação de contrato', 'contract_expiring', 'suggestion', -43200, '{"activity_type":"renovacao_contratual","days_before":30}'::jsonb),
      ('Cobrança próxima do vencimento', 'rent_due', 'suggestion', -2880, '{"activity_type":"cobranca","days_before":2}'::jsonb),
      ('Checklist de imóvel captado', 'property_captured', 'suggestion', 0, '{"activity_type":"captacao_imovel","checklist":["Fotos","Descrição","Publicação"]}'::jsonb),
      ('SLA de atendimento', 'client_sla_breached', 'suggestion', 0, '{"activity_type":"follow_up","notify_manager":true}'::jsonb)
    ) AS seed(name, source_rule, action_type, due_offset, config)
    WHERE c.id = NEW.legacy_corretor_id
    ON CONFLICT (organization_id, name) DO NOTHING;
    RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.suporte_criar_sessao(p_ator uuid, p_corretor uuid, p_auth_session uuid, p_access text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c public.corretores; s public.admin_sessoes_suporte;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_ator
    AND role IN ('admin','super_admin') AND revogado_em IS NULL) THEN
    RAISE EXCEPTION 'acesso negado' USING ERRCODE='42501';
  END IF;
  SELECT * INTO c FROM public.corretores WHERE id=p_corretor AND status='ativo' FOR SHARE;
  IF c.id IS NULL OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=c.user_id
    AND role IN ('admin','super_admin') AND revogado_em IS NULL) THEN
    RAISE EXCEPTION 'conta indisponivel para atendimento' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=p_auth_session AND user_id=c.user_id) THEN
    RAISE EXCEPTION 'sessao de autenticacao invalida' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.admin_sessoes_suporte(ator_user_id,user_id,corretor_id,auth_session_id)
    VALUES(p_ator,c.user_id,c.id,p_auth_session) RETURNING * INTO s;
  INSERT INTO suporte_privado.credenciais VALUES(s.id,p_access);
  INSERT INTO public.admin_auditoria(ator_user_id,acao,entidade,entidade_id,dados_depois,motivo)
    VALUES(p_ator,'suporte_aberto','corretores',c.id::TEXT,
      jsonb_build_object('sessao_id',s.id,'expira_em',s.expira_em),'Atendimento pelo backoffice');
  RETURN to_jsonb(s);
END $function$
;

CREATE OR REPLACE FUNCTION public.suporte_encerrar_sessao(p_sessao uuid, p_ator uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE s public.admin_sessoes_suporte; token TEXT;
BEGIN
  SELECT * INTO s FROM public.admin_sessoes_suporte WHERE id=p_sessao AND ator_user_id=p_ator FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'acesso negado' USING ERRCODE='42501'; END IF;
  SELECT access_token INTO token FROM suporte_privado.credenciais WHERE sessao_id=s.id;
  IF s.encerrado_em IS NULL THEN
    UPDATE public.admin_sessoes_suporte SET encerrado_em=now() WHERE id=s.id;
    DELETE FROM suporte_privado.credenciais WHERE sessao_id=s.id;
    INSERT INTO public.admin_auditoria(ator_user_id,acao,entidade,entidade_id,dados_depois)
      VALUES(p_ator,'suporte_encerrado','corretores',s.corretor_id::TEXT,jsonb_build_object('sessao_id',s.id));
  END IF;
  RETURN token;
END $function$
;

CREATE OR REPLACE FUNCTION public.suporte_obter_credenciais(p_sessao uuid, p_ator uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE s public.admin_sessoes_suporte; tokens JSONB;
BEGIN
  SELECT * INTO s FROM public.admin_sessoes_suporte WHERE id=p_sessao AND ator_user_id=p_ator
    AND encerrado_em IS NULL AND expira_em>now();
  IF s.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_ator
    AND role IN ('admin','super_admin') AND revogado_em IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.corretores WHERE id=s.corretor_id AND user_id=s.user_id AND status='ativo')
    OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=s.user_id
      AND role IN ('admin','super_admin') AND revogado_em IS NULL) THEN
    RAISE EXCEPTION 'Atendimento encerrado ou acesso revogado.' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object('access_token',access_token)
    INTO tokens FROM suporte_privado.credenciais WHERE sessao_id=s.id;
  RETURN to_jsonb(s)||tokens;
END $function$
;

CREATE OR REPLACE FUNCTION public.tocar_atualizado_em()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END $function$
;

CREATE OR REPLACE FUNCTION public.trg_bootstrap_onboarding_corretor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    PERFORM public.bootstrap_onboarding_corretor(NEW.id, FALSE);
    RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.trg_onboarding_ai_first_used()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_user UUID; v_org UUID; v_profile UUID;
BEGIN
    IF NEW.role <> 'user' THEN RETURN NEW; END IF;
    v_user := auth.uid();
    IF v_user IS NULL THEN RETURN NEW; END IF;

    SELECT o.id INTO v_org
      FROM public.ai_conversations c
      JOIN public.routine_organizations o ON o.legacy_corretor_id=c.corretor_id
     WHERE c.id=NEW.conversation_id;
    SELECT id INTO v_profile FROM public.onboarding_profiles
     WHERE user_id=v_user AND organization_id=v_org;
    IF v_profile IS NOT NULL THEN
        INSERT INTO public.onboarding_events
            (organization_id,user_id,profile_id,event_name,source,metadata)
        VALUES (v_org,v_user,v_profile,'ai_first_used','assistente','{}'::JSONB)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.trg_onboarding_calendar_connected()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_profile UUID;
BEGIN
    IF NEW.status <> 'connected' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'connected' THEN RETURN NEW; END IF;

    SELECT id INTO v_profile FROM public.onboarding_profiles
     WHERE user_id=NEW.user_id AND organization_id=NEW.organization_id;
    IF v_profile IS NOT NULL THEN
        INSERT INTO public.onboarding_events
            (organization_id,user_id,profile_id,event_name,source,metadata)
        VALUES (NEW.organization_id,NEW.user_id,v_profile,'calendar_connected','google_calendar','{}'::JSONB)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.vincular_conta_do_parceiro()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.user_id IS NULL AND NEW.email IS NOT NULL THEN
        SELECT id INTO NEW.user_id
          FROM auth.users
         WHERE lower(email) = lower(btrim(NEW.email))
         LIMIT 1;
    END IF;
    RETURN NEW;
END $function$
;

-- ===== Chaves e unicidades =====

ALTER TABLE ONLY public.admin_auditoria ADD CONSTRAINT admin_auditoria_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.admin_config ADD CONSTRAINT admin_config_pkey PRIMARY KEY (chave);

ALTER TABLE ONLY public.admin_sessoes_suporte ADD CONSTRAINT admin_sessoes_suporte_auth_session_id_key UNIQUE (auth_session_id);

ALTER TABLE ONLY public.admin_sessoes_suporte ADD CONSTRAINT admin_sessoes_suporte_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_attachments ADD CONSTRAINT ai_attachments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_conversations ADD CONSTRAINT ai_conversations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_messages ADD CONSTRAINT ai_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_rate_limits ADD CONSTRAINT ai_rate_limits_pkey PRIMARY KEY (corretor_id);

ALTER TABLE ONLY public.alertas ADD CONSTRAINT alertas_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.asaas_checkout_events ADD CONSTRAINT asaas_checkout_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.asaas_conexao_segredos ADD CONSTRAINT asaas_conexao_segredos_pkey PRIMARY KEY (conexao_id);

ALTER TABLE ONLY public.asaas_conexoes ADD CONSTRAINT asaas_conexoes_corretor_id_key UNIQUE (corretor_id);

ALTER TABLE ONLY public.asaas_conexoes ADD CONSTRAINT asaas_conexoes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.asaas_conexoes ADD CONSTRAINT asaas_conexoes_webhook_slug_key UNIQUE (webhook_slug);

ALTER TABLE ONLY public.asaas_webhook_events ADD CONSTRAINT asaas_webhook_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.asaas_webhook_events ADD CONSTRAINT uq_asaas_webhook_event UNIQUE (event_id);

ALTER TABLE ONLY public.atividade_eventos ADD CONSTRAINT atividade_eventos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.auditoria_financeira ADD CONSTRAINT auditoria_financeira_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.billing_legacy_accounts ADD CONSTRAINT billing_legacy_accounts_pkey PRIMARY KEY (corretor_id);

ALTER TABLE ONLY public.calendar_connections ADD CONSTRAINT calendar_connections_organization_id_user_id_provider_key UNIQUE (organization_id, user_id, provider);

ALTER TABLE ONLY public.calendar_connections ADD CONSTRAINT calendar_connections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.calendar_event_mappings ADD CONSTRAINT calendar_event_mappings_connection_id_routine_event_id_key UNIQUE (connection_id, routine_event_id);

ALTER TABLE ONLY public.calendar_event_mappings ADD CONSTRAINT calendar_event_mappings_external_calendar_id_google_event_i_key UNIQUE (external_calendar_id, google_event_id);

ALTER TABLE ONLY public.calendar_event_mappings ADD CONSTRAINT calendar_event_mappings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.calendar_sync_states ADD CONSTRAINT calendar_sync_states_external_calendar_id_key UNIQUE (external_calendar_id);

ALTER TABLE ONLY public.calendar_sync_states ADD CONSTRAINT calendar_sync_states_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.calendar_watch_channels ADD CONSTRAINT calendar_watch_channels_channel_id_key UNIQUE (channel_id);

ALTER TABLE ONLY public.calendar_watch_channels ADD CONSTRAINT calendar_watch_channels_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.calendar_webhook_receipts ADD CONSTRAINT calendar_webhook_receipts_channel_id_message_number_key UNIQUE (channel_id, message_number);

ALTER TABLE ONLY public.calendar_webhook_receipts ADD CONSTRAINT calendar_webhook_receipts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.cancelamento_feedback ADD CONSTRAINT cancelamento_feedback_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.checkout_orders ADD CONSTRAINT checkout_orders_access_token_hash_key UNIQUE (access_token_hash);

ALTER TABLE ONLY public.checkout_orders ADD CONSTRAINT checkout_orders_asaas_subscription_id_key UNIQUE (asaas_subscription_id);

ALTER TABLE ONLY public.checkout_orders ADD CONSTRAINT checkout_orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.checkout_payments ADD CONSTRAINT checkout_payments_pkey PRIMARY KEY (payment_id);

ALTER TABLE ONLY public.checkout_rate_limits ADD CONSTRAINT checkout_rate_limits_pkey PRIMARY KEY (key_hash, bucket);

ALTER TABLE ONLY public.cliente_imovel ADD CONSTRAINT cliente_imovel_cliente_id_imovel_id_key UNIQUE (cliente_id, imovel_id);

ALTER TABLE ONLY public.cliente_imovel ADD CONSTRAINT cliente_imovel_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.clientes ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.commercial_diagnostic_events ADD CONSTRAINT commercial_diagnostic_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.commercial_diagnostics ADD CONSTRAINT commercial_diagnostics_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.commercial_diagnostics ADD CONSTRAINT commercial_diagnostics_session_id_key UNIQUE (session_id);

ALTER TABLE ONLY public.contract_quota_reservations ADD CONSTRAINT contract_quota_reservations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.contratos ADD CONSTRAINT contratos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.contratos_renegociacoes ADD CONSTRAINT contratos_renegociacoes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.corretores ADD CONSTRAINT corretores_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.corretores ADD CONSTRAINT corretores_user_id_key UNIQUE (user_id);

ALTER TABLE ONLY public.crm_etapas ADD CONSTRAINT crm_etapas_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.crm_oportunidades ADD CONSTRAINT crm_oportunidades_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.crm_tarefas ADD CONSTRAINT crm_tarefas_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.documentos ADD CONSTRAINT documentos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.external_calendars ADD CONSTRAINT external_calendars_connection_id_external_calendar_id_key UNIQUE (connection_id, external_calendar_id);

ALTER TABLE ONLY public.external_calendars ADD CONSTRAINT external_calendars_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fachada_escaneamentos ADD CONSTRAINT fachada_escaneamentos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fachada_leads ADD CONSTRAINT fachada_leads_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fachada_templates ADD CONSTRAINT fachada_templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fachadas ADD CONSTRAINT fachadas_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.faturas_aluguel ADD CONSTRAINT faturas_aluguel_external_id_key UNIQUE (external_id);

ALTER TABLE ONLY public.faturas_aluguel ADD CONSTRAINT faturas_aluguel_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.historico_contatos ADD CONSTRAINT historico_contatos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.imoveis ADD CONSTRAINT imoveis_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.imovel_fotos ADD CONSTRAINT imovel_fotos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.job_queue ADD CONSTRAINT job_queue_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.job_queue ADD CONSTRAINT uq_job_dedupe UNIQUE (dedupe_key);

ALTER TABLE ONLY public.lancamentos_financeiros ADD CONSTRAINT lancamentos_financeiros_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.leads_sem_destino ADD CONSTRAINT leads_sem_destino_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lotti_agent_bridge_endpoint ADD CONSTRAINT lotti_agent_bridge_endpoint_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lotti_agent_channels ADD CONSTRAINT lotti_agent_channels_instance_key UNIQUE (instance);

ALTER TABLE ONLY public.lotti_agent_channels ADD CONSTRAINT lotti_agent_channels_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lotti_agent_conversations ADD CONSTRAINT lotti_agent_conversations_channel_id_phone_key UNIQUE (channel_id, phone);

ALTER TABLE ONLY public.lotti_agent_conversations ADD CONSTRAINT lotti_agent_conversations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lotti_agent_messages ADD CONSTRAINT lotti_agent_messages_conversation_id_external_id_key UNIQUE (conversation_id, external_id);

ALTER TABLE ONLY public.lotti_agent_messages ADD CONSTRAINT lotti_agent_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lotti_agent_outbox ADD CONSTRAINT lotti_agent_outbox_conversation_id_revision_key UNIQUE (conversation_id, revision);

ALTER TABLE ONLY public.lotti_agent_outbox ADD CONSTRAINT lotti_agent_outbox_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lotti_agent_settings ADD CONSTRAINT lotti_agent_settings_pkey PRIMARY KEY (corretor_id);

ALTER TABLE ONLY public.lotti_agent_usage ADD CONSTRAINT lotti_agent_usage_pkey PRIMARY KEY (corretor_id, phone, period_start);

ALTER TABLE ONLY public.lotti_automation_heartbeat ADD CONSTRAINT lotti_automation_heartbeat_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lotti_broadcast_campaigns ADD CONSTRAINT lotti_broadcast_campaigns_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lotti_broadcast_deliveries ADD CONSTRAINT lotti_broadcast_deliveries_campaign_id_conversation_id_key UNIQUE (campaign_id, conversation_id);

ALTER TABLE ONLY public.lotti_broadcast_deliveries ADD CONSTRAINT lotti_broadcast_deliveries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lotti_broadcast_events ADD CONSTRAINT lotti_broadcast_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lotti_inbox_events ADD CONSTRAINT lotti_inbox_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lotti_manual_sends ADD CONSTRAINT lotti_manual_sends_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.onboarding_checklist ADD CONSTRAINT onboarding_checklist_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.onboarding_checklist ADD CONSTRAINT onboarding_checklist_profile_id_key UNIQUE (profile_id);

ALTER TABLE ONLY public.onboarding_events ADD CONSTRAINT onboarding_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.onboarding_preferences ADD CONSTRAINT onboarding_preferences_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.onboarding_preferences ADD CONSTRAINT onboarding_preferences_profile_id_key UNIQUE (profile_id);

ALTER TABLE ONLY public.onboarding_profiles ADD CONSTRAINT onboarding_profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.onboarding_profiles ADD CONSTRAINT onboarding_profiles_user_id_key UNIQUE (user_id);

ALTER TABLE ONLY public.onboarding_progress ADD CONSTRAINT onboarding_progress_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.onboarding_progress ADD CONSTRAINT onboarding_progress_profile_id_key UNIQUE (profile_id);

ALTER TABLE ONLY public.onboarding_sample_data ADD CONSTRAINT onboarding_sample_data_organization_id_entity_type_entity_i_key UNIQUE (organization_id, entity_type, entity_id);

ALTER TABLE ONLY public.onboarding_sample_data ADD CONSTRAINT onboarding_sample_data_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.onboarding_steps ADD CONSTRAINT onboarding_steps_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.onboarding_steps ADD CONSTRAINT onboarding_steps_profile_id_step_key_key UNIQUE (profile_id, step_key);

ALTER TABLE ONLY public.onboarding_tours ADD CONSTRAINT onboarding_tours_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.onboarding_tours ADD CONSTRAINT onboarding_tours_profile_id_tour_key_key UNIQUE (profile_id, tour_key);

ALTER TABLE ONLY public.organizacao_convites ADD CONSTRAINT organizacao_convites_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.organizacao_convites ADD CONSTRAINT organizacao_convites_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY public.parceiro_atribuicoes ADD CONSTRAINT parceiro_atribuicoes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.parceiro_cliques ADD CONSTRAINT parceiro_cliques_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.parceiro_comissoes ADD CONSTRAINT parceiro_comissoes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.parceiro_links ADD CONSTRAINT parceiro_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.parceiro_lote_itens ADD CONSTRAINT parceiro_lote_itens_comissao_unica UNIQUE (comissao_id);

ALTER TABLE ONLY public.parceiro_lote_itens ADD CONSTRAINT parceiro_lote_itens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.parceiro_lotes ADD CONSTRAINT parceiro_lotes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.parceiro_lotes ADD CONSTRAINT parceiro_lotes_referencia_key UNIQUE (referencia);

ALTER TABLE ONLY public.parceiro_pagamentos ADD CONSTRAINT parceiro_pagamentos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.parceiro_percentuais ADD CONSTRAINT parceiro_percentuais_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.parceiros ADD CONSTRAINT parceiros_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.plan_entitlements ADD CONSTRAINT plan_entitlements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.plan_entitlements ADD CONSTRAINT plan_entitlements_plan_id_feature_key_key UNIQUE (plan_id, feature_key);

ALTER TABLE ONLY public.plans ADD CONSTRAINT plans_code_key UNIQUE (code);

ALTER TABLE ONLY public.plans ADD CONSTRAINT plans_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pricing_campaigns ADD CONSTRAINT pricing_campaigns_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.proprietarios ADD CONSTRAINT proprietarios_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.public_request_limits ADD CONSTRAINT public_request_limits_pkey PRIMARY KEY (scope, subject_hash);

ALTER TABLE ONLY public.receita_eventos ADD CONSTRAINT receita_eventos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.repasses_proprietario ADD CONSTRAINT repasses_proprietario_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.routine_activity_log ADD CONSTRAINT routine_activity_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.routine_automation_runs ADD CONSTRAINT routine_automation_runs_organization_id_dedupe_key_key UNIQUE (organization_id, dedupe_key);

ALTER TABLE ONLY public.routine_automation_runs ADD CONSTRAINT routine_automation_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.routine_automations ADD CONSTRAINT routine_automations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.routine_entity_links ADD CONSTRAINT routine_entity_links_event_id_task_id_entity_type_entity_id_key UNIQUE (event_id, task_id, entity_type, entity_id);

ALTER TABLE ONLY public.routine_entity_links ADD CONSTRAINT routine_entity_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.routine_events ADD CONSTRAINT routine_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.routine_inbox ADD CONSTRAINT routine_inbox_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.routine_memberships ADD CONSTRAINT routine_memberships_organization_id_user_id_key UNIQUE (organization_id, user_id);

ALTER TABLE ONLY public.routine_memberships ADD CONSTRAINT routine_memberships_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.routine_organizations ADD CONSTRAINT routine_organizations_legacy_corretor_id_key UNIQUE (legacy_corretor_id);

ALTER TABLE ONLY public.routine_organizations ADD CONSTRAINT routine_organizations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.routine_preferences ADD CONSTRAINT routine_preferences_pkey PRIMARY KEY (organization_id, user_id);

ALTER TABLE ONLY public.routine_reminders ADD CONSTRAINT routine_reminders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.routine_task_checklists ADD CONSTRAINT routine_task_checklists_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.routine_tasks ADD CONSTRAINT routine_tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.subscription_addons ADD CONSTRAINT subscription_addons_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.usage_counters ADD CONSTRAINT usage_counters_corretor_id_feature_key_period_start_key UNIQUE (corretor_id, feature_key, period_start);

ALTER TABLE ONLY public.usage_counters ADD CONSTRAINT usage_counters_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.webhook_logs ADD CONSTRAINT webhook_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY suporte_privado.credenciais ADD CONSTRAINT credenciais_pkey PRIMARY KEY (sessao_id);

-- ===== Checks =====

ALTER TABLE ONLY public.ai_messages ADD CONSTRAINT ai_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text, 'tool'::text])));

ALTER TABLE ONLY public.alertas ADD CONSTRAINT alertas_entidade_tipo_check CHECK (((entidade_tipo IS NULL) OR (entidade_tipo = ANY (ARRAY['fatura'::text, 'repasse'::text, 'contrato'::text, 'cliente'::text, 'imovel'::text, 'plano'::text]))));

ALTER TABLE ONLY public.alertas ADD CONSTRAINT alertas_origem_check CHECK (((origem IS NULL) OR (origem = ANY (ARRAY['sistema'::text, 'asaas'::text, 'cron'::text, 'ia'::text]))));

ALTER TABLE ONLY public.asaas_checkout_events ADD CONSTRAINT asaas_checkout_events_attempts_check CHECK ((attempts >= 0));

ALTER TABLE ONLY public.asaas_checkout_events ADD CONSTRAINT asaas_checkout_events_status_check CHECK ((status = ANY (ARRAY['received'::text, 'processing'::text, 'processed'::text, 'ignored'::text, 'failed'::text])));

ALTER TABLE ONLY public.asaas_conexoes ADD CONSTRAINT asaas_conexoes_ambiente_check CHECK ((ambiente = ANY (ARRAY['sandbox'::text, 'producao'::text])));

ALTER TABLE ONLY public.asaas_conexoes ADD CONSTRAINT asaas_conexoes_passo_guia_valido CHECK (((passo_guia >= 1) AND (passo_guia <= 4)));

ALTER TABLE ONLY public.asaas_conexoes ADD CONSTRAINT asaas_conexoes_status_check CHECK ((status = ANY (ARRAY['nao_conectada'::text, 'conectada'::text, 'invalida'::text, 'sem_permissao'::text])));

ALTER TABLE ONLY public.asaas_webhook_events ADD CONSTRAINT asaas_webhook_events_status_check CHECK ((status = ANY (ARRAY['RECEIVED'::text, 'PROCESSING'::text, 'PROCESSED'::text, 'IGNORED'::text, 'FAILED'::text])));

ALTER TABLE ONLY public.atividade_eventos ADD CONSTRAINT atividade_eventos_tipo_check CHECK ((tipo = ANY (ARRAY['login'::text, 'sessao'::text, 'acao'::text])));

ALTER TABLE ONLY public.auditoria_financeira ADD CONSTRAINT auditoria_financeira_origem_check CHECK ((origem = ANY (ARRAY['ui'::text, 'webhook'::text, 'cron'::text, 'worker'::text, 'trigger'::text, 'migracao'::text])));

ALTER TABLE ONLY public.calendar_connections ADD CONSTRAINT calendar_connections_privacy_mode_check CHECK ((privacy_mode = ANY (ARRAY['full'::text, 'partial'::text, 'busy_only'::text])));

ALTER TABLE ONLY public.calendar_connections ADD CONSTRAINT calendar_connections_provider_check CHECK ((provider = 'google'::text));

ALTER TABLE ONLY public.calendar_connections ADD CONSTRAINT calendar_connections_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'connected'::text, 'expired'::text, 'error'::text, 'disconnected'::text])));

ALTER TABLE ONLY public.calendar_watch_channels ADD CONSTRAINT calendar_watch_channels_status_check CHECK ((status = ANY (ARRAY['active'::text, 'renewing'::text, 'expired'::text, 'stopped'::text, 'error'::text])));

ALTER TABLE ONLY public.cancelamento_feedback ADD CONSTRAINT cancelamento_feedback_identificado CHECK (((corretor_id IS NOT NULL) OR (btrim(COALESCE(contato_nome, ''::text)) <> ''::text)));

ALTER TABLE ONLY public.cancelamento_feedback ADD CONSTRAINT cancelamento_feedback_motivo_check CHECK ((motivo = ANY (ARRAY['preco_alto'::text, 'pouco_uso'::text, 'dificuldade_implantacao'::text, 'faltam_funcionalidades'::text, 'faltam_integracoes'::text, 'problemas_tecnicos'::text, 'outra_solucao'::text, 'atendimento_ruim'::text, 'encerrou_operacao'::text, 'outro'::text])));

ALTER TABLE ONLY public.cancelamento_feedback ADD CONSTRAINT cancelamento_feedback_origem_check CHECK ((origem = ANY (ARRAY['whatsapp'::text, 'suporte'::text, 'ligacao'::text, 'formulario'::text, 'sistema'::text, 'outro'::text])));

ALTER TABLE ONLY public.cancelamento_feedback ADD CONSTRAINT cancelamento_feedback_sem_pii_duplicado CHECK (((corretor_id IS NULL) OR ((contato_email IS NULL) AND (contato_telefone IS NULL))));

ALTER TABLE ONLY public.checkout_orders ADD CONSTRAINT checkout_orders_amount_check CHECK ((amount > (0)::numeric));

ALTER TABLE ONLY public.checkout_orders ADD CONSTRAINT checkout_orders_billing_cycle_check CHECK ((billing_cycle = ANY (ARRAY['monthly'::text, 'annual'::text])));

ALTER TABLE ONLY public.checkout_orders ADD CONSTRAINT checkout_orders_payment_method_check CHECK ((payment_method = ANY (ARRAY['PIX'::text, 'CREDIT_CARD'::text])));

ALTER TABLE ONLY public.checkout_orders ADD CONSTRAINT checkout_orders_plan_code_check CHECK ((plan_code = ANY (ARRAY['essencial'::text, 'profissional'::text, 'imobiliaria'::text])));

ALTER TABLE ONLY public.checkout_orders ADD CONSTRAINT checkout_orders_status_check CHECK ((status = ANY (ARRAY['creating'::text, 'awaiting_payment'::text, 'processing'::text, 'active'::text, 'failed'::text, 'overdue'::text, 'refunded'::text])));

ALTER TABLE ONLY public.commercial_diagnostic_events ADD CONSTRAINT commercial_diagnostic_events_event_check CHECK ((event = ANY (ARRAY['diagnostic_started'::text, 'profile_selected'::text, 'diagnostic_step_completed'::text, 'diagnostic_abandoned'::text, 'diagnostic_completed'::text, 'qualified_lead'::text, 'cta_clicked'::text])));

ALTER TABLE ONLY public.commercial_diagnostic_events ADD CONSTRAINT commercial_diagnostic_events_step_check CHECK (((step IS NULL) OR (length(step) <= 40)));

ALTER TABLE ONLY public.commercial_diagnostics ADD CONSTRAINT commercial_diagnostics_city_check CHECK (((city IS NULL) OR (length(city) <= 120)));

ALTER TABLE ONLY public.commercial_diagnostics ADD CONSTRAINT commercial_diagnostics_company_check CHECK (((company IS NULL) OR (length(company) <= 120)));

ALTER TABLE ONLY public.commercial_diagnostics ADD CONSTRAINT commercial_diagnostics_email_check CHECK (((email IS NULL) OR (length(email) <= 254)));

ALTER TABLE ONLY public.commercial_diagnostics ADD CONSTRAINT commercial_diagnostics_name_check CHECK (((length(name) >= 2) AND (length(name) <= 120)));

ALTER TABLE ONLY public.commercial_diagnostics ADD CONSTRAINT commercial_diagnostics_phone_check CHECK ((phone ~ '^55[1-9][0-9]{9,10}$'::text));

ALTER TABLE ONLY public.commercial_diagnostics ADD CONSTRAINT commercial_diagnostics_status_check CHECK ((status = ANY (ARRAY['novo'::text, 'em_contato'::text, 'concluido'::text])));

ALTER TABLE ONLY public.contract_quota_reservations ADD CONSTRAINT contract_quota_reservations_status_check CHECK ((status = ANY (ARRAY['reserved'::text, 'succeeded'::text, 'released'::text])));

ALTER TABLE ONLY public.contratos ADD CONSTRAINT chk_contratos_status CHECK ((status = ANY (ARRAY['RASCUNHO'::text, 'ATIVO'::text, 'VIGENTE'::text, 'ENCERRANDO'::text, 'ENCERRADO'::text, 'CANCELADO'::text, 'ARQUIVADO'::text, 'RESCINDIDO'::text]))) NOT VALID;

ALTER TABLE ONLY public.contratos_renegociacoes ADD CONSTRAINT contratos_renegociacoes_tipo_check CHECK ((tipo = ANY (ARRAY['REAJUSTE'::text, 'RENEGOCIACAO'::text, 'ACORDO_INADIMPLENCIA'::text])));

ALTER TABLE ONLY public.corretores ADD CONSTRAINT chk_corretores_creci_status CHECK ((creci_status = ANY (ARRAY['nao_informado'::text, 'informado'::text, 'aguardando_validacao'::text, 'validado'::text, 'rejeitado'::text])));

ALTER TABLE ONLY public.corretores ADD CONSTRAINT chk_corretores_status CHECK ((status = ANY (ARRAY['ativo'::text, 'suspenso'::text, 'inativo'::text])));

ALTER TABLE ONLY public.crm_etapas ADD CONSTRAINT crm_etapas_tipo_check CHECK ((tipo = ANY (ARRAY['ABERTA'::text, 'GANHO'::text, 'PERDIDO'::text])));

ALTER TABLE ONLY public.crm_oportunidades ADD CONSTRAINT crm_oportunidades_probabilidade_check CHECK (((probabilidade >= 0) AND (probabilidade <= 100)));

ALTER TABLE ONLY public.crm_tarefas ADD CONSTRAINT crm_tarefas_tipo_check CHECK ((tipo = ANY (ARRAY['LIGACAO'::text, 'WHATSAPP'::text, 'EMAIL'::text, 'REUNIAO'::text, 'VISITA'::text, 'PROPOSTA'::text, 'OUTRO'::text])));

ALTER TABLE ONLY public.external_calendars ADD CONSTRAINT external_calendars_sync_direction_check CHECK ((sync_direction = ANY (ARRAY['import_only'::text, 'export_only'::text, 'bidirectional'::text, 'disabled'::text])));

ALTER TABLE ONLY public.fachada_templates ADD CONSTRAINT fachada_templates_categoria_check CHECK ((categoria = ANY (ARRAY['VENDA'::text, 'ALUGUEL'::text, 'ALTO_PADRAO'::text, 'COMERCIAL'::text, 'RURAL'::text, 'LANCAMENTO'::text])));

ALTER TABLE ONLY public.fachadas ADD CONSTRAINT fachadas_cta_principal_check CHECK ((cta_principal = ANY (ARRAY['AGENDAR_VISITA'::text, 'WHATSAPP'::text, 'SOLICITAR_INFO'::text, 'FAZER_PROPOSTA'::text])));

ALTER TABLE ONLY public.fachadas ADD CONSTRAINT fachadas_mensagem_contato_tamanho CHECK (((mensagem_contato IS NULL) OR (char_length(mensagem_contato) <= 600)));

ALTER TABLE ONLY public.fachadas ADD CONSTRAINT fachadas_tipo_negocio_check CHECK ((tipo_negocio = ANY (ARRAY['VENDA'::text, 'ALUGUEL'::text, 'TEMPORADA'::text, 'LANCAMENTO'::text])));

ALTER TABLE ONLY public.faturas_aluguel ADD CONSTRAINT chk_faturas_status CHECK ((status = ANY (ARRAY['PENDENTE'::text, 'PAGO'::text, 'ATRASADO'::text, 'CANCELADO'::text]))) NOT VALID;

ALTER TABLE ONLY public.faturas_aluguel ADD CONSTRAINT faturas_aluguel_gerada_por_check CHECK ((gerada_por = ANY (ARRAY['manual'::text, 'cron'::text, 'ia'::text, 'migracao'::text])));

ALTER TABLE ONLY public.job_queue ADD CONSTRAINT job_queue_job_type_check CHECK ((job_type = ANY (ARRAY['ensure_customer'::text, 'create_payment'::text, 'cancel_payment'::text, 'create_transfer'::text, 'send_notification'::text, 'reconcile_payment'::text])));

ALTER TABLE ONLY public.job_queue ADD CONSTRAINT job_queue_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'RETRYING'::text, 'DONE'::text, 'FAILED'::text])));

ALTER TABLE ONLY public.lotti_agent_bridge_endpoint ADD CONSTRAINT lotti_agent_bridge_endpoint_host_check CHECK ((host ~ '^[a-z0-9-]+\.trycloudflare\.com$'::text));

ALTER TABLE ONLY public.lotti_agent_bridge_endpoint ADD CONSTRAINT lotti_agent_bridge_endpoint_id_check CHECK (id);

ALTER TABLE ONLY public.lotti_agent_channels ADD CONSTRAINT lotti_agent_channels_account_phone_check CHECK ((account_phone ~ '^[0-9]{8,15}$'::text));

ALTER TABLE ONLY public.lotti_agent_conversations ADD CONSTRAINT lotti_agent_conversation_contact_check CHECK (((phone IS NOT NULL) OR (lid IS NOT NULL)));

ALTER TABLE ONLY public.lotti_agent_conversations ADD CONSTRAINT lotti_agent_conversations_contact_name_check CHECK (((char_length(contact_name) >= 1) AND (char_length(contact_name) <= 120)));

ALTER TABLE ONLY public.lotti_agent_conversations ADD CONSTRAINT lotti_agent_conversations_contact_name_source_check CHECK ((contact_name_source = ANY (ARRAY['typed'::text, 'saved'::text, 'profile'::text])));

ALTER TABLE ONLY public.lotti_agent_conversations ADD CONSTRAINT lotti_agent_conversations_followup_step_check CHECK (((followup_step >= 0) AND (followup_step <= 10)));

ALTER TABLE ONLY public.lotti_agent_conversations ADD CONSTRAINT lotti_agent_conversations_lid_check CHECK ((lid ~ '^[0-9]{6,20}$'::text));

ALTER TABLE ONLY public.lotti_agent_conversations ADD CONSTRAINT lotti_agent_conversations_mode_check CHECK ((mode = ANY (ARRAY['ai'::text, 'human'::text, 'paused'::text])));

ALTER TABLE ONLY public.lotti_agent_conversations ADD CONSTRAINT lotti_agent_conversations_phone_check CHECK ((phone ~ '^[0-9]{8,15}$'::text));

ALTER TABLE ONLY public.lotti_agent_conversations ADD CONSTRAINT lotti_agent_conversations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])));

ALTER TABLE ONLY public.lotti_agent_messages ADD CONSTRAINT lotti_agent_messages_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text])));

ALTER TABLE ONLY public.lotti_agent_messages ADD CONSTRAINT lotti_agent_messages_sender_check CHECK ((sender = ANY (ARRAY['lead'::text, 'human'::text, 'ai'::text])));

ALTER TABLE ONLY public.lotti_agent_outbox ADD CONSTRAINT lotti_agent_outbox_status_check CHECK ((status = ANY (ARRAY['prepared'::text, 'sending'::text, 'sent'::text, 'uncertain'::text, 'cancelled'::text, 'simulated'::text])));

ALTER TABLE ONLY public.lotti_automation_heartbeat ADD CONSTRAINT lotti_automation_heartbeat_id_check CHECK ((id = 1));

ALTER TABLE ONLY public.lotti_broadcast_campaigns ADD CONSTRAINT lotti_broadcast_campaigns_body_check CHECK ((char_length(body) <= 1000));

ALTER TABLE ONLY public.lotti_broadcast_campaigns ADD CONSTRAINT lotti_broadcast_campaigns_interval_seconds_check CHECK (((interval_seconds >= 30) AND (interval_seconds <= 3600)));

ALTER TABLE ONLY public.lotti_broadcast_campaigns ADD CONSTRAINT lotti_broadcast_campaigns_max_recipients_check CHECK (((max_recipients >= 1) AND (max_recipients <= 300)));

ALTER TABLE ONLY public.lotti_broadcast_campaigns ADD CONSTRAINT lotti_broadcast_campaigns_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120)));

ALTER TABLE ONLY public.lotti_broadcast_campaigns ADD CONSTRAINT lotti_broadcast_campaigns_reply_policy_check CHECK ((reply_policy = ANY (ARRAY['ai'::text, 'human'::text, 'preserve'::text])));

ALTER TABLE ONLY public.lotti_broadcast_campaigns ADD CONSTRAINT lotti_broadcast_campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'running'::text, 'paused'::text, 'completed'::text, 'cancelled'::text])));

ALTER TABLE ONLY public.lotti_broadcast_deliveries ADD CONSTRAINT lotti_broadcast_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'skipped'::text, 'failed'::text, 'uncertain'::text, 'cancelled'::text])));

ALTER TABLE ONLY public.lotti_broadcast_events ADD CONSTRAINT lotti_broadcast_events_kind_check CHECK ((kind = ANY (ARRAY['created'::text, 'updated'::text, 'scheduled'::text, 'started'::text, 'paused'::text, 'resumed'::text, 'cancelled'::text, 'completed'::text, 'duplicated'::text])));

ALTER TABLE ONLY public.lotti_inbox_events ADD CONSTRAINT lotti_inbox_events_kind_check CHECK ((kind = ANY (ARRAY['mode'::text, 'stage'::text, 'status'::text, 'consent'::text])));

ALTER TABLE ONLY public.lotti_manual_sends ADD CONSTRAINT lotti_manual_sends_status_check CHECK ((status = ANY (ARRAY['sending'::text, 'sent'::text, 'uncertain'::text, 'failed'::text])));

ALTER TABLE ONLY public.onboarding_profiles ADD CONSTRAINT onboarding_profiles_creci_status_check CHECK ((creci_status = ANY (ARRAY['nao_informado'::text, 'informado'::text, 'aguardando_validacao'::text, 'validado'::text, 'rejeitado'::text])));

ALTER TABLE ONLY public.onboarding_profiles ADD CONSTRAINT onboarding_profiles_data_entry_strategy_check CHECK ((data_entry_strategy = ANY (ARRAY['manual'::text, 'importacao'::text, 'demonstracao'::text, 'depois'::text])));

ALTER TABLE ONLY public.onboarding_profiles ADD CONSTRAINT onboarding_profiles_persona_check CHECK ((persona = ANY (ARRAY['corretor_autonomo'::text, 'gestor_imobiliaria'::text, 'usuario_convidado'::text, 'profissional_administrativo'::text])));

ALTER TABLE ONLY public.onboarding_profiles ADD CONSTRAINT onboarding_profiles_primary_goal_check CHECK ((primary_goal = ANY (ARRAY['meus_leads'::text, 'meus_imoveis'::text, 'meu_funil'::text, 'minha_rotina'::text, 'minhas_locacoes'::text, 'meus_contratos'::text, 'minha_equipe'::text, 'todo_negocio'::text])));

ALTER TABLE ONLY public.onboarding_sample_data ADD CONSTRAINT onboarding_sample_data_entity_type_check CHECK ((entity_type = ANY (ARRAY['imovel'::text, 'cliente'::text, 'oportunidade'::text, 'tarefa'::text])));

ALTER TABLE ONLY public.onboarding_steps ADD CONSTRAINT onboarding_steps_status_check CHECK ((status = ANY (ARRAY['iniciado'::text, 'concluido'::text, 'pulado'::text, 'erro'::text])));

ALTER TABLE ONLY public.organizacao_convites ADD CONSTRAINT organizacao_convites_papel_check CHECK ((papel = ANY (ARRAY['gestor'::text, 'corretor'::text, 'financeiro'::text, 'juridico'::text, 'locacoes'::text, 'marketing'::text, 'suporte'::text])));

ALTER TABLE ONLY public.organizacao_convites ADD CONSTRAINT organizacao_convites_status_check CHECK ((status = ANY (ARRAY['pendente'::text, 'aceito'::text, 'revogado'::text, 'expirado'::text])));

ALTER TABLE ONLY public.parceiro_atribuicoes ADD CONSTRAINT parceiro_atribuicoes_janela_dias_check CHECK (((janela_dias >= 1) AND (janela_dias <= 730)));

ALTER TABLE ONLY public.parceiro_atribuicoes ADD CONSTRAINT parceiro_atribuicoes_modelo_check CHECK ((modelo = ANY (ARRAY['primeiro_clique'::text, 'ultimo_clique'::text])));

ALTER TABLE ONLY public.parceiro_atribuicoes ADD CONSTRAINT parceiro_atribuicoes_status_check CHECK ((status = ANY (ARRAY['pendente'::text, 'convertida'::text, 'expirada'::text, 'invalidada'::text])));

ALTER TABLE ONLY public.parceiro_comissoes ADD CONSTRAINT parceiro_comissoes_percentual_aplicado_check CHECK (((percentual_aplicado >= (0)::numeric) AND (percentual_aplicado <= (100)::numeric)));

ALTER TABLE ONLY public.parceiro_comissoes ADD CONSTRAINT parceiro_comissoes_status_check CHECK ((status = ANY (ARRAY['pendente'::text, 'em_validacao'::text, 'aprovada'::text, 'paga'::text, 'cancelada'::text, 'estornada'::text])));

ALTER TABLE ONLY public.parceiro_comissoes ADD CONSTRAINT parceiro_comissoes_valor_base_check CHECK ((valor_base >= (0)::numeric));

ALTER TABLE ONLY public.parceiro_comissoes ADD CONSTRAINT parceiro_comissoes_valor_comissao_check CHECK ((valor_comissao >= (0)::numeric));

ALTER TABLE ONLY public.parceiro_links ADD CONSTRAINT parceiro_links_slug_check CHECK ((slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'::text));

ALTER TABLE ONLY public.parceiro_lote_itens ADD CONSTRAINT parceiro_lote_itens_valor_check CHECK ((valor >= (0)::numeric));

ALTER TABLE ONLY public.parceiro_lotes ADD CONSTRAINT parceiro_lotes_status_check CHECK ((status = ANY (ARRAY['rascunho'::text, 'exportado'::text, 'pago'::text, 'falhou'::text, 'cancelado'::text])));

ALTER TABLE ONLY public.parceiro_lotes ADD CONSTRAINT parceiro_lotes_total_comissoes_check CHECK ((total_comissoes >= 0));

ALTER TABLE ONLY public.parceiro_lotes ADD CONSTRAINT parceiro_lotes_total_parceiros_check CHECK ((total_parceiros >= 0));

ALTER TABLE ONLY public.parceiro_lotes ADD CONSTRAINT parceiro_lotes_valor_total_check CHECK ((valor_total >= (0)::numeric));

ALTER TABLE ONLY public.parceiro_pagamentos ADD CONSTRAINT parceiro_pagamentos_valor_total_check CHECK ((valor_total > (0)::numeric));

ALTER TABLE ONLY public.parceiro_percentuais ADD CONSTRAINT chk_valor_fixo_coerente CHECK ((((base_calculo = 'valor_fixo'::text) AND (valor_fixo IS NOT NULL)) OR (base_calculo <> 'valor_fixo'::text)));

ALTER TABLE ONLY public.parceiro_percentuais ADD CONSTRAINT chk_vigencia_ordem CHECK (((vigencia_fim IS NULL) OR (vigencia_fim >= vigencia_inicio)));

ALTER TABLE ONLY public.parceiro_percentuais ADD CONSTRAINT parceiro_percentuais_base_calculo_check CHECK ((base_calculo = ANY (ARRAY['receita_bruta'::text, 'receita_liquida'::text, 'primeiro_pagamento'::text, 'valor_fixo'::text])));

ALTER TABLE ONLY public.parceiro_percentuais ADD CONSTRAINT parceiro_percentuais_percentual_check CHECK (((percentual >= (0)::numeric) AND (percentual <= (100)::numeric)));

ALTER TABLE ONLY public.parceiro_percentuais ADD CONSTRAINT parceiro_percentuais_teto_renovacoes_check CHECK (((teto_renovacoes IS NULL) OR (teto_renovacoes >= 0)));

ALTER TABLE ONLY public.parceiro_percentuais ADD CONSTRAINT parceiro_percentuais_valor_fixo_check CHECK (((valor_fixo IS NULL) OR (valor_fixo >= (0)::numeric)));

ALTER TABLE ONLY public.parceiros ADD CONSTRAINT parceiros_convite_status_check CHECK ((convite_status = ANY (ARRAY['nao_enviado'::text, 'enviado'::text, 'aceito'::text, 'falhou'::text])));

ALTER TABLE ONLY public.parceiros ADD CONSTRAINT parceiros_cortesia_dias_valida CHECK (((cortesia_dias IS NULL) OR ((cortesia_dias > 0) AND (cortesia_dias <= 365))));

ALTER TABLE ONLY public.parceiros ADD CONSTRAINT parceiros_email_check CHECK ((email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text));

ALTER TABLE ONLY public.parceiros ADD CONSTRAINT parceiros_janela_atribuicao_dias_check CHECK (((janela_atribuicao_dias >= 1) AND (janela_atribuicao_dias <= 730)));

ALTER TABLE ONLY public.parceiros ADD CONSTRAINT parceiros_nome_check CHECK ((length(btrim(nome)) >= 2));

ALTER TABLE ONLY public.parceiros ADD CONSTRAINT parceiros_pix_completo CHECK (((chave_pix IS NULL) OR (tipo_chave_pix IS NOT NULL)));

ALTER TABLE ONLY public.parceiros ADD CONSTRAINT parceiros_status_check CHECK ((status = ANY (ARRAY['ativo'::text, 'inativo'::text, 'suspenso'::text, 'encerrado'::text])));

ALTER TABLE ONLY public.parceiros ADD CONSTRAINT parceiros_tipo_chave_pix_valido CHECK (((tipo_chave_pix IS NULL) OR (tipo_chave_pix = ANY (ARRAY['cpf'::text, 'cnpj'::text, 'email'::text, 'telefone'::text, 'aleatoria'::text]))));

ALTER TABLE ONLY public.parceiros ADD CONSTRAINT parceiros_tipo_valido CHECK (((tipo IS NULL) OR (tipo = ANY (ARRAY['afiliado'::text, 'influenciador'::text, 'consultor'::text, 'comercial'::text]))));

ALTER TABLE ONLY public.proprietarios ADD CONSTRAINT proprietarios_tipo_chave_pix_check CHECK ((tipo_chave_pix = ANY (ARRAY['CPF'::text, 'CNPJ'::text, 'EMAIL'::text, 'PHONE'::text, 'EVP'::text])));

ALTER TABLE ONLY public.public_request_limits ADD CONSTRAINT public_request_limits_hits_check CHECK ((hits > 0));

ALTER TABLE ONLY public.receita_eventos ADD CONSTRAINT chk_manual_sem_external CHECK (((origem <> 'manual_admin'::text) OR (external_id IS NULL)));

ALTER TABLE ONLY public.receita_eventos ADD CONSTRAINT receita_eventos_origem_check CHECK ((origem = ANY (ARRAY['manual_admin'::text, 'asaas'::text, 'stripe'::text])));

ALTER TABLE ONLY public.receita_eventos ADD CONSTRAINT receita_eventos_status_check CHECK ((status = ANY (ARRAY['confirmado'::text, 'estornado'::text, 'cancelado'::text])));

ALTER TABLE ONLY public.receita_eventos ADD CONSTRAINT receita_eventos_tipo_check CHECK ((tipo = ANY (ARRAY['assinatura'::text, 'addon'::text, 'avulso'::text])));

ALTER TABLE ONLY public.receita_eventos ADD CONSTRAINT receita_eventos_valor_bruto_check CHECK ((valor_bruto > (0)::numeric));

ALTER TABLE ONLY public.receita_eventos ADD CONSTRAINT receita_eventos_valor_liquido_check CHECK (((valor_liquido IS NULL) OR (valor_liquido >= (0)::numeric)));

ALTER TABLE ONLY public.routine_automation_runs ADD CONSTRAINT routine_automation_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text, 'skipped'::text])));

ALTER TABLE ONLY public.routine_automations ADD CONSTRAINT routine_automations_action_type_check CHECK ((action_type = ANY (ARRAY['task'::text, 'event'::text, 'reminder'::text, 'suggestion'::text])));

ALTER TABLE ONLY public.routine_entity_links ADD CONSTRAINT routine_entity_links_check CHECK (((((event_id IS NOT NULL))::integer + ((task_id IS NOT NULL))::integer) = 1));

ALTER TABLE ONLY public.routine_entity_links ADD CONSTRAINT routine_entity_links_entity_type_check CHECK ((entity_type = ANY (ARRAY['client'::text, 'lead'::text, 'property'::text, 'deal'::text, 'stage'::text, 'proposal'::text, 'contract'::text, 'rental'::text, 'charge'::text, 'user'::text, 'team'::text, 'unit'::text])));

ALTER TABLE ONLY public.routine_events ADD CONSTRAINT routine_events_check CHECK ((end_at > start_at));

ALTER TABLE ONLY public.routine_events ADD CONSTRAINT routine_events_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text])));

ALTER TABLE ONLY public.routine_events ADD CONSTRAINT routine_events_source_check CHECK ((source = ANY (ARRAY['lotti'::text, 'google'::text, 'automation'::text, 'ai'::text, 'other_user'::text])));

ALTER TABLE ONLY public.routine_events ADD CONSTRAINT routine_events_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending_confirmation'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text])));

ALTER TABLE ONLY public.routine_events ADD CONSTRAINT routine_events_sync_status_check CHECK ((sync_status = ANY (ARRAY['local'::text, 'pending'::text, 'synced'::text, 'conflict'::text, 'error'::text])));

ALTER TABLE ONLY public.routine_events ADD CONSTRAINT routine_events_title_check CHECK (((char_length(TRIM(BOTH FROM title)) >= 1) AND (char_length(TRIM(BOTH FROM title)) <= 180)));

ALTER TABLE ONLY public.routine_events ADD CONSTRAINT routine_events_visibility_check CHECK ((visibility = ANY (ARRAY['team'::text, 'private'::text])));

ALTER TABLE ONLY public.routine_inbox ADD CONSTRAINT routine_inbox_kind_check CHECK ((kind = ANY (ARRAY['idea'::text, 'note'::text, 'request'::text, 'task'::text, 'audio'::text, 'message'::text, 'service_extract'::text])));

ALTER TABLE ONLY public.routine_inbox ADD CONSTRAINT routine_inbox_status_check CHECK ((status = ANY (ARRAY['unprocessed'::text, 'proposed'::text, 'converted'::text, 'archived'::text])));

ALTER TABLE ONLY public.routine_memberships ADD CONSTRAINT routine_memberships_role_check CHECK ((role = ANY (ARRAY['proprietario'::text, 'administrador'::text, 'gestor'::text, 'corretor'::text, 'financeiro'::text, 'juridico'::text, 'colaborador'::text])));

ALTER TABLE ONLY public.routine_memberships ADD CONSTRAINT routine_memberships_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'suspended'::text, 'revoked'::text])));

ALTER TABLE ONLY public.routine_organizations ADD CONSTRAINT chk_routine_organization_type CHECK ((organization_type = ANY (ARRAY['individual'::text, 'imobiliaria'::text, 'construtora_loteadora'::text])));

ALTER TABLE ONLY public.routine_preferences ADD CONSTRAINT routine_preferences_default_event_minutes_check CHECK (((default_event_minutes >= 15) AND (default_event_minutes <= 480)));

ALTER TABLE ONLY public.routine_preferences ADD CONSTRAINT routine_preferences_default_reminder_minutes_check CHECK (((default_reminder_minutes >= 0) AND (default_reminder_minutes <= 10080)));

ALTER TABLE ONLY public.routine_preferences ADD CONSTRAINT routine_preferences_default_view_check CHECK ((default_view = ANY (ARRAY['day'::text, 'week'::text, 'month'::text, 'list'::text])));

ALTER TABLE ONLY public.routine_reminders ADD CONSTRAINT routine_reminders_channel_check CHECK ((channel = ANY (ARRAY['in_app'::text, 'email'::text, 'whatsapp'::text, 'push'::text])));

ALTER TABLE ONLY public.routine_reminders ADD CONSTRAINT routine_reminders_check CHECK (((((event_id IS NOT NULL))::integer + ((task_id IS NOT NULL))::integer) = 1));

ALTER TABLE ONLY public.routine_reminders ADD CONSTRAINT routine_reminders_minutes_before_check CHECK (((minutes_before IS NULL) OR ((minutes_before >= 0) AND (minutes_before <= 525600))));

ALTER TABLE ONLY public.routine_reminders ADD CONSTRAINT routine_reminders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'cancelled'::text])));

ALTER TABLE ONLY public.routine_tasks ADD CONSTRAINT routine_tasks_estimated_minutes_check CHECK (((estimated_minutes IS NULL) OR ((estimated_minutes >= 5) AND (estimated_minutes <= 1440))));

ALTER TABLE ONLY public.routine_tasks ADD CONSTRAINT routine_tasks_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text])));

ALTER TABLE ONLY public.routine_tasks ADD CONSTRAINT routine_tasks_source_check CHECK ((source = ANY (ARRAY['lotti'::text, 'google'::text, 'automation'::text, 'ai'::text, 'other_user'::text, 'inbox'::text])));

ALTER TABLE ONLY public.routine_tasks ADD CONSTRAINT routine_tasks_status_check CHECK ((status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text])));

ALTER TABLE ONLY public.routine_tasks ADD CONSTRAINT routine_tasks_title_check CHECK (((char_length(TRIM(BOTH FROM title)) >= 1) AND (char_length(TRIM(BOTH FROM title)) <= 180)));

ALTER TABLE ONLY public.routine_tasks ADD CONSTRAINT routine_tasks_visibility_check CHECK ((visibility = ANY (ARRAY['team'::text, 'private'::text])));

-- ===== Chaves estrangeiras =====

ALTER TABLE ONLY public.admin_auditoria ADD CONSTRAINT admin_auditoria_ator_user_id_fkey FOREIGN KEY (ator_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.admin_config ADD CONSTRAINT admin_config_atualizado_por_fkey FOREIGN KEY (atualizado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.admin_sessoes_suporte ADD CONSTRAINT admin_sessoes_suporte_ator_user_id_fkey FOREIGN KEY (ator_user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.admin_sessoes_suporte ADD CONSTRAINT admin_sessoes_suporte_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id);

ALTER TABLE ONLY public.admin_sessoes_suporte ADD CONSTRAINT admin_sessoes_suporte_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.ai_attachments ADD CONSTRAINT ai_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.ai_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ai_conversations ADD CONSTRAINT ai_conversations_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ai_messages ADD CONSTRAINT ai_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.ai_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ai_rate_limits ADD CONSTRAINT ai_rate_limits_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.alertas ADD CONSTRAINT alertas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.alertas ADD CONSTRAINT alertas_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.asaas_conexao_segredos ADD CONSTRAINT asaas_conexao_segredos_conexao_id_fkey FOREIGN KEY (conexao_id) REFERENCES public.asaas_conexoes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.asaas_conexoes ADD CONSTRAINT asaas_conexoes_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.asaas_webhook_events ADD CONSTRAINT asaas_webhook_events_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.atividade_eventos ADD CONSTRAINT atividade_eventos_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.atividade_eventos ADD CONSTRAINT atividade_eventos_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.billing_legacy_accounts ADD CONSTRAINT billing_legacy_accounts_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id);

ALTER TABLE ONLY public.calendar_connections ADD CONSTRAINT calendar_connections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.routine_organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.calendar_connections ADD CONSTRAINT calendar_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.calendar_event_mappings ADD CONSTRAINT calendar_event_mappings_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.calendar_connections(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.calendar_event_mappings ADD CONSTRAINT calendar_event_mappings_external_calendar_id_fkey FOREIGN KEY (external_calendar_id) REFERENCES public.external_calendars(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.calendar_event_mappings ADD CONSTRAINT calendar_event_mappings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.routine_organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.calendar_event_mappings ADD CONSTRAINT calendar_event_mappings_routine_event_id_fkey FOREIGN KEY (routine_event_id) REFERENCES public.routine_events(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.calendar_sync_states ADD CONSTRAINT calendar_sync_states_external_calendar_id_fkey FOREIGN KEY (external_calendar_id) REFERENCES public.external_calendars(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.calendar_watch_channels ADD CONSTRAINT calendar_watch_channels_external_calendar_id_fkey FOREIGN KEY (external_calendar_id) REFERENCES public.external_calendars(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.cancelamento_feedback ADD CONSTRAINT cancelamento_feedback_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.cancelamento_feedback ADD CONSTRAINT cancelamento_feedback_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.checkout_orders ADD CONSTRAINT checkout_orders_provisioned_user_id_fkey FOREIGN KEY (provisioned_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.checkout_payments ADD CONSTRAINT checkout_payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.checkout_orders(id);

ALTER TABLE ONLY public.cliente_imovel ADD CONSTRAINT cliente_imovel_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.cliente_imovel ADD CONSTRAINT cliente_imovel_imovel_id_fkey FOREIGN KEY (imovel_id) REFERENCES public.imoveis(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.clientes ADD CONSTRAINT clientes_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.contract_quota_reservations ADD CONSTRAINT contract_quota_reservations_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id);

ALTER TABLE ONLY public.contratos ADD CONSTRAINT contratos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.contratos ADD CONSTRAINT contratos_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.contratos ADD CONSTRAINT contratos_imovel_id_fkey FOREIGN KEY (imovel_id) REFERENCES public.imoveis(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.contratos_renegociacoes ADD CONSTRAINT contratos_renegociacoes_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.contratos_renegociacoes ADD CONSTRAINT contratos_renegociacoes_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.corretores ADD CONSTRAINT corretores_suspenso_por_fkey FOREIGN KEY (suspenso_por) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.corretores ADD CONSTRAINT corretores_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.crm_etapas ADD CONSTRAINT crm_etapas_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.crm_oportunidades ADD CONSTRAINT crm_oportunidades_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.crm_oportunidades ADD CONSTRAINT crm_oportunidades_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.crm_oportunidades ADD CONSTRAINT crm_oportunidades_etapa_id_fkey FOREIGN KEY (etapa_id) REFERENCES public.crm_etapas(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.crm_oportunidades ADD CONSTRAINT crm_oportunidades_imovel_id_fkey FOREIGN KEY (imovel_id) REFERENCES public.imoveis(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.crm_tarefas ADD CONSTRAINT crm_tarefas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.crm_tarefas ADD CONSTRAINT crm_tarefas_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.crm_tarefas ADD CONSTRAINT crm_tarefas_oportunidade_id_fkey FOREIGN KEY (oportunidade_id) REFERENCES public.crm_oportunidades(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.documentos ADD CONSTRAINT documentos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.documentos ADD CONSTRAINT documentos_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.documentos ADD CONSTRAINT documentos_imovel_id_fkey FOREIGN KEY (imovel_id) REFERENCES public.imoveis(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.external_calendars ADD CONSTRAINT external_calendars_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.calendar_connections(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.external_calendars ADD CONSTRAINT external_calendars_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.routine_organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.external_calendars ADD CONSTRAINT external_calendars_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.fachada_escaneamentos ADD CONSTRAINT fachada_escaneamentos_fachada_id_fkey FOREIGN KEY (fachada_id) REFERENCES public.fachadas(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.fachada_leads ADD CONSTRAINT fachada_leads_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.fachada_leads ADD CONSTRAINT fachada_leads_fachada_id_fkey FOREIGN KEY (fachada_id) REFERENCES public.fachadas(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.fachada_templates ADD CONSTRAINT fachada_templates_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.fachadas ADD CONSTRAINT fachadas_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.fachadas ADD CONSTRAINT fachadas_imovel_id_fkey FOREIGN KEY (imovel_id) REFERENCES public.imoveis(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.faturas_aluguel ADD CONSTRAINT faturas_aluguel_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.faturas_aluguel ADD CONSTRAINT faturas_aluguel_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.faturas_aluguel ADD CONSTRAINT faturas_aluguel_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.faturas_aluguel ADD CONSTRAINT faturas_aluguel_imovel_id_fkey FOREIGN KEY (imovel_id) REFERENCES public.imoveis(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.historico_contatos ADD CONSTRAINT historico_contatos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.imoveis ADD CONSTRAINT imoveis_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.imoveis ADD CONSTRAINT imoveis_proprietario_id_fkey FOREIGN KEY (proprietario_id) REFERENCES public.proprietarios(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.imovel_fotos ADD CONSTRAINT imovel_fotos_imovel_id_fkey FOREIGN KEY (imovel_id) REFERENCES public.imoveis(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.job_queue ADD CONSTRAINT job_queue_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lancamentos_financeiros ADD CONSTRAINT lancamentos_financeiros_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.lancamentos_financeiros ADD CONSTRAINT lancamentos_financeiros_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lancamentos_financeiros ADD CONSTRAINT lancamentos_financeiros_fatura_id_fkey FOREIGN KEY (fatura_id) REFERENCES public.faturas_aluguel(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.lancamentos_financeiros ADD CONSTRAINT lancamentos_financeiros_imovel_id_fkey FOREIGN KEY (imovel_id) REFERENCES public.imoveis(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.leads_sem_destino ADD CONSTRAINT leads_sem_destino_atribuido_a_fkey FOREIGN KEY (atribuido_a) REFERENCES public.corretores(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.lotti_agent_channels ADD CONSTRAINT lotti_agent_channels_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lotti_agent_conversations ADD CONSTRAINT lotti_agent_conversations_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.lotti_agent_channels(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lotti_agent_conversations ADD CONSTRAINT lotti_agent_conversations_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.lotti_agent_conversations ADD CONSTRAINT lotti_agent_conversations_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lotti_agent_messages ADD CONSTRAINT lotti_agent_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.lotti_agent_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lotti_agent_outbox ADD CONSTRAINT lotti_agent_outbox_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.lotti_agent_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lotti_agent_settings ADD CONSTRAINT lotti_agent_settings_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lotti_agent_usage ADD CONSTRAINT lotti_agent_usage_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lotti_broadcast_campaigns ADD CONSTRAINT lotti_broadcast_campaigns_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lotti_broadcast_deliveries ADD CONSTRAINT lotti_broadcast_deliveries_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.lotti_broadcast_campaigns(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lotti_broadcast_deliveries ADD CONSTRAINT lotti_broadcast_deliveries_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.lotti_agent_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lotti_broadcast_deliveries ADD CONSTRAINT lotti_broadcast_deliveries_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lotti_broadcast_events ADD CONSTRAINT lotti_broadcast_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.lotti_broadcast_campaigns(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lotti_inbox_events ADD CONSTRAINT lotti_inbox_events_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.lotti_agent_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lotti_manual_sends ADD CONSTRAINT lotti_manual_sends_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.lotti_agent_conversations(id);

ALTER TABLE ONLY public.lotti_manual_sends ADD CONSTRAINT lotti_manual_sends_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id);

ALTER TABLE ONLY public.onboarding_checklist ADD CONSTRAINT onboarding_checklist_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.onboarding_profiles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.onboarding_events ADD CONSTRAINT onboarding_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.routine_organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.onboarding_events ADD CONSTRAINT onboarding_events_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.onboarding_profiles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.onboarding_events ADD CONSTRAINT onboarding_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.onboarding_preferences ADD CONSTRAINT onboarding_preferences_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.onboarding_profiles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.onboarding_profiles ADD CONSTRAINT onboarding_profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.routine_organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.onboarding_profiles ADD CONSTRAINT onboarding_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.onboarding_progress ADD CONSTRAINT onboarding_progress_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.onboarding_profiles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.onboarding_sample_data ADD CONSTRAINT onboarding_sample_data_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.routine_organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.onboarding_sample_data ADD CONSTRAINT onboarding_sample_data_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.onboarding_steps ADD CONSTRAINT onboarding_steps_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.onboarding_profiles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.onboarding_tours ADD CONSTRAINT onboarding_tours_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.onboarding_profiles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.organizacao_convites ADD CONSTRAINT organizacao_convites_aceito_por_fkey FOREIGN KEY (aceito_por) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.organizacao_convites ADD CONSTRAINT organizacao_convites_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.organizacao_convites ADD CONSTRAINT organizacao_convites_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.routine_organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.parceiro_atribuicoes ADD CONSTRAINT parceiro_atribuicoes_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.parceiro_atribuicoes ADD CONSTRAINT parceiro_atribuicoes_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.parceiro_links(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.parceiro_atribuicoes ADD CONSTRAINT parceiro_atribuicoes_parceiro_id_fkey FOREIGN KEY (parceiro_id) REFERENCES public.parceiros(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.parceiro_atribuicoes ADD CONSTRAINT parceiro_atribuicoes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.parceiro_cliques ADD CONSTRAINT parceiro_cliques_link_id_fkey FOREIGN KEY (link_id) REFERENCES public.parceiro_links(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.parceiro_cliques ADD CONSTRAINT parceiro_cliques_parceiro_id_fkey FOREIGN KEY (parceiro_id) REFERENCES public.parceiros(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.parceiro_comissoes ADD CONSTRAINT parceiro_comissoes_aprovada_por_fkey FOREIGN KEY (aprovada_por) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.parceiro_comissoes ADD CONSTRAINT parceiro_comissoes_atribuicao_id_fkey FOREIGN KEY (atribuicao_id) REFERENCES public.parceiro_atribuicoes(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.parceiro_comissoes ADD CONSTRAINT parceiro_comissoes_cancelada_por_fkey FOREIGN KEY (cancelada_por) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.parceiro_comissoes ADD CONSTRAINT parceiro_comissoes_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.parceiro_comissoes ADD CONSTRAINT parceiro_comissoes_pagamento_id_fkey FOREIGN KEY (pagamento_id) REFERENCES public.parceiro_pagamentos(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.parceiro_comissoes ADD CONSTRAINT parceiro_comissoes_parceiro_id_fkey FOREIGN KEY (parceiro_id) REFERENCES public.parceiros(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.parceiro_comissoes ADD CONSTRAINT parceiro_comissoes_percentual_id_fkey FOREIGN KEY (percentual_id) REFERENCES public.parceiro_percentuais(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.parceiro_comissoes ADD CONSTRAINT parceiro_comissoes_receita_evento_id_fkey FOREIGN KEY (receita_evento_id) REFERENCES public.receita_eventos(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.parceiro_links ADD CONSTRAINT parceiro_links_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.parceiro_links ADD CONSTRAINT parceiro_links_parceiro_id_fkey FOREIGN KEY (parceiro_id) REFERENCES public.parceiros(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.parceiro_lote_itens ADD CONSTRAINT parceiro_lote_itens_comissao_id_fkey FOREIGN KEY (comissao_id) REFERENCES public.parceiro_comissoes(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.parceiro_lote_itens ADD CONSTRAINT parceiro_lote_itens_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.parceiro_lotes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.parceiro_lote_itens ADD CONSTRAINT parceiro_lote_itens_parceiro_id_fkey FOREIGN KEY (parceiro_id) REFERENCES public.parceiros(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.parceiro_lotes ADD CONSTRAINT parceiro_lotes_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.parceiro_pagamentos ADD CONSTRAINT parceiro_pagamentos_parceiro_id_fkey FOREIGN KEY (parceiro_id) REFERENCES public.parceiros(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.parceiro_pagamentos ADD CONSTRAINT parceiro_pagamentos_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.parceiro_percentuais ADD CONSTRAINT parceiro_percentuais_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.parceiro_percentuais ADD CONSTRAINT parceiro_percentuais_parceiro_id_fkey FOREIGN KEY (parceiro_id) REFERENCES public.parceiros(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.parceiros ADD CONSTRAINT parceiros_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.parceiros ADD CONSTRAINT parceiros_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.plan_entitlements ADD CONSTRAINT plan_entitlements_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.proprietarios ADD CONSTRAINT proprietarios_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.receita_eventos ADD CONSTRAINT receita_eventos_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.receita_eventos ADD CONSTRAINT receita_eventos_estornado_por_fkey FOREIGN KEY (estornado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.receita_eventos ADD CONSTRAINT receita_eventos_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.repasses_proprietario ADD CONSTRAINT repasses_proprietario_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.repasses_proprietario ADD CONSTRAINT repasses_proprietario_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.repasses_proprietario ADD CONSTRAINT repasses_proprietario_fatura_origem_id_fkey FOREIGN KEY (fatura_origem_id) REFERENCES public.faturas_aluguel(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.repasses_proprietario ADD CONSTRAINT repasses_proprietario_proprietario_id_fkey FOREIGN KEY (proprietario_id) REFERENCES public.proprietarios(id);

ALTER TABLE ONLY public.routine_activity_log ADD CONSTRAINT routine_activity_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.routine_activity_log ADD CONSTRAINT routine_activity_log_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.routine_organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_automation_runs ADD CONSTRAINT routine_automation_runs_automation_id_fkey FOREIGN KEY (automation_id) REFERENCES public.routine_automations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_automation_runs ADD CONSTRAINT routine_automation_runs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.routine_organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_automations ADD CONSTRAINT routine_automations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.routine_automations ADD CONSTRAINT routine_automations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.routine_organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_entity_links ADD CONSTRAINT routine_entity_links_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.routine_events(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_entity_links ADD CONSTRAINT routine_entity_links_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.routine_organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_entity_links ADD CONSTRAINT routine_entity_links_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.routine_tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_events ADD CONSTRAINT routine_events_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.routine_events ADD CONSTRAINT routine_events_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clientes(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.routine_events ADD CONSTRAINT routine_events_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contratos(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.routine_events ADD CONSTRAINT routine_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.routine_events ADD CONSTRAINT routine_events_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.crm_oportunidades(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.routine_events ADD CONSTRAINT routine_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.routine_organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_events ADD CONSTRAINT routine_events_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.imoveis(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.routine_events ADD CONSTRAINT routine_events_rental_id_fkey FOREIGN KEY (rental_id) REFERENCES public.contratos(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.routine_inbox ADD CONSTRAINT routine_inbox_converted_event_id_fkey FOREIGN KEY (converted_event_id) REFERENCES public.routine_events(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.routine_inbox ADD CONSTRAINT routine_inbox_converted_task_id_fkey FOREIGN KEY (converted_task_id) REFERENCES public.routine_tasks(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.routine_inbox ADD CONSTRAINT routine_inbox_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.routine_organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_inbox ADD CONSTRAINT routine_inbox_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_memberships ADD CONSTRAINT routine_memberships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.routine_organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_memberships ADD CONSTRAINT routine_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_organizations ADD CONSTRAINT routine_organizations_legacy_corretor_id_fkey FOREIGN KEY (legacy_corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_preferences ADD CONSTRAINT routine_preferences_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.routine_organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_preferences ADD CONSTRAINT routine_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_reminders ADD CONSTRAINT routine_reminders_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.routine_events(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_reminders ADD CONSTRAINT routine_reminders_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.routine_organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_reminders ADD CONSTRAINT routine_reminders_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.routine_tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_reminders ADD CONSTRAINT routine_reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_task_checklists ADD CONSTRAINT routine_task_checklists_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.routine_tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_tasks ADD CONSTRAINT routine_tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.routine_tasks ADD CONSTRAINT routine_tasks_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clientes(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.routine_tasks ADD CONSTRAINT routine_tasks_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contratos(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.routine_tasks ADD CONSTRAINT routine_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.routine_tasks ADD CONSTRAINT routine_tasks_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.crm_oportunidades(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.routine_tasks ADD CONSTRAINT routine_tasks_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.routine_organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_tasks ADD CONSTRAINT routine_tasks_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.imoveis(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.routine_tasks ADD CONSTRAINT routine_tasks_rental_id_fkey FOREIGN KEY (rental_id) REFERENCES public.contratos(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.subscription_addons ADD CONSTRAINT subscription_addons_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subscription_addons ADD CONSTRAINT subscription_addons_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id);

ALTER TABLE ONLY public.usage_counters ADD CONSTRAINT usage_counters_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES public.corretores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_roles ADD CONSTRAINT user_roles_concedido_por_fkey FOREIGN KEY (concedido_por) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.user_roles ADD CONSTRAINT user_roles_revogado_por_fkey FOREIGN KEY (revogado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.user_roles ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY suporte_privado.credenciais ADD CONSTRAINT credenciais_sessao_id_fkey FOREIGN KEY (sessao_id) REFERENCES public.admin_sessoes_suporte(id);

-- ===== Índices =====

CREATE INDEX alertas_ia_conversation_unread_idx ON public.alertas USING btree (((metadata ->> 'conversation_id'::text))) WHERE ((origem = 'ia'::text) AND (lido IS NOT TRUE));

CREATE INDEX cancelamento_feedback_corretor_idx ON public.cancelamento_feedback USING btree (corretor_id) WHERE (corretor_id IS NOT NULL);

CREATE INDEX cancelamento_feedback_data_idx ON public.cancelamento_feedback USING btree (data_cancelamento DESC);

CREATE INDEX cancelamento_feedback_motivo_idx ON public.cancelamento_feedback USING btree (motivo, data_cancelamento DESC);

CREATE INDEX checkout_orders_email_idx ON public.checkout_orders USING btree (lower(payer_email), created_at DESC);

CREATE INDEX checkout_orders_payment_idx ON public.checkout_orders USING btree (asaas_payment_id) WHERE (asaas_payment_id IS NOT NULL);

CREATE INDEX checkout_rate_limits_bucket_idx ON public.checkout_rate_limits USING btree (bucket);

CREATE INDEX clientes_corretor_phone_key_idx ON public.clientes USING btree (corretor_id, public.lotti_phone_key(telefone));

CREATE INDEX commercial_diagnostic_events_funnel_idx ON public.commercial_diagnostic_events USING btree (event, step, created_at DESC);

CREATE INDEX commercial_diagnostic_events_session_idx ON public.commercial_diagnostic_events USING btree (session_id, created_at);

CREATE INDEX commercial_diagnostics_created_idx ON public.commercial_diagnostics USING btree (created_at DESC);

CREATE INDEX commercial_diagnostics_status_idx ON public.commercial_diagnostics USING btree (status, created_at DESC);

CREATE INDEX idx_admin_auditoria_ator ON public.admin_auditoria USING btree (ator_user_id, criado_em DESC);

CREATE INDEX idx_admin_auditoria_data ON public.admin_auditoria USING btree (criado_em DESC);

CREATE INDEX idx_admin_auditoria_entidade ON public.admin_auditoria USING btree (entidade, entidade_id, criado_em DESC);

CREATE INDEX idx_ai_attachments_message ON public.ai_attachments USING btree (message_id);

CREATE INDEX idx_ai_conversations_pinned ON public.ai_conversations USING btree (corretor_id, pinned DESC, updated_at DESC);

CREATE INDEX idx_ai_messages_conversation ON public.ai_messages USING btree (conversation_id, created_at);

CREATE INDEX idx_alertas_corretor_lido ON public.alertas USING btree (corretor_id, lido, created_at DESC);

CREATE INDEX idx_alertas_corretor_nao_lidos ON public.alertas USING btree (corretor_id, lido, created_at DESC);

CREATE INDEX idx_alertas_entidade ON public.alertas USING btree (entidade_tipo, entidade_id);

CREATE INDEX idx_asaas_conexoes_webhook_slug ON public.asaas_conexoes USING btree (webhook_slug);

CREATE INDEX idx_atividade_corretor ON public.atividade_eventos USING btree (corretor_id, criado_em DESC);

CREATE INDEX idx_atividade_data ON public.atividade_eventos USING btree (criado_em DESC);

CREATE INDEX idx_atribuicoes_parceiro ON public.parceiro_atribuicoes USING btree (parceiro_id, status, criado_em DESC);

CREATE INDEX idx_auditoria_entidade ON public.auditoria_financeira USING btree (entidade, entidade_id);

CREATE INDEX idx_auditoria_tenant ON public.auditoria_financeira USING btree (corretor_id, criado_em);

CREATE INDEX idx_awe_payment ON public.asaas_webhook_events USING btree (payment_id);

CREATE INDEX idx_awe_pending ON public.asaas_webhook_events USING btree (status, received_at) WHERE (status = ANY (ARRAY['RECEIVED'::text, 'FAILED'::text]));

CREATE INDEX idx_calendar_mapping_event ON public.calendar_event_mappings USING btree (routine_event_id);

CREATE INDEX idx_calendar_watch_expiration ON public.calendar_watch_channels USING btree (expires_at) WHERE (status = 'active'::text);

CREATE INDEX idx_cliques_link ON public.parceiro_cliques USING btree (link_id, criado_em DESC);

CREATE INDEX idx_cliques_parceiro ON public.parceiro_cliques USING btree (parceiro_id, criado_em DESC);

CREATE INDEX idx_cliques_visitante ON public.parceiro_cliques USING btree (visitante_id);

CREATE INDEX idx_comissoes_parceiro ON public.parceiro_comissoes USING btree (parceiro_id, status, gerada_em DESC);

CREATE INDEX idx_comissoes_status ON public.parceiro_comissoes USING btree (status, gerada_em DESC);

CREATE INDEX idx_corretores_status ON public.corretores USING btree (status);

CREATE INDEX idx_corretores_ultimo_acesso ON public.corretores USING btree (ultimo_acesso_em DESC NULLS LAST);

CREATE INDEX idx_crm_etapas_corretor_ordem ON public.crm_etapas USING btree (corretor_id, ordem);

CREATE INDEX idx_crm_oport_cliente ON public.crm_oportunidades USING btree (cliente_id);

CREATE INDEX idx_crm_oport_corretor_etapa ON public.crm_oportunidades USING btree (corretor_id, etapa_id, ordem);

CREATE INDEX idx_crm_tarefas_abertas ON public.crm_tarefas USING btree (corretor_id, data_prevista) WHERE (concluida = false);

CREATE INDEX idx_fachada_escaneamentos_created ON public.fachada_escaneamentos USING btree (created_at);

CREATE INDEX idx_fachada_escaneamentos_fachada ON public.fachada_escaneamentos USING btree (fachada_id);

CREATE INDEX idx_fachada_leads_created ON public.fachada_leads USING btree (created_at);

CREATE INDEX idx_fachada_leads_fachada ON public.fachada_leads USING btree (fachada_id);

CREATE INDEX idx_fachada_templates_corretor ON public.fachada_templates USING btree (corretor_id);

CREATE INDEX idx_fachadas_corretor ON public.fachadas USING btree (corretor_id);

CREATE INDEX idx_fachadas_imovel ON public.fachadas USING btree (imovel_id);

CREATE INDEX idx_faturas_contrato ON public.faturas_aluguel USING btree (contrato_id);

CREATE INDEX idx_faturas_corretor ON public.faturas_aluguel USING btree (corretor_id);

CREATE INDEX idx_faturas_status ON public.faturas_aluguel USING btree (status);

CREATE INDEX idx_historico_cliente_data ON public.historico_contatos USING btree (cliente_id, data_contato DESC);

CREATE INDEX idx_historico_tipo ON public.historico_contatos USING btree (tipo);

CREATE INDEX idx_imoveis_anunciado ON public.imoveis USING btree (anunciado) WHERE (anunciado = true);

CREATE INDEX idx_imoveis_finalidade ON public.imoveis USING btree (finalidade);

CREATE INDEX idx_imoveis_status_anunciado ON public.imoveis USING btree (status_venda, anunciado) WHERE ((anunciado = true) AND (status_venda = 'DISPONIVEL'::public.status_venda));

CREATE INDEX idx_imovel_fotos_imovel ON public.imovel_fotos USING btree (imovel_id);

CREATE INDEX idx_imovel_fotos_imovel_ordem ON public.imovel_fotos USING btree (imovel_id, ordem);

CREATE INDEX idx_imovel_fotos_principal ON public.imovel_fotos USING btree (imovel_id, principal) WHERE (principal = true);

CREATE INDEX idx_job_queue_claim ON public.job_queue USING btree (run_after) WHERE (status = ANY (ARRAY['PENDING'::text, 'RETRYING'::text]));

CREATE INDEX idx_onboarding_events_nome_data ON public.onboarding_events USING btree (event_name, criado_em DESC);

CREATE INDEX idx_onboarding_events_org_data ON public.onboarding_events USING btree (organization_id, criado_em DESC);

CREATE INDEX idx_pagamentos_parceiro ON public.parceiro_pagamentos USING btree (parceiro_id, pago_em DESC);

CREATE INDEX idx_parceiro_links_parceiro ON public.parceiro_links USING btree (parceiro_id);

CREATE INDEX idx_parceiros_status ON public.parceiros USING btree (status);

CREATE INDEX idx_percentual_parceiro ON public.parceiro_percentuais USING btree (parceiro_id, vigencia_inicio DESC);

CREATE INDEX idx_receita_confirmado ON public.receita_eventos USING btree (confirmado_em DESC) WHERE (status = 'confirmado'::text);

CREATE INDEX idx_receita_corretor ON public.receita_eventos USING btree (corretor_id, confirmado_em DESC);

CREATE INDEX idx_repasses_corretor ON public.repasses_proprietario USING btree (corretor_id);

CREATE INDEX idx_repasses_status ON public.repasses_proprietario USING btree (status);

CREATE INDEX idx_repasses_status_valor ON public.repasses_proprietario USING btree (corretor_id, status, valor_liquido_repasse);

CREATE INDEX idx_routine_activity_entity ON public.routine_activity_log USING btree (organization_id, entity_type, entity_id, created_at DESC);

CREATE INDEX idx_routine_events_calendar ON public.routine_events USING btree (organization_id, assigned_to, start_at, end_at) WHERE ((deleted_at IS NULL) AND (status <> 'cancelled'::text));

CREATE INDEX idx_routine_inbox_open ON public.routine_inbox USING btree (organization_id, user_id, created_at DESC) WHERE (status = 'unprocessed'::text);

CREATE INDEX idx_routine_memberships_org ON public.routine_memberships USING btree (organization_id, status, role);

CREATE INDEX idx_routine_memberships_user ON public.routine_memberships USING btree (user_id, status, organization_id);

CREATE INDEX idx_routine_tasks_due ON public.routine_tasks USING btree (organization_id, assigned_to, due_at) WHERE ((deleted_at IS NULL) AND (status <> ALL (ARRAY['completed'::text, 'cancelled'::text])));

CREATE UNIQUE INDEX idx_subscriptions_corretor ON public.subscriptions USING btree (corretor_id) WHERE (status = ANY (ARRAY['trialing'::public.subscription_status, 'active'::public.subscription_status, 'past_due'::public.subscription_status]));

CREATE INDEX idx_user_roles_user ON public.user_roles USING btree (user_id);

CREATE INDEX lotti_agent_channel_owner_idx ON public.lotti_agent_channels USING btree (corretor_id);

CREATE INDEX lotti_agent_conversation_active_idx ON public.lotti_agent_conversations USING btree (corretor_id, updated_at DESC) WHERE (archived_at IS NULL);

CREATE UNIQUE INDEX lotti_agent_conversation_lid_key ON public.lotti_agent_conversations USING btree (channel_id, lid) WHERE (lid IS NOT NULL);

CREATE INDEX lotti_agent_conversation_owner_idx ON public.lotti_agent_conversations USING btree (corretor_id);

CREATE INDEX lotti_agent_conversation_phone_key_idx ON public.lotti_agent_conversations USING btree (channel_id, public.lotti_conversation_phone_key(phone)) WHERE (phone IS NOT NULL);

CREATE INDEX lotti_agent_conversations_pausa_idx ON public.lotti_agent_conversations USING btree (pausa_ia_ate) WHERE (pausa_ia_ate IS NOT NULL);

CREATE INDEX lotti_agent_customer_idx ON public.lotti_agent_conversations USING btree (cliente_id);

CREATE INDEX lotti_agent_followup_due_idx ON public.lotti_agent_conversations USING btree (followup_due_at) WHERE (followup_due_at IS NOT NULL);

CREATE INDEX lotti_agent_message_time_idx ON public.lotti_agent_messages USING btree (conversation_id, created_at);

CREATE INDEX lotti_agent_pending_idx ON public.lotti_agent_conversations USING btree (next_attempt_at) WHERE (mode = 'ai'::text);

CREATE INDEX lotti_agent_usage_period_idx ON public.lotti_agent_usage USING btree (corretor_id, period_start);

CREATE INDEX lotti_broadcast_campaign_due_idx ON public.lotti_broadcast_campaigns USING btree (starts_at) WHERE (status = 'scheduled'::text);

CREATE INDEX lotti_broadcast_campaign_owner_idx ON public.lotti_broadcast_campaigns USING btree (corretor_id, updated_at DESC);

CREATE INDEX lotti_broadcast_delivery_account_idx ON public.lotti_broadcast_deliveries USING btree (corretor_id, created_at);

CREATE INDEX lotti_broadcast_delivery_campaign_idx ON public.lotti_broadcast_deliveries USING btree (campaign_id, status);

CREATE INDEX lotti_broadcast_delivery_due_idx ON public.lotti_broadcast_deliveries USING btree (scheduled_at) WHERE (status = 'pending'::text);

CREATE INDEX lotti_broadcast_event_campaign_idx ON public.lotti_broadcast_events USING btree (campaign_id, created_at);

CREATE INDEX lotti_inbox_events_conversation_time ON public.lotti_inbox_events USING btree (conversation_id, created_at);

CREATE INDEX parceiro_lote_itens_lote_idx ON public.parceiro_lote_itens USING btree (lote_id);

CREATE INDEX parceiro_lote_itens_parceiro_idx ON public.parceiro_lote_itens USING btree (parceiro_id);

CREATE INDEX parceiro_lotes_status_idx ON public.parceiro_lotes USING btree (status, criado_em DESC);

CREATE INDEX public_request_limits_expiry ON public.public_request_limits USING btree (expires_at);

CREATE UNIQUE INDEX uq_asaas_conexoes_herdada ON public.asaas_conexoes USING btree (herdada_do_ambiente) WHERE herdada_do_ambiente;

CREATE UNIQUE INDEX uq_atribuicao_corretor ON public.parceiro_atribuicoes USING btree (corretor_id) WHERE (corretor_id IS NOT NULL);

CREATE UNIQUE INDEX uq_atribuicao_user ON public.parceiro_atribuicoes USING btree (user_id) WHERE (user_id IS NOT NULL);

CREATE UNIQUE INDEX uq_atribuicao_visitante ON public.parceiro_atribuicoes USING btree (visitante_id);

CREATE UNIQUE INDEX uq_clientes_asaas_customer ON public.clientes USING btree (asaas_customer_id) WHERE (asaas_customer_id IS NOT NULL);

CREATE UNIQUE INDEX uq_comissao_por_receita ON public.parceiro_comissoes USING btree (receita_evento_id);

CREATE UNIQUE INDEX uq_convite_pendente_org_email ON public.organizacao_convites USING btree (organization_id, lower(email)) WHERE (status = 'pendente'::text);

CREATE UNIQUE INDEX uq_crm_etapas_corretor_nome ON public.crm_etapas USING btree (corretor_id, nome);

CREATE UNIQUE INDEX uq_fatura_contrato_mes ON public.faturas_aluguel USING btree (contrato_id, mes_referencia);

CREATE UNIQUE INDEX uq_lancamento_comissao_fatura ON public.lancamentos_financeiros USING btree (fatura_id) WHERE ((fatura_id IS NOT NULL) AND (categoria = 'COMISSAO_LOCACAO'::text));

CREATE UNIQUE INDEX uq_onboarding_evento_marco ON public.onboarding_events USING btree (profile_id, event_name) WHERE (event_name = ANY (ARRAY['signup_completed'::text, 'onboarding_started'::text, 'persona_selected'::text, 'organization_created'::text, 'profile_completed'::text, 'first_property_created'::text, 'first_client_created'::text, 'first_deal_created'::text, 'first_task_created'::text, 'calendar_connected'::text, 'team_member_invited'::text, 'ai_first_used'::text, 'onboarding_completed'::text, 'first_value_reached'::text]));

CREATE UNIQUE INDEX uq_parceiro_link_principal ON public.parceiro_links USING btree (parceiro_id) WHERE (principal AND (revogado_em IS NULL));

CREATE UNIQUE INDEX uq_parceiro_links_slug ON public.parceiro_links USING btree (slug);

CREATE UNIQUE INDEX uq_parceiros_email ON public.parceiros USING btree (lower(email));

CREATE UNIQUE INDEX uq_percentual_vigente ON public.parceiro_percentuais USING btree (parceiro_id) WHERE (vigencia_fim IS NULL);

CREATE UNIQUE INDEX uq_receita_external ON public.receita_eventos USING btree (origem, external_id) WHERE (external_id IS NOT NULL);

CREATE UNIQUE INDEX uq_repasse_por_fatura ON public.repasses_proprietario USING btree (fatura_origem_id) WHERE (fatura_origem_id IS NOT NULL);

CREATE UNIQUE INDEX uq_routine_automations_org_name ON public.routine_automations USING btree (organization_id, name);

CREATE UNIQUE INDEX uq_routine_entity_links_event ON public.routine_entity_links USING btree (event_id, entity_type, entity_id) WHERE (event_id IS NOT NULL);

CREATE UNIQUE INDEX uq_routine_entity_links_task ON public.routine_entity_links USING btree (task_id, entity_type, entity_id) WHERE (task_id IS NOT NULL);

CREATE UNIQUE INDEX uq_routine_membership_ativa_por_usuario ON public.routine_memberships USING btree (user_id) WHERE (status = 'active'::text);

CREATE UNIQUE INDEX uq_user_roles_vigente ON public.user_roles USING btree (user_id, role) WHERE (revogado_em IS NULL);

-- ===== Views =====

CREATE VIEW public.v_leads_whatsapp WITH (security_invoker=true) AS
 SELECT id,
    nome,
    telefone,
    email,
    status_funil,
    corretor_id,
    ultimo_contato,
    proximo_followup,
    tracking_data ->> 'classificacao'::text AS classificacao,
    tracking_data -> 'qualificacao'::text AS qualificacao,
    ( SELECT count(*) AS count
           FROM public.historico_contatos h
          WHERE h.cliente_id = c.id AND h.tipo = 'WHATSAPP'::public.canal_contato) AS total_msgs_whatsapp,
    ( SELECT max(h.data_contato) AS max
           FROM public.historico_contatos h
          WHERE h.cliente_id = c.id AND h.tipo = 'WHATSAPP'::public.canal_contato) AS ultima_msg_whatsapp
   FROM public.clientes c
  WHERE (tracking_data ->> 'origem'::text) = 'whatsapp'::text OR (EXISTS ( SELECT 1
           FROM public.historico_contatos h
          WHERE h.cliente_id = c.id AND h.tipo = 'WHATSAPP'::public.canal_contato));

-- ===== Gatilhos =====

CREATE TRIGGER tr_admin_auditoria_imutavel BEFORE DELETE OR UPDATE ON public.admin_auditoria FOR EACH ROW EXECUTE FUNCTION public.bloquear_mutacao_admin_auditoria();

CREATE TRIGGER auditar_escrita_direta AFTER INSERT OR DELETE OR UPDATE ON public.admin_config FOR EACH ROW EXECUTE FUNCTION public.auditar_escrita_direta_admin();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.admin_config FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.ai_attachments FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.ai_conversations FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.ai_messages FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER trg_onboarding_ai_first_used AFTER INSERT ON public.ai_messages FOR EACH ROW EXECUTE FUNCTION public.trg_onboarding_ai_first_used();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.ai_rate_limits FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.alertas FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER asaas_checkout_events_updated_at BEFORE UPDATE ON public.asaas_checkout_events FOR EACH ROW EXECUTE FUNCTION public.checkout_set_updated_at();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.asaas_checkout_events FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.asaas_conexao_segredos FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_asaas_conexao_segredos_updated_at BEFORE UPDATE ON public.asaas_conexao_segredos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.asaas_conexoes FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_asaas_conexoes_updated_at BEFORE UPDATE ON public.asaas_conexoes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.asaas_webhook_events FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.atividade_eventos FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.auditoria_financeira FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_auditoria_imutavel BEFORE DELETE OR UPDATE ON public.auditoria_financeira FOR EACH ROW EXECUTE FUNCTION public.bloquear_mutacao_auditoria();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.billing_legacy_accounts FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.calendar_connections FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER trg_onboarding_calendar_connected AFTER INSERT OR UPDATE OF status ON public.calendar_connections FOR EACH ROW EXECUTE FUNCTION public.trg_onboarding_calendar_connected();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.calendar_event_mappings FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.calendar_sync_states FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_calendar_sync_states_updated_at BEFORE UPDATE ON public.calendar_sync_states FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.calendar_watch_channels FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_calendar_watch_channels_updated_at BEFORE UPDATE ON public.calendar_watch_channels FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.calendar_webhook_receipts FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.cancelamento_feedback FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER cancelamento_feedback_atualizado_em BEFORE UPDATE ON public.cancelamento_feedback FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.checkout_orders FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER checkout_orders_updated_at BEFORE UPDATE ON public.checkout_orders FOR EACH ROW EXECUTE FUNCTION public.checkout_set_updated_at();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.checkout_payments FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.checkout_rate_limits FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.cliente_imovel FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER clientes_phone_guard_insert BEFORE INSERT ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.clientes_phone_guard();

CREATE TRIGGER clientes_phone_guard_update BEFORE UPDATE OF telefone ON public.clientes FOR EACH ROW WHEN ((public.lotti_phone_key(old.telefone) IS DISTINCT FROM public.lotti_phone_key(new.telefone))) EXECUTE FUNCTION public.clientes_phone_guard();

CREATE TRIGGER lotti_inbox_record_legacy_stage AFTER UPDATE OF status_funil ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.lotti_inbox_record_legacy_stage();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.commercial_diagnostic_events FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.commercial_diagnostics FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.contract_quota_reservations FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.contratos FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER contratos_limite_plano BEFORE INSERT OR UPDATE OF status, tipo, corretor_id ON public.contratos FOR EACH ROW EXECUTE FUNCTION public.bloquear_recurso_acima_da_cota();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.contratos_renegociacoes FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.corretores FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_ensure_routine_organization AFTER INSERT ON public.corretores FOR EACH ROW EXECUTE FUNCTION public.ensure_routine_organization_for_corretor();

CREATE TRIGGER tr_proteger_status_corretor BEFORE UPDATE ON public.corretores FOR EACH ROW EXECUTE FUNCTION public.proteger_status_corretor();

CREATE TRIGGER trg_bootstrap_onboarding AFTER INSERT ON public.corretores FOR EACH ROW EXECUTE FUNCTION public.trg_bootstrap_onboarding_corretor();

CREATE TRIGGER trg_crm_seed_etapas AFTER INSERT ON public.corretores FOR EACH ROW EXECUTE FUNCTION public.crm_seed_etapas_novo_corretor();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.crm_etapas FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.crm_oportunidades FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER lotti_inbox_record_crm_stage AFTER UPDATE OF etapa_id ON public.crm_oportunidades FOR EACH ROW EXECUTE FUNCTION public.lotti_inbox_record_crm_stage();

CREATE TRIGGER trg_crm_oport_updated_at BEFORE UPDATE ON public.crm_oportunidades FOR EACH ROW EXECUTE FUNCTION public.crm_touch_updated_at();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.crm_tarefas FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.documentos FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.external_calendars FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_external_calendars_updated_at BEFORE UPDATE ON public.external_calendars FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.fachada_escaneamentos FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER guard_public_insert BEFORE INSERT ON public.fachada_escaneamentos FOR EACH ROW EXECUTE FUNCTION public.guard_public_fachada_insert();

CREATE TRIGGER trg_dec_scans AFTER DELETE ON public.fachada_escaneamentos FOR EACH ROW EXECUTE FUNCTION public.decrement_contador_fachada();

CREATE TRIGGER trigger_increment_escaneamentos AFTER INSERT ON public.fachada_escaneamentos FOR EACH ROW EXECUTE FUNCTION public.increment_escaneamentos();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.fachada_leads FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER guard_public_insert BEFORE INSERT ON public.fachada_leads FOR EACH ROW EXECUTE FUNCTION public.guard_public_fachada_insert();

CREATE TRIGGER trg_dec_leads AFTER DELETE ON public.fachada_leads FOR EACH ROW EXECUTE FUNCTION public.decrement_contador_fachada();

CREATE TRIGGER trigger_increment_leads AFTER INSERT ON public.fachada_leads FOR EACH ROW EXECUTE FUNCTION public.increment_leads();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.fachada_templates FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.fachadas FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER fachadas_limite_plano BEFORE INSERT OR UPDATE OF ativo, corretor_id ON public.fachadas FOR EACH ROW EXECUTE FUNCTION public.bloquear_recurso_acima_da_cota();

CREATE TRIGGER tr_proteger_id_fachada BEFORE UPDATE ON public.fachadas FOR EACH ROW EXECUTE FUNCTION public.proteger_id_fachada();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.faturas_aluguel FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_on_bill_paid AFTER UPDATE ON public.faturas_aluguel FOR EACH ROW EXECUTE FUNCTION public.handle_bill_payment();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.historico_contatos FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.imoveis FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER imoveis_limite_plano BEFORE INSERT OR UPDATE OF ativo, corretor_id ON public.imoveis FOR EACH ROW EXECUTE FUNCTION public.bloquear_recurso_acima_da_cota();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.imovel_fotos FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.job_queue FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.lancamentos_financeiros FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.leads_sem_destino FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.lotti_agent_bridge_endpoint FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.lotti_agent_channels FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER lotti_channel_reset_company_on_number_change BEFORE UPDATE OF account_phone ON public.lotti_agent_channels FOR EACH ROW EXECUTE FUNCTION public.lotti_channel_reset_company_on_number_change();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.lotti_agent_conversations FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER lotti_agent_conversation_phone_guard BEFORE INSERT ON public.lotti_agent_conversations FOR EACH ROW EXECUTE FUNCTION public.lotti_agent_conversation_phone_guard();

CREATE TRIGGER lotti_agent_opt_out_mode_guard BEFORE UPDATE OF mode ON public.lotti_agent_conversations FOR EACH ROW EXECUTE FUNCTION public.lotti_agent_opt_out_mode_guard();

CREATE TRIGGER lotti_conversa_no_crm_insert BEFORE INSERT ON public.lotti_agent_conversations FOR EACH ROW EXECUTE FUNCTION public.lotti_conversa_no_crm();

CREATE TRIGGER lotti_conversa_no_crm_phone BEFORE UPDATE OF phone, contact_name ON public.lotti_agent_conversations FOR EACH ROW EXECUTE FUNCTION public.lotti_conversa_no_crm();

CREATE TRIGGER lotti_inbox_record_mode AFTER UPDATE OF mode ON public.lotti_agent_conversations FOR EACH ROW EXECUTE FUNCTION public.lotti_inbox_record_mode();

CREATE TRIGGER lotti_inbox_record_status AFTER UPDATE OF status ON public.lotti_agent_conversations FOR EACH ROW EXECUTE FUNCTION public.lotti_inbox_record_status();

CREATE TRIGGER lotti_manual_mode_guard BEFORE UPDATE OF mode ON public.lotti_agent_conversations FOR EACH ROW EXECUTE FUNCTION public.lotti_manual_mode_guard();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.lotti_agent_messages FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER lotti_agent_detect_opt_out AFTER INSERT ON public.lotti_agent_messages FOR EACH ROW EXECUTE FUNCTION public.lotti_agent_detect_opt_out();

CREATE TRIGGER lotti_inbox_reopen_on_inbound AFTER INSERT ON public.lotti_agent_messages FOR EACH ROW EXECUTE FUNCTION public.lotti_inbox_reopen_on_inbound();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.lotti_agent_outbox FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.lotti_agent_settings FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.lotti_agent_usage FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.lotti_automation_heartbeat FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.lotti_broadcast_campaigns FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.lotti_broadcast_deliveries FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.lotti_broadcast_events FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.lotti_inbox_events FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.lotti_manual_sends FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER lotti_manual_opt_out_guard BEFORE INSERT ON public.lotti_manual_sends FOR EACH ROW EXECUTE FUNCTION public.lotti_manual_opt_out_guard();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.onboarding_checklist FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.onboarding_events FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.onboarding_preferences FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.onboarding_profiles FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.onboarding_progress FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.onboarding_sample_data FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.onboarding_steps FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.onboarding_tours FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.organizacao_convites FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.parceiro_atribuicoes FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.parceiro_cliques FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.parceiro_comissoes FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_comissoes_atualizado BEFORE UPDATE ON public.parceiro_comissoes FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

CREATE TRIGGER auditar_escrita_direta AFTER INSERT OR DELETE OR UPDATE ON public.parceiro_links FOR EACH ROW EXECUTE FUNCTION public.auditar_escrita_direta_admin();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.parceiro_links FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_auditar_parceiro_links_admin AFTER INSERT OR UPDATE ON public.parceiro_links FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_admin_direta();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.parceiro_lote_itens FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.parceiro_lotes FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER parceiro_lotes_atualizado_em BEFORE UPDATE ON public.parceiro_lotes FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.parceiro_pagamentos FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_escrita_direta AFTER INSERT OR DELETE OR UPDATE ON public.parceiro_percentuais FOR EACH ROW EXECUTE FUNCTION public.auditar_escrita_direta_admin();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.parceiro_percentuais FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_fechar_vigencia_anterior BEFORE INSERT ON public.parceiro_percentuais FOR EACH ROW EXECUTE FUNCTION public.fechar_vigencia_percentual_anterior();

CREATE TRIGGER auditar_escrita_direta AFTER INSERT OR DELETE OR UPDATE ON public.parceiros FOR EACH ROW EXECUTE FUNCTION public.auditar_escrita_direta_admin();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.parceiros FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_auditar_parceiros_admin AFTER INSERT OR UPDATE ON public.parceiros FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_admin_direta();

CREATE TRIGGER tr_parceiros_atualizado BEFORE UPDATE ON public.parceiros FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

CREATE TRIGGER tr_vincular_conta_parceiro BEFORE INSERT OR UPDATE OF email ON public.parceiros FOR EACH ROW EXECUTE FUNCTION public.vincular_conta_do_parceiro();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.plan_entitlements FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER trg_plan_entitlements_updated_at BEFORE UPDATE ON public.plan_entitlements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER trg_plans_updated_at BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.pricing_campaigns FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER trg_pricing_campaigns_updated_at BEFORE UPDATE ON public.pricing_campaigns FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.proprietarios FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.public_request_limits FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_escrita_direta AFTER INSERT OR DELETE OR UPDATE ON public.receita_eventos FOR EACH ROW EXECUTE FUNCTION public.auditar_escrita_direta_admin();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.receita_eventos FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_estornar_comissao AFTER UPDATE OF status ON public.receita_eventos FOR EACH ROW EXECUTE FUNCTION public.estornar_comissao_da_receita();

CREATE TRIGGER tr_gerar_comissao AFTER INSERT ON public.receita_eventos FOR EACH ROW EXECUTE FUNCTION public.gerar_comissao_de_receita();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.repasses_proprietario FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.routine_activity_log FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.routine_automation_runs FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.routine_automations FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_routine_automations_updated_at BEFORE UPDATE ON public.routine_automations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.routine_entity_links FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.routine_events FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_routine_events_log AFTER INSERT OR DELETE OR UPDATE ON public.routine_events FOR EACH ROW EXECUTE FUNCTION public.routine_log_change();

CREATE TRIGGER tr_routine_events_touch BEFORE UPDATE ON public.routine_events FOR EACH ROW EXECUTE FUNCTION public.routine_touch_and_version();

CREATE TRIGGER tr_routine_events_validate_entities BEFORE INSERT OR UPDATE ON public.routine_events FOR EACH ROW EXECUTE FUNCTION public.routine_validate_item_entities();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.routine_inbox FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_routine_inbox_updated_at BEFORE UPDATE ON public.routine_inbox FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.routine_memberships FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_routine_memberships_updated_at BEFORE UPDATE ON public.routine_memberships FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.routine_organizations FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_routine_organizations_updated_at BEFORE UPDATE ON public.routine_organizations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER tr_seed_routine_automations AFTER INSERT ON public.routine_organizations FOR EACH ROW EXECUTE FUNCTION public.seed_routine_automations_for_organization();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.routine_preferences FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_routine_preferences_updated_at BEFORE UPDATE ON public.routine_preferences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.routine_reminders FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_routine_reminders_updated_at BEFORE UPDATE ON public.routine_reminders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.routine_task_checklists FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_routine_task_checklists_updated_at BEFORE UPDATE ON public.routine_task_checklists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.routine_tasks FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER tr_routine_tasks_log AFTER INSERT OR DELETE OR UPDATE ON public.routine_tasks FOR EACH ROW EXECUTE FUNCTION public.routine_log_change();

CREATE TRIGGER tr_routine_tasks_touch BEFORE UPDATE ON public.routine_tasks FOR EACH ROW EXECUTE FUNCTION public.routine_touch_and_version();

CREATE TRIGGER tr_routine_tasks_validate_entities BEFORE INSERT OR UPDATE ON public.routine_tasks FOR EACH ROW EXECUTE FUNCTION public.routine_validate_item_entities();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.subscription_addons FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER trg_subscription_addons_updated_at BEFORE UPDATE ON public.subscription_addons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.usage_counters FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER trg_usage_counters_updated_at BEFORE UPDATE ON public.usage_counters FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER auditar_escrita_direta AFTER INSERT OR DELETE OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.auditar_escrita_direta_admin();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

CREATE TRIGGER auditar_suporte AFTER INSERT OR DELETE OR UPDATE ON public.webhook_logs FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte();

-- ===== Gatilho do cadastro (auth.users) =====

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created' AND tgrelid = 'auth.users'::regclass) THEN
    EXECUTE 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()';
  END IF;
END $do$;

-- ===== RLS ligado =====

ALTER TABLE public.admin_auditoria ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_config ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_sessoes_suporte ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_attachments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_rate_limits ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.alertas ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.asaas_checkout_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.asaas_conexao_segredos ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.asaas_conexoes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.asaas_webhook_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.atividade_eventos ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.auditoria_financeira ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.billing_legacy_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.calendar_event_mappings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.calendar_sync_states ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.calendar_watch_channels ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.calendar_webhook_receipts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cancelamento_feedback ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.checkout_orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.checkout_payments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.checkout_rate_limits ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cliente_imovel ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.commercial_diagnostic_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.commercial_diagnostics ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.contract_quota_reservations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.contratos ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.contratos_renegociacoes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.corretores ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.crm_etapas ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.crm_oportunidades ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.crm_tarefas ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.documentos ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.external_calendars ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fachada_escaneamentos ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fachada_leads ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fachada_templates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fachadas ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.faturas_aluguel ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.historico_contatos ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.imoveis ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.imovel_fotos ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.job_queue ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lancamentos_financeiros ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.leads_sem_destino ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lotti_agent_bridge_endpoint ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lotti_agent_channels ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lotti_agent_conversations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lotti_agent_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lotti_agent_outbox ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lotti_agent_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lotti_agent_usage ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lotti_automation_heartbeat ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lotti_broadcast_campaigns ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lotti_broadcast_deliveries ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lotti_broadcast_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lotti_inbox_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lotti_manual_sends ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.onboarding_checklist ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.onboarding_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.onboarding_preferences ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.onboarding_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.onboarding_sample_data ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.onboarding_steps ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.onboarding_tours ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.organizacao_convites ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.parceiro_atribuicoes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.parceiro_cliques ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.parceiro_comissoes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.parceiro_links ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.parceiro_lote_itens ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.parceiro_lotes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.parceiro_pagamentos ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.parceiro_percentuais ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.parceiros ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.plan_entitlements ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pricing_campaigns ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.proprietarios ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.public_request_limits ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.receita_eventos ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.repasses_proprietario ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.routine_activity_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.routine_automation_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.routine_automations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.routine_entity_links ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.routine_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.routine_inbox ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.routine_memberships ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.routine_organizations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.routine_preferences ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.routine_reminders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.routine_task_checklists ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.routine_tasks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.subscription_addons ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

-- ===== Policies =====

CREATE POLICY "admin_auditoria: admin le" ON public.admin_auditoria AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "admin_config: admin le" ON public.admin_config AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "admin_config: super_admin escreve" ON public.admin_config AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "suporte: admin le" ON public.admin_sessoes_suporte AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "Corretor ve anexos de suas conversas" ON public.ai_attachments AS PERMISSIVE FOR ALL TO authenticated
  USING ((message_id IN ( SELECT m.id
   FROM (public.ai_messages m
     JOIN public.ai_conversations c ON ((c.id = m.conversation_id)))
  WHERE (c.corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)))))
  WITH CHECK ((message_id IN ( SELECT m.id
   FROM (public.ai_messages m
     JOIN public.ai_conversations c ON ((c.id = m.conversation_id)))
  WHERE (c.corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)))));

CREATE POLICY "Corretor gerencia suas conversas IA" ON public.ai_conversations AS PERMISSIVE FOR ALL TO authenticated
  USING ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)))
  WITH CHECK ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)));

CREATE POLICY "Corretor ve mensagens de suas conversas" ON public.ai_messages AS PERMISSIVE FOR ALL TO authenticated
  USING ((conversation_id IN ( SELECT ai_conversations.id
   FROM public.ai_conversations
  WHERE (ai_conversations.corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)))))
  WITH CHECK ((conversation_id IN ( SELECT ai_conversations.id
   FROM public.ai_conversations
  WHERE (ai_conversations.corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)))));

CREATE POLICY "Corretor gerencia seu rate limit" ON public.ai_rate_limits AS PERMISSIVE FOR ALL TO authenticated
  USING ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)))
  WITH CHECK ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)));

CREATE POLICY "routine organization: alerts read" ON public.alertas AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.routine_organizations o
  WHERE ((o.legacy_corretor_id = alertas.corretor_id) AND private.routine_member_has_role(o.id, ARRAY['proprietario'::text, 'administrador'::text, 'gestor'::text, 'corretor'::text, 'colaborador'::text])))));

CREATE POLICY alertas_corretor_crud ON public.alertas AS PERMISSIVE FOR ALL TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.corretores co
  WHERE ((co.id = alertas.corretor_id) AND (co.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY alertas_service_all ON public.alertas AS PERMISSIVE FOR ALL TO PUBLIC
  USING ((auth.role() = 'service_role'::text))
  WITH CHECK ((auth.role() = 'service_role'::text));

CREATE POLICY "Corretor atualiza o passo do guia" ON public.asaas_conexoes AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING ((corretor_id = public.get_corretor_id()))
  WITH CHECK ((corretor_id = public.get_corretor_id()));

CREATE POLICY "Corretor vê sua conexão Asaas" ON public.asaas_conexoes AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((corretor_id = public.get_corretor_id()));

CREATE POLICY "Corretor le seus eventos" ON public.asaas_webhook_events AS PERMISSIVE FOR SELECT TO authenticated
  USING ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)));

CREATE POLICY "atividade: corretor le a sua" ON public.atividade_eventos AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR public.is_admin()));

CREATE POLICY "Corretor le sua auditoria" ON public.auditoria_financeira AS PERMISSIVE FOR SELECT TO authenticated
  USING ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)));

CREATE POLICY "cancelamento_feedback: admin le" ON public.cancelamento_feedback AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "Corretor gerencia vinculos cliente_imovel" ON public.cliente_imovel AS PERMISSIVE FOR ALL TO authenticated
  USING ((cliente_id IN ( SELECT clientes.id
   FROM public.clientes
  WHERE (clientes.corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)))))
  WITH CHECK ((cliente_id IN ( SELECT clientes.id
   FROM public.clientes
  WHERE (clientes.corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)))));

CREATE POLICY "Corretor gerencia clientes" ON public.clientes AS PERMISSIVE FOR ALL TO PUBLIC
  USING ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)));

CREATE POLICY "routine organization: clients read" ON public.clientes AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.routine_organizations o
  WHERE ((o.legacy_corretor_id = clientes.corretor_id) AND private.routine_member_has_role(o.id, ARRAY['proprietario'::text, 'administrador'::text, 'gestor'::text, 'corretor'::text, 'colaborador'::text])))));

CREATE POLICY commercial_diagnostic_events_admin_select ON public.commercial_diagnostic_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY commercial_diagnostics_admin_select ON public.commercial_diagnostics AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY commercial_diagnostics_admin_update ON public.commercial_diagnostics AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Corretor gerencia contratos" ON public.contratos AS PERMISSIVE FOR ALL TO PUBLIC
  USING ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)));

CREATE POLICY "routine organization: contracts read" ON public.contratos AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.routine_organizations o
  WHERE ((o.legacy_corretor_id = contratos.corretor_id) AND private.routine_member_has_role(o.id, ARRAY['proprietario'::text, 'administrador'::text, 'gestor'::text, 'corretor'::text, 'financeiro'::text, 'juridico'::text])))));

CREATE POLICY "Corretor gerencia renegociacoes" ON public.contratos_renegociacoes AS PERMISSIVE FOR ALL TO authenticated
  USING ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)))
  WITH CHECK ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)));

CREATE POLICY "Corretor atualiza próprio perfil" ON public.corretores AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Corretor vê tudo" ON public.corretores AS PERMISSIVE FOR ALL TO PUBLIC
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "Corretor gerencia suas etapas" ON public.crm_etapas AS PERMISSIVE FOR ALL TO authenticated
  USING ((corretor_id = public.get_corretor_id()))
  WITH CHECK ((corretor_id = public.get_corretor_id()));

CREATE POLICY "Corretor gerencia suas oportunidades" ON public.crm_oportunidades AS PERMISSIVE FOR ALL TO authenticated
  USING ((corretor_id = public.get_corretor_id()))
  WITH CHECK ((corretor_id = public.get_corretor_id()));

CREATE POLICY "routine organization: deals read" ON public.crm_oportunidades AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.routine_organizations o
  WHERE ((o.legacy_corretor_id = crm_oportunidades.corretor_id) AND private.routine_member_has_role(o.id, ARRAY['proprietario'::text, 'administrador'::text, 'gestor'::text, 'corretor'::text, 'colaborador'::text])))));

CREATE POLICY "Corretor gerencia suas tarefas" ON public.crm_tarefas AS PERMISSIVE FOR ALL TO authenticated
  USING ((corretor_id = public.get_corretor_id()))
  WITH CHECK ((corretor_id = public.get_corretor_id()));

CREATE POLICY "Corretor criar documentos" ON public.documentos AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "Corretor deletar documentos" ON public.documentos AS PERMISSIVE FOR DELETE TO authenticated
  USING ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "Corretor editar documentos" ON public.documentos AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "Corretor ver documentos" ON public.documentos AS PERMISSIVE FOR SELECT TO authenticated
  USING ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "external calendars: owner configure" ON public.external_calendars AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((user_id = ( SELECT auth.uid() AS uid)) AND private.routine_connection_owned_in_org(connection_id, organization_id)))
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.routine_connection_owned_in_org(connection_id, organization_id)));

CREATE POLICY "external calendars: owner read" ON public.external_calendars AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = ( SELECT auth.uid() AS uid)) AND private.routine_connection_owned(connection_id)));

CREATE POLICY "Corretor ve escaneamentos" ON public.fachada_escaneamentos AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((fachada_id IN ( SELECT fachadas.id
   FROM public.fachadas
  WHERE (fachadas.corretor_id IN ( SELECT corretores.id
           FROM public.corretores
          WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY "Publico registra escaneamento em fachada ativa" ON public.fachada_escaneamentos AS PERMISSIVE FOR INSERT TO anon, authenticated
  WITH CHECK (public.public_fachada_active(fachada_id));

CREATE POLICY "Corretor atualiza leads das suas fachadas" ON public.fachada_leads AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((fachada_id IN ( SELECT fachadas.id
   FROM public.fachadas
  WHERE (fachadas.corretor_id IN ( SELECT corretores.id
           FROM public.corretores
          WHERE (corretores.user_id = auth.uid()))))))
  WITH CHECK ((fachada_id IN ( SELECT fachadas.id
   FROM public.fachadas
  WHERE (fachadas.corretor_id IN ( SELECT corretores.id
           FROM public.corretores
          WHERE (corretores.user_id = auth.uid()))))));

CREATE POLICY "Corretor deleta leads das suas fachadas" ON public.fachada_leads AS PERMISSIVE FOR DELETE TO authenticated
  USING ((fachada_id IN ( SELECT fachadas.id
   FROM public.fachadas
  WHERE (fachadas.corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)))));

CREATE POLICY "Corretor ve leads" ON public.fachada_leads AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((fachada_id IN ( SELECT fachadas.id
   FROM public.fachadas
  WHERE (fachadas.corretor_id IN ( SELECT corretores.id
           FROM public.corretores
          WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY "Publico cria lead em fachada ativa" ON public.fachada_leads AS PERMISSIVE FOR INSERT TO anon, authenticated
  WITH CHECK (public.public_fachada_active(fachada_id));

CREATE POLICY "Corretor atualiza templates" ON public.fachada_templates AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "Corretor cria templates" ON public.fachada_templates AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "Corretor deleta templates" ON public.fachada_templates AS PERMISSIVE FOR DELETE TO PUBLIC
  USING ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "Corretor ve templates" ON public.fachada_templates AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((corretor_id IS NULL) OR (corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "corretor gerencia seus templates" ON public.fachada_templates AS PERMISSIVE FOR ALL TO authenticated
  USING ((corretor_id = public.get_corretor_id()))
  WITH CHECK ((corretor_id = public.get_corretor_id()));

CREATE POLICY "Corretor atualiza suas fachadas" ON public.fachadas AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)))
  WITH CHECK ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)));

CREATE POLICY "Corretor cria fachadas" ON public.fachadas AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "Corretor deleta suas fachadas" ON public.fachadas AS PERMISSIVE FOR DELETE TO PUBLIC
  USING ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "Corretor vê suas fachadas" ON public.fachadas AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "Corretor gerencia faturas" ON public.faturas_aluguel AS PERMISSIVE FOR ALL TO authenticated
  USING ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)))
  WITH CHECK ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)));

CREATE POLICY historico_corretor_read ON public.historico_contatos AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM (public.clientes c
     JOIN public.corretores co ON ((co.id = c.corretor_id)))
  WHERE ((c.id = historico_contatos.cliente_id) AND (co.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY historico_service_all ON public.historico_contatos AS PERMISSIVE FOR ALL TO PUBLIC
  USING ((auth.role() = 'service_role'::text))
  WITH CHECK ((auth.role() = 'service_role'::text));

CREATE POLICY "Corretor gerencia imoveis" ON public.imoveis AS PERMISSIVE FOR ALL TO PUBLIC
  USING ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)));

CREATE POLICY "Leitura pública de imóveis anunciados" ON public.imoveis AS PERMISSIVE FOR SELECT TO anon
  USING (((status_venda = 'DISPONIVEL'::public.status_venda) AND (ativo = true) AND (anunciado = true)));

CREATE POLICY "routine organization: properties read" ON public.imoveis AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.routine_organizations o
  WHERE ((o.legacy_corretor_id = imoveis.corretor_id) AND private.routine_member_has_role(o.id, ARRAY['proprietario'::text, 'administrador'::text, 'gestor'::text, 'corretor'::text, 'colaborador'::text])))));

CREATE POLICY "Corretor gerencia fotos de seus imoveis" ON public.imovel_fotos AS PERMISSIVE FOR ALL TO authenticated
  USING ((imovel_id IN ( SELECT imoveis.id
   FROM public.imoveis
  WHERE (imoveis.corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)))));

CREATE POLICY "Leitura pública de fotos de imóveis anunciados" ON public.imovel_fotos AS PERMISSIVE FOR SELECT TO anon
  USING ((imovel_id IN ( SELECT imoveis.id
   FROM public.imoveis
  WHERE ((imoveis.anunciado = true) AND (imoveis.ativo = true) AND (imoveis.status_venda = 'DISPONIVEL'::public.status_venda)))));

CREATE POLICY "Corretor le seus jobs" ON public.job_queue AS PERMISSIVE FOR SELECT TO authenticated
  USING ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)));

CREATE POLICY "Corretor criar financeiro" ON public.lancamentos_financeiros AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "Corretor deletar financeiro" ON public.lancamentos_financeiros AS PERMISSIVE FOR DELETE TO authenticated
  USING ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "Corretor editar financeiro" ON public.lancamentos_financeiros AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "Corretor ver financeiro" ON public.lancamentos_financeiros AS PERMISSIVE FOR SELECT TO authenticated
  USING ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY lotti_agent_bridge_service ON public.lotti_agent_bridge_endpoint AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY lotti_agent_channel_read ON public.lotti_agent_channels AS PERMISSIVE FOR SELECT TO authenticated
  USING ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY lotti_agent_conversation_read ON public.lotti_agent_conversations AS PERMISSIVE FOR SELECT TO authenticated
  USING ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY lotti_agent_message_read ON public.lotti_agent_messages AS PERMISSIVE FOR SELECT TO authenticated
  USING ((conversation_id IN ( SELECT lotti_agent_conversations.id
   FROM public.lotti_agent_conversations)));

CREATE POLICY lotti_agent_settings_owner_read ON public.lotti_agent_settings AS PERMISSIVE FOR SELECT TO authenticated
  USING ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY lotti_automation_heartbeat_read ON public.lotti_automation_heartbeat AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY lotti_broadcast_campaign_owner_read ON public.lotti_broadcast_campaigns AS PERMISSIVE FOR SELECT TO authenticated
  USING ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY lotti_broadcast_delivery_owner_read ON public.lotti_broadcast_deliveries AS PERMISSIVE FOR SELECT TO authenticated
  USING ((corretor_id IN ( SELECT corretores.id
   FROM public.corretores
  WHERE (corretores.user_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY lotti_broadcast_event_owner_read ON public.lotti_broadcast_events AS PERMISSIVE FOR SELECT TO authenticated
  USING ((campaign_id IN ( SELECT lotti_broadcast_campaigns.id
   FROM public.lotti_broadcast_campaigns)));

CREATE POLICY lotti_inbox_events_owner_read ON public.lotti_inbox_events AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (public.lotti_agent_conversations cv
     JOIN public.corretores c ON ((c.id = cv.corretor_id)))
  WHERE ((cv.id = lotti_inbox_events.conversation_id) AND (c.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "onboarding_checklist: proprio" ON public.onboarding_checklist AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.onboarding_profiles p
  WHERE ((p.id = onboarding_checklist.profile_id) AND (p.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.onboarding_profiles p
  WHERE ((p.id = onboarding_checklist.profile_id) AND (p.user_id = auth.uid())))));

CREATE POLICY "onboarding_events: proprio ou admin" ON public.onboarding_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR public.is_admin()));

CREATE POLICY "onboarding_preferences: proprio" ON public.onboarding_preferences AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.onboarding_profiles p
  WHERE ((p.id = onboarding_preferences.profile_id) AND (p.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.onboarding_profiles p
  WHERE ((p.id = onboarding_preferences.profile_id) AND (p.user_id = auth.uid())))));

CREATE POLICY "onboarding_profile: proprio" ON public.onboarding_profiles AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "onboarding_progress: proprio" ON public.onboarding_progress AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.onboarding_profiles p
  WHERE ((p.id = onboarding_progress.profile_id) AND (p.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.onboarding_profiles p
  WHERE ((p.id = onboarding_progress.profile_id) AND (p.user_id = auth.uid())))));

CREATE POLICY "sample_data: membro le" ON public.onboarding_sample_data AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_organization_member(organization_id));

CREATE POLICY "onboarding_steps: proprio" ON public.onboarding_steps AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.onboarding_profiles p
  WHERE ((p.id = onboarding_steps.profile_id) AND (p.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.onboarding_profiles p
  WHERE ((p.id = onboarding_steps.profile_id) AND (p.user_id = auth.uid())))));

CREATE POLICY "onboarding_tours: proprio" ON public.onboarding_tours AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.onboarding_profiles p
  WHERE ((p.id = onboarding_tours.profile_id) AND (p.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.onboarding_profiles p
  WHERE ((p.id = onboarding_tours.profile_id) AND (p.user_id = auth.uid())))));

CREATE POLICY "convites: gestor le" ON public.organizacao_convites AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_organization_manager(organization_id));

CREATE POLICY "atribuicoes: admin le" ON public.parceiro_atribuicoes AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "cliques: admin le" ON public.parceiro_cliques AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "comissoes: admin le" ON public.parceiro_comissoes AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "links: admin cria" ON public.parceiro_links AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "links: admin edita" ON public.parceiro_links AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "links: admin le" ON public.parceiro_links AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "parceiro_lote_itens: admin le" ON public.parceiro_lote_itens AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "parceiro_lotes: admin le" ON public.parceiro_lotes AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "pagamentos: admin le" ON public.parceiro_pagamentos AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "percentuais: admin cria" ON public.parceiro_percentuais AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "percentuais: admin le" ON public.parceiro_percentuais AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "parceiros: admin cria" ON public.parceiros AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "parceiros: admin edita" ON public.parceiros AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "parceiros: admin le" ON public.parceiros AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY entitlements_read_all ON public.plan_entitlements AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (true);

CREATE POLICY plans_read_all ON public.plans AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (true);

CREATE POLICY campaigns_read_active ON public.pricing_campaigns AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((active = true));

CREATE POLICY "Corretor gerencia proprietarios" ON public.proprietarios AS PERMISSIVE FOR ALL TO authenticated
  USING ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)))
  WITH CHECK ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)));

CREATE POLICY "receita: admin le" ON public.receita_eventos AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "receita: super_admin estorna" ON public.receita_eventos AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "receita: super_admin registra" ON public.receita_eventos AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Corretor gerencia repasses" ON public.repasses_proprietario AS PERMISSIVE FOR ALL TO authenticated
  USING ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)))
  WITH CHECK ((corretor_id = ( SELECT public.get_corretor_id() AS get_corretor_id)));

CREATE POLICY "routine activity: member read" ON public.routine_activity_log AS PERMISSIVE FOR SELECT TO authenticated
  USING (private.routine_is_member(organization_id));

CREATE POLICY "routine automation runs: members read" ON public.routine_automation_runs AS PERMISSIVE FOR SELECT TO authenticated
  USING (private.routine_is_member(organization_id));

CREATE POLICY "routine automations: managers write" ON public.routine_automations AS PERMISSIVE FOR ALL TO authenticated
  USING (private.routine_member_has_role(organization_id, ARRAY['proprietario'::text, 'administrador'::text]))
  WITH CHECK (private.routine_member_has_role(organization_id, ARRAY['proprietario'::text, 'administrador'::text]));

CREATE POLICY "routine automations: members read" ON public.routine_automations AS PERMISSIVE FOR SELECT TO authenticated
  USING (private.routine_is_member(organization_id));

CREATE POLICY "routine links: member read" ON public.routine_entity_links AS PERMISSIVE FOR SELECT TO authenticated
  USING ((private.routine_is_member(organization_id) AND (((event_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.routine_events e
  WHERE (e.id = routine_entity_links.event_id)))) OR ((task_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.routine_tasks t
  WHERE (t.id = routine_entity_links.task_id)))))));

CREATE POLICY "routine links: member write" ON public.routine_entity_links AS PERMISSIVE FOR ALL TO authenticated
  USING ((((event_id IS NOT NULL) AND private.routine_can_write_event_id(event_id) AND (EXISTS ( SELECT 1
   FROM public.routine_events e
  WHERE ((e.id = routine_entity_links.event_id) AND (e.organization_id = routine_entity_links.organization_id))))) OR ((task_id IS NOT NULL) AND private.routine_can_write_task_id(task_id) AND (EXISTS ( SELECT 1
   FROM public.routine_tasks t
  WHERE ((t.id = routine_entity_links.task_id) AND (t.organization_id = routine_entity_links.organization_id)))))))
  WITH CHECK ((((event_id IS NOT NULL) AND private.routine_can_write_event_id(event_id) AND (EXISTS ( SELECT 1
   FROM public.routine_events e
  WHERE ((e.id = routine_entity_links.event_id) AND (e.organization_id = routine_entity_links.organization_id))))) OR ((task_id IS NOT NULL) AND private.routine_can_write_task_id(task_id) AND (EXISTS ( SELECT 1
   FROM public.routine_tasks t
  WHERE ((t.id = routine_entity_links.task_id) AND (t.organization_id = routine_entity_links.organization_id)))))));

CREATE POLICY "routine events: create authorized" ON public.routine_events AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (private.routine_can_write_item(organization_id, assigned_to, created_by, visibility));

CREATE POLICY "routine events: delete authorized" ON public.routine_events AS PERMISSIVE FOR DELETE TO authenticated
  USING (private.routine_can_write_item(organization_id, assigned_to, created_by, visibility));

CREATE POLICY "routine events: update authorized" ON public.routine_events AS PERMISSIVE FOR UPDATE TO authenticated
  USING (private.routine_can_write_item(organization_id, assigned_to, created_by, visibility))
  WITH CHECK (private.routine_can_write_item(organization_id, assigned_to, created_by, visibility));

CREATE POLICY "routine events: visible items" ON public.routine_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (private.routine_can_view_item(organization_id, assigned_to, created_by, visibility));

CREATE POLICY "routine inbox: own read" ON public.routine_inbox AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = ( SELECT auth.uid() AS uid)) AND private.routine_is_member(organization_id)));

CREATE POLICY "routine inbox: own write" ON public.routine_inbox AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.routine_is_member(organization_id)));

CREATE POLICY "routine memberships: managers insert" ON public.routine_memberships AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (private.routine_member_has_role(organization_id, ARRAY['proprietario'::text, 'administrador'::text]));

CREATE POLICY "routine memberships: managers update" ON public.routine_memberships AS PERMISSIVE FOR UPDATE TO authenticated
  USING (private.routine_member_has_role(organization_id, ARRAY['proprietario'::text, 'administrador'::text]))
  WITH CHECK (private.routine_member_has_role(organization_id, ARRAY['proprietario'::text, 'administrador'::text]));

CREATE POLICY "routine memberships: organization read" ON public.routine_memberships AS PERMISSIVE FOR SELECT TO authenticated
  USING (private.routine_is_member(organization_id));

CREATE POLICY "routine organizations: managers update" ON public.routine_organizations AS PERMISSIVE FOR UPDATE TO authenticated
  USING (private.routine_member_has_role(id, ARRAY['proprietario'::text, 'administrador'::text]))
  WITH CHECK (private.routine_member_has_role(id, ARRAY['proprietario'::text, 'administrador'::text]));

CREATE POLICY "routine organizations: member read" ON public.routine_organizations AS PERMISSIVE FOR SELECT TO authenticated
  USING (private.routine_is_member(id));

CREATE POLICY "routine preferences: own" ON public.routine_preferences AS PERMISSIVE FOR ALL TO authenticated
  USING (((user_id = ( SELECT auth.uid() AS uid)) AND private.routine_is_member(organization_id)))
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.routine_is_member(organization_id)));

CREATE POLICY "routine reminders: authorized write" ON public.routine_reminders AS PERMISSIVE FOR ALL TO authenticated
  USING ((((user_id = ( SELECT auth.uid() AS uid)) OR private.routine_member_has_role(organization_id, ARRAY['proprietario'::text, 'administrador'::text, 'gestor'::text])) AND (((event_id IS NOT NULL) AND private.routine_can_write_event_id(event_id)) OR ((task_id IS NOT NULL) AND private.routine_can_write_task_id(task_id)))))
  WITH CHECK ((private.routine_user_is_member(organization_id, user_id) AND ((user_id = ( SELECT auth.uid() AS uid)) OR private.routine_member_has_role(organization_id, ARRAY['proprietario'::text, 'administrador'::text, 'gestor'::text])) AND (((event_id IS NOT NULL) AND private.routine_can_write_event_id(event_id)) OR ((task_id IS NOT NULL) AND private.routine_can_write_task_id(task_id)))));

CREATE POLICY "routine reminders: own or manager read" ON public.routine_reminders AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR private.routine_member_has_role(organization_id, ARRAY['proprietario'::text, 'administrador'::text, 'gestor'::text])));

CREATE POLICY "routine checklist: task read" ON public.routine_task_checklists AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.routine_tasks t
  WHERE (t.id = routine_task_checklists.task_id))));

CREATE POLICY "routine checklist: task write" ON public.routine_task_checklists AS PERMISSIVE FOR ALL TO authenticated
  USING (private.routine_can_write_task_id(task_id))
  WITH CHECK (private.routine_can_write_task_id(task_id));

CREATE POLICY "routine tasks: create authorized" ON public.routine_tasks AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (private.routine_can_write_item(organization_id, assigned_to, created_by, visibility));

CREATE POLICY "routine tasks: delete authorized" ON public.routine_tasks AS PERMISSIVE FOR DELETE TO authenticated
  USING (private.routine_can_write_item(organization_id, assigned_to, created_by, visibility));

CREATE POLICY "routine tasks: update authorized" ON public.routine_tasks AS PERMISSIVE FOR UPDATE TO authenticated
  USING (private.routine_can_write_item(organization_id, assigned_to, created_by, visibility))
  WITH CHECK (private.routine_can_write_item(organization_id, assigned_to, created_by, visibility));

CREATE POLICY "routine tasks: visible items" ON public.routine_tasks AS PERMISSIVE FOR SELECT TO authenticated
  USING (private.routine_can_view_item(organization_id, assigned_to, created_by, visibility));

CREATE POLICY addons_org_manage ON public.subscription_addons AS PERMISSIVE FOR ALL TO authenticated
  USING (((corretor_id = public.get_corretor_id()) AND (EXISTS ( SELECT 1
   FROM public.routine_organizations o
  WHERE ((o.legacy_corretor_id = subscription_addons.corretor_id) AND public.is_organization_manager(o.id))))))
  WITH CHECK (((corretor_id = public.get_corretor_id()) AND (EXISTS ( SELECT 1
   FROM public.routine_organizations o
  WHERE ((o.legacy_corretor_id = subscription_addons.corretor_id) AND public.is_organization_manager(o.id))))));

CREATE POLICY addons_org_read ON public.subscription_addons AS PERMISSIVE FOR SELECT TO authenticated
  USING ((corretor_id = public.get_corretor_id()));

CREATE POLICY subscriptions_org_manage ON public.subscriptions AS PERMISSIVE FOR ALL TO authenticated
  USING (((corretor_id = public.get_corretor_id()) AND (EXISTS ( SELECT 1
   FROM public.routine_organizations o
  WHERE ((o.legacy_corretor_id = subscriptions.corretor_id) AND public.is_organization_manager(o.id))))))
  WITH CHECK (((corretor_id = public.get_corretor_id()) AND (EXISTS ( SELECT 1
   FROM public.routine_organizations o
  WHERE ((o.legacy_corretor_id = subscriptions.corretor_id) AND public.is_organization_manager(o.id))))));

CREATE POLICY subscriptions_org_read ON public.subscriptions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((corretor_id = public.get_corretor_id()));

CREATE POLICY usage_own ON public.usage_counters AS PERMISSIVE FOR ALL TO authenticated
  USING ((corretor_id = public.get_corretor_id()))
  WITH CHECK ((corretor_id = public.get_corretor_id()));

CREATE POLICY "user_roles: admin le" ON public.user_roles AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "user_roles: super_admin concede" ON public.user_roles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "user_roles: super_admin revoga" ON public.user_roles AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ===== Uso dos schemas =====

GRANT USAGE ON SCHEMA auth TO anon;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT USAGE ON SCHEMA auth TO service_role;

GRANT USAGE ON SCHEMA extensions TO anon;
GRANT USAGE ON SCHEMA extensions TO authenticated;
GRANT USAGE ON SCHEMA extensions TO service_role;

GRANT USAGE ON SCHEMA private TO authenticated;

GRANT USAGE ON SCHEMA public TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

GRANT USAGE ON SCHEMA suporte_privado TO service_role;

-- ===== Permissões de tabela =====

REVOKE ALL ON TABLE public.admin_auditoria FROM anon, authenticated, service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.admin_auditoria TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.admin_auditoria TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.admin_auditoria TO service_role;

REVOKE ALL ON TABLE public.admin_config FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.admin_config TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.admin_config TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.admin_config TO service_role;

REVOKE ALL ON TABLE public.admin_sessoes_suporte FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.admin_sessoes_suporte TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.admin_sessoes_suporte TO service_role;

REVOKE ALL ON TABLE public.ai_attachments FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ai_attachments TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ai_attachments TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ai_attachments TO service_role;

REVOKE ALL ON TABLE public.ai_conversations FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ai_conversations TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ai_conversations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ai_conversations TO service_role;

REVOKE ALL ON TABLE public.ai_messages FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ai_messages TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ai_messages TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ai_messages TO service_role;

REVOKE ALL ON TABLE public.ai_rate_limits FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ai_rate_limits TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ai_rate_limits TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ai_rate_limits TO service_role;

REVOKE ALL ON TABLE public.alertas FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.alertas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.alertas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.alertas TO service_role;

REVOKE ALL ON TABLE public.asaas_checkout_events FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.asaas_checkout_events TO service_role;

REVOKE ALL ON TABLE public.asaas_conexao_segredos FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.asaas_conexao_segredos TO service_role;

REVOKE ALL ON TABLE public.asaas_conexoes FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.asaas_conexoes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.asaas_conexoes TO service_role;

REVOKE ALL ON TABLE public.asaas_webhook_events FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.asaas_webhook_events TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.asaas_webhook_events TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.asaas_webhook_events TO service_role;

REVOKE ALL ON TABLE public.atividade_eventos FROM anon, authenticated, service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.atividade_eventos TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.atividade_eventos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.atividade_eventos TO service_role;

REVOKE ALL ON TABLE public.auditoria_financeira FROM anon, authenticated, service_role;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.auditoria_financeira TO anon;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.auditoria_financeira TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.auditoria_financeira TO service_role;

REVOKE ALL ON TABLE public.billing_legacy_accounts FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.billing_legacy_accounts TO service_role;

REVOKE ALL ON TABLE public.calendar_connections FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.calendar_connections TO service_role;

REVOKE ALL ON TABLE public.calendar_event_mappings FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.calendar_event_mappings TO service_role;

REVOKE ALL ON TABLE public.calendar_sync_states FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.calendar_sync_states TO service_role;

REVOKE ALL ON TABLE public.calendar_watch_channels FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.calendar_watch_channels TO service_role;

REVOKE ALL ON TABLE public.calendar_webhook_receipts FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.calendar_webhook_receipts TO service_role;

REVOKE ALL ON TABLE public.cancelamento_feedback FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.cancelamento_feedback TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.cancelamento_feedback TO service_role;

REVOKE ALL ON TABLE public.checkout_orders FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.checkout_orders TO service_role;

REVOKE ALL ON TABLE public.checkout_payments FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.checkout_payments TO service_role;

REVOKE ALL ON TABLE public.checkout_rate_limits FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.checkout_rate_limits TO service_role;

REVOKE ALL ON TABLE public.cliente_imovel FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.cliente_imovel TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.cliente_imovel TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.cliente_imovel TO service_role;

REVOKE ALL ON TABLE public.clientes FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.clientes TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.clientes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.clientes TO service_role;

REVOKE ALL ON TABLE public.commercial_diagnostic_events FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.commercial_diagnostic_events TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.commercial_diagnostic_events TO service_role;

REVOKE ALL ON TABLE public.commercial_diagnostics FROM anon, authenticated, service_role;
GRANT SELECT, UPDATE ON TABLE public.commercial_diagnostics TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.commercial_diagnostics TO service_role;

REVOKE ALL ON TABLE public.contract_quota_reservations FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contract_quota_reservations TO service_role;

REVOKE ALL ON TABLE public.contratos FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contratos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contratos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contratos TO service_role;

REVOKE ALL ON TABLE public.contratos_renegociacoes FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contratos_renegociacoes TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contratos_renegociacoes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contratos_renegociacoes TO service_role;

REVOKE ALL ON TABLE public.corretores FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.corretores TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.corretores TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.corretores TO service_role;

REVOKE ALL ON TABLE public.crm_etapas FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.crm_etapas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.crm_etapas TO service_role;

REVOKE ALL ON TABLE public.crm_oportunidades FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.crm_oportunidades TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.crm_oportunidades TO service_role;

REVOKE ALL ON TABLE public.crm_tarefas FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.crm_tarefas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.crm_tarefas TO service_role;

REVOKE ALL ON TABLE public.documentos FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.documentos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.documentos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.documentos TO service_role;

REVOKE ALL ON TABLE public.external_calendars FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.external_calendars TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.external_calendars TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.external_calendars TO service_role;

REVOKE ALL ON TABLE public.fachada_escaneamentos FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.fachada_escaneamentos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.fachada_escaneamentos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.fachada_escaneamentos TO service_role;

REVOKE ALL ON TABLE public.fachada_leads FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.fachada_leads TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.fachada_leads TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.fachada_leads TO service_role;

REVOKE ALL ON TABLE public.fachada_templates FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.fachada_templates TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.fachada_templates TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.fachada_templates TO service_role;

REVOKE ALL ON TABLE public.fachadas FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.fachadas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.fachadas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.fachadas TO service_role;

REVOKE ALL ON TABLE public.faturas_aluguel FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.faturas_aluguel TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.faturas_aluguel TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.faturas_aluguel TO service_role;

REVOKE ALL ON TABLE public.historico_contatos FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.historico_contatos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.historico_contatos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.historico_contatos TO service_role;

REVOKE ALL ON TABLE public.imoveis FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON TABLE public.imoveis TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.imoveis TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.imoveis TO service_role;

REVOKE ALL ON TABLE public.imovel_fotos FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.imovel_fotos TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.imovel_fotos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.imovel_fotos TO service_role;

REVOKE ALL ON TABLE public.job_queue FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.job_queue TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.job_queue TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.job_queue TO service_role;

REVOKE ALL ON TABLE public.lancamentos_financeiros FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lancamentos_financeiros TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lancamentos_financeiros TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lancamentos_financeiros TO service_role;

REVOKE ALL ON TABLE public.leads_sem_destino FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.leads_sem_destino TO service_role;

REVOKE ALL ON TABLE public.lotti_agent_bridge_endpoint FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lotti_agent_bridge_endpoint TO service_role;

REVOKE ALL ON TABLE public.lotti_agent_channels FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.lotti_agent_channels TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lotti_agent_channels TO service_role;

REVOKE ALL ON TABLE public.lotti_agent_conversations FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.lotti_agent_conversations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lotti_agent_conversations TO service_role;

REVOKE ALL ON TABLE public.lotti_agent_messages FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.lotti_agent_messages TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lotti_agent_messages TO service_role;

REVOKE ALL ON TABLE public.lotti_agent_outbox FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lotti_agent_outbox TO service_role;

REVOKE ALL ON TABLE public.lotti_agent_settings FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.lotti_agent_settings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lotti_agent_settings TO service_role;

REVOKE ALL ON TABLE public.lotti_agent_usage FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lotti_agent_usage TO service_role;

REVOKE ALL ON TABLE public.lotti_automation_heartbeat FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.lotti_automation_heartbeat TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lotti_automation_heartbeat TO service_role;

REVOKE ALL ON TABLE public.lotti_broadcast_campaigns FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.lotti_broadcast_campaigns TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lotti_broadcast_campaigns TO service_role;

REVOKE ALL ON TABLE public.lotti_broadcast_deliveries FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.lotti_broadcast_deliveries TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lotti_broadcast_deliveries TO service_role;

REVOKE ALL ON TABLE public.lotti_broadcast_events FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.lotti_broadcast_events TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lotti_broadcast_events TO service_role;

REVOKE ALL ON TABLE public.lotti_inbox_events FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.lotti_inbox_events TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lotti_inbox_events TO service_role;

REVOKE ALL ON TABLE public.lotti_manual_sends FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lotti_manual_sends TO service_role;

REVOKE ALL ON TABLE public.onboarding_checklist FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_checklist TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_checklist TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_checklist TO service_role;

REVOKE ALL ON TABLE public.onboarding_events FROM anon, authenticated, service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.onboarding_events TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.onboarding_events TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_events TO service_role;

REVOKE ALL ON TABLE public.onboarding_preferences FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_preferences TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_preferences TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_preferences TO service_role;

REVOKE ALL ON TABLE public.onboarding_profiles FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_profiles TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_profiles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_profiles TO service_role;

REVOKE ALL ON TABLE public.onboarding_progress FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_progress TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_progress TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_progress TO service_role;

REVOKE ALL ON TABLE public.onboarding_sample_data FROM anon, authenticated, service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.onboarding_sample_data TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.onboarding_sample_data TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_sample_data TO service_role;

REVOKE ALL ON TABLE public.onboarding_steps FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_steps TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_steps TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_steps TO service_role;

REVOKE ALL ON TABLE public.onboarding_tours FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_tours TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_tours TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.onboarding_tours TO service_role;

REVOKE ALL ON TABLE public.organizacao_convites FROM anon, authenticated, service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.organizacao_convites TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.organizacao_convites TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.organizacao_convites TO service_role;

REVOKE ALL ON TABLE public.parceiro_atribuicoes FROM anon, authenticated, service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.parceiro_atribuicoes TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.parceiro_atribuicoes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.parceiro_atribuicoes TO service_role;

REVOKE ALL ON TABLE public.parceiro_cliques FROM anon, authenticated, service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.parceiro_cliques TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.parceiro_cliques TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.parceiro_cliques TO service_role;

REVOKE ALL ON TABLE public.parceiro_comissoes FROM anon, authenticated, service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.parceiro_comissoes TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.parceiro_comissoes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.parceiro_comissoes TO service_role;

REVOKE ALL ON TABLE public.parceiro_links FROM anon, authenticated, service_role;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.parceiro_links TO anon;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.parceiro_links TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.parceiro_links TO service_role;

REVOKE ALL ON TABLE public.parceiro_lote_itens FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.parceiro_lote_itens TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.parceiro_lote_itens TO service_role;

REVOKE ALL ON TABLE public.parceiro_lotes FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.parceiro_lotes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.parceiro_lotes TO service_role;

REVOKE ALL ON TABLE public.parceiro_pagamentos FROM anon, authenticated, service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.parceiro_pagamentos TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.parceiro_pagamentos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.parceiro_pagamentos TO service_role;

REVOKE ALL ON TABLE public.parceiro_percentuais FROM anon, authenticated, service_role;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.parceiro_percentuais TO anon;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.parceiro_percentuais TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.parceiro_percentuais TO service_role;

REVOKE ALL ON TABLE public.parceiros FROM anon, authenticated, service_role;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.parceiros TO anon;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.parceiros TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.parceiros TO service_role;

REVOKE ALL ON TABLE public.plan_entitlements FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.plan_entitlements TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.plan_entitlements TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.plan_entitlements TO service_role;

REVOKE ALL ON TABLE public.plans FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.plans TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.plans TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.plans TO service_role;

REVOKE ALL ON TABLE public.pricing_campaigns FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pricing_campaigns TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pricing_campaigns TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pricing_campaigns TO service_role;

REVOKE ALL ON TABLE public.proprietarios FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.proprietarios TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.proprietarios TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.proprietarios TO service_role;

REVOKE ALL ON TABLE public.public_request_limits FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.public_request_limits TO service_role;

REVOKE ALL ON TABLE public.receita_eventos FROM anon, authenticated, service_role;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.receita_eventos TO anon;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.receita_eventos TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.receita_eventos TO service_role;

REVOKE ALL ON TABLE public.repasses_proprietario FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.repasses_proprietario TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.repasses_proprietario TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.repasses_proprietario TO service_role;

REVOKE ALL ON TABLE public.routine_activity_log FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_activity_log TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_activity_log TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_activity_log TO service_role;

REVOKE ALL ON TABLE public.routine_automation_runs FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_automation_runs TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_automation_runs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_automation_runs TO service_role;

REVOKE ALL ON TABLE public.routine_automations FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_automations TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_automations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_automations TO service_role;

REVOKE ALL ON TABLE public.routine_entity_links FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_entity_links TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_entity_links TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_entity_links TO service_role;

REVOKE ALL ON TABLE public.routine_events FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_events TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_events TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_events TO service_role;

REVOKE ALL ON TABLE public.routine_inbox FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_inbox TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_inbox TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_inbox TO service_role;

REVOKE ALL ON TABLE public.routine_memberships FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_memberships TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_memberships TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_memberships TO service_role;

REVOKE ALL ON TABLE public.routine_organizations FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_organizations TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_organizations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_organizations TO service_role;

REVOKE ALL ON TABLE public.routine_preferences FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_preferences TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_preferences TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_preferences TO service_role;

REVOKE ALL ON TABLE public.routine_reminders FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_reminders TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_reminders TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_reminders TO service_role;

REVOKE ALL ON TABLE public.routine_task_checklists FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_task_checklists TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_task_checklists TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_task_checklists TO service_role;

REVOKE ALL ON TABLE public.routine_tasks FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_tasks TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_tasks TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.routine_tasks TO service_role;

REVOKE ALL ON TABLE public.subscription_addons FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.subscription_addons TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.subscription_addons TO service_role;

REVOKE ALL ON TABLE public.subscriptions FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.subscriptions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.subscriptions TO service_role;

REVOKE ALL ON TABLE public.usage_counters FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.usage_counters TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.usage_counters TO service_role;

REVOKE ALL ON TABLE public.user_roles FROM anon, authenticated, service_role;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_roles TO anon;
GRANT INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_roles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_roles TO service_role;

REVOKE ALL ON TABLE public.v_leads_whatsapp FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_leads_whatsapp TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_leads_whatsapp TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_leads_whatsapp TO service_role;

REVOKE ALL ON TABLE public.webhook_logs FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.webhook_logs TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.webhook_logs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.webhook_logs TO service_role;

REVOKE ALL ON TABLE suporte_privado.credenciais FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE suporte_privado.credenciais TO service_role;

-- ===== Permissões por coluna =====

GRANT UPDATE (passo_guia) ON TABLE public.asaas_conexoes TO authenticated;

GRANT SELECT (anunciado) ON TABLE public.imoveis TO anon;

GRANT SELECT (area_m2) ON TABLE public.imoveis TO anon;

GRANT SELECT (ativo) ON TABLE public.imoveis TO anon;

GRANT SELECT (bairro) ON TABLE public.imoveis TO anon;

GRANT SELECT (banheiros) ON TABLE public.imoveis TO anon;

GRANT SELECT (cep) ON TABLE public.imoveis TO anon;

GRANT SELECT (cidade) ON TABLE public.imoveis TO anon;

GRANT SELECT (created_at) ON TABLE public.imoveis TO anon;

GRANT SELECT (descricao) ON TABLE public.imoveis TO anon;

GRANT SELECT (descricao_curta) ON TABLE public.imoveis TO anon;

GRANT SELECT (dormitorios) ON TABLE public.imoveis TO anon;

GRANT SELECT (endereco) ON TABLE public.imoveis TO anon;

GRANT SELECT (estado) ON TABLE public.imoveis TO anon;

GRANT SELECT (finalidade) ON TABLE public.imoveis TO anon;

GRANT SELECT (garagem) ON TABLE public.imoveis TO anon;

GRANT SELECT (id) ON TABLE public.imoveis TO anon;

GRANT SELECT (status_venda) ON TABLE public.imoveis TO anon;

GRANT SELECT (tipo) ON TABLE public.imoveis TO anon;

GRANT SELECT (titulo) ON TABLE public.imoveis TO anon;

GRANT SELECT (valor) ON TABLE public.imoveis TO anon;

-- ===== Permissões de sequência =====

GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.admin_auditoria_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.admin_auditoria_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.admin_auditoria_id_seq TO service_role;

GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.atividade_eventos_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.atividade_eventos_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.atividade_eventos_id_seq TO service_role;

GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.auditoria_financeira_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.auditoria_financeira_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.auditoria_financeira_id_seq TO service_role;

GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.calendar_webhook_receipts_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.calendar_webhook_receipts_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.calendar_webhook_receipts_id_seq TO service_role;

GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.commercial_diagnostic_events_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.commercial_diagnostic_events_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.commercial_diagnostic_events_id_seq TO service_role;

GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.job_queue_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.job_queue_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.job_queue_id_seq TO service_role;

GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.onboarding_events_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.onboarding_events_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.onboarding_events_id_seq TO service_role;

GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.parceiro_cliques_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.parceiro_cliques_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.parceiro_cliques_id_seq TO service_role;

GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.routine_activity_log_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.routine_activity_log_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.routine_activity_log_id_seq TO service_role;

-- ===== Permissões de função =====

REVOKE ALL ON FUNCTION private.routine_can_view_item(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.routine_can_view_item(uuid,uuid,uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION private.routine_can_write_event_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.routine_can_write_event_id(uuid) TO authenticated;

REVOKE ALL ON FUNCTION private.routine_can_write_item(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.routine_can_write_item(uuid,uuid,uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION private.routine_can_write_task_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.routine_can_write_task_id(uuid) TO authenticated;

REVOKE ALL ON FUNCTION private.routine_connection_owned(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.routine_connection_owned(uuid) TO authenticated;

REVOKE ALL ON FUNCTION private.routine_connection_owned_in_org(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.routine_connection_owned_in_org(uuid,uuid) TO authenticated;

REVOKE ALL ON FUNCTION private.routine_is_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.routine_is_member(uuid) TO authenticated;

REVOKE ALL ON FUNCTION private.routine_member_has_role(uuid,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.routine_member_has_role(uuid,text[]) TO authenticated;

REVOKE ALL ON FUNCTION private.routine_user_is_member(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.routine_user_is_member(uuid,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.aceitar_convite_organizacao(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aceitar_convite_organizacao(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aceitar_convite_organizacao(text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_cancelar_lote(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cancelar_lote(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancelar_lote(uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_conceder_papel(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_conceder_papel(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_conceder_papel(uuid,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_config_int(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_config_int(text,integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_config_texto(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_config_texto(text,text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_criar_parceiro_completo(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_criar_parceiro_completo(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_criar_parceiro_completo(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.admin_definir_percentual(uuid,numeric,text,numeric,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_definir_percentual(uuid,numeric,text,numeric,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_definir_percentual(uuid,numeric,text,numeric,date,text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_definir_status_corretor(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_definir_status_corretor(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_definir_status_corretor(uuid,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_detalhe_lote(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_detalhe_lote(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_detalhe_lote(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.admin_detalhe_organizacao(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_detalhe_organizacao(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_detalhe_organizacao(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.admin_detalhe_usuario(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_detalhe_usuario(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_detalhe_usuario(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.admin_estornar_receita(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_estornar_receita(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_estornar_receita(uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_gerar_lote_repasse(uuid[],numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_gerar_lote_repasse(uuid[],numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_gerar_lote_repasse(uuid[],numeric,text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_listar_acessos(text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_acessos(text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_acessos(text,integer,integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_listar_assinaturas(text,text,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_assinaturas(text,text,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_assinaturas(text,text,text,text,integer,integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_listar_atendimento(text,text,uuid,boolean,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_atendimento(text,text,uuid,boolean,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_atendimento(text,text,uuid,boolean,text,integer,integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_listar_auditoria(text,text,date,date,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_auditoria(text,text,date,date,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_auditoria(text,text,date,date,integer,integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_listar_cancelamentos(text,text,text,date,date,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_cancelamentos(text,text,text,date,date,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_cancelamentos(text,text,text,date,date,integer,integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_listar_comissoes(uuid,text,date,date,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_comissoes(uuid,text,date,date,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_comissoes(uuid,text,date,date,integer,integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_listar_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_config() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_config() TO service_role;

REVOKE ALL ON FUNCTION public.admin_listar_lotes(text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_lotes(text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_lotes(text,integer,integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_listar_organizacoes(text,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_organizacoes(text,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_organizacoes(text,text,text,integer,integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_listar_pagamentos(text,text,text,text,date,date,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_pagamentos(text,text,text,text,date,date,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_pagamentos(text,text,text,text,date,date,integer,integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_listar_parceiros(text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_parceiros(text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_parceiros(text,text,integer,integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_listar_receita(uuid,text,date,date,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_receita(uuid,text,date,date,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_receita(uuid,text,date,date,integer,integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_listar_usuarios(text,text,text,uuid,date,date,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_usuarios(text,text,text,uuid,date,date,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_usuarios(text,text,text,uuid,date,date,text,text,integer,integer) TO service_role;

REVOKE ALL ON FUNCTION public.admin_marcar_lote_exportado(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_marcar_lote_exportado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_marcar_lote_exportado(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.admin_marcar_lote_pago(uuid,date,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_marcar_lote_pago(uuid,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_marcar_lote_pago(uuid,date,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_metricas_cancelamento(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_metricas_cancelamento(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_metricas_cancelamento(date,date) TO service_role;

REVOKE ALL ON FUNCTION public.admin_metricas_saas(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_metricas_saas(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_metricas_saas(date,date) TO service_role;

REVOKE ALL ON FUNCTION public.admin_metricas_visao_geral(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_metricas_visao_geral(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_metricas_visao_geral(date,date) TO service_role;

REVOKE ALL ON FUNCTION public.admin_onboarding_metricas(timestamp with time zone,timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_onboarding_metricas(timestamp with time zone,timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_onboarding_metricas(timestamp with time zone,timestamp with time zone) TO service_role;

REVOKE ALL ON FUNCTION public.admin_opcoes_parceiros() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_opcoes_parceiros() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_opcoes_parceiros() TO service_role;

REVOKE ALL ON FUNCTION public.admin_papeis_usuario(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_papeis_usuario(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_papeis_usuario(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.admin_parceiros_elegiveis_repasse(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_parceiros_elegiveis_repasse(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_parceiros_elegiveis_repasse(numeric) TO service_role;

REVOKE ALL ON FUNCTION public.admin_preparar_suporte(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_preparar_suporte(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_preparar_suporte(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.admin_registrar_cancelamento(text,uuid,text,text,text,text,text,text,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_registrar_cancelamento(text,uuid,text,text,text,text,text,text,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_registrar_cancelamento(text,uuid,text,text,text,text,text,text,date) TO service_role;

REVOKE ALL ON FUNCTION public.admin_registrar_pagamento(uuid,uuid[],text,text,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_registrar_pagamento(uuid,uuid[],text,text,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_registrar_pagamento(uuid,uuid[],text,text,date,text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_registrar_receita(uuid,numeric,timestamp with time zone,text,numeric,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_registrar_receita(uuid,numeric,timestamp with time zone,text,numeric,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_registrar_receita(uuid,numeric,timestamp with time zone,text,numeric,date,text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_revogar_papel(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_revogar_papel(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revogar_papel(uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_salvar_config(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_salvar_config(text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_salvar_config(text,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.admin_status_integracoes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_status_integracoes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_status_integracoes() TO service_role;

REVOKE ALL ON FUNCTION public.admin_transicionar_comissao(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_transicionar_comissao(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_transicionar_comissao(uuid,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.apply_checkout_payment(uuid,text,text,text,text,date,numeric,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_checkout_payment(uuid,text,text,text,text,date,numeric,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.auditar_escrita_direta_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auditar_escrita_direta_admin() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.auditar_escrita_direta_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.auditar_escrita_direta_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auditar_escrita_direta_admin() TO service_role;

REVOKE ALL ON FUNCTION public.auditar_mutacao_admin_direta() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auditar_mutacao_admin_direta() TO service_role;

REVOKE ALL ON FUNCTION public.auditar_mutacao_suporte() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auditar_mutacao_suporte() TO service_role;

REVOKE ALL ON FUNCTION public.bloquear_mutacao_admin_auditoria() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bloquear_mutacao_admin_auditoria() TO service_role;

REVOKE ALL ON FUNCTION public.bloquear_mutacao_auditoria() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bloquear_mutacao_auditoria() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.bloquear_mutacao_auditoria() TO anon;
GRANT EXECUTE ON FUNCTION public.bloquear_mutacao_auditoria() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bloquear_mutacao_auditoria() TO service_role;

REVOKE ALL ON FUNCTION public.bloquear_recurso_acima_da_cota() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bloquear_recurso_acima_da_cota() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.bloquear_recurso_acima_da_cota() TO anon;
GRANT EXECUTE ON FUNCTION public.bloquear_recurso_acima_da_cota() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bloquear_recurso_acima_da_cota() TO service_role;

REVOKE ALL ON FUNCTION public.bootstrap_onboarding_corretor(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_onboarding_corretor(uuid,boolean) TO service_role;

REVOKE ALL ON FUNCTION public.checar_cota(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checar_cota(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.checar_cota(uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.checkout_set_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkout_set_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.claim_asaas_checkout_event(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_asaas_checkout_event(text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.claim_checkout_order_provisioning(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_checkout_order_provisioning(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.claim_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_jobs(integer) TO service_role;

REVOKE ALL ON FUNCTION public.classificar_atividade(timestamp with time zone,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classificar_atividade(timestamp with time zone,integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.classificar_atividade(timestamp with time zone,integer) TO anon;
GRANT EXECUTE ON FUNCTION public.classificar_atividade(timestamp with time zone,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.classificar_atividade(timestamp with time zone,integer) TO service_role;

REVOKE ALL ON FUNCTION public.clientes_phone_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clientes_phone_guard() TO service_role;

REVOKE ALL ON FUNCTION public.conciliar_transferencia_repasse(uuid,text,text,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conciliar_transferencia_repasse(uuid,text,text,numeric,text) TO service_role;

REVOKE ALL ON FUNCTION public.consume_checkout_rate_limit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_checkout_rate_limit(text) TO service_role;

REVOKE ALL ON FUNCTION public.consume_public_lead_limit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_public_lead_limit(text) TO service_role;

REVOKE ALL ON FUNCTION public.consume_public_request_limit(text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_public_request_limit(text,text,integer,integer) TO service_role;

REVOKE ALL ON FUNCTION public.conta_antiga_sem_limite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conta_antiga_sem_limite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conta_antiga_sem_limite(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.criar_convite_organizacao(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_convite_organizacao(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_convite_organizacao(text,text) TO service_role;

REVOKE ALL ON FUNCTION public.crm_candidatos_cliente(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_candidatos_cliente(uuid,text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.crm_clientes_por_telefone(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_clientes_por_telefone(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_clientes_por_telefone(text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.crm_converter_lead(uuid,uuid,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_converter_lead(uuid,uuid,jsonb,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_converter_lead(uuid,uuid,jsonb,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.crm_criar_cliente(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_criar_cliente(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_criar_cliente(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.crm_oportunidade_aberta(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_oportunidade_aberta(uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.crm_seed_etapas_novo_corretor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_seed_etapas_novo_corretor() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_seed_etapas_novo_corretor() TO anon;
GRANT EXECUTE ON FUNCTION public.crm_seed_etapas_novo_corretor() TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_seed_etapas_novo_corretor() TO service_role;

REVOKE ALL ON FUNCTION public.crm_touch_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_touch_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_touch_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.crm_touch_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_touch_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.decrement_contador_fachada() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decrement_contador_fachada() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.decrement_contador_fachada() TO anon;
GRANT EXECUTE ON FUNCTION public.decrement_contador_fachada() TO authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_contador_fachada() TO service_role;

REVOKE ALL ON FUNCTION public.ensure_routine_organization_for_corretor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_routine_organization_for_corretor() TO service_role;

REVOKE ALL ON FUNCTION public.estornar_comissao_da_receita() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estornar_comissao_da_receita() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.estornar_comissao_da_receita() TO anon;
GRANT EXECUTE ON FUNCTION public.estornar_comissao_da_receita() TO authenticated;
GRANT EXECUTE ON FUNCTION public.estornar_comissao_da_receita() TO service_role;

REVOKE ALL ON FUNCTION public.estornar_pagamento_fatura(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estornar_pagamento_fatura(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.estornar_pagamento_fatura(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.estornar_pagamento_fatura(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estornar_pagamento_fatura(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.exigir_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exigir_admin() TO service_role;

REVOKE ALL ON FUNCTION public.exigir_backoffice() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exigir_backoffice() TO service_role;

REVOKE ALL ON FUNCTION public.exigir_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exigir_super_admin() TO service_role;

REVOKE ALL ON FUNCTION public.fachada_esta_ativa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fachada_esta_ativa(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.fachada_esta_ativa(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.fachada_esta_ativa(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fachada_esta_ativa(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.fechar_vigencia_percentual_anterior() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fechar_vigencia_percentual_anterior() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.fechar_vigencia_percentual_anterior() TO anon;
GRANT EXECUTE ON FUNCTION public.fechar_vigencia_percentual_anterior() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fechar_vigencia_percentual_anterior() TO service_role;

REVOKE ALL ON FUNCTION public.finish_asaas_checkout_event(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finish_asaas_checkout_event(text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.finish_contract_quota(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finish_contract_quota(uuid,boolean) TO service_role;

REVOKE ALL ON FUNCTION public.generate_monthly_rent_bills(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_monthly_rent_bills(date) TO service_role;

REVOKE ALL ON FUNCTION public.gerar_alertas_vencimento_contratos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gerar_alertas_vencimento_contratos() TO service_role;

REVOKE ALL ON FUNCTION public.gerar_comissao_de_receita() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gerar_comissao_de_receita() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.gerar_comissao_de_receita() TO anon;
GRANT EXECUTE ON FUNCTION public.gerar_comissao_de_receita() TO authenticated;
GRANT EXECUTE ON FUNCTION public.gerar_comissao_de_receita() TO service_role;

REVOKE ALL ON FUNCTION public.get_corretor_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_corretor_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_corretor_id() TO service_role;

REVOKE ALL ON FUNCTION public.get_onboarding_contexto() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_onboarding_contexto() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_onboarding_contexto() TO service_role;

REVOKE ALL ON FUNCTION public.guard_public_fachada_insert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_public_fachada_insert() TO service_role;

REVOKE ALL ON FUNCTION public.handle_bill_payment() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_bill_payment() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_bill_payment() TO anon;
GRANT EXECUTE ON FUNCTION public.handle_bill_payment() TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_bill_payment() TO service_role;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO anon;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

REVOKE ALL ON FUNCTION public.has_role(uuid,public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid,public.app_role) TO service_role;

REVOKE ALL ON FUNCTION public.increment_escaneamentos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_escaneamentos() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_escaneamentos() TO anon;
GRANT EXECUTE ON FUNCTION public.increment_escaneamentos() TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_escaneamentos() TO service_role;

REVOKE ALL ON FUNCTION public.increment_leads() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_leads() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_leads() TO anon;
GRANT EXECUTE ON FUNCTION public.increment_leads() TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_leads() TO service_role;

REVOKE ALL ON FUNCTION public.incrementar_uso(uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.incrementar_uso(uuid,text,integer) TO service_role;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;

REVOKE ALL ON FUNCTION public.is_backoffice_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_backoffice_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_backoffice_user() TO service_role;

REVOKE ALL ON FUNCTION public.is_organization_manager(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_organization_manager(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_organization_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_organization_manager(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.is_organization_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_organization_member(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_organization_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_organization_member(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO service_role;

REVOKE ALL ON FUNCTION public.lead_capture_upsert_cliente(uuid,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lead_capture_upsert_cliente(uuid,text,text,text,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_auto_begin(uuid,uuid,bigint,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_auto_begin(uuid,uuid,bigint,text,text,boolean) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_auto_fail(uuid,uuid,bigint,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_auto_fail(uuid,uuid,bigint,boolean) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_auto_finish(uuid,uuid,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_auto_finish(uuid,uuid,bigint,text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_begin_send(uuid,uuid,bigint,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_begin_send(uuid,uuid,bigint,boolean) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_bind_account(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_bind_account(uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_claim() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_claim() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_contact_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_contact_name(text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_conversation_phone_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_conversation_phone_guard() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_defer(uuid,uuid,timestamp with time zone,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_defer(uuid,uuid,timestamp with time zone,boolean,text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_detect_opt_out() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_detect_opt_out() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_detect_opt_out() TO anon;
GRANT EXECUTE ON FUNCTION public.lotti_agent_detect_opt_out() TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_agent_detect_opt_out() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_escalate_stalled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_escalate_stalled() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_fail(uuid,uuid,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_fail(uuid,uuid,text,boolean) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_finish(uuid,uuid,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_finish(uuid,uuid,bigint,text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_followup_advance(uuid,bigint,smallint,timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_followup_advance(uuid,bigint,smallint,timestamp with time zone) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_followup_arm(uuid,bigint,timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_followup_arm(uuid,bigint,timestamp with time zone) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_followup_claim() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_followup_claim() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_followup_close(uuid,uuid,bigint,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_followup_close(uuid,uuid,bigint,boolean,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_followup_release(uuid,uuid,smallint,timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_followup_release(uuid,uuid,smallint,timestamp with time zone) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_handoff(uuid,uuid,bigint,jsonb,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_handoff(uuid,uuid,bigint,jsonb,uuid,boolean) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_import_history(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_import_history(text,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_ingest(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_ingest(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_is_opt_out(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_is_opt_out(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_agent_is_opt_out(text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_merge_conversation(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_merge_conversation(uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_move_stage(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_move_stage(uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_opt_out_mode_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_opt_out_mode_guard() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_opt_out_mode_guard() TO anon;
GRANT EXECUTE ON FUNCTION public.lotti_agent_opt_out_mode_guard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_agent_opt_out_mode_guard() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_pausa_padrao() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_pausa_padrao() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_pausa_padrao() TO anon;
GRANT EXECUTE ON FUNCTION public.lotti_agent_pausa_padrao() TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_agent_pausa_padrao() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_pode_atender(uuid,timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_pode_atender(uuid,timestamp with time zone) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_prepare(uuid,uuid,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_prepare(uuid,uuid,bigint,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_reconciliar_envio(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_reconciliar_envio(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_agent_reconciliar_envio(uuid,boolean) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_register_bridge(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_register_bridge(text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_resolve_conversation(uuid,text,text,text,timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_resolve_conversation(uuid,text,text,text,timestamp with time zone) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_save_settings(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_save_settings(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_agent_save_settings(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_set_mode(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_set_mode(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_agent_set_mode(uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_agent_validate_settings(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_agent_validate_settings(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_agent_validate_settings(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_broadcast_activate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_activate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_activate(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_broadcast_audience(uuid,uuid[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_audience(uuid,uuid[],text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_broadcast_claim() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_claim() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_broadcast_complete(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_complete(uuid,text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_broadcast_control(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_control(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_control(uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_broadcast_delete_draft(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_delete_draft(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_delete_draft(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_broadcast_duplicate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_duplicate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_duplicate(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_broadcast_finish_campaign(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_finish_campaign(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_broadcast_log(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_log(uuid,text,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_broadcast_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_owner() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_broadcast_preview(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_preview(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_preview(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_broadcast_render(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_render(text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_broadcast_save(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_save(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_save(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_broadcast_stage_ids(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_stage_ids(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_broadcast_start(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_start(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_broadcast_validate(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_broadcast_validate(uuid,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_channel_reset_company_on_number_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_channel_reset_company_on_number_change() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_channel_reset_company_on_number_change() TO anon;
GRANT EXECUTE ON FUNCTION public.lotti_channel_reset_company_on_number_change() TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_channel_reset_company_on_number_change() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_channel_set_company_name(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_channel_set_company_name(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_channel_set_company_name(text,text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_conversa_no_crm() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_conversa_no_crm() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_conversation_phone_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_conversation_phone_key(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_conversation_phone_key(text) TO anon;
GRANT EXECUTE ON FUNCTION public.lotti_conversation_phone_key(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_conversation_phone_key(text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_crm_primeira_etapa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_crm_primeira_etapa(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_find_or_create_cliente(uuid,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_find_or_create_cliente(uuid,text,text,jsonb,boolean) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_inbox_abrir_negocio(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_abrir_negocio(uuid,uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_inbox_add_to_crm(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_add_to_crm(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_add_to_crm(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_inbox_clear_opt_out(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_clear_opt_out(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_clear_opt_out(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_inbox_event_actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_event_actor() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_event_actor() TO anon;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_event_actor() TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_event_actor() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_inbox_link_cliente(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_link_cliente(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_inbox_merge_conversations(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_merge_conversations(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_merge_conversations(uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_inbox_record_crm_stage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_record_crm_stage() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_record_crm_stage() TO anon;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_record_crm_stage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_record_crm_stage() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_inbox_record_legacy_stage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_record_legacy_stage() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_record_legacy_stage() TO anon;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_record_legacy_stage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_record_legacy_stage() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_inbox_record_mode() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_record_mode() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_record_mode() TO anon;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_record_mode() TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_record_mode() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_inbox_record_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_record_status() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_record_status() TO anon;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_record_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_record_status() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_inbox_rename_client(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_rename_client(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_rename_client(uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_inbox_reopen_on_inbound() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_reopen_on_inbound() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_reopen_on_inbound() TO anon;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_reopen_on_inbound() TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_reopen_on_inbound() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_inbox_set_status(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_set_status(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_set_status(uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_inbox_start_conversation(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_start_conversation(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_start_conversation(text,text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_inbox_update_contact(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_update_contact(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_update_contact(uuid,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_manual_adopt_remote(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_manual_adopt_remote(uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_manual_begin(uuid,uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_manual_begin(uuid,uuid,uuid,text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_manual_finish(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_manual_finish(uuid,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_manual_mode_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_manual_mode_guard() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_manual_mode_guard() TO anon;
GRANT EXECUTE ON FUNCTION public.lotti_manual_mode_guard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_manual_mode_guard() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_manual_opt_out_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_manual_opt_out_guard() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_manual_opt_out_guard() TO anon;
GRANT EXECUTE ON FUNCTION public.lotti_manual_opt_out_guard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_manual_opt_out_guard() TO service_role;

REVOKE ALL ON FUNCTION public.lotti_phone_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_phone_key(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_phone_key(text) TO anon;
GRANT EXECUTE ON FUNCTION public.lotti_phone_key(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_phone_key(text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_phone_key_confiavel(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_phone_key_confiavel(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_phone_key_confiavel(text) TO anon;
GRANT EXECUTE ON FUNCTION public.lotti_phone_key_confiavel(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_phone_key_confiavel(text) TO service_role;

REVOKE ALL ON FUNCTION public.lotti_telefone_legivel(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_telefone_legivel(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.lotti_telefone_legivel(text) TO anon;
GRANT EXECUTE ON FUNCTION public.lotti_telefone_legivel(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_telefone_legivel(text) TO service_role;

REVOKE ALL ON FUNCTION public.marcar_alertas_lidos(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_alertas_lidos(uuid[]) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_alertas_lidos(uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION public.marcar_alertas_lidos(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_alertas_lidos(uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.meus_papeis() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meus_papeis() TO authenticated;
GRANT EXECUTE ON FUNCTION public.meus_papeis() TO service_role;

REVOKE ALL ON FUNCTION public.mrr_da_assinatura(text,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mrr_da_assinatura(text,numeric,numeric) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.mrr_da_assinatura(text,numeric,numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.mrr_da_assinatura(text,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mrr_da_assinatura(text,numeric,numeric) TO service_role;

REVOKE ALL ON FUNCTION public.onboarding_executar_acao(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.onboarding_executar_acao(text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.onboarding_executar_acao(text,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.parceiro_portal_registrar_aceite() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parceiro_portal_registrar_aceite() TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_portal_registrar_aceite() TO service_role;

REVOKE ALL ON FUNCTION public.parceiro_portal_resumo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parceiro_portal_resumo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_portal_resumo() TO service_role;

REVOKE ALL ON FUNCTION public.parceiro_portal_salvar_repasse(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parceiro_portal_salvar_repasse(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_portal_salvar_repasse(text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.parceiro_portal_teto_renovacoes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parceiro_portal_teto_renovacoes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_portal_teto_renovacoes() TO service_role;

REVOKE ALL ON FUNCTION public.percentual_vigente_em(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.percentual_vigente_em(uuid,date) TO service_role;

REVOKE ALL ON FUNCTION public.promover_primeiro_super_admin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promover_primeiro_super_admin(text) TO service_role;

REVOKE ALL ON FUNCTION public.proteger_id_fachada() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.proteger_id_fachada() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.proteger_id_fachada() TO anon;
GRANT EXECUTE ON FUNCTION public.proteger_id_fachada() TO authenticated;
GRANT EXECUTE ON FUNCTION public.proteger_id_fachada() TO service_role;

REVOKE ALL ON FUNCTION public.proteger_status_corretor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.proteger_status_corretor() TO service_role;

REVOKE ALL ON FUNCTION public.public_fachada_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_fachada_active(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.public_fachada_active(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_fachada_active(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.registrar_alerta_financeiro(uuid,text,text,text,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_alerta_financeiro(uuid,text,text,text,uuid,jsonb,text) TO service_role;

REVOKE ALL ON FUNCTION public.registrar_atividade(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_atividade(text,text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_atividade(text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.registrar_atividade(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_atividade(text,text) TO service_role;

REVOKE ALL ON FUNCTION public.registrar_auditoria_admin(text,text,text,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_auditoria_admin(text,text,text,jsonb,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_auditoria_admin(text,text,text,jsonb,jsonb,text) TO service_role;

REVOKE ALL ON FUNCTION public.registrar_onboarding_evento(text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_onboarding_evento(text,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_onboarding_evento(text,text,text,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.reserve_contract_quota(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_contract_quota(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.routine_detect_conflicts(uuid,timestamp with time zone,timestamp with time zone,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.routine_detect_conflicts(uuid,timestamp with time zone,timestamp with time zone,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.routine_detect_conflicts(uuid,timestamp with time zone,timestamp with time zone,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.routine_log_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.routine_log_change() TO service_role;

REVOKE ALL ON FUNCTION public.routine_register_completion(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.routine_register_completion(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.routine_register_completion(text,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.routine_touch_and_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.routine_touch_and_version() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.routine_touch_and_version() TO anon;
GRANT EXECUTE ON FUNCTION public.routine_touch_and_version() TO authenticated;
GRANT EXECUTE ON FUNCTION public.routine_touch_and_version() TO service_role;

REVOKE ALL ON FUNCTION public.routine_validate_item_entities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.routine_validate_item_entities() TO service_role;

REVOKE ALL ON FUNCTION public.salvar_conexao_asaas(uuid,text,text,text,text,text,text,text[],text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.salvar_conexao_asaas(uuid,text,text,text,text,text,text,text[],text,text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.salvar_onboarding(jsonb,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.salvar_onboarding(jsonb,jsonb,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_onboarding(jsonb,jsonb,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.salvar_onboarding_tour(text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.salvar_onboarding_tour(text,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_onboarding_tour(text,text,integer) TO service_role;

REVOKE ALL ON FUNCTION public.seed_routine_automations_for_organization() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_routine_automations_for_organization() TO service_role;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.suporte_criar_sessao(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suporte_criar_sessao(uuid,uuid,uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.suporte_encerrar_sessao(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suporte_encerrar_sessao(uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.suporte_obter_credenciais(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suporte_obter_credenciais(uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.tocar_atualizado_em() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tocar_atualizado_em() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.tocar_atualizado_em() TO anon;
GRANT EXECUTE ON FUNCTION public.tocar_atualizado_em() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tocar_atualizado_em() TO service_role;

REVOKE ALL ON FUNCTION public.trg_bootstrap_onboarding_corretor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_bootstrap_onboarding_corretor() TO service_role;

REVOKE ALL ON FUNCTION public.trg_onboarding_ai_first_used() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_onboarding_ai_first_used() TO service_role;

REVOKE ALL ON FUNCTION public.trg_onboarding_calendar_connected() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_onboarding_calendar_connected() TO service_role;

REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO anon;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;

REVOKE ALL ON FUNCTION public.vincular_conta_do_parceiro() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vincular_conta_do_parceiro() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.vincular_conta_do_parceiro() TO anon;
GRANT EXECUTE ON FUNCTION public.vincular_conta_do_parceiro() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vincular_conta_do_parceiro() TO service_role;

-- ===== Realtime =====

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'alertas') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.alertas';
  END IF;
END $do$;
