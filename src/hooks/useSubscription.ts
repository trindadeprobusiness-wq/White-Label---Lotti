// ============================================================
// Lotti — Hook de assinatura e limites
// ============================================================

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import * as assinaturaApi from '@/lib/api/assinatura';
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
  LimitCheck,
} from '@/types/subscription';
import { proximoPlanoParaCota } from '@/lib/planos';
import { monthlyUsagePeriod } from '@/lib/billingPeriod';

// ── Buscar todos os planos (com entitlements) ──
export function useAllPlans() {
  return useQuery({
    queryKey: ['plans'],
    queryFn: async (): Promise<PlanWithEntitlements[]> => {
      if (apiDisponivel()) {
        const [plans, entitlements] = await Promise.all([
          assinaturaApi.listarPlanosApi() as Promise<unknown> as Promise<Plan[]>,
          assinaturaApi.listarEntitlementsApi() as Promise<unknown> as Promise<PlanEntitlement[]>,
        ]);
        return plans.map((plan) => ({
          ...plan,
          entitlements: entitlements.filter((e) => e.plan_id === plan.id),
        }));
      }
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
      if (apiDisponivel()) return (await assinaturaApi.assinaturaAtualApi()) as unknown as Subscription | null;

      const { data, error } = await supabase
        .from('subscriptions')
        .select('*, plan:plans(*)')
        .eq('corretor_id', corretorId)
        .order('created_at', { ascending: false })
        .limit(1)
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
      if (apiDisponivel()) {
        const uso = await assinaturaApi.usoAssinaturaApi();
        const agora = new Date().toISOString();
        const counters = [...(uso.contadores as unknown as UsageCounter[])];
        const ativosApi: Array<[FeatureKey, number]> = [
          ['max_imoveis', uso.ativos.max_imoveis],
          ['max_contratos_locacao', uso.ativos.max_contratos_locacao],
          ['max_fachadas', uso.ativos.max_fachadas],
        ];
        for (const [featureKey, used] of ativosApi) {
          const existing = counters.find((counter) => counter.feature_key === featureKey);
          if (existing) existing.used_quantity = used;
          else counters.push({
            id: `active:${featureKey}`,
            corretor_id: corretorId,
            feature_key: featureKey,
            used_quantity: used,
            period_start: uso.period_start,
            period_end: uso.period_end,
            created_at: agora,
            updated_at: agora,
          });
        }
        return counters;
      }

      const now = new Date();
      const { start: periodStart, end: periodEnd } = monthlyUsagePeriod(now);
      const [monthly, imoveis, contratos, fachadas] = await Promise.all([
        supabase.from('usage_counters').select('*')
          .eq('corretor_id', corretorId).eq('period_start', periodStart),
        supabase.from('imoveis').select('id', { count: 'exact', head: true })
          .eq('corretor_id', corretorId).eq('ativo', true),
        supabase.from('contratos').select('id', { count: 'exact', head: true })
          .eq('corretor_id', corretorId).in('tipo', ['LOCACAO_RESIDENCIAL', 'LOCACAO_COMERCIAL']).eq('status', 'ATIVO'),
        supabase.from('fachadas').select('id', { count: 'exact', head: true })
          .eq('corretor_id', corretorId).eq('ativo', true),
      ]);

      if (monthly.error) throw monthly.error;
      if (imoveis.error) throw imoveis.error;
      if (contratos.error) throw contratos.error;
      if (fachadas.error) throw fachadas.error;

      const counters = [...((monthly.data as UsageCounter[]) || [])];
      const ativos: Array<[FeatureKey, number]> = [
        ['max_imoveis', imoveis.count ?? 0],
        ['max_contratos_locacao', contratos.count ?? 0],
        ['max_fachadas', fachadas.count ?? 0],
      ];
      for (const [featureKey, used] of ativos) {
        const existing = counters.find((counter) => counter.feature_key === featureKey);
        if (existing) existing.used_quantity = used;
        else counters.push({
          id: `active:${featureKey}`,
          corretor_id: corretorId,
          feature_key: featureKey,
          used_quantity: used,
          period_start: periodStart,
          period_end: periodEnd,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        });
      }
      return counters;
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
      if (apiDisponivel()) return (await assinaturaApi.addonsApi()) as unknown as SubscriptionAddon[];

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
      if (apiDisponivel()) return (await assinaturaApi.campanhaAtivaApi()) as unknown as PricingCampaign | null;
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

// ── Conta antiga: imóveis, fachadas e aluguéis sem limite, mesmo em teste ──
// A regra mora no banco (conta_antiga_sem_limite, migration 20261003120000) e
// é a mesma que checar_cota usa. A tela não enxerga billing_legacy_accounts,
// então pergunta.
const RECURSOS_DA_CONTA_ANTIGA: FeatureKey[] = ['max_imoveis', 'max_fachadas', 'max_contratos_locacao'];

export function useContaAntigaSemLimite() {
  const corretorId = useCRMStore((s) => s.corretor?.id);

  return useQuery({
    queryKey: ['conta-antiga-sem-limite', corretorId],
    queryFn: async (): Promise<boolean> => {
      if (apiDisponivel()) return assinaturaApi.contaAntigaSemLimiteApi();
      const { data, error } = await supabase.rpc('conta_antiga_sem_limite' as never, {
        _corretor_id: corretorId,
      } as never);
      if (error) throw error;
      return data === true;
    },
    enabled: !!corretorId,
  });
}

// Só a primeira tentativa segura a tela. Se ela falha, vale o plano enquanto
// o TanStack tenta de novo — em vez de travar uns 7s a cada tentativa.
const aguardandoContaAntiga = (q: { isLoading: boolean; failureCount: number }) => q.isLoading && q.failureCount === 0;

// ── Verificar limite de uma feature ──
export function useCheckLimit() {
  const subscriptionQuery = useCurrentSubscription();
  const plansQuery = useAllPlans();
  const usageQuery = useUsage();
  const addonsQuery = useAddons();
  const contaAntigaQuery = useContaAntigaSemLimite();
  const subscription = subscriptionQuery.data;
  const plans = plansQuery.data;
  const usage = usageQuery.data;
  const addons = addonsQuery.data;

  /**
   * Verifica se o corretor pode executar a ação limitada.
   * Retorna { allowed, used, limit, unlimited }
   */
  const checkLimit = (featureKey: FeatureKey): LimitCheck => {
    // A pergunta da conta antiga só segura os três recursos que ela decide —
    // IA e leads não esperam por ela. E um erro nela não trava nada: sem a
    // resposta, vale o plano, o mesmo de antes da isenção.
    const recursoDaContaAntiga = RECURSOS_DA_CONTA_ANTIGA.includes(featureKey);
    const ready = !subscriptionQuery.isLoading && !plansQuery.isLoading
      && !usageQuery.isLoading && !addonsQuery.isLoading
      && !(recursoDaContaAntiga && aguardandoContaAntiga(contaAntigaQuery))
      && !subscriptionQuery.error && !plansQuery.error && !usageQuery.error && !addonsQuery.error;
    const BLOQUEADO = {
      allowed: false, used: 0, limit: 0, unlimited: false,
      ratio: 1, status: 'exceeded', featureName: featureKey,
      currentPlan: null, recommendedPlan: null, ready,
    } as const;

    if (!ready) return BLOQUEADO;

    // Preserva contas legadas ainda sem assinatura cadastrada, como na main.
    // A autorização de operações de IA continua sendo verificada no servidor.
    const LEGADO = {
      ...BLOQUEADO, allowed: true, limit: null, unlimited: true,
      ratio: null, status: 'ok',
    } as const;
    if (!subscription || !plans) return LEGADO;
    // Conta antiga com assinatura de teste — ativa ou já vencida — continua
    // sem limite nesses três recursos. As demais cotas seguem o plano.
    if (recursoDaContaAntiga && contaAntigaQuery.data === true) return LEGADO;

    const plan = plans.find((p) => p.id === subscription.plan_id);
    if (!plan) return BLOQUEADO;

    const endsAt = subscription.status === 'trialing' ? subscription.trial_ends_at : subscription.current_period_end;
    if (!['active', 'trialing'].includes(subscription.status) || !endsAt || Date.parse(endsAt) <= Date.now()) {
      return { ...BLOQUEADO, currentPlan: plan };
    }

    const entitlement = plan.entitlements.find((e) => e.feature_key === featureKey);
    if (!entitlement) return BLOQUEADO;
    const common = {
      featureName: entitlement.feature_name,
      currentPlan: plan,
      recommendedPlan: proximoPlanoParaCota(plans, plan.id, featureKey),
      ready: true,
    };
    if (!entitlement.enabled) return { ...BLOQUEADO, ...common };

    // Feature boolean (tem ou não tem)
    if (entitlement.limit_value === null && !entitlement.unlimited) {
      return {
        allowed: entitlement.enabled,
        used: 0,
        limit: null,
        unlimited: false,
        ratio: null,
        status: entitlement.enabled ? 'ok' : 'exceeded',
        ...common,
      };
    }

    // Feature ilimitada
    if (entitlement.unlimited) {
      return { allowed: true, used: 0, limit: null, unlimited: true, ratio: null, status: 'ok', ...common };
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
      ...common,
    };
  };

  return checkLimit;
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
  const contaAntigaQuery = useContaAntigaSemLimite();
  const contaAntiga = contaAntigaQuery.data;
  const contaAntigaLoading = aguardandoContaAntiga(contaAntigaQuery);
  const checkLimit = useCheckLimit();

  // Sem esperar a conta antiga, /plano mostraria imóveis, fachadas e aluguéis
  // como "0 de 0 · Limite atingido" enquanto ela carrega.
  const isLoading = subLoading || plansLoading || usageLoading || addonsLoading || contaAntigaLoading;

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
      contaAntigaSemLimite: contaAntiga === true,
      isReadOnly: !['active', 'trialing'].includes(subscription.status)
        || !((subscription.status === 'trialing' ? subscription.trial_ends_at : subscription.current_period_end))
        || Date.parse((subscription.status === 'trialing' ? subscription.trial_ends_at : subscription.current_period_end)!) <= Date.now(),
    },
    isLoading: false,
  };
}
