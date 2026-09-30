import { formatarTelefone } from './validators';

export interface TelefoneNormalizado {
  /** Só dígitos (DDD + número), no formato que o Asaas aceita. null = não dá para salvar. */
  digitos: string | null;
  /** Versão formatada para gravar/exibir. '' quando não há telefone utilizável. */
  formatado: string;
}

/**
 * Espelha telefoneParaAsaas() de supabase/functions/_shared/telefone.ts.
 *
 * A duplicação é inevitável: uma roda em Deno (Edge Function) e a outra no bundle
 * do Vite, sem caminho de import entre elas. Se as regras mudarem, mude nos dois.
 */
/** DDDs que existem de verdade — 20, 25, 30, 50 e outros nunca foram atribuídos. */
export const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export function normalizarTelefoneBR(bruto: string | null | undefined): TelefoneNormalizado {
  let d = (bruto ?? '').replace(/\D/g, '');

  // Código do país: o lead-capture e integrações de WhatsApp gravam "55" na frente.
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);

  const celular = d.length === 11 && d[2] === '9';
  const fixo = d.length === 10;

  if (!DDDS_VALIDOS.has(Number(d.slice(0, 2))) || (!celular && !fixo)) {
    return { digitos: null, formatado: '' };
  }
  return { digitos: d, formatado: formatarTelefone(d) };
}

// Um número por vez: DDD (com ou sem parênteses e +55) seguido de 8 ou 9 dígitos.
const TRECHO_TELEFONE = /(?:\+?\s*55[\s.-]*)?(?:\(\s*\d{2}\s*\)|\d{2})[\s.-]*\d{4,5}[\s.-]*\d{4}(?!\d)/g;

/**
 * Primeiro telefone brasileiro válido de um texto livre, já formatado.
 *
 * Contratos lidos pela IA trazem "(62) 91111-0002 / (62) 3333-4444" no campo de
 * telefone. Juntar todos os dígitos formava um número que não existe, e o
 * cadastro não casava com o cliente que já tinha o celular. '' quando não há.
 */
export function primeiroTelefoneBR(texto: string | null | undefined): string {
  for (const trecho of (texto ?? '').match(TRECHO_TELEFONE) ?? []) {
    const { formatado } = normalizarTelefoneBR(trecho);
    if (formatado) return formatado;
  }
  return '';
}

/**
 * CPF/CNPJ como o cadastro guarda: só dígitos quando o documento está completo
 * (é o formato que o Asaas e a busca de clientes usam). Qualquer outra coisa é
 * mantida como foi digitada, para o corretor corrigir depois.
 */
export function documentoParaSalvar(texto: string | null | undefined): string | null {
  const bruto = (texto ?? '').trim();
  const digitos = bruto.replace(/\D/g, '');
  if (digitos.length === 11 || digitos.length === 14) return digitos;
  return bruto || null;
}
