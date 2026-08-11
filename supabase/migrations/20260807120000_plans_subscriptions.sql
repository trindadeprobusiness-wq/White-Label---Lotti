-- ============================================================
-- Lotti — Planos, Assinaturas, Limites e Campanhas
-- Migration: 20260807120000_plans_subscriptions.sql
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. TABELA plans
-- ────────────────────────────────────────────────────────────
create table if not exists public.plans (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,           -- 'essencial', 'profissional', 'imobiliaria'
  name          text not null,
  description   text not null default '',
  monthly_price numeric(10,2) not null,
  annual_price  numeric(10,2) not null,
  active        boolean not null default true,
  highlighted   boolean not null default false,  -- badge "MAIS ESCOLHIDO"
  display_order smallint not null default 0,
  trial_days    smallint not null default 14,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.plans is 'Catálogo de planos da Lotti. Editável pelo admin.';

-- RLS: leitura pública (pricing page), escrita só via service_role
alter table public.plans enable row level security;

create policy "plans_read_all" on public.plans
  for select using (true);

-- ────────────────────────────────────────────────────────────
-- 2. TABELA plan_entitlements
-- ────────────────────────────────────────────────────────────
create table if not exists public.plan_entitlements (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.plans(id) on delete cascade,
  feature_key   text not null,                   -- ex: 'max_users', 'max_imoveis', 'ai_contracts_monthly'
  feature_name  text not null,                   -- ex: 'Usuários', 'Imóveis ativos'
  category      text not null default 'geral',   -- para agrupar na tabela comparativa
  enabled       boolean not null default true,
  limit_value   integer,                         -- null quando é boolean (tem/não tem)
  unlimited     boolean not null default false,
  display_order smallint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (plan_id, feature_key)
);

comment on table public.plan_entitlements is 'Permissões e limites por plano. feature_key é a chave usada no código.';

alter table public.plan_entitlements enable row level security;

create policy "entitlements_read_all" on public.plan_entitlements
  for select using (true);

-- ────────────────────────────────────────────────────────────
-- 3. TABELA subscriptions
-- ────────────────────────────────────────────────────────────
create type public.billing_cycle as enum ('monthly', 'annual');
create type public.subscription_status as enum (
  'trialing',        -- em período de teste
  'active',          -- pago e ativo
  'past_due',        -- pagamento atrasado
  'canceled',        -- cancelado (acesso até fim do ciclo)
  'expired',         -- trial expirado sem conversão
  'read_only'        -- 7 dias pós-expiração, só leitura
);

create table if not exists public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  corretor_id              uuid not null references public.corretores(id) on delete cascade,
  plan_id                  uuid not null references public.plans(id),
  billing_cycle            public.billing_cycle not null default 'monthly',
  status                   public.subscription_status not null default 'trialing',
  trial_started_at         timestamptz,
  trial_ends_at            timestamptz,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  canceled_at              timestamptz,
  cancel_reason            text,
  external_subscription_id text,                 -- ID no gateway (Asaas/Stripe)
  founder_campaign_id      uuid,                 -- referência à campanha de fundador
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.subscriptions is 'Assinatura SaaS ativa do corretor. Uma por corretor.';

-- Índice para busca rápida
create unique index idx_subscriptions_corretor on public.subscriptions(corretor_id)
  where status in ('trialing', 'active', 'past_due');

alter table public.subscriptions enable row level security;

create policy "subscriptions_own" on public.subscriptions
  for all using (
    corretor_id in (
      select id from public.corretores where user_id = auth.uid()
    )
  );

-- ────────────────────────────────────────────────────────────
-- 4. TABELA usage_counters
-- ────────────────────────────────────────────────────────────
create table if not exists public.usage_counters (
  id              uuid primary key default gen_random_uuid(),
  corretor_id     uuid not null references public.corretores(id) on delete cascade,
  feature_key     text not null,                 -- ex: 'ai_contracts_monthly', 'ai_assistant_monthly'
  used_quantity   integer not null default 0,
  period_start    date not null,
  period_end      date not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (corretor_id, feature_key, period_start)
);

comment on table public.usage_counters is 'Contadores de consumo mensal por feature limitada.';

alter table public.usage_counters enable row level security;

create policy "usage_own" on public.usage_counters
  for all using (
    corretor_id in (
      select id from public.corretores where user_id = auth.uid()
    )
  );

-- ────────────────────────────────────────────────────────────
-- 5. TABELA subscription_addons
-- ────────────────────────────────────────────────────────────
create type public.addon_status as enum ('active', 'canceled');

create table if not exists public.subscription_addons (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  corretor_id     uuid not null references public.corretores(id) on delete cascade,
  addon_code      text not null,                 -- 'extra_user', 'extra_fachadas_25', 'extra_ai_100', etc.
  addon_name      text not null,
  quantity        integer not null default 1,
  unit_price      numeric(10,2) not null,
  status          public.addon_status not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.subscription_addons is 'Adicionais contratados sobre a assinatura.';

alter table public.subscription_addons enable row level security;

create policy "addons_own" on public.subscription_addons
  for all using (
    corretor_id in (
      select id from public.corretores where user_id = auth.uid()
    )
  );

-- ────────────────────────────────────────────────────────────
-- 6. TABELA pricing_campaigns
-- ────────────────────────────────────────────────────────────
create type public.discount_type as enum ('percentage', 'fixed');

create table if not exists public.pricing_campaigns (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  discount_type     public.discount_type not null default 'percentage',
  discount_value    numeric(10,2) not null,       -- ex: 20.00 para 20% ou R$20
  maximum_customers integer,                      -- null = sem limite
  current_customers integer not null default 0,
  starts_at         timestamptz not null,
  ends_at           timestamptz,                  -- null = sem data fim
  duration_months   integer not null default 12,   -- meses que o desconto dura
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.pricing_campaigns is 'Campanhas de preço (ex: preço de fundador para os 100 primeiros).';

alter table public.pricing_campaigns enable row level security;

-- Leitura pública para exibir na pricing page
create policy "campaigns_read_active" on public.pricing_campaigns
  for select using (active = true);

-- ────────────────────────────────────────────────────────────
-- 7. FUNÇÃO de updated_at automático
-- ────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Triggers de updated_at
create trigger trg_plans_updated_at before update on public.plans
  for each row execute function public.set_updated_at();

create trigger trg_plan_entitlements_updated_at before update on public.plan_entitlements
  for each row execute function public.set_updated_at();

create trigger trg_subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

create trigger trg_usage_counters_updated_at before update on public.usage_counters
  for each row execute function public.set_updated_at();

create trigger trg_subscription_addons_updated_at before update on public.subscription_addons
  for each row execute function public.set_updated_at();

create trigger trg_pricing_campaigns_updated_at before update on public.pricing_campaigns
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 8. SEED DATA — Planos
-- ────────────────────────────────────────────────────────────
insert into public.plans (code, name, description, monthly_price, annual_price, highlighted, display_order, trial_days)
values
  ('essencial',     'Lotti Essencial',     'Para o corretor autônomo que quer sair de planilhas e começar a gerir.',         99.00,  990.00, false, 1, 14),
  ('profissional',  'Lotti Profissional',  'Para duplas, pequenas equipes e operações de vendas e aluguéis.',               149.00, 1490.00, true,  2, 14),
  ('imobiliaria',   'Lotti Imobiliária',   'Para imobiliárias com equipe. Gestão, controle e indicadores por corretor.',    299.00, 2990.00, false, 3, 14)
on conflict (code) do nothing;

-- ────────────────────────────────────────────────────────────
-- 9. SEED DATA — Entitlements
-- ────────────────────────────────────────────────────────────
-- Helper: busca plan_id pelo code
do $$
declare
  pid_ess uuid;
  pid_pro uuid;
  pid_imo uuid;
begin
  select id into pid_ess from public.plans where code = 'essencial';
  select id into pid_pro from public.plans where code = 'profissional';
  select id into pid_imo from public.plans where code = 'imobiliaria';

  -- ── Limites numéricos ──
  -- max_users
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, limit_value, display_order) values
    (pid_ess, 'max_users',              'Usuários',                        'equipe',       1,    1),
    (pid_pro, 'max_users',              'Usuários',                        'equipe',       2,    1),
    (pid_imo, 'max_users',              'Usuários',                        'equipe',       10,   1);

  -- max_imoveis
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, limit_value, display_order) values
    (pid_ess, 'max_imoveis',            'Imóveis ativos',                  'imoveis',      100,  2),
    (pid_pro, 'max_imoveis',            'Imóveis ativos',                  'imoveis',      500,  2),
    (pid_imo, 'max_imoveis',            'Imóveis ativos',                  'imoveis',      null, 2);
  update public.plan_entitlements set unlimited = true where plan_id = pid_imo and feature_key = 'max_imoveis';

  -- max_fachadas
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, limit_value, display_order) values
    (pid_ess, 'max_fachadas',           'Fachadas Inteligentes ativas',    'fachadas',     5,    3),
    (pid_pro, 'max_fachadas',           'Fachadas Inteligentes ativas',    'fachadas',     25,   3),
    (pid_imo, 'max_fachadas',           'Fachadas Inteligentes ativas',    'fachadas',     100,  3);

  -- ai_contracts_monthly
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, limit_value, display_order) values
    (pid_ess, 'ai_contracts_monthly',   'Contratos com IA / mês',          'ia',           10,   4),
    (pid_pro, 'ai_contracts_monthly',   'Contratos com IA / mês',          'ia',           60,   4),
    (pid_imo, 'ai_contracts_monthly',   'Contratos com IA / mês',          'ia',           250,  4);

  -- ai_assistant_monthly
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, limit_value, display_order) values
    (pid_ess, 'ai_assistant_monthly',   'Interações com Assistente / mês', 'ia',           30,   5),
    (pid_pro, 'ai_assistant_monthly',   'Interações com Assistente / mês', 'ia',           300,  5),
    (pid_imo, 'ai_assistant_monthly',   'Interações com Assistente / mês', 'ia',           1500, 5);

  -- storage_gb
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, limit_value, display_order) values
    (pid_ess, 'storage_gb',             'Armazenamento de mídias',         'midias',       5,    6),
    (pid_pro, 'storage_gb',             'Armazenamento de mídias',         'midias',       25,   6),
    (pid_imo, 'storage_gb',             'Armazenamento de mídias',         'midias',       100,  6);

  -- ── Features booleanas ──
  -- Gestão de aluguéis
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, enabled, display_order) values
    (pid_ess, 'rental_management',      'Gestão completa de aluguéis',     'alugueis',     false, 10),
    (pid_pro, 'rental_management',      'Gestão completa de aluguéis',     'alugueis',     true,  10),
    (pid_imo, 'rental_management',      'Gestão completa de aluguéis',     'alugueis',     true,  10);

  -- Integração Asaas
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, enabled, display_order) values
    (pid_ess, 'asaas_integration',      'Integração Asaas (cobranças)',     'alugueis',     false, 11),
    (pid_pro, 'asaas_integration',      'Integração Asaas (cobranças)',     'alugueis',     true,  11),
    (pid_imo, 'asaas_integration',      'Integração Asaas (cobranças)',     'alugueis',     true,  11);

  -- Análise de contratos IA
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, enabled, display_order) values
    (pid_ess, 'ai_contract_analysis',   'Análise de contratos com IA',     'contratos',    false, 12),
    (pid_pro, 'ai_contract_analysis',   'Análise de contratos com IA',     'contratos',    true,  12),
    (pid_imo, 'ai_contract_analysis',   'Análise de contratos com IA',     'contratos',    true,  12);

  -- Exportação PDF/DOCX
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, enabled, display_order) values
    (pid_ess, 'contract_export',        'Exportação PDF e DOCX',           'contratos',    false, 13),
    (pid_pro, 'contract_export',        'Exportação PDF e DOCX',           'contratos',    true,  13),
    (pid_imo, 'contract_export',        'Exportação PDF e DOCX',           'contratos',    true,  13);

  -- Relatórios financeiros avançados
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, enabled, display_order) values
    (pid_ess, 'advanced_reports',       'Relatórios avançados',            'relatorios',   false, 14),
    (pid_pro, 'advanced_reports',       'Relatórios avançados',            'relatorios',   true,  14),
    (pid_imo, 'advanced_reports',       'Relatórios avançados',            'relatorios',   true,  14);

  -- Equipe e permissões
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, enabled, display_order) values
    (pid_ess, 'team_management',        'Gestão de equipe',                'equipe',       false, 15),
    (pid_pro, 'team_management',        'Gestão de equipe',                'equipe',       false, 15),
    (pid_imo, 'team_management',        'Gestão de equipe',                'equipe',       true,  15);

  -- Indicadores por corretor
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, enabled, display_order) values
    (pid_ess, 'team_analytics',         'Indicadores por corretor',        'equipe',       false, 16),
    (pid_pro, 'team_analytics',         'Indicadores por corretor',        'equipe',       false, 16),
    (pid_imo, 'team_analytics',         'Indicadores por corretor',        'equipe',       true,  16);

  -- Suporte prioritário
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, enabled, display_order) values
    (pid_ess, 'priority_support',       'Suporte prioritário',             'suporte',      false, 17),
    (pid_pro, 'priority_support',       'Suporte prioritário',             'suporte',      true,  17),
    (pid_imo, 'priority_support',       'Suporte prioritário',             'suporte',      true,  17);

  -- Onboarding orientado
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, enabled, display_order) values
    (pid_ess, 'guided_onboarding',      'Onboarding orientado',            'suporte',      false, 18),
    (pid_pro, 'guided_onboarding',      'Onboarding orientado',            'suporte',      false, 18),
    (pid_imo, 'guided_onboarding',      'Onboarding orientado',            'suporte',      true,  18);

  -- Automações e alertas
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, enabled, display_order) values
    (pid_ess, 'automations',            'Automações e alertas inteligentes', 'crm',        false, 19),
    (pid_pro, 'automations',            'Automações e alertas inteligentes', 'crm',        true,  19),
    (pid_imo, 'automations',            'Automações e alertas inteligentes', 'crm',        true,  19);

  -- Financeiro completo
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, enabled, display_order) values
    (pid_ess, 'full_financial',         'Controle financeiro completo',    'financeiro',   false, 20),
    (pid_pro, 'full_financial',         'Controle financeiro completo',    'financeiro',   true,  20),
    (pid_imo, 'full_financial',         'Controle financeiro completo',    'financeiro',   true,  20);

  -- Métricas detalhadas fachadas
  insert into public.plan_entitlements (plan_id, feature_key, feature_name, category, enabled, display_order) values
    (pid_ess, 'fachadas_analytics',     'Métricas detalhadas de Fachadas', 'fachadas',     false, 21),
    (pid_pro, 'fachadas_analytics',     'Métricas detalhadas de Fachadas', 'fachadas',     true,  21),
    (pid_imo, 'fachadas_analytics',     'Métricas detalhadas de Fachadas', 'fachadas',     true,  21);

end;
$$;

-- ────────────────────────────────────────────────────────────
-- 10. SEED DATA — Campanha de Fundador
-- ────────────────────────────────────────────────────────────
insert into public.pricing_campaigns (name, discount_type, discount_value, maximum_customers, starts_at, duration_months, active)
values (
  'Preço de Fundador — 100 primeiros',
  'percentage',
  20.00,
  100,
  now(),
  12,
  true
);
