/**
 * Extração de mensagem de erro.
 *
 * O padrão `err instanceof Error ? err.message : 'algo deu errado'` espalhado pelo
 * projeto engole justamente o erro mais útil: o PostgrestError do Supabase é um
 * objeto simples, não uma instância de Error, então a causa real ("violates check
 * constraint ...") virava mensagem genérica e o usuário ficava sem saber o que houve.
 */

interface ErroComMensagem {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}

const temMensagem = (e: unknown): e is ErroComMensagem =>
  typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string';

/** Mensagem legível de Error, de PostgrestError/StorageError (objeto simples) ou de string. */
export function mensagemDeErro(e: unknown, padrao = 'Erro inesperado.'): string {
  if (typeof e === 'string' && e.trim()) return e.trim();
  if (e instanceof Error && e.message) return e.message;

  if (temMensagem(e)) {
    // details/hint é onde o Postgres costuma dizer o que fazer a respeito.
    const extras = [e.details, e.hint].filter((x): x is string => !!x && !!x.trim());
    return [e.message, ...extras].join(' — ');
  }

  return padrao;
}
