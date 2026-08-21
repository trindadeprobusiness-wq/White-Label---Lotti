import { Check, ChevronDown, ChevronUp, Circle, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useOnboarding } from '@/hooks/useOnboarding';
import { checklistDaAtivacao, proximaMelhorAcao } from '@/lib/onboarding/regras';
import { cn } from '@/lib/utils';

export function OnboardingChecklist() {
  const { contexto, disponivel, salvarChecklist } = useOnboarding();
  if (!disponivel || !contexto || (!contexto.concluidoEm && !contexto.dispensadoEm)) return null;

  let itens = checklistDaAtivacao(contexto.evidencias);
  if (contexto.persona === 'corretor_autonomo') {
    itens = itens.filter((item) => item.chave !== 'equipe');
  }
  if (contexto.persona === 'profissional_administrativo' || contexto.persona === 'usuario_convidado') {
    itens = itens.filter((item) => !['imovel', 'cliente', 'oportunidade', 'equipe'].includes(item.chave));
  }

  const concluidos = itens.filter((item) => item.concluido).length;
  const progresso = itens.length ? Math.round((concluidos / itens.length) * 100) : 100;
  const podeRetomar = !contexto.concluidoEm && Boolean(contexto.dispensadoEm);
  if (progresso === 100 && contexto.checklistDispensadoEm) return null;

  const sugerida = proximaMelhorAcao(contexto.objetivo, contexto.evidencias);
  const proxima = itens.find((item) => item.chave === sugerida.chave && !item.concluido)
    ?? itens.find((item) => !item.concluido)
    ?? sugerida;

  if (contexto.checklistMinimizado) {
    return (
      <section className="mb-5 flex flex-col gap-3 rounded-xl border border-primary/20 bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Sua operação está {progresso}% pronta</p>
          <p className="truncate text-xs text-muted-foreground">Próximo passo: {proxima.titulo}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={podeRetomar ? '/onboarding' : proxima.rota}>{podeRetomar ? 'Retomar configuração' : 'Continuar'}</Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Expandir checklist"
            onClick={() => salvarChecklist.mutate({ minimized: false })}
          ><ChevronDown className="h-4 w-4" /></Button>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-5 overflow-hidden rounded-xl border border-primary/20 bg-card shadow-sm" aria-labelledby="onboarding-checklist-title">
      <div className="flex flex-col gap-4 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 id="onboarding-checklist-title" className="font-semibold">Coloque a Lotti para trabalhar</h2>
            <p className="text-sm text-muted-foreground">{concluidos} de {itens.length} passos concluídos</p>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:w-auto">
          {podeRetomar && <Button variant="outline" size="sm" asChild><Link to="/onboarding">Retomar configuração</Link></Button>}
          <div className="flex w-32 items-center gap-2 sm:w-44">
            <Progress value={progresso} aria-label={`${progresso}% concluído`} className="h-2" />
            <span className="text-xs font-semibold tabular-nums text-primary">{progresso}%</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Minimizar checklist"
            onClick={() => salvarChecklist.mutate({ minimized: true })}
          ><ChevronUp className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="grid gap-1 p-3 sm:grid-cols-2 lg:grid-cols-3">
        {itens.map((item) => (
          <Link
            key={item.chave}
            to={item.rota}
            className={cn(
              'group flex min-h-12 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              item.concluido ? 'text-muted-foreground' : 'hover:bg-primary/5',
            )}
          >
            <span className={cn(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
              item.concluido ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground',
            )}>
              {item.concluido ? <Check className="h-3 w-3" /> : <Circle className="h-2 w-2 fill-current" />}
            </span>
            <span className={cn(item.concluido && 'line-through decoration-border')}>{item.titulo}</span>
          </Link>
        ))}
      </div>

      {progresso === 100 && (
        <div className="flex items-center justify-between border-t bg-primary/[0.04] px-5 py-3">
          <p className="text-sm font-medium text-primary">Configuração essencial concluída.</p>
          <Button variant="ghost" size="sm" onClick={() => salvarChecklist.mutate({ dismissed: true })}>
            Ocultar checklist
          </Button>
        </div>
      )}
    </section>
  );
}
