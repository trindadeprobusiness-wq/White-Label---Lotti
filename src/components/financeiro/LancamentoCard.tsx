import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Trash2, Repeat, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { diaDoLancamento } from '@/lib/formato';
import {
  LancamentoFinanceiro,
  CATEGORIA_LABELS,
  CATEGORIA_ICONS,
} from '@/types/financeiro';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { DadoSensivel } from '@/components/ui/dado-sensivel';

interface LancamentoCardProps {
  lancamento: LancamentoFinanceiro;
  onDelete?: (id: string) => void;
  onEdit?: (lancamento: LancamentoFinanceiro) => void;
}

export function LancamentoCard({ lancamento, onDelete, onEdit }: LancamentoCardProps) {
  const isReceita = lancamento.tipo === 'RECEITA';

  const formatarValor = (valor: number) => {
    return valor.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  };

  return (
    <div className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/5 transition-colors">
      <div className="flex items-center gap-4">
        <div className={cn(
          "w-12 h-12 rounded-full flex items-center justify-center text-xl",
          isReceita ? "bg-green-100 dark:bg-green-900/30" : "bg-red-100 dark:bg-red-900/30"
        )}>
          {CATEGORIA_ICONS[lancamento.categoria]}
        </div>
        
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="font-medium">{lancamento.descricao}</p>
            {lancamento.recorrente && (
              <Badge variant="outline" className="text-xs">
                <Repeat className="h-3 w-3 mr-1" />
                Recorrente
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{CATEGORIA_LABELS[lancamento.categoria]}</span>
            <span>•</span>
            <span>{(() => { const dia = diaDoLancamento(lancamento.data); return dia ? format(dia, "dd 'de' MMM, yyyy", { locale: ptBR }) : '—'; })()}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <p className={cn(
          "text-lg font-semibold",
          isReceita ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
        )}>
          <DadoSensivel valor={`${isReceita ? '+' : '-'} ${formatarValor(Number(lancamento.valor))}`} tipo="valor" />
        </p>

        <div className="flex items-center gap-1">
          {onEdit && (
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => onEdit(lancamento)}
            >
              <Edit2 className="h-4 w-4" />
            </Button>
          )}

          {onDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir lançamento?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Tem certeza que deseja excluir "{lancamento.descricao}"? 
                    Esta ação não pode ser desfeita.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onDelete(lancamento.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Excluir
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
    </div>
  );
}
