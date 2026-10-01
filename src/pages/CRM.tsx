import { useState } from 'react';
import { LayoutDashboard, Inbox, ListTodo, ChevronLeft } from 'lucide-react';
import { CrmDashboard } from '@/components/crm/CrmDashboard';
import { CrmPipeline } from '@/components/crm/CrmPipeline';
import { CrmLeadsInbox } from '@/components/crm/CrmLeadsInbox';
import { CrmTarefas } from '@/components/crm/CrmTarefas';
import { useLeadsPendentes } from '@/hooks/crm/useCrm';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/shell/PageHeader';
import { cn } from '@/lib/utils';

/**
 * Funil de Vendas — reúne num lugar só o que estava espalhado (contato, funil,
 * histórico, alertas, leads das fachadas) e acrescenta o que faltava: o negócio
 * separado do contato, tarefa com prazo, e etapas configuráveis em vez de enum.
 *
 * A tela é o Kanban. Fachadas, Tarefas e Painel são consultas ocasionais e
 * moram no menu do próprio quadro: como abas fixas, cobravam uma faixa
 * permanente da tela e empurravam as colunas para baixo, que é o que se vem
 * ver aqui. Os botões "Nova tarefa" e "Novo lead" saíram porque nenhum dos
 * dois criava nada — só trocavam de aba.
 */

const SECOES = {
  leads: { titulo: 'Fachadas', icone: Inbox, conteudo: <CrmLeadsInbox /> },
  tarefas: { titulo: 'Tarefas', icone: ListTodo, conteudo: <CrmTarefas /> },
  painel: { titulo: 'Painel', icone: LayoutDashboard, conteudo: <CrmDashboard /> },
} as const;

type Secao = keyof typeof SECOES;

export default function CRM() {
  const { data: leads } = useLeadsPendentes();
  const pendentes = leads?.length ?? 0;
  const [secao, setSecao] = useState<Secao | null>(null);
  const aberta = secao ? SECOES[secao] : null;

  return (
    /* Um painel branco sobre o fundo da área de trabalho, com o funil inteiro
       dentro dele. Com o quadro solto na página, as colunas flutuavam sem
       moldura e a tela não tinha onde terminar.
       No Kanban a altura é a da janela: o quadro desce até a borda de baixo e
       rola por dentro, em vez de deixar uma faixa morta abaixo das colunas.
       Nas outras seções, que são listas, a altura volta a ser a do conteúdo. */
    <div
      className={cn(
        'animate-fade-in flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6',
        !aberta && 'md:h-[calc(100dvh-6rem)]',
      )}
    >
      <PageHeader
        titulo="Funil de Vendas"
        subtitulo="Leads, negócios e follow-up do primeiro contato ao fechamento."
        comBusca={!!aberta}
        className="mb-5 shrink-0"
      />

      {aberta ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setSecao(null)}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Funil
          </button>
          <h2 className="text-lg font-semibold">{aberta.titulo}</h2>
          {aberta.conteudo}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <CrmPipeline
            extrasDoMenu={
              <>
                <DropdownMenuSeparator />
                {(Object.keys(SECOES) as Secao[]).map((chave) => {
                  const { titulo, icone: Icone } = SECOES[chave];
                  return (
                    <DropdownMenuItem key={chave} onSelect={() => setSecao(chave)}>
                      <Icone className="mr-2 h-4 w-4" />
                      {titulo}
                      {chave === 'leads' && pendentes > 0 && (
                        <span className="ml-auto text-xs text-muted-foreground tabular">{pendentes}</span>
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </>
            }
          />
        </div>
      )}
    </div>
  );
}
