/**
 * A qualificação vem da IA como texto cru: "locacao", "1900", "agendar visita".
 * É o formato certo para o modelo e o errado para quem lê — o corretor via
 * "locacao" sem acento e "1900" sem saber se eram reais, metros ou ano.
 *
 * Aqui só se arruma a apresentação. O dado gravado continua o mesmo.
 */

const INTERESSE: Record<string, string> = {
  locacao: 'Locação', locação: 'Locação', aluguel: 'Locação', alugar: 'Locação',
  compra: 'Compra', comprar: 'Compra',
  venda: 'Venda', vender: 'Venda',
  investimento: 'Investimento', investir: 'Investimento',
};

const real = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** "agendar visita" -> "Agendar visita". Não mexe no resto da frase. */
function comMaiuscula(texto: string): string {
  const limpo = texto.trim();
  return limpo ? limpo.charAt(0).toLocaleUpperCase('pt-BR') + limpo.slice(1) : limpo;
}

/**
 * Orçamento só vira moeda quando é número puro. "até 400 mil" ou "1900 a 2500"
 * ficam como a IA escreveu: converter uma faixa ou uma frase inventaria precisão.
 */
function orcamento(texto: string): string {
  const limpo = texto.trim();
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+([.,]\d+)?$/.test(limpo)) return comMaiuscula(limpo);
  // "1.900" é milhar em pt-BR; "1900.50" é decimal. Ponto seguido de exatamente
  // três dígitos é tratado como separador de milhar.
  const normalizado = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(limpo)
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo.replace(',', '.');
  const valor = Number(normalizado);
  return Number.isFinite(valor) ? real.format(valor) : comMaiuscula(limpo);
}

export function valorLegivel(campo: string, valor: string): string {
  if (campo === 'intent') return INTERESSE[valor.trim().toLocaleLowerCase('pt-BR')] ?? comMaiuscula(valor);
  if (campo === 'budget') return orcamento(valor);
  return comMaiuscula(valor);
}

export type Temperatura = { rotulo: string; tom: 'frio' | 'morno' | 'quente' | 'neutro' };

export function temperaturaLegivel(valor?: string | null): Temperatura | null {
  if (!valor?.trim()) return null;
  const chave = valor.trim().toLocaleLowerCase('pt-BR');
  if (chave === 'frio' || chave === 'morno' || chave === 'quente') return { rotulo: comMaiuscula(chave), tom: chave };
  return { rotulo: comMaiuscula(valor), tom: 'neutro' };
}
