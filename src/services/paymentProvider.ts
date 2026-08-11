// ============================================================
// Lotti — Camada de abstração do gateway de pagamento
// ============================================================
//
// A assinatura SaaS da Lotti NÃO usa o mesmo Asaas que os
// clientes usam para cobranças de aluguel. Esta interface
// permite trocar o gateway sem alterar a lógica de planos.
//
// PENDÊNCIA: Implementar o provider real (Asaas subconta
// separada, Stripe, etc). A implementação atual é um MOCK
// que apenas retorna os estados sem processar pagamento.
// ============================================================

import type { BillingCycle, SubscriptionStatus } from '@/types/subscription';

export interface CreateSubscriptionParams {
  corretorId: string;
  planCode: string;
  billingCycle: BillingCycle;
  campaignId?: string;
}

export interface CreateCheckoutParams {
  corretorId: string;
  planCode: string;
  billingCycle: BillingCycle;
  returnUrl: string;
}

export interface PaymentProvider {
  /** Cria uma assinatura no gateway e retorna o ID externo */
  createSubscription(params: CreateSubscriptionParams): Promise<{
    externalId: string;
    status: SubscriptionStatus;
  }>;

  /** Cancela uma assinatura no gateway */
  cancelSubscription(externalId: string): Promise<void>;

  /** Gera URL de checkout para o cliente pagar */
  createCheckoutUrl(params: CreateCheckoutParams): Promise<string>;

  /** Troca o plano de uma assinatura existente */
  changePlan(externalId: string, newPlanCode: string, billingCycle: BillingCycle): Promise<void>;
}

// ── Implementação Mock (para desenvolvimento) ──
export class MockPaymentProvider implements PaymentProvider {
  async createSubscription(params: CreateSubscriptionParams) {
    console.log('[MockPayment] createSubscription', params);
    return {
      externalId: `mock_sub_${Date.now()}`,
      status: 'trialing' as SubscriptionStatus,
    };
  }

  async cancelSubscription(externalId: string) {
    console.log('[MockPayment] cancelSubscription', externalId);
  }

  async createCheckoutUrl(params: CreateCheckoutParams) {
    console.log('[MockPayment] createCheckoutUrl', params);
    // Em produção, retornaria a URL do checkout do gateway
    return params.returnUrl;
  }

  async changePlan(externalId: string, newPlanCode: string, billingCycle: BillingCycle) {
    console.log('[MockPayment] changePlan', { externalId, newPlanCode, billingCycle });
  }
}

// Singleton — troque por `new AsaasProvider()` ou `new StripeProvider()` quando integrar
export const paymentProvider: PaymentProvider = new MockPaymentProvider();
