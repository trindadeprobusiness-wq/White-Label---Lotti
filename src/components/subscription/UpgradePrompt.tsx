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
  currentPlanName: string;
  used: number;
  limit: number | null;
  recommendedPlanName: string | null;
}

export function conteudoUpgrade({
  featureName,
  used,
  limit,
  currentPlanName,
  recommendedPlanName,
}: Pick<UpgradePromptProps, 'featureName' | 'used' | 'limit' | 'currentPlanName' | 'recommendedPlanName'>) {
  return {
    title: `Limite de ${featureName} atingido`,
    description: `Você usou ${used} de ${limit ?? 0} no plano ${currentPlanName}.`,
    actionLabel: recommendedPlanName ? `Ver plano ${recommendedPlanName}` : 'Ver opções de plano',
  };
}

export function UpgradePrompt({
  open,
  onOpenChange,
  featureKey,
  featureName,
  currentPlanName,
  used,
  limit,
  recommendedPlanName,
}: UpgradePromptProps) {
  const navigate = useNavigate();
  const conteudo = conteudoUpgrade({ featureName, used, limit, currentPlanName, recommendedPlanName });

  const handleUpgradeClick = () => {
    planEvents.limitReached(featureKey, currentPlanName);
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
            {conteudo.title}
          </DialogTitle>
          <DialogDescription className="text-center pt-2">
            {conteudo.description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground text-center">
            {recommendedPlanName
              ? `O plano ${recommendedPlanName} oferece mais capacidade para este recurso.`
              : 'Consulte as opções disponíveis para ampliar sua capacidade.'}
          </div>
        </div>

        <DialogFooter className="flex-col sm:justify-center sm:space-x-0 gap-2">
          <Button onClick={handleUpgradeClick} className="w-full gap-2">
            <Rocket className="h-4 w-4" />
            {conteudo.actionLabel}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full">
            Entendi, talvez depois
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
