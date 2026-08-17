import { Bell, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlobalSearch } from './GlobalSearch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCRMStore } from '@/stores/crmStore';

/**
 * Faixa superior do workspace.
 *
 * Não é navbar de site: não tem links de navegação, marca nem menu. É o
 * contexto da página (título, subtítulo) mais as ações que pertencem a ela.
 * A navegação inteira mora na sidebar.
 */

interface PageHeaderProps {
  titulo: string;
  subtitulo?: string;
  /** Mostra a busca global. Ligada nas telas com volume de registros. */
  comBusca?: boolean;
  /** Sino de alertas e ajuda. Ligados onde a referência os mostra. */
  comUtilitarios?: boolean;
  /** Botões da página, do secundário para o primário (o primário é o último). */
  acoes?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  titulo,
  subtitulo,
  comBusca = false,
  comUtilitarios = false,
  acoes,
  className,
}: PageHeaderProps) {
  const { alertas } = useCRMStore();
  const naoLidos = alertas.filter((a) => !a.lido).length;

  return (
    <header
      className={cn(
        // Em telas largas tudo cabe numa linha; abaixo disso as ações descem
        // para a segunda, em vez de espremer o título até ele quebrar feio.
        'mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between',
        className,
      )}
    >
      <div className="min-w-0 shrink-0">
        <h1 className="text-title text-foreground">{titulo}</h1>
        {subtitulo && (
          <p className="mt-1 text-sm text-muted-foreground">{subtitulo}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5 xl:flex-nowrap">
        {comBusca && (
          <GlobalSearch className="order-1 w-full min-w-0 sm:w-80 xl:w-[26rem] xl:flex-1" />
        )}

        {comUtilitarios && (
          // order-2 também no mobile: com order-3 os utilitários caíam numa
          // terceira linha sozinhos, abaixo dos botões, o que parecia sobra
          // de layout em vez de agrupamento.
          <div className="order-2 flex items-center gap-1">
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="relative flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-ring"
                  aria-label={
                    naoLidos > 0
                      ? `Notificações: ${naoLidos} não lida(s)`
                      : 'Notificações'
                  }
                >
                  <Bell className="h-[18px] w-[18px]" />
                  {naoLidos > 0 && (
                    // Ponto, não contador: o número exato não muda a ação, e o
                    // badge numérico brigaria com o ícone em 18px.
                    <span
                      className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-warning ring-2 ring-background"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {naoLidos > 0 ? `${naoLidos} alerta(s) para ver` : 'Sem alertas novos'}
              </TooltipContent>
            </Tooltip>

            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-ring"
                  aria-label="Ajuda"
                >
                  <HelpCircle className="h-[18px] w-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Ajuda</TooltipContent>
            </Tooltip>
          </div>
        )}

        {acoes && (
          <div className="order-3 flex flex-wrap items-center gap-2.5">{acoes}</div>
        )}
      </div>
    </header>
  );
}
