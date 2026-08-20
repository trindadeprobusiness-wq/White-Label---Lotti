export type TipoDadoSensivel = 'telefone' | 'email' | 'endereco' | 'documento' | 'valor';

/**
 * A máscara é apenas visual. O valor original nunca é alterado, para que
 * buscas, cálculos e ações do CRM continuem usando o dado verdadeiro.
 */
/** Máscara única de dinheiro. Literal em um lugar só para não divergir. */
export const VALOR_MASCARADO = 'R$ ••••••';

/** Máscara de dado pessoal — sem cifrão, porque não é dinheiro. */
export const TEXTO_MASCARADO = '••••••••';

export function ocultarDadoSensivel(
  valor: string | number | null | undefined,
  tipo: TipoDadoSensivel,
): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  return tipo === 'valor' ? VALOR_MASCARADO : TEXTO_MASCARADO;
}

/** Chave única do interruptor global. Prefixada para não colidir no localStorage. */
export const CHAVE_VALORES_OCULTOS = 'lotti:valores-ocultos';

/**
 * Lê a preferência salva de "esconder valores".
 *
 * O padrão é MOSTRAR — é assim que aplicativo de banco se comporta, e é o
 * comportamento que o usuário pediu. Esconder é a exceção, para quando alguém
 * está olhando por cima do ombro ou a tela está sendo compartilhada.
 *
 * Qualquer coisa diferente de 'true' devolve falso: chave ausente, valor
 * corrompido por outra aba ou lixo de versão antiga não podem esconder os
 * números do corretor sem ele ter pedido.
 */
export function lerPreferenciaOculta(bruto: string | null | undefined): boolean {
  return bruto === 'true';
}

/**
 * Mascara valores em reais dentro de um texto livre.
 *
 * Por que existe: o webhook do Asaas grava a mensagem do alerta já com o valor
 * embutido — "Recebimento de R$ 2.300,00 de Diego Vinícius Mendes". Mascarar
 * só o número da direita do cartão deixava a quantia exposta no meio da frase,
 * o que anula o modo privado justamente na tela que ele mais protege.
 *
 * Reescrever a mensagem no banco não serve: ela é histórico e precisa manter o
 * valor real. A máscara é de exibição.
 *
 * Cobre "R$ 2.300,00", "R$1.234,56" e "R$ 970". Não toca em número que não
 * seja dinheiro — "vence em 15 dias" continua legível, porque esconder o prazo
 * não protege ninguém e tira o sentido do aviso.
 */
export function mascararValoresNoTexto(texto: string): string {
  return texto.replace(/R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?/g, VALOR_MASCARADO);
}
