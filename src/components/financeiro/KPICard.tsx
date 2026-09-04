import { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { DadoSensivel } from '@/components/ui/dado-sensivel';

interface KPICardProps {
  titulo: string;
  valor: number;
  formatoMoeda?: boolean;
  formatoPercentual?: boolean;
  icone: ReactNode;
  corIcone?: string;
  tendencia?: 'alta' | 'baixa' | 'neutra';
  variacao?: number;
}

export function KPICard({
  titulo,
  valor,
  formatoMoeda = true,
  formatoPercentual = false,
  icone,
  corIcone = 'bg-primary/10 text-primary',
  tendencia,
  variacao,
}: KPICardProps) {
  const formatarValor = () => {
    if (formatoPercentual) {
      return `${valor.toFixed(1)}%`;
    }
    if (formatoMoeda) {
      return valor.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
    }
    return valor.toLocaleString('pt-BR');
  };

  const TendenciaIcon = tendencia === 'alta' 
    ? TrendingUp 
    : tendencia === 'baixa' 
    ? TrendingDown 
    : Minus;

  const tendenciaCor = tendencia === 'alta' 
    ? 'text-green-500' 
    : tendencia === 'baixa' 
    ? 'text-red-500' 
    : 'text-muted-foreground';

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground font-medium">{titulo}</p>
            <p className="text-2xl font-bold tracking-tight">
              {/* Só dinheiro é mascarado. Percentual e contagem não expõem
                  patrimônio e some-los deixaria o cartão sem sentido. */}
              {formatoMoeda && !formatoPercentual
                ? <DadoSensivel valor={formatarValor()} tipo="valor" />
                : formatarValor()}
            </p>
            {tendencia && variacao !== undefined && (
              <div className={cn("flex items-center gap-1 text-xs", tendenciaCor)}>
                <TendenciaIcon className="h-3 w-3" />
                <span>{variacao > 0 ? '+' : ''}{variacao.toFixed(1)}% vs mês anterior</span>
              </div>
            )}
          </div>
          <div className={cn("p-3 rounded-xl", corIcone)}>
            {icone}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
