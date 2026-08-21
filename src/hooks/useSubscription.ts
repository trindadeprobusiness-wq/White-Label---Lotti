// ============================================================
// Lotti — Hook de assinatura e limites
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCRMStore } from '@/stores/crmStore';
import type {
  Plan,
  PlanEntitlement,
  PlanWithEntitlements,
  Subscription,
  UsageCounter,
  UsageSummary,
  SubscriptionAddon,
  PricingCampaign,
  FeatureKey,
  SubscriptionSummary,
} from '@/types/subscription';

// ── Buscar todos os planos (com entitlements) ──
export function useAllPlans() {
  return useQuery({
    queryKey: ['plans'],
    queryFn: async (): Promise<PlanWithEntitlements[]> => {
      const { data: plans, error: pErr } = await supabase
        .from('plans')
        .select('*')
        .eq('active', true)
        .order('display_order');

      if (pErr) throw pErr;

      const { data: entitlements, error: eErr } = await supabase
        .from('plan_entitlements')
        .select('*')
        .order('display_order');

      if (eErr) throw eErr;

      return (plans as Plan[]).map((plan) => ({
        ...plan,
        entitlements: (entitlements as PlanEntitlement[]).filter(
          (e) => e.plan_id === plan.id
        ),
      }));
    },
    staleTime: 5 * 60_000, // planos mudam raramente
  });
}

// ── Buscar assinatura ativa do corretor logado ──
export function useCurrentSubscription() {
  const corretorId = useCRMStore((s) => s.corretor?.id);

  return useQuery({
    queryKey: ['subscription', corretorId],
    queryFn: async (): Promise<Subscription | null> => {
      if (!corretorId) return null;

      const { data, error } = await supabase
        .from('subscriptions')
        .select('*, plan:plans(*)')
        .eq('corretor_id', corretorId)
        .in('status', ['trialing', 'active', 'past_due', 'read_only'])
        .maybeSingle();

      if (error) throw error;
      return data as Subscription | null;
    },
    enabled: !!corretorId,
  });
}

// ── Buscar contadores de uso do período atual ──
export function useUsage() {
  const corretorId = useCRMStore((s) => s.corretor?.id);

  return useQuery({
    queryKey: ['usage', corretorId],
    queryFn: async (): Promise<UsageCounter[]> => {
      if (!corretorId) return [];

      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split('T')[0];

      const { data, error } = await supabase
        .from('usage_counters')
        .select('*')
        .eq('corretor_id', corretorId)
        .eq('period_start', periodStart);

      if (error) throw error;
      return (data as UsageCounter[]) || [];
    },
    enabled: !!corretorId,
  });
}

// ── Buscar adicionais ativos ──
export function useAddons() {
  const corretorId = useCRMStore((s) => s.corretor?.id);

  return useQuery({
    queryKey: ['addons', corretorId],
    queryFn: async (): Promise<SubscriptionAddon[]> => {
      if (!corretorId) return [];

      const { data, error } = await supabase
        .from('subscription_addons')
        .select('*')
        .eq('corretor_id', corretorId)
        .eq('status', 'active');

      if (error) throw error;
      return (data as SubscriptionAddon[]) || [];
    },
    enabled: !!corretorId,
  });
}

// ── Buscar campanha ativa ──
export function useActiveCampaign() {
  return useQuery({
    queryKey: ['campaign'],
    queryFn: async (): Promise<PricingCampaign | null> => {
      const { data, error } = await supabase
        .from('pricing_campaigns')
        .select('*')
        .eq('active', true)
        .maybeSingle();

      if (error) throw error;
      return data as PricingCampaign | null;
    },
    staleTime: 5 * 60_000,
  });
}

// ── Verificar limite de uma feature ──
export function useCheckLimit() {
  const { data: subscription } = useCurrentSubscription();
  const { data: plans } = useAllPlans();
  const { data: usage } = useUsage();
  const { data: addons } = useAddons();

  /**
   * Verifica se o corretor pode executar a ação limitada.
   * Retorna { allowed, used, limit, unlimited }
   */
  const checkLimit = (featureKey: FeatureKey): {
    allowed: boolean;
    used: number;
    limit: number | null;
    unlimited: boolean;
    ratio: number | null;
    status: 'ok' | 'warning' | 'exceeded';
  } => {
    // Sem assinatura, sem plano ou sem entitlement → LIBERA.
    //
    // Antes bloqueava, e isso teria travado a base inteira no dia em que os
    // limites fossem ligados: hoje nenhum corretor tem linha em `subscriptions`,
    // e nada cria uma. Todo botão protegido apareceria desabilitado para todo
    // mundo, sem ninguém entender por quê.
    //
    // A assimetria é deliberada. Aqui, no front, o risco é impedir o corretor de
    // usar o CRM DELE por causa de uma consulta de cobrança que falhou — e isso
    // é muito pior que alguém passar um pouco da cota. No servidor
    // (`_shared/cotas.ts`) o padrão é o oposto: sem assinatura, a IA não roda,
    // porque ali o risco é gastar inferência por quem não paga. Dado do cliente
    // falha aberto; nosso dinheiro falha fechado.
    const LIBERADO = {
      allowed: true, used: 0, limit: null, unlimited: true,
      ratio: null, status: 'ok',
    } as const;

    if (!subscription || !plans) return LIBERADO;

    const plan = plans.find((p) => p.id === subscription.plan_id);
    if (!plan) return LIBERADO;

    const entitlement = plan.entitlements.find((e) => e.feature_key === featureKey);
    if (!entitlement) return LIBERADO;

    // Feature boolean (tem ou não tem)
    if (entitlement.limit_value === null && !entitlement.unlimited) {
      return {
        allowed: entitlement.enabled,
        used: 0,
        limit: null,
        unlimited: false,
        ratio: null,
        status: entitlement.enabled ? 'ok' : 'exceeded',
      };
    }

    // Feature ilimitada
    if (entitlement.unlimited) {
      return { allowed: true, used: 0, limit: null, unlimited: true, ratio: null, status: 'ok' };
    }

    // Feature com limite numérico
    let baseLimit = entitlement.limit_value || 0;

    // Somar adicionais que expandem esse limite
    if (addons) {
      const addonMap: Record<string, FeatureKey> = {
        extra_user: 'max_users',
        extra_fachadas_25: 'max_fachadas',
        extra_ai_100: 'ai_contracts_monthly',
        extra_storage_50: 'storage_gb',
      };
      const addonMultiplier: Record<string, number> = {
        extra_user: 1,
        extra_fachadas_25: 25,
        extra_ai_100: 100,
        extra_storage_50: 50,
      };

      for (const addon of addons) {
        if (addonMap[addon.addon_code] === featureKey) {
          baseLimit += (addonMultiplier[addon.addon_code] || 0) * addon.quantity;
        }
      }
    }

    // Consumo atual
    const counter = usage?.find((u) => u.feature_key === featureKey);
    const used = counter?.used_quantity || 0;
    const ratio = baseLimit > 0 ? used / baseLimit : 0;
    const status = ratio >= 1 ? 'exceeded' : ratio >= 0.8 ? 'warning' : 'ok';

    return {
      allowed: used < baseLimit,
      used,
      limit: baseLimit,
      unlimited: false,
      ratio,
      status,
    };
  };

  return checkLimit;
}

// ── Incrementar uso (chamado após operação bem-sucedida) ──
export function useIncrementUsage() {
  const corretorId = useCRMStore((s) => s.corretor?.id);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (featureKey: FeatureKey) => {
      if (!corretorId) throw new Error('Corretor não logado');

      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split('T')[0];
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        .toISOString()
        .split('T')[0];

      // Upsert: cria ou incrementa
      const { data: existing } = await supabase
        .from('usage_counters')
        .select('id, used_quantity')
        .eq('corretor_id', corretorId)
        .eq('feature_key', featureKey)
        .eq('period_start', periodStart)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('usage_counters')
          .update({ used_quantity: existing.used_quantity + 1 })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('usage_counters')
          .insert({
            corretor_id: corretorId,
            feature_key: featureKey,
            used_quantity: 1,
            period_start: periodStart,
            period_end: periodEnd,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usage', corretorId] });
    },
  });
}

// ── Resumo completo para a página /plano ──
export function useSubscriptionSummary(): {
  data: SubscriptionSummary | null;
  isLoading: boolean;
} {
  const { data: subscription, isLoading: subLoading } = useCurrentSubscription();
  const { data: plans, isLoading: plansLoading } = useAllPlans();
  const { data: usage, isLoading: usageLoading } = useUsage();
  const { data: addons, isLoading: addonsLoading } = useAddons();
  const { data: campaign } = useActiveCampaign();
  const checkLimit = useCheckLimit();

  const isLoading = subLoading || plansLoading || usageLoading || addonsLoading;

  if (isLoading || !subscription || !plans) {
    return { data: null, isLoading };
  }

  const plan = plans.find((p) => p.id === subscription.plan_id);
  if (!plan) return { data: null, isLoading: false };

  // Construir resumo de uso
  const measurableKeys: FeatureKey[] = [
    // Primeiro da lista de propósito: é a cota que o corretor precisa
    // acompanhar, e a única que gera cobrança de excedente.
    'leads_qualificados_monthly',
    'max_contratos_locacao',
    'max_users',
    'max_imoveis',
    'max_fachadas',
    'ai_contracts_monthly',
    'ai_assistant_monthly',
    'storage_gb',
  ];

  const usageSummary: UsageSummary[] = measurableKeys.map((key) => {
    const ent = plan.entitlements.find((e) => e.feature_key === key);
    const check = checkLimit(key);
    return {
      feature_key: key,
      feature_name: ent?.feature_name || key,
      used: check.used,
      limit: check.limit,
      unlimited: check.unlimited,
      ratio: check.ratio,
      status: check.status,
    };
  });

  // Dias restantes no trial
  let daysLeftInTrial: number | null = null;
  if (subscription.status === 'trialing' && subscription.trial_ends_at) {
    const diff = new Date(subscription.trial_ends_at).getTime() - Date.now();
    daysLeftInTrial = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  return {
    data: {
      subscription,
      plan,
      usage: usageSummary,
      addons: addons || [],
      campaign: campaign || null,
      daysLeftInTrial,
      isReadOnly: subscription.status === 'read_only',
    },
    isLoading: false,
  };
}
