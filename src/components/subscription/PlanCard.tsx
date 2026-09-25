import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Check, MoveRight } from 'lucide-react';
import type { PlanWithEntitlements, BillingCycle, PricingCampaign } from '@/types/subscription';
import { plansDisplay } from '@/data/plansData';
import { planEvents } from '@/lib/analytics';

interface PlanCardProps {
  plan: PlanWithEntitlements;
  billingCycle: BillingCycle;
  campaign?: PricingCampaign | null;
  currentPlanId?: string;
  onSelect?: (planId: string) => void;
  className?: string;
  actionLabel?: string;
  disabled?: boolean;
}

export function PlanCard({
  plan,
  billingCycle,
  campaign,
  currentPlanId,
  onSelect,
  className,
  actionLabel,
  disabled = false,
}: PlanCardProps) {
  const display = plansDisplay.find((d) => d.code === plan.code);
  const isHighlighted = plan.highlighted;
  const isCurrent = plan.id === currentPlanId;
  const Icon = display?.icon;

  // Preço
  const basePrice = billingCycle === 'annual' ? plan.annual_price : plan.monthly_price;
  const monthlyEquivalent = billingCycle === 'annual'
    ? (plan.annual_price / 12)
    : plan.monthly_price;

  // Campanha de fundador
  let founderPrice: number | null = null;
  if (
    campaign?.active &&
    campaign.discount_type === 'percentage' &&
    billingCycle === 'monthly' // fundador não acumula com anual
  ) {
    founderPrice = plan.monthly_price * (1 - campaign.discount_value / 100);
  }

  const handleClick = () => {
    planEvents.clickPlan(plan.code, billingCycle);
    onSelect?.(plan.id);
  };

  return (
    <Card
      className={cn(
        'relative flex flex-col transition-all duration-300',
        isHighlighted
          ? 'border-primary shadow-premium-hover scale-[1.02] ring-1 ring-primary/20'
          : 'hover:shadow-premium-hover hover:border-primary/30',
        isCurrent && 'ring-2 ring-primary',
        className,
      )}
    >
      {/* Badges */}
      <div className="absolute -top-3 left-0 right-0 flex justify-center gap-2">
        {isHighlighted && (
          <Badge className="bg-primary text-primary-foreground shadow-sm">
            MAIS ESCOLHIDO
          </Badge>
        )}
        {isCurrent && (
          <Badge variant="outline" className="bg-background shadow-sm">
            Plano atual
          </Badge>
        )}
        {founderPrice !== null && (
          <Badge variant="secondary" className="shadow-sm">
            🚀 Preço de fundador
          </Badge>
        )}
      </div>

      <CardHeader className="pt-8 pb-4">
        <div className="flex items-center gap-3 mb-2">
          {Icon && <Icon className="h-6 w-6 text-primary" />}
          <h3 className="text-xl font-semibold tracking-tight">{plan.name}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{display?.audience}</p>
      </CardHeader>

      <CardContent className="flex flex-col flex-1">
        {/* Preço */}
        <div className="mb-6">
          {founderPrice !== null ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums">
                  R$ {founderPrice.toFixed(0)}
                </span>
                <span className="text-sm text-muted-foreground">/mês</span>
              </div>
              <p className="text-sm text-muted-foreground line-through mt-1">
                R$ {plan.monthly_price.toFixed(0)}/mês
              </p>
            </>
          ) : billingCycle === 'annual' ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums">
                  R$ {monthlyEquivalent.toFixed(0)}
                </span>
                <span className="text-sm text-muted-foreground">/mês</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                R$ {basePrice.toFixed(0)}/ano
              </p>
            </>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">
                R$ {basePrice.toFixed(0)}
              </span>
              <span className="text-sm text-muted-foreground">/mês</span>
            </div>
          )}
        </div>

        {/* Features */}
        <ul className="mb-6 flex-1 space-y-2.5">
          {display?.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <div className="space-y-2 mt-auto">
          <Button
            onClick={handleClick}
            variant={isHighlighted ? 'default' : 'outline'}
            className="w-full gap-2"
            disabled={isCurrent || disabled}
          >
            {isCurrent ? 'Plano atual' : (actionLabel || display?.cta || 'Começar teste gratuito')}
            {!isCurrent && <MoveRight className="h-4 w-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
