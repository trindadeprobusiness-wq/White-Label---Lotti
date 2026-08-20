import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ocultarDadoSensivel, type TipoDadoSensivel } from '@/lib/privacidade';
import { usePrivacidade } from '@/stores/privacidadeStore';

type DadoSensivelProps = {
  valor: string | number | null | undefined;
  tipo: TipoDadoSensivel;
  className?: string;
  href?: string;
};

/**
 * Dado que pode ser mascarado na tela. Dois comportamentos, de propósito
 * diferentes:
 *
 * **Valor em dinheiro** segue o interruptor global do cabeçalho, como em
 * aplicativo de banco: aparece por padrão e some quando o corretor decide
 * esconder. Um olhinho por cartão obrigava três cliques para ver o próprio
 * resultado do mês, toda vez que a página abria.
 *
 * **Dado pessoal** (telefone, e-mail, documento, endereço) continua começando
 * escondido, com o próprio olho: ali a proteção é contra exposição acidental
 * de dado de terceiro, e o padrão certo é o inverso. Com o modo privado ligado
 * no cabeçalho, some junto e o olho individual sai de cena — quando a tela
 * está sendo compartilhada, nada deve ser revelável por engano.
 *
 * A máscara é só visual: o valor original nunca é alterado.
 */
export function DadoSensivel({ valor, tipo, className, href }: DadoSensivelProps) {
  const valoresOcultos = usePrivacidade((s) => s.valoresOcultos);
  const [revelado, setRevelado] = useState(false);

  const ehDinheiro = tipo === 'valor';
  const oculto = ehDinheiro ? valoresOcultos : valoresOcultos || !revelado;

  const temConteudo = valor !== null && valor !== undefined && valor !== '';
  // O olho individual é só do dado pessoal, e some quando o modo privado
  // global está ligado — senão ele viraria uma brecha na própria proteção.
  const mostraOlho = temConteudo && !ehDinheiro && !valoresOcultos;

  const texto = oculto ? ocultarDadoSensivel(valor, tipo) : String(valor ?? '—');

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      {!oculto && href ? (
        <a href={href} className="hover:underline">{texto}</a>
      ) : (
        <span>{texto}</span>
      )}

      {mostraOlho && (
        <button
          type="button"
          onPointerDown={(evento) => evento.stopPropagation()}
          onClick={(evento) => {
            evento.preventDefault();
            evento.stopPropagation();
            setRevelado((atual) => !atual);
          }}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-ring"
          aria-label={revelado ? 'Ocultar dado sensível' : 'Mostrar dado sensível'}
          title={revelado ? 'Ocultar dado' : 'Mostrar dado'}
        >
          {revelado ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
      )}
    </span>
  );
}
