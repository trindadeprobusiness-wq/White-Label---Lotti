import { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LancamentoPorCategoria, CATEGORIA_LABELS } from '@/types/financeiro';
import { VALOR_MASCARADO } from '@/lib/privacidade';
import { usePrivacidade } from '@/stores/privacidadeStore';

interface GraficoCategoriasProps {
  dados: LancamentoPorCategoria[];
  titulo: string;
  tipo: 'receita' | 'despesa';
}

const CORES_DESPESA = [
  'hsl(0, 84%, 60%)',
  'hsl(0, 84%, 70%)',
  'hsl(25, 95%, 53%)',
  'hsl(38, 92%, 50%)',
  'hsl(45, 93%, 47%)',
  'hsl(262, 83%, 58%)',
  'hsl(280, 87%, 65%)',
  'hsl(326, 100%, 74%)',
];

const CORES_RECEITA = [
  'hsl(142, 76%, 36%)',
  'hsl(142, 76%, 46%)',
  'hsl(142, 71%, 56%)',
  'hsl(152, 76%, 36%)',
  'hsl(162, 76%, 36%)',
  'hsl(172, 66%, 50%)',
];

export function GraficoCategorias({ dados, titulo, tipo }: GraficoCategoriasProps) {
  // O gráfico também expõe dinheiro: tooltip, legenda e totais.
  const oculto = usePrivacidade((s) => s.valoresOcultos);
  const cores = tipo === 'despesa' ? CORES_DESPESA : CORES_RECEITA;

  const dadosFormatados = useMemo(() => 
    dados.map(d => ({
      ...d,
      nome: CATEGORIA_LABELS[d.categoria],
    })),
    [dados]
  );

  const total = dados.reduce((acc, d) => acc + d.total, 0);

  if (dados.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{titulo}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[250px] text-muted-foreground">
          Nenhum lançamento registrado
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={dadosFormatados}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
                dataKey="total"
                nameKey="nome"
              >
                {dadosFormatados.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={cores[index % cores.length]} 
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => [
                  oculto
                    ? VALOR_MASCARADO
                    : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                  'Valor'
                ]}
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        
        <div className="mt-4 space-y-2">
          {dadosFormatados.slice(0, 5).map((item, index) => (
            <div key={item.categoria} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: cores[index % cores.length] }}
                />
                <span className="text-muted-foreground truncate max-w-[150px]">
                  {item.nome}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {oculto
                    ? VALOR_MASCARADO
                    : item.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </span>
                <span className="text-muted-foreground text-xs">
                  ({item.percentual.toFixed(0)}%)
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
