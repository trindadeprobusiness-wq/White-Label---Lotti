import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ChevronDown,
  ChevronRight,
  HelpCircle,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Plus,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { MetricCard, SectionCard } from '@/components/shell/primitivos';
import { moeda, percentual } from '@/lib/formato';
import { DadoSensivel } from '@/components/ui/dado-sensivel';
import { Dinheiro } from '@/components/ui/dinheiro';
import {
  calcularDRE,
  contarNaoClassificados,
  TOOLTIPS_DRE,
  type GrupoDREResultado,
  type LinhaDRE,
  type ResultadoDRE,
} from '@/lib/dre';
import type { LancamentoFinanceiro } from '@/types/financeiro';
import { CATEGORIA_LABELS } from '@/types/financeiro';

// ────────────────────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────────────────────

interface DRETabProps {
  lancamentos: LancamentoFinanceiro[];
  periodoLabel: string;
  /** Lançamentos do período anterior para comparação (opcional). */
  lancamentosAnterior?: LancamentoFinanceiro[];
  onAddLancamento?: () => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Tooltip helper
// ────────────────────────────────────────────────────────────────────────────

function DRETooltip({ id }: { id: string }) {
  const text = TOOLTIPS_DRE[id];
  if (!text) return null;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="inline h-3.5 w-3.5 text-muted-foreground/50 hover:text-muted-foreground cursor-help ml-1" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Comparação
// ────────────────────────────────────────────────────────────────────────────

function Variacao({ atual, anterior }: { atual: number; anterior?: number }) {
  if (anterior === undefined || anterior === 0) return null;
  const diff = ((atual - anterior) / Math.abs(anterior)) * 100;
  if (!isFinite(diff)) return null;
  const positivo = diff >= 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        positivo ? 'text-success' : 'text-destructive',
      )}
    >
      {positivo ? (
        <TrendingUp className="h-3 w-3" />
      ) : (
        <TrendingDown className="h-3 w-3" />
      )}
      {Math.abs(diff).toFixed(1)}%
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Linha expansível do grupo DRE
// ────────────────────────────────────────────────────────────────────────────

function LinhaGrupo({
  grupo,
  isSubtraction,
}: {
  grupo: GrupoDREResultado;
  isSubtraction?: boolean;
}) {
  const [expandido, setExpandido] = useState(false);

  if (grupo.total === 0 && grupo.linhas.length === 0) return null;

  return (
    <div className="border-b border-border/50 last:border-b-0">
      {/* Cabeçalho do grupo */}
      <button
        type="button"
        onClick={() => setExpandido(!expandido)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-accent/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {grupo.linhas.length > 0 ? (
            expandido ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )
          ) : (
            <span className="w-4" />
          )}
          <span className="text-sm font-medium text-muted-foreground">
            {isSubtraction && '(−) '}
            {grupo.label}
          </span>
        </div>
        <span
          className={cn(
            'text-sm font-semibold tabular',
            isSubtraction ? 'text-destructive' : 'text-foreground',
          )}
        >
          <DadoSensivel
            valor={`${isSubtraction ? '-' : ''}${moeda(grupo.total)}`}
            tipo="valor"
          />
        </span>
      </button>

      {/* Sublinhas expandidas */}
      {expandido && grupo.linhas.length > 0 && (
        <div className="bg-muted/20">
          {grupo.linhas.map((linha) => (
            <LinhaDetalhe key={linha.label} linha={linha} />
          ))}
        </div>
      )}
    </div>
  );
}

function LinhaDetalhe({ linha }: { linha: LinhaDRE }) {
  const [expandido, setExpandido] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => linha.lancamentos.length > 0 && setExpandido(!expandido)}
        className={cn(
          'flex w-full items-center justify-between px-4 py-2 pl-12 text-left transition-colors',
          linha.lancamentos.length > 0
            ? 'hover:bg-accent/20 cursor-pointer'
            : 'cursor-default',
        )}
      >
        <span className="text-sm text-muted-foreground">{linha.label}</span>
        <span className="text-sm tabular font-medium">
          <DadoSensivel valor={moeda(linha.valor)} tipo="valor" />
        </span>
      </button>

      {/* Lançamentos individuais (drill-down) */}
      {expandido && linha.lancamentos.length > 0 && (
        <div className="bg-muted/30 border-t border-border/30">
          {linha.lancamentos.map((l) => (
            <div
              key={l.id}
              className="flex items-center justify-between px-4 py-1.5 pl-16 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-muted-foreground truncate max-w-[200px] sm:max-w-[300px]">
                  {l.subcategoria || l.descricao}
                </span>
                <span className="text-muted-foreground/60 shrink-0">
                  {format(new Date(l.data + 'T12:00:00'), 'dd/MM', { locale: ptBR })}
                </span>
              </div>
              <span className="text-xs tabular font-medium shrink-0">
                <DadoSensivel valor={moeda(Math.abs(Number(l.valor)))} tipo="valor" />
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Linha de resultado (highlight)
// ────────────────────────────────────────────────────────────────────────────

function LinhaResultado({
  label,
  valor,
  tooltipId,
  variante,
  porcentagem,
  anterior,
}: {
  label: string;
  valor: number;
  tooltipId?: string;
  variante?: 'primary' | 'success' | 'warning' | 'neutral';
  porcentagem?: number;
  anterior?: number;
}) {
  const bg = {
    primary: 'bg-primary/5 border-primary/10',
    success: 'bg-success-surface border-success/10',
    warning: 'bg-warning-surface border-warning/10',
    neutral: 'bg-muted/30 border-border/50',
  }[variante ?? 'neutral'];

  return (
    <div className={cn('flex items-center justify-between px-4 py-3 border-y', bg)}>
      <div className="flex items-center gap-1">
        <span className="text-sm font-semibold">
          {label}
        </span>
        {tooltipId && <DRETooltip id={tooltipId} />}
      </div>
      <div className="flex items-center gap-3">
        {porcentagem !== undefined && (
          <span className="text-xs font-medium text-muted-foreground tabular">
            {percentual(porcentagem)}
          </span>
        )}
        <Variacao atual={valor} anterior={anterior} />
        <span
          className={cn(
            'text-sm font-bold tabular',
            valor >= 0 ? 'text-success' : 'text-destructive',
          )}
        >
          <DadoSensivel valor={moeda(valor)} tipo="valor" />
        </span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Empty state
// ────────────────────────────────────────────────────────────────────────────

function EmptyDRE({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted/50 p-4 mb-4">
        <TrendingUp className="h-8 w-8 text-muted-foreground/40" />
      </div>
      <h3 className="text-lg font-medium mb-2">
        Sua DRE será montada automaticamente
      </h3>
      <p className="text-sm text-muted-foreground max-w-md mb-6">
        Conforme receitas e despesas forem registradas, a Demonstração do Resultado
        do Exercício será calculada e atualizada em tempo real.
      </p>
      {onAdd && (
        <Button onClick={onAdd} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Adicionar lançamento
        </Button>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Componente principal
// ────────────────────────────────────────────────────────────────────────────

export function DRETab({
  lancamentos,
  periodoLabel,
  lancamentosAnterior,
  onAddLancamento,
}: DRETabProps) {
  const dre = useMemo(() => calcularDRE(lancamentos), [lancamentos]);
  const dreAnterior = useMemo(
    () => (lancamentosAnterior ? calcularDRE(lancamentosAnterior) : undefined),
    [lancamentosAnterior],
  );
  const naoClassificados = useMemo(
    () => contarNaoClassificados(lancamentos),
    [lancamentos],
  );

  // Sem dados? Empty state.
  const temDados =
    dre.receitaBruta > 0 ||
    dre.custosVariaveis > 0 ||
    dre.despesasOperacionais > 0 ||
    dre.impostos > 0;

  if (!temDados) {
    return (
      <SectionCard>
        <EmptyDRE onAdd={onAddLancamento} />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Receita líquida"
          valor={<DadoSensivel valor={moeda(dre.receitaLiquida, true)} tipo="valor" />}
          icone={<TrendingUp className="h-5 w-5" />}
          tom="success"
        />
        <MetricCard
          label="Resultado operacional"
          valor={<DadoSensivel valor={moeda(dre.resultadoOperacional, true)} tipo="valor" />}
          icone={<TrendingUp className="h-5 w-5" />}
          tom={dre.resultadoOperacional >= 0 ? 'brand' : 'warning'}
        />
        <MetricCard
          label="Resultado líquido"
          valor={<DadoSensivel valor={moeda(dre.resultadoLiquido, true)} tipo="valor" />}
          icone={dre.resultadoLiquido >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
          tom={dre.resultadoLiquido >= 0 ? 'success' : 'destructive'}
        />
        <MetricCard
          label="Margem líquida"
          valor={percentual(dre.margemLiquida)}
          icone={<TrendingUp className="h-5 w-5" />}
          tom="info"
        />
      </div>

      {/* Aviso de não classificados */}
      {naoClassificados > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning-surface px-4 py-3">
          <AlertCircle className="h-4 w-4 text-warning shrink-0" />
          <p className="text-sm text-warning">
            {naoClassificados} lançamento{naoClassificados > 1 ? 's precisam' : ' precisa'}{' '}
            de classificação para completar sua DRE.
          </p>
        </div>
      )}

      {/* DRE */}
      <SectionCard
        titulo={
          <div className="flex items-center gap-2">
            <h2 className="text-section text-foreground">
              DRE — {periodoLabel}
            </h2>
            <DRETooltip id="resultado_liquido" />
          </div>
        }
        semPadding
      >
        <div className="divide-y divide-border/50">
          {/* ── Receita Operacional Bruta ── */}
          <LinhaGrupo grupo={dre.receitaOperacional} />

          {/* ── (−) Deduções ── */}
          {dre.deducaoReceita.total > 0 && (
            <LinhaGrupo grupo={dre.deducaoReceita} isSubtraction />
          )}

          {/* ═══ RECEITA LÍQUIDA ═══ */}
          <LinhaResultado
            label="Receita Operacional Líquida"
            valor={dre.receitaLiquida}
            tooltipId="receita_liquida"
            variante="success"
            anterior={dreAnterior?.receitaLiquida}
          />

          {/* ── (−) Custos Variáveis ── */}
          {dre.custoVariavel.total > 0 && (
            <LinhaGrupo grupo={dre.custoVariavel} isSubtraction />
          )}

          {/* ═══ MARGEM DE CONTRIBUIÇÃO ═══ */}
          <LinhaResultado
            label="Margem de Contribuição"
            valor={dre.margemContribuicao}
            tooltipId="margem_contribuicao"
            variante="neutral"
            porcentagem={dre.margemContribuicaoPerc}
            anterior={dreAnterior?.margemContribuicao}
          />

          {/* ── (−) Despesas Operacionais ── */}
          <LinhaGrupo grupo={dre.despesaOperacional} isSubtraction />

          {/* ═══ RESULTADO OPERACIONAL ═══ */}
          <LinhaResultado
            label="Resultado Operacional"
            valor={dre.resultadoOperacional}
            tooltipId="resultado_operacional"
            variante={dre.resultadoOperacional >= 0 ? 'success' : 'warning'}
            anterior={dreAnterior?.resultadoOperacional}
          />

          {/* ── (+/−) Resultado Financeiro ── */}
          {(dre.resultadoFinanceiro.total > 0 || dre.resultadoFinanceiroTotal !== 0) && (
            <LinhaGrupo grupo={dre.resultadoFinanceiro} isSubtraction={dre.resultadoFinanceiroTotal < 0} />
          )}

          {/* ── (−) Impostos ── */}
          {dre.imposto.total > 0 && (
            <LinhaGrupo grupo={dre.imposto} isSubtraction />
          )}

          {/* ═══ RESULTADO LÍQUIDO ═══ */}
          <LinhaResultado
            label="Resultado Líquido"
            valor={dre.resultadoLiquido}
            tooltipId="resultado_liquido"
            variante={dre.resultadoLiquido >= 0 ? 'primary' : 'warning'}
            porcentagem={dre.margemLiquida}
            anterior={dreAnterior?.resultadoLiquido}
          />
        </div>
      </SectionCard>
    </div>
  );
}
