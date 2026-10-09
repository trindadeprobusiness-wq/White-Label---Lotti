/**
 * Cores das etapas do funil. `crm_etapas.cor` guarda o nome ('blue', 'sky'…); a tela usa o hexadecimal.
 * Fica fora do CrmPipeline para o Inbox mostrar a mesma cor sem carregar o quadro inteiro.
 */
export const PALETA_HEX: Record<string, string> = { blue: '#2563eb', sky: '#0284c7', indigo: '#4f46e5', amber: '#f59e0b', orange: '#f97316', green: '#16a34a', red: '#dc2626', violet: '#7c3aed', slate: '#64748b' };
export const corParaHex = (cor: string) => PALETA_HEX[cor] ?? PALETA_HEX.slate;
