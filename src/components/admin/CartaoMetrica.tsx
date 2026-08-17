import { TrendingUp, TrendingDown, Minus, HelpCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { variacao } from '@/lib/admin/periodo';
import { percentual } from '@/lib/formato';

interface CartaoMetricaProps {
  titulo: string;
  /** Já formatado (moeda, número, percentual) — o cartão não decide formato. */
  valor: string;
  icone?: React.ReactNode;
  /** Valores crus para a comparação. Omitir esconde a linha de variação. */
  atual?: number;
  anterior?: number;
  /** Para métricas onde crescer é ruim (cancelamentos, inadimplência). */
  crescerEhRuim?: boolean;
  ajuda?: string;
  detalhe?: string;
  carregando?: boolean;
}

/**
 * Cartão de métrica do back office.
 *
 * O projeto tinha quatro variantes de card de métrica (Dashboard inline,
 * KPICard do financeiro, Indicador do CRM, DashboardKPICards do aluguel). Esta
 * é a quinta e não tenta unificar as outras — unificá-las é refatoração das
 * telas existentes, fora do escopo desta entrega.
 */
export function CartaoMetrica({
  titulo,
  valor,
  icone,
  atual,
  anterior,
  crescerEhRuim = false,
  ajuda,
  detalhe,
  carregando,
}: CartaoMetricaProps) {
  if (carregando) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-8 w-32" />
          <Skeleton className="mt-3 h-3 w-20" />
        </CardContent>
      </Card>
    );
  }

  const temComparacao = atual !== undefined && anterior !== undefined;
  const delta = temComparacao ? variacao(atual, anterior) : null;

  // delta null com comparação pedida = período anterior zerado. Dizemos isso em
  // palavras; "+100%" ali seria número inventado sobre base inexistente.
  const semBase = temComparacao && delta === null;

  const Icone = delta === null ? Minus : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const positivo = delta !== null && (crescerEhRuim ? delta < 0 : delta > 0);
  const negativo = delta !== null && delta !== 0 && !positivo;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <p className="text-sm text-muted-foreground">{titulo}</p>
            {ajuda && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    aria-label={`Como ${titulo.toLowerCase()} é calculado`}
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs leading-relaxed">{ajuda}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          {icone && <div className="rounded-lg bg-primary/10 p-2 text-primary">{icone}</div>}
        </div>

        <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{valor}</p>

        {detalhe && <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>}

        {temComparacao && (
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            {semBase ? (
              <span className="text-muted-foreground">Sem base de comparação</span>
            ) : (
              <>
                <Icone
                  className={cn(
                    'h-3.5 w-3.5',
                    positivo && 'text-success',
                    negativo && 'text-destructive',
                    !positivo && !negativo && 'text-muted-foreground',
                  )}
                />
                <span
                  className={cn(
                    'tabular-nums font-medium',
                    positivo && 'text-success',
                    negativo && 'text-destructive',
                    !positivo && !negativo && 'text-muted-foreground',
                  )}
                >
                  {delta !== null && delta > 0 ? '+' : ''}
                  {percentual(delta)}
                </span>
                <span className="text-muted-foreground">vs. período anterior</span>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
