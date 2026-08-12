import { format } from 'date-fns';
import { CheckCircle2, Circle, ListTodo } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { tarefaAtrasada } from '@/lib/crm/pipeline';
import { useTarefas, useConcluirTarefa } from '@/hooks/crm/useCrm';
import type { CrmTarefa } from '@/lib/crm/tipos';

export function CrmTarefas() {
  const { data: tarefas, isLoading } = useTarefas();
  const concluir = useConcluirTarefa();

  if (isLoading) {
    return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>;
  }

  if (!tarefas?.length) {
    return (
      <Card>
        <CardContent className="py-12 flex flex-col items-center gap-2 text-center text-muted-foreground">
          <ListTodo className="h-8 w-8 opacity-40" />
          <p className="font-medium text-foreground">Nenhuma tarefa</p>
          <p className="text-sm">Crie tarefas a partir de um negócio para não perder o follow-up.</p>
        </CardContent>
      </Card>
    );
  }

  // Atrasadas primeiro — é o que precisa de ação hoje.
  const ordenadas = [...tarefas].sort((a, b) => {
    const aAtras = tarefaAtrasada(a) ? 0 : 1;
    const bAtras = tarefaAtrasada(b) ? 0 : 1;
    if (aAtras !== bAtras) return aAtras - bAtras;
    if (a.concluida !== b.concluida) return a.concluida ? 1 : -1;
    return (a.data_prevista ?? '').localeCompare(b.data_prevista ?? '');
  });

  return (
    <div className="space-y-2">
      {ordenadas.map((t: CrmTarefa & { clientes?: { nome?: string } }) => {
        const atrasada = tarefaAtrasada(t);
        return (
          <Card key={t.id} className={cn(atrasada && 'border-red-500/30')}>
            <CardContent className="py-3 flex items-center gap-3">
              <button
                type="button"
                title={t.concluida ? 'Reabrir tarefa' : 'Concluir tarefa'}
                onClick={() => concluir.mutate({ id: t.id, concluida: !t.concluida })}
                className="shrink-0 text-muted-foreground hover:text-primary transition"
              >
                {t.concluida
                  ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  : <Circle className="h-5 w-5" />}
              </button>

              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-medium truncate', t.concluida && 'line-through text-muted-foreground')}>
                  {t.titulo}
                </p>
                {t.clientes?.nome && (
                  <p className="text-xs text-muted-foreground truncate">{t.clientes.nome}</p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {t.data_prevista && (
                  <span className={cn('text-xs', atrasada ? 'text-red-600 dark:text-red-400 font-medium' : 'text-muted-foreground')}>
                    {format(new Date(t.data_prevista), 'dd/MM/yyyy')}
                  </span>
                )}
                {atrasada && (
                  <Badge variant="secondary" className="bg-red-500/10 text-red-600 dark:text-red-400 text-[10px]">
                    Atrasada
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
