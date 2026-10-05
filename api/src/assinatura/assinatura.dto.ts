/** Mesma regra do ParseUUIDPipe sem versão: qualquer 8-4-4-4-12 hexadecimal. */
export const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Igual ao max-rows do PostgREST que o front recebe hoje. */
export const LIMITE_LISTA = 1000;
/** C3 lê duas linhas de propósito: duas campanhas ativas viram 409, como o maybeSingle de hoje. */
export const LIMITE_CAMPANHA = 2;

/** Igual ao FeatureKey de src/types/subscription.ts. */
export const CHAVES_COTA = [
  'leads_qualificados_monthly', 'max_contratos_locacao', 'max_users', 'max_imoveis', 'max_fachadas',
  'ai_contracts_monthly', 'ai_assistant_monthly', 'storage_gb', 'rental_management', 'asaas_integration',
  'ai_contract_analysis', 'contract_export', 'advanced_reports', 'team_management', 'team_analytics',
  'priority_support', 'guided_onboarding', 'automations', 'full_financial', 'fachadas_analytics',
] as const;

export type ChaveCota = (typeof CHAVES_COTA)[number];

/** Mesmo fuso de checar_cota e de src/lib/billingPeriod.ts. */
export const FUSO_USO_PADRAO = 'America/Sao_Paulo';

export interface ConfigAssinatura {
  /** Fuso do período de cota. Variável opcional: faltando, usa o padrão. */
  fusoUso: string;
}

/** Lida a cada uso: nenhum valor de segredo, só o nome da variável aparece no código. */
export function lerConfigAssinatura(env: NodeJS.ProcessEnv = process.env): ConfigAssinatura {
  const fuso = (env.BILLING_USAGE_TIMEZONE ?? '').trim();
  return { fusoUso: fuso || FUSO_USO_PADRAO };
}

/** Linha de to_jsonb: chaves e tipos iguais aos que o PostgREST entrega hoje. */
export type Linha = Record<string, unknown>;

export interface UsoAssinatura {
  period_start: string;
  period_end: string;
  contadores: Linha[];
  ativos: { max_imoveis: number; max_contratos_locacao: number; max_fachadas: number };
}

export interface RespostaCota {
  permitido: boolean;
  usado: number;
  limite: number | null;
  ilimitado: boolean;
  habilitado: boolean;
}
