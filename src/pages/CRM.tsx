import { CrmPipeline } from '@/components/crm/CrmPipeline';
import { PageHeader } from '@/components/shell/PageHeader';

/**
 * Funil de Vendas — a tela é o Kanban, e só ele.
 *
 * Fachadas, Tarefas e Painel já moraram aqui como abas e depois no menu do
 * quadro; saíram dos dois por decisão do dono do produto. Os componentes
 * continuam no repositório (`CrmLeadsInbox`, `CrmTarefas`, `CrmDashboard`),
 * hoje sem nenhuma porta de entrada na interface.
 *
 * O painel tem a altura da janela e o quadro preenche o que sobra dele, em vez
 * de carregar uma conta de cabeçalho embutida no CSS do componente.
 */
export default function CRM() {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm md:-mb-10 md:h-[calc(100dvh-3.5rem)] md:p-6 md:pb-4">
      <PageHeader titulo="Funil de Vendas" className="mb-4 shrink-0" />
      <div className="min-h-0 flex-1">
        <CrmPipeline />
      </div>
    </div>
  );
}
