import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LayoutDashboard, KanbanSquare, Inbox, ListTodo } from 'lucide-react';
import { CrmDashboard } from '@/components/crm/CrmDashboard';
import { CrmPipeline } from '@/components/crm/CrmPipeline';
import { CrmLeadsInbox } from '@/components/crm/CrmLeadsInbox';
import { CrmTarefas } from '@/components/crm/CrmTarefas';
import { useLeadsPendentes } from '@/hooks/crm/useCrm';
import { Badge } from '@/components/ui/badge';

/**
 * CRM — reúne num lugar só o que estava espalhado (contato, funil, histórico,
 * alertas, leads das fachadas) e acrescenta o que faltava: o negócio separado
 * do contato, tarefa com prazo, e etapas configuráveis em vez de enum.
 */
export default function CRM() {
  const { data: leads } = useLeadsPendentes();
  const pendentes = leads?.length ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">CRM</h1>
          <p className="text-muted-foreground">
            Leads, negócios e follow-up — do primeiro contato ao fechamento.
          </p>
        </div>
      </div>

      <Tabs defaultValue="pipeline" className="space-y-4">
        <TabsList className="grid w-full max-w-2xl grid-cols-4">
          <TabsTrigger value="pipeline" className="flex items-center gap-2">
            <KanbanSquare className="h-4 w-4" /> Pipeline
          </TabsTrigger>
          <TabsTrigger value="leads" className="flex items-center gap-2">
            <Inbox className="h-4 w-4" /> Leads
            {pendentes > 0 && (
              <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px]">{pendentes}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="tarefas" className="flex items-center gap-2">
            <ListTodo className="h-4 w-4" /> Tarefas
          </TabsTrigger>
          <TabsTrigger value="painel" className="flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4" /> Painel
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline"><CrmPipeline /></TabsContent>
        <TabsContent value="leads"><CrmLeadsInbox /></TabsContent>
        <TabsContent value="tarefas"><CrmTarefas /></TabsContent>
        <TabsContent value="painel"><CrmDashboard /></TabsContent>
      </Tabs>
    </div>
  );
}
