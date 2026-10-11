import { Check, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { camposDaAcao } from '@/lib/ia/acao';
import { humanizarTexto } from '@/lib/ia/humanizar';
import type { AISuggestedAction } from '@/types/ai';

interface AIActionCardProps {
  action: AISuggestedAction;
  onConfirm: (action: AISuggestedAction) => void;
  onReject: (actionId: string) => void;
}

const ACTION_LABELS: Record<string, string> = {
  create_client: 'Cadastrar cliente',
  update_client_status: 'Mudar status do cliente',
  schedule_followup: 'Agendar follow-up',
  create_alert: 'Criar alerta',
  register_contact: 'Registrar contato',
  create_property: 'Cadastrar imóvel',
  create_financial_entry: 'Lançar no Financeiro',
};

export function AIActionCard({ action, onConfirm, onReject }: AIActionCardProps) {
  const isDone = action.status !== 'pending';
  const campos = camposDaAcao(action);

  return (
    <Card className="border-primary/20 bg-primary/5 max-w-[85%]">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-primary">
          <Zap className="h-3.5 w-3.5" />
          {ACTION_LABELS[action.action_type] || 'Ação proposta'}
        </div>
        <p className="text-sm">{humanizarTexto(action.description)}</p>
        {campos.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {campos.map(({ rotulo, valor }) => (
              <div key={rotulo} className="contents">
                <dt className="text-muted-foreground">{rotulo}</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere]">{valor}</dd>
              </div>
            ))}
          </dl>
        )}
        {isDone ? (
          <p className="text-xs text-muted-foreground">
            {action.status === 'confirmed' ? '✓ Ação executada' : '✗ Ação recusada'}
          </p>
        ) : (
          <div className="space-y-2 pt-1">
            <p className="text-xs text-muted-foreground">
              A alteração só será executada depois da sua confirmação.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => onConfirm(action)}>
                <Check className="h-3 w-3 mr-1" /> Confirmar
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onReject(action.id)}>
                <X className="h-3 w-3 mr-1" /> Recusar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
