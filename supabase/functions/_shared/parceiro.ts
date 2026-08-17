/**
 * Utilidades compartilhadas pelas funções de atribuição de parceiro.
 *
 * Ficam separadas do index.ts para serem testáveis pelo vitest, que roda em
 * node — as funções em si dependem de Deno e não podem ser importadas nos
 * testes. Mesmo motivo de _shared/telefone.ts.
 */

/** Formato aceito no slug de link, igual ao CHECK da tabela parceiro_links. */
const RE_SLUG = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;

export function slugValido(slug: unknown): slug is string {
  return typeof slug === 'string' && RE_SLUG.test(slug);
}

/** UUID v4 canônico — o formato do visitante_id gerado pelo navegador. */
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuidValido(valor: unknown): valor is string {
  return typeof valor === 'string' && RE_UUID.test(valor);
}

/**
 * Hash do IP com salt do servidor.
 *
 * O IP cru é dado pessoal e aqui só serve para contar visitante distinto e
 * limitar abuso — os dois funcionam igual com o hash. Sem o salt, um hash de
 * IPv4 seria reversível por força bruta em segundos: são só 2^32 valores.
 */
export async function hashIp(ip: string | null, salt: string): Promise<string | null> {
  if (!ip) return null;
  const dados = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', dados);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Primeiro IP do x-forwarded-for — o do cliente; o resto são proxies. */
export function ipDoRequest(headers: Headers): string | null {
  const encaminhado = headers.get('x-forwarded-for');
  if (encaminhado) {
    const primeiro = encaminhado.split(',')[0]?.trim();
    if (primeiro) return primeiro;
  }
  return headers.get('x-real-ip');
}

export interface Utm {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  gclid?: string;
  fbclid?: string;
}

const CAMPOS_UTM = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'gclid',
  'fbclid',
] as const;

/**
 * Extrai só os campos de UTM conhecidos, truncados.
 *
 * O objeto vem do cliente e vai para uma coluna JSONB. Sem allowlist, qualquer
 * um poderia despejar um payload arbitrário de megabytes na tabela.
 */
export function limparUtm(bruto: unknown): Utm | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const origem = bruto as Record<string, unknown>;
  const limpo: Record<string, string> = {};

  for (const campo of CAMPOS_UTM) {
    const valor = origem[campo];
    if (typeof valor === 'string' && valor.trim()) {
      limpo[campo] = valor.trim().slice(0, 200);
    }
  }

  return Object.keys(limpo).length > 0 ? (limpo as Utm) : null;
}

/** Trunca texto livre vindo do cliente antes de gravar. */
export function truncar(valor: unknown, max: number): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo ? limpo.slice(0, max) : null;
}

/**
 * A conversão é válida?
 *
 * Regras, e o motivo de cada uma:
 * - parceiro inativo/suspenso/encerrado não recebe cadastro novo;
 * - fora da janela, o crédito expira (senão um clique de dois anos atrás ainda
 *   renderia comissão);
 * - autoindicação por e-mail ou por conta é fraude óbvia: o parceiro criaria
 *   contas para si mesmo e faturaria comissão sobre a própria assinatura.
 */
export function motivoDeInvalidez(entrada: {
  statusParceiro: string;
  expiraEm: string | Date;
  emailParceiro: string | null;
  emailCorretor: string | null;
  userIdParceiro: string | null;
  userIdCorretor: string | null;
  agora?: Date;
}): string | null {
  const agora = entrada.agora ?? new Date();

  if (entrada.statusParceiro !== 'ativo') {
    return `parceiro com status "${entrada.statusParceiro}"`;
  }

  const expira = new Date(entrada.expiraEm);
  if (Number.isNaN(expira.getTime())) return 'janela de atribuição inválida';
  if (expira.getTime() < agora.getTime()) return 'janela de atribuição expirada';

  if (
    entrada.userIdParceiro &&
    entrada.userIdCorretor &&
    entrada.userIdParceiro === entrada.userIdCorretor
  ) {
    return 'autoindicação: o parceiro é o próprio usuário';
  }

  const a = entrada.emailParceiro?.trim().toLowerCase();
  const b = entrada.emailCorretor?.trim().toLowerCase();
  if (a && b && a === b) {
    return 'autoindicação: mesmo e-mail do parceiro';
  }

  return null;
}
