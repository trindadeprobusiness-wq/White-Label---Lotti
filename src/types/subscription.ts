// ============================================================
// Lotti — Tipos do sistema de planos e assinaturas
// ============================================================

export type BillingCycle = 'monthly' | 'annual';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'read_only';

export type DiscountType = 'percentage' | 'fixed';
export type AddonStatus = 'active' | 'canceled';

// ── Plan ──
export interface Plan {
  id: string;
  code: 'essencial' | 'profissional' | 'imobiliaria';
  name: string;
  description: string;
  monthly_price: number;
  annual_price: number;
  active: boolean;
  highlighted: boolean;
  display_order: number;
  trial_days: number;
  created_at: string;
  updated_at: string;
}

// ── Plan Entitlement ──
export interface PlanEntitlement {
  id: string;
  plan_id: string;
  feature_key: FeatureKey;
  feature_name: string;
  category: EntitlementCategory;
  enabled: boolean;
  limit_value: number | null;
  unlimited: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

// Feature keys — mapeiam diretamente ao seed do banco
export type FeatureKey =
  | 'max_users'
  | 'max_imoveis'
  | 'max_fachadas'
  | 'ai_contracts_monthly'
  | 'ai_assistant_monthly'
  | 'storage_gb'
  | 'rental_management'
  | 'asaas_integration'
  | 'ai_contract_analysis'
  | 'contract_export'
  | 'advanced_reports'
  | 'team_management'
  | 'team_analytics'
  | 'priority_support'
  | 'guided_onboarding'
  | 'automations'
  | 'full_financial'
  | 'fachadas_analytics';

export type EntitlementCategory =
  | 'equipe'
  | 'imoveis'
  | 'fachadas'
  | 'ia'
  | 'midias'
  | 'alugueis'
  | 'contratos'
  | 'relatorios'
  | 'suporte'
  | 'crm'
  | 'financeiro'
  | 'geral';

// ── Subscription ──
export interface Subscription {
  id: string;
  corretor_id: string;
  plan_id: string;
  billing_cycle: BillingCycle;
  status: SubscriptionStatus;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  cancel_reason: string | null;
  external_subscription_id: string | null;
  founder_campaign_id: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  plan?: Plan;
}

// ── Usage Counter ──
export interface UsageCounter {
  id: string;
  corretor_id: string;
  feature_key: FeatureKey;
  used_quantity: number;
  period_start: string;
  period_end: string;
  created_at: string;
  updated_at: string;
}

// ── Subscription Addon ──
export interface SubscriptionAddon {
  id: string;
  subscription_id: string;
  corretor_id: string;
  addon_code: AddonCode;
  addon_name: string;
  quantity: number;
  unit_price: number;
  status: AddonStatus;
  created_at: string;
  updated_at: string;
}

export type AddonCode =
  | 'extra_user'
  | 'extra_fachadas_25'
  | 'extra_ai_100'
  | 'extra_storage_50'
  | 'whatsapp_api'
  | 'migration_onboarding';

// ── Pricing Campaign ──
export interface PricingCampaign {
  id: string;
  name: string;
  discount_type: DiscountType;
  discount_value: number;
  maximum_customers: number | null;
  current_customers: number;
  starts_at: string;
  ends_at: string | null;
  duration_months: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// ── Computed / UI helpers ──
export interface PlanWithEntitlements extends Plan {
  entitlements: PlanEntitlement[];
}

export interface UsageSummary {
  feature_key: FeatureKey;
  feature_name: string;
  used: number;
  limit: number | null;
  unlimited: boolean;
  /** 0-1 percentage; null if unlimited */
  ratio: number | null;
  /** 'ok' | 'warning' (≥80%) | 'exceeded' (100%) */
  status: 'ok' | 'warning' | 'exceeded';
}

export interface SubscriptionSummary {
  subscription: Subscription;
  plan: PlanWithEntitlements;
  usage: UsageSummary[];
  addons: SubscriptionAddon[];
  campaign: PricingCampaign | null;
  daysLeftInTrial: number | null;
  isReadOnly: boolean;
}

// ── Addon catalog (for display) ──
export interface AddonDefinition {
  code: AddonCode;
  name: string;
  description: string;
  price: number;
  unit: string; // '/mês', 'único'
  perUnit?: string; // 'por usuário', 'por pacote'
}

// ── Analytics events ──
export type PlanAnalyticsEvent =
  | 'view_pricing'
  | 'toggle_billing_cycle'
  | 'click_plan'
  | 'start_trial'
  | 'activate_trial'
  | 'convert_trial'
  | 'choose_plan'
  | 'upgrade'
  | 'downgrade'
  | 'cancel'
  | 'cancel_reason'
  | 'limit_reached'
  | 'buy_addon'
  | 'use_fachada'
  | 'use_ai_contract'
  | 'use_ai_assistant';
