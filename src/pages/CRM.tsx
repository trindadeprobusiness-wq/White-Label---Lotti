import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LayoutDashboard, KanbanSquare, Inbox, ListTodo, Plus, CalendarPlus } from 'lucide-react';
import { CrmDashboard } from '@/components/crm/CrmDashboard';
import { CrmPipeline } from '@/components/crm/CrmPipeline';
import { CrmLeadsInbox } from '@/components/crm/CrmLeadsInbox';
import { CrmTarefas } from '@/components/crm/CrmTarefas';
import { useLeadsPendentes } from '@/hooks/crm/useCrm';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shell/PageHeader';
import { abasSublinhadas } from '@/components/shell/primitivos';
import { cn } from '@/lib/utils';

/**
 * Funil de Vendas — reúne num lugar só o que estava espalhado (contato, funil,
 * histórico, alertas, leads das fachadas) e acrescenta o que faltava: o negócio
 * separado do contato, tarefa com prazo, e etapas configuráveis em vez de enum.
 */
export default function CRM() {
  const { data: leads } = useLeadsPendentes();
  const pendentes = leads?.length ?? 0;
  const [aba, setAba] = useState('pipeline');

  const abas = [
    { valor: 'pipeline', label: 'Pipeline', icone: KanbanSquare },
    { valor: 'leads', label: 'Leads', icone: Inbox, contador: pendentes },
    { valor: 'tarefas', label: 'Tarefas', icone: ListTodo },
    { valor: 'painel', label: 'Painel', icone: LayoutDashboard },
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader
        titulo="Funil de Vendas"
        subtitulo="Leads, negócios e follow-up do primeiro contato ao fechamento."
        comBusca
        comUtilitarios
        acoes={
          <>
            <Button
              variant="outline"
              className="h-control"
              onClick={() => setAba('tarefas')}
            >
              <CalendarPlus className="mr-2 h-[18px] w-[18px]" />
              Nova tarefa
            </Button>
            <Button className="h-control" onClick={() => setAba('leads')}>
              <Plus className="mr-2 h-[18px] w-[18px]" />
              Novo lead
            </Button>
          </>
        }
      />

      <Tabs value={aba} onValueChange={setAba} className="space-y-5">
        <TabsList className={abasSublinhadas.lista}>
          {abas.map(({ valor, label, icone: Icone, contador }) => (
            <TabsTrigger key={valor} value={valor} className={abasSublinhadas.gatilho}>
              <Icone className="mr-2 h-4 w-4" />
              {label}
              {contador ? (
                // Contador ao lado do rótulo, não badge flutuante: a referência
                // mostra "Leads 9" na mesma linha.
                <span
                  className={cn(
                    'ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5',
                    'text-[11px] font-semibold tabular',
                    aba === valor
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {contador}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="pipeline" className="mt-0"><CrmPipeline /></TabsContent>
        <TabsContent value="leads" className="mt-0"><CrmLeadsInbox /></TabsContent>
        <TabsContent value="tarefas" className="mt-0"><CrmTarefas /></TabsContent>
        <TabsContent value="painel" className="mt-0"><CrmDashboard /></TabsContent>
      </Tabs>
    </div>
  );
}
