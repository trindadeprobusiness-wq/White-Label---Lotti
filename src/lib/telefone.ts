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
export function normalizarTelefoneBR(bruto: string | null | undefined): TelefoneNormalizado {
  let d = (bruto ?? '').replace(/\D/g, '');

  // Código do país: o lead-capture e integrações de WhatsApp gravam "55" na frente.
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);

  const ddd = Number(d.slice(0, 2));
  const dddValido = ddd >= 11 && ddd <= 99;
  const celular = d.length === 11 && d[2] === '9';
  const fixo = d.length === 10;

  if (!dddValido || (!celular && !fixo)) return { digitos: null, formatado: '' };
  return { digitos: d, formatado: formatarTelefone(d) };
}
