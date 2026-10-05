import { createHash } from 'node:crypto';

/**
 * As duas expressões moram aqui (e são reexportadas por parceiros.dto.ts) para este arquivo não
 * depender dos decorators: assim o porte e o seu teste de paridade carregam sem reflect-metadata.
 */
/** Igual ao CHECK de parceiro_links.slug. */
export const FORMATO_SLUG = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
/**
 * UUID v4 canônico, igual ao `uuidValido` das Edge Functions.
 *
 * Exceção deliberada ao FORMATO_UUID: o visitante_id não vem do banco nem de carga histórica — é
 * sempre crypto.randomUUID() do navegador. Afrouxar a regra ampliaria de graça o espaço de
 * identificadores que um atacante pode forjar para tentar casar com o clique de outra pessoa.
 */
export const FORMATO_VISITANTE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Porte fiel de supabase/functions/_shared/parceiro.ts.
 *
 * Nada aqui muda de comportamento: mesmas regras, mesmos textos de motivo. A diferença é só o
 * ambiente (node em vez de Deno) e a origem das expressões, que agora vivem em parceiros.dto.ts.
 */

export function slugValido(slug: unknown): slug is string {
  return typeof slug === 'string' && FORMATO_SLUG.test(slug);
}

/** UUID v4 canônico — o formato do visitante_id gerado pelo navegador. */
export function visitanteValido(valor: unknown): valor is string {
  return typeof valor === 'string' && FORMATO_VISITANTE.test(valor);
}

/**
 * Hash do IP com salt do servidor.
 *
 * O IP cru é dado pessoal e aqui só serve para contar visitante distinto — funciona igual com o hash.
 * Sem o salt, um hash de IPv4 seria reversível por força bruta em segundos: são só 2^32 valores. Por
 * isso, sem salt o resultado é null em vez de um hash sem sal (contrato §6.3).
 */
export function hashIp(ip: string | null, salt: string | null): string | null {
  if (!ip || !salt) return null;
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}

export type Cabecalhos = Record<string, string | string[] | undefined>;

function cabecalho(headers: Cabecalhos, nome: string): string | null {
  const valor = headers?.[nome] ?? headers?.[nome.toLowerCase()];
  if (Array.isArray(valor)) return valor[0] ?? null;
  return typeof valor === 'string' && valor ? valor : null;
}

/** Primeiro IP do x-forwarded-for — o do cliente; o resto são proxies. */
export function ipDoRequest(headers: Cabecalhos): string | null {
  const encaminhado = cabecalho(headers, 'x-forwarded-for');
  if (encaminhado) {
    const primeiro = encaminhado.split(',')[0]?.trim();
    if (primeiro) return primeiro;
  }
  return cabecalho(headers, 'x-real-ip');
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

const CAMPOS_UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'] as const;

/**
 * Extrai só os campos de UTM conhecidos, truncados.
 *
 * O objeto vem do cliente e vai para uma coluna JSONB. Sem allowlist, qualquer um poderia despejar um
 * payload arbitrário de megabytes na tabela.
 */
export function limparUtm(bruto: unknown): Utm | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const origem = bruto as Record<string, unknown>;
  const limpo: Record<string, string> = {};
  for (const campo of CAMPOS_UTM) {
    const valor = origem[campo];
    if (typeof valor === 'string' && valor.trim()) limpo[campo] = valor.trim().slice(0, 200);
  }
  return Object.keys(limpo).length > 0 ? (limpo as Utm) : null;
}

/** Trunca texto livre vindo do cliente antes de gravar. */
export function truncar(valor: unknown, max: number): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo ? limpo.slice(0, max) : null;
}

export interface EntradaInvalidez {
  statusParceiro: string;
  expiraEm: string | Date;
  emailParceiro: string | null;
  emailCorretor: string | null;
  userIdParceiro: string | null;
  userIdCorretor: string | null;
  agora?: Date;
}

/**
 * A conversão é válida?
 *
 * Regras, e o motivo de cada uma:
 * - parceiro inativo/suspenso/encerrado não recebe cadastro novo;
 * - fora da janela, o crédito expira (senão um clique de dois anos atrás ainda renderia comissão);
 * - autoindicação por e-mail ou por conta é fraude óbvia: o parceiro criaria contas para si mesmo e
 *   faturaria comissão sobre a própria assinatura.
 *
 * O texto devolvido vai para motivo_invalidacao (coluna de auditoria), nunca para o cliente.
 */
export function motivoDeInvalidez(entrada: EntradaInvalidez): string | null {
  const agora = entrada.agora ?? new Date();

  if (entrada.statusParceiro !== 'ativo') return `parceiro com status "${entrada.statusParceiro}"`;

  const expira = new Date(entrada.expiraEm);
  if (Number.isNaN(expira.getTime())) return 'janela de atribuição inválida';
  if (expira.getTime() < agora.getTime()) return 'janela de atribuição expirada';

  if (entrada.userIdParceiro && entrada.userIdCorretor && entrada.userIdParceiro === entrada.userIdCorretor) {
    return 'autoindicação: o parceiro é o próprio usuário';
  }

  const a = entrada.emailParceiro?.trim().toLowerCase();
  const b = entrada.emailCorretor?.trim().toLowerCase();
  if (a && b && a === b) return 'autoindicação: mesmo e-mail do parceiro';

  return null;
}
