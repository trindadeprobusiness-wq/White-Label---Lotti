import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LancamentoFinanceiro } from '@/types/financeiro';
import { format, parseISO, startOfMonth, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { VALOR_MASCARADO } from '@/lib/privacidade';
import { usePrivacidade } from '@/stores/privacidadeStore';

interface GraficoReceitaDespesaProps {
  lancamentos: LancamentoFinanceiro[];
  meses?: number;
}

export function GraficoReceitaDespesa({ lancamentos, meses = 6 }: GraficoReceitaDespesaProps) {
  // O gráfico também expõe dinheiro: tooltip, legenda e totais.
  const oculto = usePrivacidade((s) => s.valoresOcultos);
  const dados = useMemo(() => {
    const hoje = new Date();
    const resultado = [];

    for (let i = meses - 1; i >= 0; i--) {
      const mesData = subMonths(startOfMonth(hoje), i);
      const mesStr = format(mesData, 'yyyy-MM');
      const mesLabel = format(mesData, 'MMM', { locale: ptBR });

      const lancamentosMes = lancamentos.filter(l => l.data.startsWith(mesStr));

      const receita = lancamentosMes
        .filter(l => l.tipo === 'RECEITA')
        .reduce((acc, l) => acc + Number(l.valor), 0);

      const despesa = lancamentosMes
        .filter(l => l.tipo === 'DESPESA')
        .reduce((acc, l) => acc + Number(l.valor), 0);

      resultado.push({
        mes: mesLabel.charAt(0).toUpperCase() + mesLabel.slice(1),
        receita,
        despesa,
        lucro: receita - despesa,
      });
    }

    return resultado;
  }, [lancamentos, meses]);

  const formatarValor = (value: number) => {
    // O eixo também entrega dinheiro: quem lê "R$ 40k" no topo sabe a ordem
    // de grandeza mesmo com todos os números mascarados. No modo privado o
    // eixo fica sem rótulo e o gráfico mostra só a forma.
    if (oculto) return '';
    if (value >= 1000) {
      return `R$ ${(value / 1000).toFixed(0)}k`;
    }
    return `R$ ${value}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Receitas vs Despesas</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dados} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="mes" 
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
                tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
              />
              <YAxis 
                tickFormatter={formatarValor}
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
                tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
              />
              <Tooltip
                formatter={(value: number) => [
                  oculto
                    ? VALOR_MASCARADO
                    : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                ]}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <Bar 
                dataKey="receita" 
                name="Receita" 
                fill="hsl(142, 76%, 36%)" 
                radius={[4, 4, 0, 0]}
              />
              <Bar 
                dataKey="despesa" 
                name="Despesa" 
                fill="hsl(0, 84%, 60%)" 
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
