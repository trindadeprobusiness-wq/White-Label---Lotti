import { format } from 'date-fns';
import { useEffect } from 'react';
import { ptBR } from 'date-fns/locale';
import { AlertTriangle, ArrowRight, Users, Building2, FileText, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useCRMStore } from '@/stores/crmStore';
import { corretorMock } from '@/data/mockData';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export default function Dashboard() {
  const { clientes, alertas, imoveis, corretor, fetchCorretor } = useCRMStore();

  useEffect(() => {
    fetchCorretor();
  }, []);

  const alertasNaoLidos = alertas.filter(a => !a.lido);

  const funnelCounts = {
    qualificacao: clientes.filter(c => c.status_funil === 'QUALIFICACAO').length,
    visitaProposta: clientes.filter(c => c.status_funil === 'VISITA_PROPOSTA').length,
    documentacao: clientes.filter(c => c.status_funil === 'DOCUMENTACAO').length,
    fechadoGanho: clientes.filter(c => c.status_funil === 'FECHADO_GANHO').length,
  };

  const hoje = format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });

  return (
    <div className="space-y-10 animate-fade-in-up">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold text-foreground tracking-tight">
          Bem-vindo, {corretor?.nome || 'Corretor'}
        </h1>
        <p className="text-muted-foreground capitalize mt-1 font-medium">{hoje}</p>
      </div>

      {/* Critical Alerts */}
      {alertasNaoLidos.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              Ações Críticas ({alertasNaoLidos.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {alertasNaoLidos.map((alerta) => (
              <div
                key={alerta.id}
                className="flex items-center justify-between p-3 bg-card rounded-lg border border-destructive/20"
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                  <span className="text-sm font-medium">{alerta.mensagem}</span>
                </div>
                <div className="flex gap-2">
                  {alerta.cliente_id && (
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/clientes/${alerta.cliente_id}`}>
                        Ver Cliente
                      </Link>
                    </Button>
                  )}
                  {alerta.imovel_id && (
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/imoveis">
                        Ver Imóvel
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{clientes.length}</p>
                <p className="text-sm text-muted-foreground">Clientes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <Building2 className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{imoveis.length}</p>
                <p className="text-sm text-muted-foreground">Imóveis</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <FileText className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">{funnelCounts.documentacao}</p>
                <p className="text-sm text-muted-foreground">Em Documentação</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <TrendingUp className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{funnelCounts.fechadoGanho}</p>
                <p className="text-sm text-muted-foreground">Vendas Fechadas</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Funnel Summary */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-xl tracking-tight">Resumo do Funil</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/funil" className="flex items-center gap-1">
              Ver Funil Completo
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className={cn(
              "text-center p-4 rounded-lg",
              "bg-funnel-qualification"
            )}>
              <p className="text-3xl font-bold text-primary">{funnelCounts.qualificacao}</p>
              <p className="text-sm text-muted-foreground font-medium">Qualificação</p>
            </div>
            <div className={cn(
              "text-center p-4 rounded-lg",
              "bg-funnel-visit"
            )}>
              <p className="text-3xl font-bold text-warning">{funnelCounts.visitaProposta}</p>
              <p className="text-sm text-muted-foreground font-medium">Visita/Proposta</p>
            </div>
            <div className={cn(
              "text-center p-4 rounded-lg",
              "bg-funnel-documentation"
            )}>
              <p className="text-3xl font-bold text-orange-500">{funnelCounts.documentacao}</p>
              <p className="text-sm text-muted-foreground font-medium">Documentação</p>
            </div>
            <div className={cn(
              "text-center p-4 rounded-lg",
              "bg-funnel-closing"
            )}>
              <p className="text-3xl font-bold text-success">{funnelCounts.fechadoGanho}</p>
              <p className="text-sm text-muted-foreground font-medium">Fechados</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-xl tracking-tight">Clientes Recentes</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/clientes">Ver Todos</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {clientes.slice(0, 4).map((cliente) => (
              <Link
                key={cliente.id}
                to={`/clientes/${cliente.id}`}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors"
              >
                <div>
                  <p className="font-medium">{cliente.nome}</p>
                  <p className="text-sm text-muted-foreground">{cliente.telefone}</p>
                </div>
                <Badge variant={
                  cliente.status_funil === 'FECHADO_GANHO' ? 'default' :
                    cliente.status_funil === 'DOCUMENTACAO' ? 'secondary' :
                      'outline'
                }>
                  {cliente.status_funil === 'QUALIFICACAO' && 'Qualificação'}
                  {cliente.status_funil === 'VISITA_PROPOSTA' && 'Visita'}
                  {cliente.status_funil === 'DOCUMENTACAO' && 'Documentação'}
                  {cliente.status_funil === 'FECHADO_GANHO' && 'Ganho'}
                  {cliente.status_funil === 'FECHADO_PERDIDO' && 'Perdido'}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-xl tracking-tight">Imóveis em Destaque</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/imoveis">Ver Todos</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {imoveis.slice(0, 4).map((imovel) => (
              <Link
                key={imovel.id}
                to={`/imoveis/${imovel.id}`}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors"
              >
                <div>
                  <p className="font-medium">{imovel.titulo}</p>
                  <p className="text-sm text-muted-foreground">
                    {imovel.bairro} • {imovel.valor > 10000
                      ? `R$ ${(imovel.valor / 1000).toFixed(0)}k`
                      : `R$ ${imovel.valor.toLocaleString('pt-BR')}/mês`
                    }
                  </p>
                </div>
                {imovel.exclusividade_ate && (
                  <Badge variant="outline" className="text-xs">
                    Exclusiva
                  </Badge>
                )}
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
