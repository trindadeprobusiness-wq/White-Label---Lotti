import { CanActivate, ExecutionContext, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppEnv, ENV } from '../config/env';

/** Cabeçalho com o segredo do checkout do site (CHECKOUT_API_TOKEN). */
export const CABECALHO_CHECKOUT = 'x-lotti-checkout';

/** Comparação em tempo constante sobre o SHA-256 dos dois lados (tamanhos diferentes não vazam). */
export function segredoCheckoutConfere(recebido: string, esperado: string): boolean {
  const a = createHash('sha256').update(recebido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

/**
 * Rotas /api/checkout/*: só o servidor do site institucional (Vercel) as chama, com o segredo
 * no cabeçalho x-lotti-checkout. Sem CHECKOUT_API_TOKEN na API → 503 (nunca aceita); errado ou
 * ausente → 401. Fica fora do CORS: nenhum navegador fala com estas rotas.
 */
@Injectable()
export class CheckoutTokenGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: AppEnv) {}

  canActivate(ctx: ExecutionContext): boolean {
    const esperado = this.env.checkoutApiToken;
    if (!esperado) {
      throw new ServiceUnavailableException({
        statusCode: 503, codigo: 'checkout_api_nao_configurada', message: 'Integração do checkout não configurada.',
      });
    }
    const bruto = ctx.switchToHttp().getRequest().headers?.[CABECALHO_CHECKOUT];
    const recebido = Array.isArray(bruto) ? bruto[0] : bruto;
    if (typeof recebido !== 'string' || !recebido || recebido.length > 1024 || !segredoCheckoutConfere(recebido, esperado)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
