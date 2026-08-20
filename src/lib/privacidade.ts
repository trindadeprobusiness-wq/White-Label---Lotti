export type TipoDadoSensivel = 'telefone' | 'email' | 'endereco' | 'documento' | 'valor';

/**
 * A máscara é apenas visual. O valor original nunca é alterado, para que
 * buscas, cálculos e ações do CRM continuem usando o dado verdadeiro.
 */
export function ocultarDadoSensivel(
  valor: string | number | null | undefined,
  tipo: TipoDadoSensivel,
): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  return tipo === 'valor' ? 'R$ ••••••' : '••••••••';
}
