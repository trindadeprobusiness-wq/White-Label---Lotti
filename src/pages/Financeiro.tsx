import { useEffect, useState, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, startOfYear, endOfYear, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DateRange } from "react-day-picker";
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  Wallet,
  Percent,
  Calendar,
  Filter,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useFinanceiro } from '@/hooks/useFinanceiro';
import { KPICard } from '@/components/financeiro/KPICard';
import { NovoLancamentoDialog } from '@/components/financeiro/NovoLancamentoDialog';
import { LancamentoCard } from '@/components/financeiro/LancamentoCard';
import { GraficoReceitaDespesa } from '@/components/financeiro/GraficoReceitaDespesa';
import { GraficoProjecao } from '@/components/financeiro/GraficoProjecao';
import { GraficoCategorias } from '@/components/financeiro/GraficoCategorias';
import { LancamentoFinanceiro, ProjecaoMensal, TipoLancamento } from '@/types/financeiro';
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import { toast } from 'sonner';

type Periodo = 'mes_atual' | 'trimestre' | 'ano' | 'todos' | 'personalizado';

export default function Financeiro() {
  const [periodo, setPeriodo] = useState<Periodo>('mes_atual');
  const [customDate, setCustomDate] = useState<DateRange | undefined>();
  const [projecao, setProjecao] = useState<ProjecaoMensal[]>([]);
  const [filtroTipo, setFiltroTipo] = useState<TipoLancamento | 'todos'>('todos');
  const [lancamentoEmEdicao, setLancamentoEmEdicao] = useState<LancamentoFinanceiro | null>(null);

  const {
    lancamentos,
    loading,
    fetchLancamentos,
    deleteLancamento,
    calcularResumo,
    calcularPorCategoria,
    calcularProjecaoAnual,
  } = useFinanceiro();

  const carregarDados = async () => {
    const hoje = new Date();
    let dataInicio: Date | undefined;
    let dataFim: Date | undefined;

    switch (periodo) {
      case 'mes_atual':
        dataInicio = startOfMonth(hoje);
        dataFim = endOfMonth(hoje);
        break;
      case 'trimestre':
        dataInicio = subMonths(startOfMonth(hoje), 2);
        dataFim = endOfMonth(hoje);
        break;
      case 'ano':
        dataInicio = startOfYear(hoje);
        dataFim = endOfYear(hoje);
        break;
      case 'personalizado':
        if (customDate?.from) {
          dataInicio = customDate.from;
          dataFim = customDate.to || customDate.from;
        }
        break;
      default:
        dataInicio = undefined;
        dataFim = undefined;
    }

    // Só busca se tiver datas definidas (ou for 'todos')
    if (periodo === 'personalizado' && !dataInicio) return;

    await fetchLancamentos({ dataInicio, dataFim });

    const projecaoData = await calcularProjecaoAnual();
    setProjecao(projecaoData);
  };

  useEffect(() => {
    carregarDados();
  }, [periodo, customDate]);

  const handleDelete = async (id: string) => {
    try {
      await deleteLancamento(id);
      toast.success('Lançamento excluído com sucesso');
    } catch (error) {
      toast.error('Erro ao excluir lançamento');
    }
  };

  const handleEdit = (lancamento: LancamentoFinanceiro) => {
    setLancamentoEmEdicao(lancamento);
  };

  const resumo = useMemo(() => calcularResumo(), [lancamentos]);
  const despesasPorCategoria = useMemo(() => calcularPorCategoria('DESPESA'), [lancamentos]);
  const receitasPorCategoria = useMemo(() => calcularPorCategoria('RECEITA'), [lancamentos]);

  const lancamentosFiltrados = useMemo(() => {
    if (filtroTipo === 'todos') return lancamentos;
    return lancamentos.filter(l => l.tipo === filtroTipo);
  }, [lancamentos, filtroTipo]);

  const periodoLabel = {
    mes_atual: format(new Date(), "MMMM 'de' yyyy", { locale: ptBR }),
    trimestre: 'Últimos 3 meses',
    ano: `Ano de ${new Date().getFullYear()}`,
    todos: 'Todo o período',
    personalizado: customDate?.from
      ? `${format(customDate.from, "dd/MM/yyyy")} - ${customDate.to ? format(customDate.to, "dd/MM/yyyy") : '...'}`
      : 'Período Personalizado',
  };

  if (loading && lancamentos.length === 0) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Financeiro</h1>
          <p className="text-muted-foreground">
            Gerencie receitas, despesas e acompanhe sua projeção anual
          </p>
        </div>

        <div className="flex items-center gap-3">
          {periodo === 'personalizado' && (
            <DatePickerWithRange
              date={customDate}
              onDateChange={setCustomDate}
            />
          )}

          <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
            <SelectTrigger className="w-[180px]">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mes_atual">Mês Atual</SelectItem>
              <SelectItem value="trimestre">Trimestre</SelectItem>
              <SelectItem value="ano">Ano</SelectItem>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="personalizado">Personalizado</SelectItem>
            </SelectContent>
          </Select>

          <NovoLancamentoDialog onSuccess={carregarDados} />
        </div>
      </div>

      <p className="text-sm text-muted-foreground -mt-2">
        📅 Exibindo: <span className="font-medium capitalize">{periodoLabel[periodo]}</span>
      </p>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard
          titulo="Receita Total"
          valor={resumo.receita_total}
          icone={<TrendingUp className="h-5 w-5" />}
          corIcone="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
        />
        <KPICard
          titulo="Despesas"
          valor={resumo.despesa_total}
          icone={<TrendingDown className="h-5 w-5" />}
          corIcone="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
        />
        <KPICard
          titulo="Lucro Líquido"
          valor={resumo.lucro}
          icone={<Wallet className="h-5 w-5" />}
          corIcone={resumo.lucro >= 0
            ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
            : "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400"
          }
        />
        <KPICard
          titulo="Margem"
          valor={resumo.margem}
          formatoMoeda={false}
          formatoPercentual={true}
          icone={<Percent className="h-5 w-5" />}
          corIcone="bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="visao_geral" className="space-y-4">
        <TabsList>
          <TabsTrigger value="visao_geral">Visão Geral</TabsTrigger>
          <TabsTrigger value="custos">Custos</TabsTrigger>
          <TabsTrigger value="faturamento">Faturamento</TabsTrigger>
          <TabsTrigger value="projecao">Projeção</TabsTrigger>
        </TabsList>

        {/* Visão Geral */}
        <TabsContent value="visao_geral" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <GraficoReceitaDespesa lancamentos={lancamentos} />

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="lg:text-lg">Últimos Lançamentos</CardTitle>
                <Select
                  value={filtroTipo}
                  onValueChange={(v) => setFiltroTipo(v as TipoLancamento | 'todos')}
                >
                  <SelectTrigger className="w-[130px]">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="RECEITA">Receitas</SelectItem>
                    <SelectItem value="DESPESA">Despesas</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent className="space-y-3 max-h-[350px] overflow-y-auto">
                {lancamentosFiltrados.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    Nenhum lançamento encontrado
                  </p>
                ) : (
                  <>
                    {lancamentosFiltrados.slice(0, 10).map((lancamento) => (
                      <LancamentoCard
                        key={lancamento.id}
                        lancamento={lancamento}
                        onDelete={handleDelete}
                        onEdit={handleEdit}
                      />
                    ))}
                    {lancamentosFiltrados.length > 10 && (
                      <div className="text-center pt-2 pb-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          + {lancamentosFiltrados.length - 10} lançamentos ocultos.
                        </p>
                        <p className="text-[10px] text-muted-foreground/70">
                          Acesse as abas "Custos" ou "Faturamento" para ver a lista completa.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Custos */}
        <TabsContent value="custos" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <GraficoCategorias
              dados={despesasPorCategoria}
              titulo="Distribuição de Custos"
              tipo="despesa"
            />

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Despesas do Período</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 max-h-[400px] overflow-y-auto">
                {lancamentos.filter(l => l.tipo === 'DESPESA').length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    Nenhuma despesa registrada
                  </p>
                ) : (
                  lancamentos
                    .filter(l => l.tipo === 'DESPESA')
                    .map((lancamento) => (
                      <LancamentoCard
                        key={lancamento.id}
                        lancamento={lancamento}
                        onDelete={handleDelete}
                        onEdit={handleEdit}
                      />
                    ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* Cards por tipo de custo */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  📢 Anúncios
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {despesasPorCategoria
                    .filter(d => d.categoria.startsWith('ANUNCIO'))
                    .reduce((acc, d) => acc + d.total, 0)
                    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  🏢 Operacional
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {despesasPorCategoria
                    .filter(d => d.categoria.startsWith('OPERACIONAL'))
                    .reduce((acc, d) => acc + d.total, 0)
                    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  📄 Impostos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {despesasPorCategoria
                    .filter(d => d.categoria.startsWith('IMPOSTO'))
                    .reduce((acc, d) => acc + d.total, 0)
                    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Faturamento */}
        <TabsContent value="faturamento" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <GraficoCategorias
              dados={receitasPorCategoria}
              titulo="Fontes de Receita"
              tipo="receita"
            />

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Receitas do Período</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 max-h-[400px] overflow-y-auto">
                {lancamentos.filter(l => l.tipo === 'RECEITA').length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    Nenhuma receita registrada
                  </p>
                ) : (
                  lancamentos
                    .filter(l => l.tipo === 'RECEITA')
                    .map((lancamento) => (
                      <LancamentoCard
                        key={lancamento.id}
                        lancamento={lancamento}
                        onDelete={handleDelete}
                        onEdit={handleEdit}
                      />
                    ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* Cards por tipo de receita */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  💰 Comissões de Venda
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {receitasPorCategoria
                    .filter(d => d.categoria === 'COMISSAO_VENDA')
                    .reduce((acc, d) => acc + d.total, 0)
                    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  🔑 Comissões de Locação
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {receitasPorCategoria
                    .filter(d => d.categoria === 'COMISSAO_LOCACAO')
                    .reduce((acc, d) => acc + d.total, 0)
                    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  💼 Outros Serviços
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {receitasPorCategoria
                    .filter(d => !['COMISSAO_VENDA', 'COMISSAO_LOCACAO'].includes(d.categoria))
                    .reduce((acc, d) => acc + d.total, 0)
                    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Projeção */}
        <TabsContent value="projecao" className="space-y-6">
          <GraficoProjecao dados={projecao} />

          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  📈 Receita Anual Projetada
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {projecao.reduce((acc, p) => acc + p.receita, 0)
                    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  📉 Despesa Anual Projetada
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {projecao.reduce((acc, p) => acc + p.despesa, 0)
                    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  💵 Lucro Anual Projetado
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {projecao.reduce((acc, p) => acc + p.lucro, 0)
                    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  📊 Média Mensal
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {(projecao.reduce((acc, p) => acc + p.lucro, 0) / 12)
                    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      <NovoLancamentoDialog
        onSuccess={() => {
          carregarDados();
          setLancamentoEmEdicao(null);
        }}
        lancamentoToEdit={lancamentoEmEdicao}
        open={!!lancamentoEmEdicao}
        onOpenChange={(open) => !open && setLancamentoEmEdicao(null)}
      />
    </div>
  );
}
