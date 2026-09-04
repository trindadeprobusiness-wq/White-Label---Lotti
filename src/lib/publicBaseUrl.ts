// Base URL pública usada nos links das fachadas (o destino do QR Code).
//
// PROBLEMA que isto resolve: o QR era montado com `window.location.origin`.
// Ao gerar/baixar a fachada rodando em localhost, o QR codificava
// `http://localhost:8080/p/...` — inescaneável por qualquer celular. O material
// impresso ficava inútil sem ninguém perceber.
//
// Regra:
//  1. Se VITE_PUBLIC_BASE_URL estiver definida, usa ela (permite trocar o
//     domínio sem mexer no código quando houver domínio próprio).
//  2. Se estiver num host de desenvolvimento (localhost / 127.* / rede local),
//     usa o domínio de PRODUÇÃO — nunca deixa um link local vazar para um QR.
//  3. Caso contrário, usa a própria origem (funciona em produção e em qualquer
//     domínio próprio futuro automaticamente).

const PROD_FALLBACK = 'https://casa-mente-contrato-1.vercel.app';

function isDevHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host.startsWith('127.') ||
    host.startsWith('192.168.') ||
    host.startsWith('10.') ||
    host.endsWith('.local')
  );
}

export function getPublicBaseUrl(): string {
  const envUrl = import.meta.env.VITE_PUBLIC_BASE_URL as string | undefined;
  if (envUrl) return envUrl.replace(/\/$/, '');

  if (typeof window !== 'undefined') {
    if (isDevHost(window.location.hostname)) return PROD_FALLBACK;
    return window.location.origin;
  }

  return PROD_FALLBACK;
}

/** URL pública da landing page de uma fachada (o que o QR Code aponta). */
export function getFachadaPublicUrl(fachadaId: string): string {
  return `${getPublicBaseUrl()}/p/${fachadaId}`;
}

/**
 * Link exclusivo de um parceiro.
 *
 * Mesmo motivo do QR: este link é copiado para WhatsApp, e-mail e material
 * impresso. Se saísse com `localhost` porque alguém gerou em desenvolvimento,
 * o parceiro divulgaria um endereço morto sem ninguém perceber.
 */
export function getParceiroLinkUrl(slug: string): string {
  return `${getPublicBaseUrl()}/r/${slug}`;
}
