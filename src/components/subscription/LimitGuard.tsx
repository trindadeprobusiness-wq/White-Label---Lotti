import { useState, type ReactNode } from 'react';
import { useCheckLimit, useCurrentSubscription, useAllPlans } from '@/hooks/useSubscription';
import { UpgradePrompt } from './UpgradePrompt';
import type { FeatureKey } from '@/types/subscription';

interface LimitGuardProps {
  featureKey: FeatureKey;
  children: ReactNode | ((check: ReturnType<typeof useCheckLimit>) => ReactNode);
  fallback?: ReactNode;
}

export function LimitGuard({ featureKey, children, fallback }: LimitGuardProps) {
  const [promptOpen, setPromptOpen] = useState(false);
  const checkLimit = useCheckLimit();
  const { data: subscription } = useCurrentSubscription();
  const { data: plans } = useAllPlans();

  const status = checkLimit(featureKey);

  const planName = subscription && plans
    ? plans.find((p) => p.id === subscription.plan_id)?.name || 'Sem plano'
    : 'Sem plano';

  const featureName = subscription && plans
    ? plans.find((p) => p.id === subscription.plan_id)?.entitlements.find(e => e.feature_key === featureKey)?.feature_name || featureKey
    : featureKey;

  // Interceptar cliques se não for permitido
  const handleInterceptClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPromptOpen(true);
  };

  if (!status.allowed) {
    return (
      <>
        {fallback ? (
          <div onClickCapture={handleInterceptClick}>
            {fallback}
          </div>
        ) : (
          <div onClickCapture={handleInterceptClick} className="opacity-50 cursor-not-allowed">
            {typeof children === 'function' ? children(status) : children}
          </div>
        )}
        <UpgradePrompt
          open={promptOpen}
          onOpenChange={setPromptOpen}
          featureKey={featureKey}
          featureName={featureName}
          currentPlanCode={planName}
        />
      </>
    );
  }

  return (
    <>
      {typeof children === 'function' ? children(status) : children}
    </>
  );
}
