import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePrivacidade } from '@/stores/privacidadeStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Interruptor de "esconder valores", como no painel do Asaas e nos aplicativos
 * de banco: um controle só, no topo, que vale para o sistema inteiro.
 *
 * Fica antes do sino de propósito. Quando o corretor liga o modo privado, o
 * primeiro lugar onde ele quer o efeito é justamente na notificação de
 * recebimento, que mostra o valor na linha.
 */
export function BotaoPrivacidade() {
  const valoresOcultos = usePrivacidade((s) => s.valoresOcultos);
  const alternar = usePrivacidade((s) => s.alternar);

  const rotulo = valoresOcultos ? 'Mostrar valores' : 'Ocultar valores';

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={alternar}
          aria-pressed={valoresOcultos}
          aria-label={rotulo}
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-lg transition-colors duration-150 focus-ring',
            // Ligado fica com cor de marca: o corretor precisa saber que a tela
            // está mascarada, senão confunde valor escondido com valor zerado.
            valoresOcultos
              ? 'bg-surface-brand text-primary hover:bg-surface-brand/70'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {valoresOcultos
            ? <EyeOff className="h-[18px] w-[18px]" />
            : <Eye className="h-[18px] w-[18px]" />}
        </button>
      </TooltipTrigger>
      <TooltipContent>{rotulo}</TooltipContent>
    </Tooltip>
  );
}
