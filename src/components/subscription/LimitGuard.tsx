import { useState, type ReactNode } from 'react';
import { useCheckLimit } from '@/hooks/useSubscription';
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
  onBlocked?: () => void;
}

export function LimitGuard({ featureKey, children, fallback, onBlocked }: LimitGuardProps) {
  const [promptOpen, setPromptOpen] = useState(false);
  const checkLimit = useCheckLimit();
  const status = checkLimit(featureKey);

  // Interceptar cliques se não for permitido
  const handleInterceptClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onBlocked?.();
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
          <div onClickCapture={handleInterceptClick} title="Recurso indisponível no limite atual. Clique para ver as opções do plano.">
            {typeof children === 'function' ? children(status) : children}
          </div>
        )}
        <UpgradePrompt
          open={promptOpen}
          onOpenChange={setPromptOpen}
          featureKey={featureKey}
          featureName={status.featureName}
          currentPlanName={status.currentPlan?.name ?? 'Sem assinatura ativa'}
          used={status.used}
          limit={status.limit}
          recommendedPlanName={status.recommendedPlan?.name ?? null}
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
