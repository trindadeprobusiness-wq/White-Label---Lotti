import { VALOR_MASCARADO } from '@/lib/privacidade';
import { usePrivacidade } from '@/stores/privacidadeStore';

/**
 * Um valor em reais que respeita o modo privado.
 *
 * Existe porque o módulo de Aluguéis e o Financeiro repetiam
 * `R$ {x.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` em mais de
 * vinte lugares. Envolver cada um à mão deixaria a máscara dependendo de
 * ninguém esquecer — e foi exatamente assim que os cartões de baixo do
 * Financeiro continuaram mostrando valor com o modo ligado.
 *
 * Com um componente só, esquecer fica visível: ou o valor passa por aqui, ou
 * ele aparece cru na busca por `toLocaleString`.
 */
export function Dinheiro({
  valor,
  casas = 2,
}: {
  valor: number | null | undefined;
  /** Casas decimais. Alguns resumos mostram valor cheio, sem centavos. */
  casas?: number;
}) {
  const oculto = usePrivacidade((s) => s.valoresOcultos);

  if (oculto) return <>{VALOR_MASCARADO}</>;

  return (
    <>
      {`R$ ${(valor ?? 0).toLocaleString('pt-BR', {
        minimumFractionDigits: casas,
        maximumFractionDigits: casas,
      })}`}
    </>
  );
}
