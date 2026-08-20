import { useMemo } from 'react';
import { Users, Target, TrendingUp, CircleDollarSign, AlertTriangle, Inbox } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCRMStore } from '@/stores/crmStore';
import { taxaConversao, totalPorEtapa, tarefaAtrasada } from '@/lib/crm/pipeline';
import { useEtapas, useOportunidades, useTarefas, useLeadsPendentes } from '@/hooks/crm/useCrm';
import { DadoSensivel } from '@/components/ui/dado-sensivel';

const moeda = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** O que precisamos ler de `clientes.tracking_data` (jsonb, ausente no types.ts). */
type ClienteComOrigem = { tracking_data?: { utm_source?: string; origem?: string } | null };

function Indicador({ titulo, valor, icone: Icone, detalhe, destaque }: {
  titulo: string; valor: React.ReactNode; icone: LucideIcon; detalhe?: string; destaque?: boolean;
}) {
  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{titulo}</CardTitle>
        <span className="rounded-lg bg-accent p-2">
          <Icone className={`h-4 w-4 ${destaque ? 'text-amber-500' : 'text-primary'}`} />
        </span>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-semibold ${destaque ? 'text-amber-600 dark:text-amber-400' : ''}`}>
          {valor}
        </div>
        {detalhe && <p className="text-xs text-muted-foreground mt-1">{detalhe}</p>}
      </CardContent>
    </Card>
  );
}

export function CrmDashboard() {
  const { data: etapas, isLoading: le } = useEtapas();
  const { data: oportunidades, isLoading: lo } = useOportunidades();
  const { data: tarefas } = useTarefas();
  const { data: leads } = useLeadsPendentes();
  const { clientes } = useCRMStore();

  const m = useMemo(() => {
    const ops = oportunidades ?? [];
    const eta = etapas ?? [];
    const tipoPorEtapa = new Map(eta.map((e) => [e.id, e.tipo]));
    const abertas = ops.filter((o) => tipoPorEtapa.get(o.etapa_id) === 'ABERTA');
    const ganhas = ops.filter((o) => tipoPorEtapa.get(o.etapa_id) === 'GANHO');

    // Origem sai de tracking_data, que era gravado (UTM, campanha, canal) e
    // nunca exibido em lugar nenhum do sistema. `tracking_data` não está no
    // types.ts gerado, daí a leitura estrutural.
    const porOrigem = new Map<string, number>();
    for (const c of clientes as ClienteComOrigem[]) {
      const origem = c.tracking_data?.utm_source ?? c.tracking_data?.origem ?? 'Direto';
      porOrigem.set(origem, (porOrigem.get(origem) ?? 0) + 1);
    }

    return {
      totalClientes: clientes.length,
      abertas: abertas.length,
      pipeline: totalPorEtapa(abertas),
      ganho: totalPorEtapa(ganhas),
      conversao: taxaConversao(eta, ops),
      atrasadas: (tarefas ?? []).filter((t) => tarefaAtrasada(t)).length,
      leads: leads?.length ?? 0,
      origens: [...porOrigem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4),
    };
  }, [etapas, oportunidades, tarefas, leads, clientes]);

  if (le || lo) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Indicador titulo="Contatos" valor={String(m.totalClientes)} icone={Users} />
        <Indicador titulo="Negócios abertos" valor={String(m.abertas)} icone={Target} />
        <Indicador titulo="Valor no pipeline" valor={<DadoSensivel valor={moeda(m.pipeline)} tipo="valor" />} icone={CircleDollarSign}
          detalhe="Soma dos negócios em aberto" />
        <Indicador titulo="Taxa de conversão" valor={`${m.conversao}%`} icone={TrendingUp}
          detalhe="Ganhos sobre negócios encerrados" />
        <Indicador titulo="Ganho" valor={<DadoSensivel valor={moeda(m.ganho)} tipo="valor" />} icone={CircleDollarSign} />
        <Indicador titulo="Tarefas atrasadas" valor={String(m.atrasadas)} icone={AlertTriangle}
          destaque={m.atrasadas > 0} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-sm">Origem dos contatos</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {m.origens.length === 0 && <p className="text-sm text-muted-foreground">Sem dados de origem ainda.</p>}
            {m.origens.map(([origem, qtd]) => (
              <div key={origem} className="flex items-center justify-between text-sm">
                <span className="truncate">{origem}</span>
                <span className="font-medium">{qtd}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-1.5">
            <Inbox className="h-4 w-4" /> Leads esperando
          </CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{m.leads}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {m.leads > 0 ? 'Converta na aba Leads para virarem clientes.' : 'Nada pendente.'}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
