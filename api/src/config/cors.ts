import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { AppEnv } from './env';

/**
 * CORS da API. O login próprio guarda o refresh num cookie HttpOnly de api.* e o front
 * (app.*) chama /api/auth/* com credentials:'include'. Para o navegador aceitar a
 * resposta, ela precisa de Access-Control-Allow-Credentials: true e da origem exata
 * (nunca '*'), por isso a lista explícita de env.corsOrigins.
 *
 * O cookie em si é SameSite=Lax: app.plataformalotti.com.br e api.plataformalotti.com.br
 * são o mesmo "site" (mesmo domínio registrável), então o navegador o envia nesse fetch
 * entre origens. Uma origem de outro site (outro domínio, ou localhost contra a produção)
 * passa pelo CORS mas não recebe o cookie.
 */
export function opcoesCors(env: Pick<AppEnv, 'corsOrigins'>): CorsOptions {
  return {
    origin: env.corsOrigins,
    credentials: true,
    // Guarda o preflight por 10 min: menos OPTIONS antes de cada chamada com Authorization.
    maxAge: 600,
  };
}
