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
 * Dado que some quando o modo privado está ligado — dinheiro, telefone,
 * e-mail, documento e endereço, todos governados pelo mesmo interruptor do
 * cabeçalho.
 *
 * **Por que não há mais um olhinho por campo.** Havia: cada dado trazia o
 * próprio botão e começava escondido. Numa lista de 32 clientes isso virava 32
 * olhos empilhados na coluna de contato, e ver os telefones exigia 32 cliques.
 * O controle por campo transforma privacidade em trabalho manual e, pior, não
 * protege de verdade: numa tela compartilhada basta um clique para expor.
 *
 * Um interruptor só, no topo, resolve os dois lados — esconde tudo de uma vez
 * e não pede clique nenhum no uso normal. É como banco e o painel do Asaas
 * fazem, e foi o que o usuário pediu.
 *
 * A máscara é só visual: o valor original nunca é alterado, e busca, cálculo e
 * exportação continuam usando o dado verdadeiro.
 */
export function DadoSensivel({ valor, tipo, className, href }: DadoSensivelProps) {
  const oculto = usePrivacidade((s) => s.valoresOcultos);

  if (oculto) {
    return (
      <span className={cn('inline-flex items-center', className)}>
        {ocultarDadoSensivel(valor, tipo)}
      </span>
    );
  }

  const texto = String(valor ?? '—');
  const temConteudo = valor !== null && valor !== undefined && valor !== '';

  return (
    <span className={cn('inline-flex items-center', className)}>
      {href && temConteudo ? (
        <a href={href} className="hover:underline">{texto}</a>
      ) : (
        texto
      )}
    </span>
  );
}
