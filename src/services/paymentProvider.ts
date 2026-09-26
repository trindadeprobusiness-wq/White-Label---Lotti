// ============================================================
// Lotti — Camada de abstração do gateway de pagamento
// ============================================================
//
// A assinatura SaaS da Lotti NÃO usa o mesmo Asaas que os
// clientes usam para cobranças de aluguel. Esta interface
// permite trocar o gateway sem alterar a lógica de planos.
//
// PENDÊNCIA: Implementar o provider real (Asaas subconta
// separada, Stripe, etc). Enquanto isso, falhar de forma explícita é parte do
// contrato: a interface nunca pode anunciar sucesso sem processar pagamento.
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

export class BillingIntegrationUnavailableError extends Error {
  constructor() {
    super('O checkout SaaS ainda não possui um gateway de pagamento configurado.');
    this.name = 'BillingIntegrationUnavailableError';
  }
}

/**
 * Estado único consumido pela tela. Só deve virar `true` quando um provider
 * server-side persistir a operação e confirmar a resposta do gateway.
 */
export const billingIntegrationReady = false;

export class UnavailablePaymentProvider implements PaymentProvider {
  async createSubscription(_params: CreateSubscriptionParams): Promise<{
    externalId: string;
    status: SubscriptionStatus;
  }> {
    throw new BillingIntegrationUnavailableError();
  }

  async cancelSubscription(_externalId: string): Promise<void> {
    throw new BillingIntegrationUnavailableError();
  }

  async createCheckoutUrl(_params: CreateCheckoutParams): Promise<string> {
    throw new BillingIntegrationUnavailableError();
  }

  async changePlan(
    _externalId: string,
    _newPlanCode: string,
    _billingCycle: BillingCycle,
  ): Promise<void> {
    throw new BillingIntegrationUnavailableError();
  }
}

export const paymentProvider: PaymentProvider = new UnavailablePaymentProvider();
