import {
  BarChart3,
  QrCode,
  Users,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import type { FachadaMetricas } from '@/types/fachada';

const PERIODOS = [
  { value: 7, label: 'Últimos 7 dias' },
  { value: 30, label: 'Últimos 30 dias' },
  { value: 90, label: 'Últimos 90 dias' },
  { value: 3650, label: 'Todo o período' },
];

interface FachadaDashboardProps {
  metricas: FachadaMetricas | null;
  periodo: number;
  onPeriodoChange: (dias: number) => void;
}

export function FachadaDashboard({ metricas, periodo, onPeriodoChange }: FachadaDashboardProps) {
  const periodoLabel = PERIODOS.find((p) => p.value === periodo)?.label ?? 'Últimos 30 dias';

  if (!metricas) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <BarChart3 className="h-12 w-12 mb-3 opacity-40" />
        <p>Carregando métricas...</p>
      </div>
    );
  }

  const cards = [
    {
      title: 'Fachadas Ativas',
      value: metricas.totalFachadas,
      icon: QrCode,
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
    },
    {
      title: 'Escaneamentos',
      value: metricas.totalEscaneamentos,
      icon: BarChart3,
      color: 'text-violet-500',
      bg: 'bg-violet-500/10',
    },
    {
      title: 'Leads Capturados',
      value: metricas.totalLeads,
      icon: Users,
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
    },
    {
      title: 'Taxa de Conversão',
      value: `${metricas.taxaConversao}%`,
      icon: TrendingUp,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10',
    },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Card key={c.title} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4 flex items-center gap-4">
              <div className={`p-3 rounded-xl ${c.bg}`}>
                <c.icon className={`h-6 w-6 ${c.color}`} />
              </div>
              <div>
                <p className="text-2xl font-bold">{c.value}</p>
                <p className="text-xs text-muted-foreground">{c.title}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-lg">Leads &amp; Escaneamentos — {periodoLabel}</CardTitle>
            <Select value={String(periodo)} onValueChange={(v) => onPeriodoChange(Number(v))}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODOS.map((p) => (
                  <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {metricas.leadsPorDia.length === 0 ? (
            <div className="flex items-center justify-center h-52 text-muted-foreground">
              <p>Nenhum dado registrado ainda.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={metricas.leadsPorDia}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis
                  dataKey="data"
                  tickFormatter={(v: string) => {
                    const d = new Date(v + 'T00:00:00');
                    return `${d.getDate()}/${d.getMonth() + 1}`;
                  }}
                  fontSize={11}
                />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip
                  labelFormatter={(v: string) => {
                    const d = new Date(v + 'T00:00:00');
                    return d.toLocaleDateString('pt-BR');
                  }}
                />
                <Legend />
                <Bar
                  dataKey="escaneamentos"
                  name="Escaneamentos"
                  fill="#8b5cf6"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="leads"
                  name="Leads"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
