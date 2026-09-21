import { cn } from '@/lib/utils';
import { GlobalSearch } from './GlobalSearch';
import { BotaoPrivacidade } from './BotaoPrivacidade';
import { PainelAjuda } from './PainelAjuda';

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
  /** Ajuda e o interruptor de esconder valores. */
  comUtilitarios?: boolean;
  /** Permite manter ajuda sem o interruptor global de privacidade. */
  mostrarPrivacidade?: boolean;
  /**
   * Mostra o olhinho de ocultar valores financeiros. Ligado só nas telas com
   * valores em dinheiro (Dashboard, Financeiro, Aluguéis). Nas demais o botão
   * não faz sentido — Clientes, Funil, Imóveis etc. não têm o que esconder.
   */
  /** Botões da página, do secundário para o primário (o primário é o último). */
  acoes?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  titulo,
  subtitulo,
  comBusca = false,
  comUtilitarios = false,
  mostrarPrivacidade = true,
  acoes,
  className,
}: PageHeaderProps) {
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
            {/* Padrão global; Mídias é a exceção explícita solicitada para não
                exibir esse controle nesta tela. */}
            {mostrarPrivacidade && <BotaoPrivacidade />}
            <PainelAjuda />
          </div>
        )}

        {acoes && (
          <div className="order-3 flex flex-wrap items-center gap-2.5">{acoes}</div>
        )}
      </div>
    </header>
  );
}
