import type { CorsOptions, CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface';
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
 *
 * Exceção: ROTAS_CORS_PUBLICO, chamadas por OUTROS sites (vitrine do site institucional e
 * captura de lead das landing pages, que antes falavam com as Edge Functions com
 * Access-Control-Allow-Origin: *). Nelas a política é outra e nunca tem credenciais: origem '*'
 * por padrão ou a lista de PUBLIC_CORS_ORIGINS, sem Access-Control-Allow-Credentials. O cookie
 * de refresh tem Path=/api/auth e nem viaja para elas.
 */

/** Prefixos (com o /api do setGlobalPrefix) das rotas públicas que outros sites chamam. */
export const ROTAS_CORS_PUBLICO = ['/api/publico/imoveis', '/api/publico/leads'] as const;

/** Cabeçalhos que os clientes das Edge Functions mandavam (supabase-js manda authorization/apikey/x-client-info). */
const CABECALHOS_PUBLICOS = ['authorization', 'x-client-info', 'apikey', 'content-type'];

/** Caminho sem query, sem barras repetidas no fim e em minúsculas (o roteador do Express ignora caixa). */
function caminho(url: string | undefined): string {
  const semQuery = (url ?? '').split('?')[0].split('#')[0];
  return semQuery.toLowerCase().replace(/\/+$/, '');
}

export function rotaPublicaComCors(url: string | undefined): boolean {
  const c = caminho(url);
  return ROTAS_CORS_PUBLICO.some((r) => c === r || c.startsWith(`${r}/`));
}

export function opcoesCorsApp(env: Pick<AppEnv, 'corsOrigins'>): CorsOptions {
  return {
    origin: env.corsOrigins,
    credentials: true,
    // Guarda o preflight por 10 min: menos OPTIONS antes de cada chamada com Authorization.
    maxAge: 600,
  };
}

export function opcoesCorsPublico(env: Pick<AppEnv, 'publicCorsOrigins'>): CorsOptions {
  const origens = env.publicCorsOrigins ?? '*';
  return {
    origin: origens === '*' ? '*' : origens,
    credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowedHeaders: CABECALHOS_PUBLICOS,
    // A landing page lê o Retry-After do 429 da captura.
    exposedHeaders: ['Retry-After'],
    maxAge: 600,
  };
}

/** Escolhe a política por requisição: rota pública de outros sites ou o app com cookie. */
export function opcoesCors(env: Pick<AppEnv, 'corsOrigins' | 'publicCorsOrigins'>): CorsOptionsDelegate<{ originalUrl?: string; url?: string }> {
  const app = opcoesCorsApp(env);
  const publico = opcoesCorsPublico(env);
  return (req, cb) => cb(null, rotaPublicaComCors(req.originalUrl ?? req.url) ? publico : app);
}
