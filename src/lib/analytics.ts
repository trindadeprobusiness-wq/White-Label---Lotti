// ============================================================
// Lotti — Analytics / Event tracking
// ============================================================
//
// Todos os eventos de planos, assinaturas e limites passam
// por aqui. Implementação inicial: console.log em dev.
// Troque por Mixpanel, PostHog, Segment ou GA4 quando pronto.
// ============================================================

import type { PlanAnalyticsEvent } from '@/types/subscription';

type EventProperties = Record<string, string | number | boolean | null>;

const IS_DEV = import.meta.env.DEV;

/**
 * Dispara um evento de analytics.
 * Em dev, loga no console. Em produção, envia para o provider.
 */
export function track(event: PlanAnalyticsEvent, properties?: EventProperties) {
  if (IS_DEV) {
    console.log(`[Analytics] ${event}`, properties || {});
  }

  // TODO: Integrar com provider real
  // posthog.capture(event, properties);
  // mixpanel.track(event, properties);
}

/**
 * Convenience wrappers para eventos frequentes
 */
export const planEvents = {
  viewPricing: () => track('view_pricing'),

  toggleBillingCycle: (cycle: 'monthly' | 'annual') =>
    track('toggle_billing_cycle', { cycle }),

  clickPlan: (planCode: string, billingCycle: string) =>
    track('click_plan', { plan: planCode, billing_cycle: billingCycle }),

  startTrial: (planCode: string) =>
    track('start_trial', { plan: planCode }),

  convertTrial: (planCode: string, billingCycle: string) =>
    track('convert_trial', { plan: planCode, billing_cycle: billingCycle }),

  upgrade: (from: string, to: string) =>
    track('upgrade', { from_plan: from, to_plan: to }),

  downgrade: (from: string, to: string) =>
    track('downgrade', { from_plan: from, to_plan: to }),

  cancel: (planCode: string, reason?: string) =>
    track('cancel', { plan: planCode, reason: reason || '' }),

  limitReached: (featureKey: string, planCode: string) =>
    track('limit_reached', { feature: featureKey, plan: planCode }),

  buyAddon: (addonCode: string) =>
    track('buy_addon', { addon: addonCode }),
} as const;
