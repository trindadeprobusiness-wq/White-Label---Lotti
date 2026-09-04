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

/** Desligado só quando explicitamente `false`; ausente = ligado. */
const ligado = (valor: unknown) =>
  String(valor ?? '').trim().toLowerCase() !== 'false';

export const FLAGS = {
  /**
   * Aba CRM. LIGADA por padrão.
   *
   * Nasceu desligada e o resultado foi uma funcionalidade que ninguém via: a
   * variável não existia no .env local, a aba sumia e parecia que nada tinha
   * sido feito. Como o CRM agora funciona sobre as tabelas que já existem
   * (`clientes`, `alertas`, `fachada_leads`) e só fica mais rico com a migration,
   * não há motivo para escondê-lo. Para desligar: VITE_CRM_ENABLED=false.
   */
  crm: ligado(import.meta.env.VITE_CRM_ENABLED),

  /** Google é parte fixa da autenticação; Microsoft permanece opcional. */
  oauthMicrosoft: String(import.meta.env.VITE_OAUTH_PROVIDERS ?? '').includes('microsoft'),
} as const;
