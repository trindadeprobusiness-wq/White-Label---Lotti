/**
 * Feature flags de build.
 *
 * LIMITE IMPORTANTE: variável `VITE_*` é embutida no bundle na hora do build e
 * é pública. Isto ESCONDE interface — não protege dado. O isolamento real é a
 * RLS no Supabase (`corretor_id = get_corretor_id()`), que vale mesmo se alguém
 * chamar a API por fora do app.
 *
 * Desligar a flag e rebuildar é o rollback: a aba some e as tabelas do CRM
 * ficam ociosas, sem afetar nada que já existe.
 */

const ativo = (valor: unknown) =>
  String(valor ?? '').trim().toLowerCase() === 'true';

export const FLAGS = {
  /** Aba CRM. Nasce desligada — só ligue depois de aplicar a migration do CRM. */
  crm: ativo(import.meta.env.VITE_CRM_ENABLED),
} as const;
