import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ocultarDadoSensivel, type TipoDadoSensivel } from '@/lib/privacidade';

type DadoSensivelProps = {
  valor: string | number | null | undefined;
  tipo: TipoDadoSensivel;
  className?: string;
  href?: string;
};

/** Campo individual: começa oculto e só revela seu próprio valor ao clicar. */
export function DadoSensivel({ valor, tipo, className, href }: DadoSensivelProps) {
  const [visivel, setVisivel] = useState(false);
  const texto = visivel ? String(valor ?? '—') : ocultarDadoSensivel(valor, tipo);

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      {visivel && href ? <a href={href} className="hover:underline">{texto}</a> : <span>{texto}</span>}
      {valor !== null && valor !== undefined && valor !== '' && (
        <button
          type="button"
          onPointerDown={(evento) => evento.stopPropagation()}
          onClick={(evento) => {
            evento.preventDefault();
            evento.stopPropagation();
            setVisivel((atual) => !atual);
          }}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-ring"
          aria-label={visivel ? 'Ocultar dado sensível' : 'Mostrar dado sensível'}
          title={visivel ? 'Ocultar dado' : 'Mostrar dado'}
        >
          {visivel ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
      )}
    </span>
  );
}
