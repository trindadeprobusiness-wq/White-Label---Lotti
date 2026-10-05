/**
 * Variáveis do módulo parceiros (contrato §0.5). Todas opcionais.
 *
 * Nenhum valor de segredo é guardado nem registrado em log: a config só diz se a variável EXISTE e
 * guarda o valor estritamente necessário para montar URL pública. A SUPABASE_SERVICE_ROLE_KEY deixa de
 * ser usada por este módulo — o caminho do dono é a própria conexão do Prisma (§6.3).
 */
export interface ConfigParceiros {
  /** Origens aceitas no clique; vazia aceita qualquer Origin (mesmo efeito de hoje). */
  origensPermitidas: string[];
  /** Base do link do parceiro no convite, sem barra final. */
  appUrl: string;
  /** redirectTo do convite. */
  portalUrl: string;
  /** Salt do sha256 do IP no clique; sem ele o ip_hash vai null. */
  ipHashSalt: string | null;
  /** Segredo do HMAC das chaves de limite do diagnóstico. */
  limitePublicoSecret: string | null;
  /** Nome do provedor transacional escolhido; sem ele a porta de convite responde 503. */
  provedorDeEmail: string | null;
}

const PADRAO_APP = 'https://app.plataformalotti.com.br';
const PADRAO_PORTAL = 'https://app.plataformalotti.com.br/nova-senha?redirectTo=%2Fparceiro';

const texto = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** Lida a cada uso: os testes trocam variáveis sem reiniciar o módulo. */
export function lerConfigParceiros(env: NodeJS.ProcessEnv = process.env): ConfigParceiros {
  return {
    origensPermitidas: (env.PARCEIRO_ORIGENS_PERMITIDAS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
    appUrl: (texto(env.PARCEIRO_APP_URL) ?? PADRAO_APP).replace(/\/$/, ''),
    portalUrl: texto(env.PARCEIRO_PORTAL_URL) ?? PADRAO_PORTAL,
    ipHashSalt: texto(env.IP_HASH_SALT),
    limitePublicoSecret: texto(env.PUBLIC_RATE_LIMIT_SECRET),
    provedorDeEmail: texto(env.PARCEIRO_EMAIL_PROVEDOR),
  };
}
