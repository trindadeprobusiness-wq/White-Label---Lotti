// A Edge Function distingue por que a ponte do WhatsApp não atendeu. Antes disso
// tudo era um 503 só, e a tela dizia "indisponível" para quatro problemas com
// consertos opostos — diagnosticar uma queda virava eliminação de hipóteses.

/** Causas em que a mensagem comprovadamente não saiu. */
export const FALHA_CERTA = ['bridge_rejected', 'bridge_not_configured', 'bridge_bad_state'];

export const MENSAGEM_DA_PONTE: Record<string, string> = {
  // Os dois lados guardam o mesmo segredo e nada os compara: quando divergem, é
  // aqui que aparece. Dizer o motivo poupa a caçada.
  bridge_rejected: 'A plataforma e a ponte do WhatsApp estão com credenciais diferentes. É preciso alinhar o token nos dois lados.',
  bridge_not_configured: 'A conexão com o WhatsApp não está configurada nesta plataforma.',
  bridge_unreachable: 'A ponte do WhatsApp não respondeu. Verifique se o servidor dela está no ar.',
  bridge_bad_state: 'A ponte do WhatsApp respondeu algo inesperado. O serviço precisa de revisão.',
  bridge_failed: 'Não foi possível falar com o WhatsApp agora.',
};

/**
 * O código vem no corpo da resposta, que o supabase-js guarda em `context`.
 * Sem ele, qualquer falha pareceria a mesma coisa.
 */
export async function codigoDoErro(error: unknown) {
  const contexto = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (typeof contexto?.json !== 'function') return undefined;
  try {
    return ((await contexto.json()) as { error?: string } | null)?.error;
  } catch {
    return undefined;
  }
}

/** Erro que carrega o código, para a tela poder explicar em vez de só falhar. */
export async function erroDaPonte(error: unknown) {
  const codigo = await codigoDoErro(error);
  return Object.assign(new Error(codigo ?? 'connection_unavailable'), { codigo });
}
