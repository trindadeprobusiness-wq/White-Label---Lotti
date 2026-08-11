import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { CreditCard, History, Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { useSubscriptionSummary, useAllPlans } from '@/hooks/useSubscription';
import { UsageBar } from '@/components/subscription/UsageBar';
import { PlanCard } from '@/components/subscription/PlanCard';
import { paymentProvider } from '@/services/paymentProvider';
import type { BillingCycle } from '@/types/subscription';

export function PlanoAssinatura() {
  const { data: summary, isLoading } = useSubscriptionSummary();
  const { data: plans } = useAllPlans();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!summary || !plans) {
    return (
      <div className="text-center py-12">
        <h3 className="text-lg font-medium">Erro ao carregar assinatura</h3>
        <p className="text-muted-foreground">Tente recarregar a página.</p>
      </div>
    );
  }

  const { subscription, plan, usage, addons, isReadOnly, daysLeftInTrial } = summary;

  const handlePlanSelect = async (planId: string) => {
    const selectedPlan = plans.find(p => p.id === planId);
    if (!selectedPlan) return;

    try {
      const url = await paymentProvider.createCheckoutUrl({
        corretorId: subscription.corretor_id,
        planCode: selectedPlan.code,
        billingCycle,
        returnUrl: window.location.href,
      });
      console.log('Redirecting to checkout:', url);
      // window.location.href = url;
    } catch (err) {
      console.error('Failed to create checkout:', err);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Plano e Assinatura</h1>
        <p className="text-muted-foreground">
          Gerencie seu plano atual, acompanhe seu consumo e adicione recursos extras.
        </p>
      </div>

      {isReadOnly && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
          <div>
            <h4 className="font-semibold text-destructive">Sua conta está no modo somente leitura</h4>
            <p className="text-sm text-destructive/80 mt-1">
              Seu período de teste expirou ou houve um problema com o pagamento. 
              Para voltar a adicionar imóveis e clientes, escolha um plano abaixo.
            </p>
          </div>
        </div>
      )}

      {/* Resumo do Plano Atual */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Plano Atual</CardTitle>
              {subscription.status === 'active' && <Badge variant="default" className="bg-green-600">Ativo</Badge>}
              {subscription.status === 'trialing' && <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-200">Em Teste</Badge>}
              {subscription.status === 'past_due' && <Badge variant="destructive">Atrasado</Badge>}
            </div>
            <CardDescription>Detalhamento da sua assinatura Lotti</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl font-bold">{plan.name}</span>
              </div>
              <p className="text-muted-foreground">
                Ciclo {subscription.billing_cycle === 'annual' ? 'Anual' : 'Mensal'}
              </p>
            </div>

            {daysLeftInTrial !== null && (
              <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
                Você tem <strong>{daysLeftInTrial} dias</strong> restantes no período de teste gratuito.
              </div>
            )}

            <Separator />

            <div className="grid gap-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Próxima cobrança
                </span>
                <span className="font-medium">
                  {subscription.current_period_end 
                    ? new Date(subscription.current_period_end).toLocaleDateString('pt-BR') 
                    : '-'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Consumo do Ciclo */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Consumo do Ciclo Atual</CardTitle>
            <CardDescription>Renova em 1º de cada mês</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 space-y-5">
            {usage.slice(0, 4).map((u) => (
              <UsageBar key={u.feature_key} usage={u} />
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Adicionais Contratados */}
      {addons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Recursos Adicionais
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {addons.map(addon => (
                <div key={addon.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium">{addon.addon_name}</p>
                    <p className="text-sm text-muted-foreground">Quantidade: {addon.quantity}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">R$ {addon.unit_price.toFixed(2)}/mês</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Separator className="my-8" />

      {/* Upgrade de Planos */}
      <div className="space-y-6">
        <div className="text-center space-y-2 max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold">Faça upgrade e libere mais recursos</h2>
          <p className="text-muted-foreground">
            Sua operação está crescendo? Nossos planos acompanham o seu ritmo.
          </p>
        </div>

        {/* Toggle Mensal/Anual */}
        <div className="flex justify-center items-center gap-4 mb-8">
          <span className={`text-sm font-medium ${billingCycle === 'monthly' ? 'text-foreground' : 'text-muted-foreground'}`}>
            Mensal
          </span>
          <Switch 
            checked={billingCycle === 'annual'} 
            onCheckedChange={(c) => setBillingCycle(c ? 'annual' : 'monthly')} 
          />
          <span className={`text-sm font-medium flex items-center gap-2 ${billingCycle === 'annual' ? 'text-foreground' : 'text-muted-foreground'}`}>
            Anual
            <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
              Economize 2 meses
            </Badge>
          </span>
        </div>

        {/* Cards dos Planos */}
        <div className="grid md:grid-cols-3 gap-6">
          {plans.map(p => (
            <PlanCard 
              key={p.id} 
              plan={p} 
              billingCycle={billingCycle} 
              campaign={summary.campaign}
              currentPlanId={subscription.plan_id}
              onSelect={handlePlanSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
