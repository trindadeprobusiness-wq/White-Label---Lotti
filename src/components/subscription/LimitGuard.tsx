import { useState, type ReactNode } from 'react';
import { useCheckLimit, useCurrentSubscription, useAllPlans } from '@/hooks/useSubscription';
import { UpgradePrompt } from './UpgradePrompt';
import type { FeatureKey } from '@/types/subscription';

/**
 * O RESULTADO de checar o limite, não a função que checa.
 *
 * A tipagem anterior era `ReturnType<typeof useCheckLimit>`, que é a própria
 * função `checkLimit`. O componente então chamava `children(status)` passando um
 * objeto onde o tipo pedia uma função — dois erros de compilação que ficaram
 * de pé enquanto o componente não era usado em tela nenhuma.
 */
type StatusLimite = ReturnType<ReturnType<typeof useCheckLimit>>;

interface LimitGuardProps {
  featureKey: FeatureKey;
  children: ReactNode | ((check: StatusLimite) => ReactNode);
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
