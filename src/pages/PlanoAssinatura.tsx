import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { CreditCard, Loader2, Sparkles, AlertTriangle, Ban } from 'lucide-react';
import { useSubscriptionSummary, useAllPlans } from '@/hooks/useSubscription';
import { UsageBar } from '@/components/subscription/UsageBar';
import { PlanCard } from '@/components/subscription/PlanCard';
import { billingIntegrationReady, paymentProvider } from '@/services/paymentProvider';
import type { BillingCycle, FeatureKey, PlanWithEntitlements, SubscriptionSummary } from '@/types/subscription';
import { acaoEntrePlanos, cotasIncompativeis } from '@/lib/planos';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const DEMO_LIMITS: Record<string, [number | null, number | null, number | null]> = {
  max_imoveis: [250, 1500, null],
  max_contratos_locacao: [5, 30, null],
  max_fachadas: [15, 60, null],
  ai_contracts_monthly: [10, 25, 40],
  leads_qualificados_monthly: [100, 250, 600],
};

// Mantida exportada para o teste da prévia local; não carrega estado global.
// eslint-disable-next-line react-refresh/only-export-components
export function criarAssinaturaDemonstracao(
  planoAtual: 'essencial' | 'profissional' | 'imobiliaria' = 'essencial',
): { summary: SubscriptionSummary; plans: PlanWithEntitlements[] } {
  const now = new Date();
  const iso = now.toISOString();
  const codes = ['essencial', 'profissional', 'imobiliaria'] as const;
  const names = ['Lotti Inteligente', 'Lotti Profissional', 'Lotti Eficazes'] as const;
  const prices = [279, 399, 799];
  const featureNames: Record<string, string> = {
    leads_qualificados_monthly: 'Leads atendidos pela IA / mês',
    max_imoveis: 'Imóveis ativos',
    max_contratos_locacao: 'Contratos de aluguel ativos',
    max_fachadas: 'Fachadas Inteligentes',
    ai_contracts_monthly: 'Operações com IA por mês',
  };
  const plans = codes.map((code, index): PlanWithEntitlements => ({
    id: `demo-${code}`, code, name: names[index],
    description: 'Plano demonstrativo para visualização local.',
    monthly_price: prices[index], annual_price: prices[index] * 10,
    active: true, highlighted: code === 'profissional', display_order: index + 1,
    trial_days: 14, created_at: iso, updated_at: iso,
    entitlements: Object.entries(DEMO_LIMITS).map(([key, limits], order) => ({
      id: `demo-${code}-${key}`, plan_id: `demo-${code}`,
      feature_key: key as FeatureKey, feature_name: featureNames[key],
      category: key === 'max_imoveis' ? 'imoveis' : key === 'max_fachadas' ? 'fachadas' : 'contratos',
      enabled: true, limit_value: limits[index], unlimited: limits[index] === null,
      display_order: order + 1, created_at: iso, updated_at: iso,
    })),
  }));
  const plan = plans.find((item) => item.code === planoAtual) ?? plans[0];
  const used: Record<string, number> = {
    max_imoveis: 4, max_contratos_locacao: 2, max_fachadas: 5, ai_contracts_monthly: 7,
  };
  return {
    plans,
    summary: {
      subscription: {
        id: 'demo-subscription', corretor_id: 'demo-corretor', plan_id: plan.id,
        billing_cycle: 'monthly', status: 'active', trial_started_at: null, trial_ends_at: null,
        current_period_start: iso,
        current_period_end: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
        cancel_at_period_end: false, canceled_at: null, cancel_reason: null,
        external_subscription_id: null, founder_campaign_id: null, created_at: iso, updated_at: iso,
      },
      plan,
      usage: plan.entitlements.map((entitlement) => {
        const value = used[entitlement.feature_key] ?? 0;
        const limit = entitlement.limit_value;
        const ratio = limit === null ? null : value / limit;
        return {
          feature_key: entitlement.feature_key, feature_name: entitlement.feature_name,
          used: value, limit, unlimited: entitlement.unlimited, ratio,
          status: ratio !== null && ratio >= 1 ? 'exceeded' : ratio !== null && ratio >= 0.8 ? 'warning' : 'ok',
        };
      }),
      addons: [], campaign: null, daysLeftInTrial: null, isReadOnly: false,
    },
  };
}

export function PlanoAssinatura() {
  const { data: summary, isLoading } = useSubscriptionSummary();
  const { data: plans } = useAllPlans();
  const demoParametro = new URLSearchParams(window.location.search).get('demo');
  const demoSolicitada = ['assinatura', 'essencial', 'profissional', 'imobiliaria'].includes(demoParametro ?? '');
  const planoDemo = demoParametro === 'profissional' || demoParametro === 'imobiliaria'
    ? demoParametro
    : 'essencial';
  // No localhost, uma conta sem assinatura recebe uma prévia visual automaticamente.
  // Nenhum dado fictício é persistido e builds de produção nunca ativam este fallback.
  const demoAtiva = import.meta.env.DEV && (demoSolicitada || (!isLoading && !summary));
  const demo = demoAtiva ? criarAssinaturaDemonstracao(planoDemo) : null;
  const summaryExibido = demo?.summary ?? summary;
  const plansExibidos = demo?.plans ?? plans;
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);

  if (isLoading && !demoAtiva) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!summaryExibido || !plansExibidos) {
    return (
      <div className="text-center py-12">
        <h3 className="text-lg font-medium">Erro ao carregar assinatura</h3>
        <p className="text-muted-foreground">Tente recarregar a página.</p>
      </div>
    );
  }

  const { subscription, plan, usage, addons, isReadOnly, daysLeftInTrial } = summaryExibido;

  const handlePlanSelect = async (planId: string) => {
    const selectedPlan = plansExibidos.find(p => p.id === planId);
    if (!selectedPlan) return;

    const action = acaoEntrePlanos(plan, selectedPlan);
    if (action === 'current') return;
    const incompatíveis = action === 'downgrade' ? cotasIncompativeis(selectedPlan, usage) : [];
    if (incompatíveis.length) {
      toast.error(`Reduza o uso de ${incompatíveis.join(', ')} antes do downgrade.`);
      return;
    }

    setChanging(planId);
    try {
      if (subscription.external_subscription_id) {
        await paymentProvider.changePlan(subscription.external_subscription_id, selectedPlan.code, billingCycle);
        toast.success(`${action === 'upgrade' ? 'Upgrade' : 'Downgrade'} solicitado para ${selectedPlan.name}.`);
        return;
      }
      const url = await paymentProvider.createCheckoutUrl({
        corretorId: subscription.corretor_id,
        planCode: selectedPlan.code,
        billingCycle,
        returnUrl: window.location.href,
      });
      if (url && url !== window.location.href) window.location.assign(url);
      else toast.info(`Checkout do plano ${selectedPlan.name} preparado para integração do gateway.`);
    } catch (err) {
      toast.error('Não foi possível alterar o plano agora. Tente novamente.');
    } finally {
      setChanging(null);
    }
  };

  const handleCancel = async () => {
    setChanging('cancel');
    try {
      await paymentProvider.cancelSubscription(subscription.external_subscription_id ?? subscription.id);
      toast.success('Cancelamento solicitado. O acesso continua até o fim do período pago.');
      setCancelOpen(false);
    } catch {
      toast.error('Não foi possível solicitar o cancelamento agora.');
    } finally {
      setChanging(null);
    }
  };

  const usageComercial = usage.filter((item) => [
    'leads_qualificados_monthly', 'max_imoveis', 'max_contratos_locacao', 'max_fachadas', 'ai_contracts_monthly',
  ].includes(item.feature_key));
  const precoAtual = subscription.billing_cycle === 'annual' ? plan.annual_price : plan.monthly_price;

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-0">
      {!billingIntegrationReady && !demoAtiva && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4" role="status">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-warning" />
          <div>
            <h2 className="font-semibold">Alterações de assinatura temporariamente indisponíveis</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Seu plano e consumo continuam visíveis, mas troca e cancelamento ficam bloqueados até a ativação segura do checkout SaaS.
            </p>
          </div>
        </div>
      )}
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

      <section aria-labelledby="assinatura-atual" className="space-y-3">
        <div>
          <h2 id="assinatura-atual" className="text-xl font-semibold tracking-tight">Sua assinatura</h2>
          <p className="mt-1 text-sm text-muted-foreground">Visão geral do seu plano e da próxima cobrança.</p>
        </div>
        <Card className="overflow-hidden border-primary/15 shadow-sm">
          <CardContent className="grid gap-6 p-6 md:grid-cols-[1.4fr_1fr_1fr] md:items-center">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-2xl font-bold tracking-tight">{plan.name}</span>
              {subscription.status === 'active' && <Badge variant="default" className="bg-green-600">Ativo</Badge>}
              {subscription.status === 'trialing' && <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-200">Em Teste</Badge>}
              {subscription.status === 'past_due' && <Badge variant="destructive">Atrasado</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">
                Para gerenciar sua operação com os recursos incluídos no plano.
              </p>
            </div>
            <div className="space-y-1 border-l pl-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Valor e ciclo</p>
              <p className="text-xl font-semibold tabular-nums">
                R$ {precoAtual.toFixed(0)} <span className="text-sm font-normal text-muted-foreground">/{subscription.billing_cycle === 'annual' ? 'ano' : 'mês'}</span>
              </p>
              <p className="text-sm text-muted-foreground">Cobrança {subscription.billing_cycle === 'annual' ? 'anual' : 'mensal'}</p>
            </div>
            <div className="space-y-1 border-l pl-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Próxima cobrança</p>
              <p className="flex items-center gap-2 font-semibold">
                <CreditCard className="h-4 w-4 text-primary" />
                {subscription.current_period_end
                  ? new Date(subscription.current_period_end).toLocaleDateString('pt-BR')
                  : 'A definir'}
              </p>
              <p className="text-sm text-muted-foreground">Renovação automática</p>
            </div>
          </CardContent>
          {daysLeftInTrial !== null && (
            <div className="border-t bg-blue-50 px-6 py-3 text-sm text-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
              Você tem <strong>{daysLeftInTrial} dias</strong> restantes no período de teste gratuito.
            </div>
          )}
        </Card>
      </section>

      <section aria-labelledby="gerenciar-assinatura" className="rounded-xl border border-destructive/20 bg-destructive/5 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="gerenciar-assinatura" className="font-semibold">Gerenciar assinatura</h2>
            <p className="mt-1 text-sm text-muted-foreground">O cancelamento mantém seu acesso até o fim do período já pago.</p>
          </div>
          <Button
            variant="destructive"
            className="min-h-11 w-full font-semibold shadow-sm sm:w-auto"
            onClick={() => setCancelOpen(true)}
            disabled={!billingIntegrationReady}
          >
            <Ban className="mr-2 h-4 w-4" /> Cancelar assinatura
          </Button>
        </div>
      </section>

      <section aria-labelledby="uso-plano" className="space-y-3">
        <div>
          <h2 id="uso-plano" className="text-xl font-semibold tracking-tight">Uso do plano</h2>
          <p className="mt-1 text-sm text-muted-foreground">Os limites são renovados no início de cada ciclo.</p>
        </div>
        <Card className="shadow-sm">
          <CardContent className="grid gap-x-10 gap-y-6 p-6 md:grid-cols-2">
            {usageComercial.map((u) => <UsageBar key={u.feature_key} usage={u} />)}
          </CardContent>
        </Card>
      </section>

      {addons.length > 0 && (
        <section aria-labelledby="recursos-adicionais" className="space-y-3">
          <h2 id="recursos-adicionais" className="text-xl font-semibold tracking-tight">Recursos adicionais</h2>
          <Card className="shadow-sm">
            <CardContent className="divide-y p-6">
              {addons.map(addon => (
                <div key={addon.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="flex items-center gap-2 font-medium"><Sparkles className="h-4 w-4 text-primary" />{addon.addon_name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">Quantidade: {addon.quantity}</p>
                  </div>
                  <p className="font-medium">R$ {addon.unit_price.toFixed(2)}/mês</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      <Separator />

      <section aria-labelledby="trocar-plano" className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="trocar-plano" className="text-xl font-semibold tracking-tight">Comparar e trocar de plano</h2>
            <p className="mt-1 text-sm text-muted-foreground">Escolha o plano que acompanha o momento da sua operação.</p>
          </div>
          <div className="flex items-center gap-3 rounded-full border bg-muted/30 px-4 py-2">
            <span className={`text-sm font-medium ${billingCycle === 'monthly' ? 'text-foreground' : 'text-muted-foreground'}`}>Mensal</span>
            <Switch checked={billingCycle === 'annual'} onCheckedChange={(c) => setBillingCycle(c ? 'annual' : 'monthly')} />
            <span className={`text-sm font-medium ${billingCycle === 'annual' ? 'text-foreground' : 'text-muted-foreground'}`}>Anual</span>
            <Badge variant="secondary" className="hidden bg-green-100 text-green-700 sm:inline-flex">2 meses grátis</Badge>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          {plansExibidos.map(p => (
            <PlanCard
              key={p.id}
              plan={p}
              billingCycle={billingCycle}
              campaign={summaryExibido.campaign}
              currentPlanId={subscription.plan_id}
              onSelect={handlePlanSelect}
              actionLabel={changing === p.id
                ? 'Processando...'
                : acaoEntrePlanos(plan, p) === 'upgrade'
                  ? `Fazer upgrade para ${p.name}`
                  : acaoEntrePlanos(plan, p) === 'downgrade'
                    ? `Fazer downgrade para ${p.name}`
                    : undefined}
              disabled={!billingIntegrationReady && !demoAtiva}
            />
          ))}
        </div>
      </section>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar sua assinatura?</AlertDialogTitle>
            <AlertDialogDescription>
              Você continuará com acesso até o fim do período já pago. Depois disso, a conta ficará somente para consulta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter assinatura</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} disabled={changing === 'cancel'}>
              {changing === 'cancel' ? 'Cancelando...' : 'Confirmar cancelamento'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
