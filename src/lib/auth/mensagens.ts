/**
 * Traduz erro do Supabase Auth para português de gente.
 *
 * O app traduzia apenas duas mensagens; todo o resto chegava cru em inglês —
 * "Email not confirmed", "For security purposes...", "AuthApiError" — para um
 * usuário brasileiro que não tem como agir sobre isso.
 *
 * Regra: mensagem desconhecida NUNCA vaza o texto original. Vira um padrão
 * neutro, porque texto de biblioteca em inglês não ajuda ninguém e ainda expõe
 * detalhe interno.
 */

const PADRAO = 'Não foi possível concluir. Tente novamente em instantes.';

/** Ordem importa: a primeira que casar vence. */
const REGRAS: { casa: RegExp; texto: string | ((m: RegExpMatchArray) => string) }[] = [
  {
    casa: /invalid login credentials|invalid email or password/i,
    texto: 'E-mail ou senha incorretos. Verifique os dados e tente novamente.',
  },
  {
    casa: /email not confirmed|not confirmed/i,
    texto: 'Confirme seu e-mail antes de entrar. Procure a mensagem que enviamos (veja também o spam).',
  },
  {
    casa: /already registered|already exists|user already/i,
    texto: 'Este e-mail já tem conta. Faça login ou use "Esqueci minha senha".',
  },
  {
    casa: /password should be at least (\d+)/i,
    texto: (m) => `A senha precisa ter pelo menos ${m[1]} caracteres.`,
  },
  {
    casa: /weak password|password is too weak/i,
    texto: 'Escolha uma senha mais forte — misture letras, números e símbolos.',
  },
  {
    // Precisa vir ANTES da regra genérica de rate limit: esta traz o tempo.
    casa: /for security purposes.*?(\d+) seconds/i,
    texto: (m) => `Por segurança, aguarde ${m[1]} segundos antes de tentar de novo.`,
  },
  {
    casa: /rate limit|too many requests/i,
    texto: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.',
  },
  {
    casa: /token has expired|expired or is invalid|invalid token/i,
    texto: 'Este link expirou ou já foi usado. Peça um novo e-mail de recuperação.',
  },
  {
    casa: /unable to validate email|invalid email/i,
    texto: 'E-mail inválido. Confira se digitou corretamente.',
  },
  {
    casa: /failed to fetch|network|networkerror/i,
    texto: 'Não conseguimos falar com o servidor. Verifique sua conexão e tente novamente.',
  },
  {
    casa: /user not found/i,
    texto: 'Não encontramos uma conta com esse e-mail.',
  },
  {
    casa: /same password|should be different/i,
    texto: 'A nova senha precisa ser diferente da anterior.',
  },
];

export function mensagemDeAuth(erro: unknown, padrao = PADRAO): string {
  const bruto =
    typeof erro === 'string'
      ? erro
      : typeof (erro as { message?: unknown })?.message === 'string'
        ? (erro as { message: string }).message
        : '';

  if (!bruto) return padrao;

  for (const regra of REGRAS) {
    const m = bruto.match(regra.casa);
    if (m) return typeof regra.texto === 'function' ? regra.texto(m) : regra.texto;
  }

  // Não devolvemos `bruto`: é texto de biblioteca, em inglês, sem valor para
  // quem está na tela. O detalhe fica no console para depuração.
  console.error('[auth] mensagem não mapeada:', bruto);
  return padrao;
}
