import { Check, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { AISuggestedAction } from '@/types/ai';

interface AIActionCardProps {
  action: AISuggestedAction;
  onConfirm: (action: AISuggestedAction) => void;
  onReject: (actionId: string) => void;
}

const ACTION_LABELS: Record<string, string> = {
  create_client: 'Criar Cliente',
  update_client_status: 'Atualizar Status',
  schedule_followup: 'Agendar Follow-up',
  create_alert: 'Criar Alerta',
  register_contact: 'Registrar Contato',
};

export function AIActionCard({ action, onConfirm, onReject }: AIActionCardProps) {
  const isDone = action.status !== 'pending';

  return (
    <Card className="border-primary/20 bg-primary/5 max-w-[85%]">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-primary">
          <Zap className="h-3.5 w-3.5" />
          {ACTION_LABELS[action.action_type] || action.action_type}
        </div>
        <p className="text-sm">{action.description}</p>
        {isDone ? (
          <p className="text-xs text-muted-foreground">
            {action.status === 'confirmed' ? '✓ Ação executada' : '✗ Ação recusada'}
          </p>
        ) : (
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => onConfirm(action)}>
              <Check className="h-3 w-3 mr-1" /> Confirmar
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onReject(action.id)}>
              <X className="h-3 w-3 mr-1" /> Recusar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
