import { describe, expect, it } from 'vitest';
import {
  BillingIntegrationUnavailableError,
  billingIntegrationReady,
  paymentProvider,
} from './paymentProvider';

describe('paymentProvider sem gateway SaaS', () => {
  it('não anuncia integração pronta', () => {
    expect(billingIntegrationReady).toBe(false);
  });

  it('nunca simula checkout ou sucesso de mutação', async () => {
    await expect(paymentProvider.createCheckoutUrl({
      corretorId: 'corretor',
      planCode: 'profissional',
      billingCycle: 'monthly',
      returnUrl: 'https://app.example.com/plano',
    })).rejects.toBeInstanceOf(BillingIntegrationUnavailableError);
    await expect(paymentProvider.cancelSubscription('sub')).rejects.toBeInstanceOf(
      BillingIntegrationUnavailableError,
    );
  });
});
