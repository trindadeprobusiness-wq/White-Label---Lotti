import { Rocket, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useNavigate } from 'react-router-dom';
import { planEvents } from '@/lib/analytics';
import type { FeatureKey } from '@/types/subscription';

interface UpgradePromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  featureKey: FeatureKey;
  featureName: string;
  currentPlanCode: string;
}

export function UpgradePrompt({
  open,
  onOpenChange,
  featureKey,
  featureName,
  currentPlanCode,
}: UpgradePromptProps) {
  const navigate = useNavigate();

  const handleUpgradeClick = () => {
    planEvents.limitReached(featureKey, currentPlanCode);
    onOpenChange(false);
    navigate('/plano');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning/10 mb-4">
            <ShieldAlert className="h-6 w-6 text-warning" />
          </div>
          <DialogTitle className="text-center text-xl">
            Limite de {featureName} atingido
          </DialogTitle>
          <DialogDescription className="text-center pt-2">
            Seu plano atual ({currentPlanCode}) não permite mais operações de{' '}
            <span className="font-medium text-foreground">{featureName}</span> neste ciclo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground text-center">
            Faça um upgrade no seu plano ou contrate um pacote adicional para liberar mais limite imediatamente.
          </div>
        </div>

        <DialogFooter className="flex-col sm:justify-center sm:space-x-0 gap-2">
          <Button onClick={handleUpgradeClick} className="w-full gap-2">
            <Rocket className="h-4 w-4" />
            Ver opções de Upgrade
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full">
            Entendi, talvez depois
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
