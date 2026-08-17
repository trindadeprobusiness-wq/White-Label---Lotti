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
  Download,
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
import { PageHeader } from '@/components/shell/PageHeader';
import { MetricCard, SectionCard, abasSublinhadas } from '@/components/shell/primitivos';
import { moeda, percentual, dataBR } from '@/lib/formato';
import { montarCsv, baixarCsv, nomeArquivoCsv } from '@/lib/admin/csv';
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

  /**
   * Exporta os lançamentos do período. Reusa o montarCsv do back office, que
   * já trata separador pt-BR, BOM e injeção de fórmula — o mesmo relatório
   * abre no Excel sem "ImobiliÃ¡ria" e sem executar nada.
   */
  const exportarCsv = () => {
    baixarCsv(
      montarCsv(lancamentos, [
        { cabecalho: 'Data', valor: (l) => dataBR(l.data) },
        { cabecalho: 'Tipo', valor: (l) => l.tipo },
        { cabecalho: 'Categoria', valor: (l) => l.categoria },
        { cabecalho: 'Descrição', valor: (l) => l.descricao },
        { cabecalho: 'Valor', valor: (l) => l.valor },
      ]),
      nomeArquivoCsv('financeiro'),
    );
  };

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
    <div className="animate-fade-in">
      <PageHeader
        titulo="Financeiro"
        subtitulo="Acompanhe receitas, despesas e o resultado do seu negócio."
        acoes={
          <>
            {periodo === 'personalizado' && (
              <DatePickerWithRange date={customDate} onDateChange={setCustomDate} />
            )}

            <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
              <SelectTrigger className="h-control w-[170px]">
                <Calendar className="mr-2 h-[18px] w-[18px] text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mes_atual">Mês atual</SelectItem>
                <SelectItem value="trimestre">Trimestre</SelectItem>
                <SelectItem value="ano">Ano</SelectItem>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="personalizado">Personalizado</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="outline" className="h-control" onClick={exportarCsv}>
              <Download className="mr-2 h-[18px] w-[18px]" />
              Exportar
            </Button>

            <NovoLancamentoDialog onSuccess={carregarDados} />
          </>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Receita total"
          valor={moeda(resumo.receita_total, true)}
          icone={<TrendingUp className="h-5 w-5" />}
          tom="success"
        />
        <MetricCard
          label="Despesas"
          valor={moeda(resumo.despesa_total, true)}
          icone={<TrendingDown className="h-5 w-5" />}
          tom="destructive"
        />
        <MetricCard
          label="Lucro líquido"
          valor={moeda(resumo.lucro, true)}
          icone={<Wallet className="h-5 w-5" />}
          tom={resumo.lucro >= 0 ? 'brand' : 'warning'}
        />
        <MetricCard
          label="Margem"
          valor={percentual(resumo.margem)}
          icone={<Percent className="h-5 w-5" />}
          tom="warning"
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="visao_geral" className="space-y-5">
        <TabsList className={abasSublinhadas.lista}>
          <TabsTrigger value="visao_geral" className={abasSublinhadas.gatilho}>Visão geral</TabsTrigger>
          <TabsTrigger value="custos" className={abasSublinhadas.gatilho}>Custos</TabsTrigger>
          <TabsTrigger value="faturamento" className={abasSublinhadas.gatilho}>Faturamento</TabsTrigger>
          <TabsTrigger value="projecao" className={abasSublinhadas.gatilho}>Projeção</TabsTrigger>
        </TabsList>

        {/* Visão Geral */}
        <TabsContent value="visao_geral" className="mt-0 space-y-5">
          {/* Resultado do período: a conta explícita que a referência mostra.
              Receita − Despesa = Lucro é o que o corretor confere primeiro, e
              o gráfico sozinho não responde isso de bate-pronto. */}
          <SectionCard titulo={`Resultado de ${periodoLabel[periodo].toLowerCase()}`}>
            <div className="grid gap-5 lg:grid-cols-[auto_1fr] lg:items-center">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-[8.5rem] rounded-lg border border-success/20 bg-success-surface px-4 py-3">
                  <p className="text-xs text-muted-foreground">Receitas</p>
                  <p className="mt-1 text-lg font-semibold tabular text-success">
                    {moeda(resumo.receita_total, true)}
                  </p>
                </div>
                <span className="text-lg text-muted-foreground" aria-hidden="true">−</span>
                <div className="min-w-[8.5rem] rounded-lg border border-destructive/20 bg-destructive-surface px-4 py-3">
                  <p className="text-xs text-muted-foreground">Despesas</p>
                  <p className="mt-1 text-lg font-semibold tabular text-destructive">
                    {moeda(resumo.despesa_total, true)}
                  </p>
                </div>
                <span className="text-lg text-muted-foreground" aria-hidden="true">=</span>
                <div className="min-w-[8.5rem] rounded-lg bg-primary px-4 py-3">
                  <p className="text-xs text-primary-foreground/75">Lucro líquido</p>
                  <p className="mt-1 text-lg font-semibold tabular text-primary-foreground">
                    {moeda(resumo.lucro, true)}
                  </p>
                </div>
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">Margem</span>
                  <span className="text-lg font-semibold tabular">{percentual(resumo.margem)}</span>
                </div>
                <div
                  className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`Margem de ${percentual(resumo.margem)}`}
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    // Margem negativa não tem barra: largura negativa não existe,
                    // e mostrar 0% deixa claro que não sobrou nada.
                    style={{ width: `${Math.max(0, Math.min(100, resumo.margem))}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Resultado calculado com os lançamentos do período.
                </p>
              </div>
            </div>
          </SectionCard>

          <div className="grid gap-5 lg:grid-cols-2">
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
