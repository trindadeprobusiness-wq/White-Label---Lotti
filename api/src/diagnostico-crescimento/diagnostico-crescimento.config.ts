/**
 * Variáveis do Diagnóstico de Crescimento na API. Lidas a cada uso (os testes trocam o ambiente sem
 * reiniciar o módulo). Nenhum valor de segredo é registrado em log.
 *
 * Mesmos nomes das Edge Functions `diagnostic` e `diagnostic-notifications`, com duas diferenças:
 *  - o limite por IP usa DIAGNOSTIC_RATE_LIMIT_SECRET e, sem ela, PUBLIC_RATE_LIMIT_SECRET (a mesma
 *    das outras rotas públicas). A Edge caía na SUPABASE_SERVICE_ROLE_KEY, que a API não tem;
 *  - o e-mail ao operador exige DIAGNOSTIC_NOTIFICATIONS_ENABLED='true' além da configuração do Resend.
 *    Desligado por padrão: as notificações ficam na fila (status pending), visíveis no painel, e nada
 *    sai da API. RESEND_API_KEY e EMAIL_FROM já existem no serviço por causa do login; sem o
 *    interruptor, bastaria LEAD_NOTIFICATION_EMAIL para começar a enviar.
 */
export interface ConfigEmailDiagnostico {
  provider: string;
  apiKey?: string;
  from?: string;
  to?: string;
  publicUrl?: string;
}

export interface ConfigDiagnostico {
  segredoLimite: string;
  iaLigada: boolean;
  limiteDiarioIa: number;
  notificacoesLigadas: boolean;
  email: ConfigEmailDiagnostico;
  segredoWorker: string;
}

const texto = (v: string | undefined): string | undefined => v?.trim() || undefined;

/** Inteiro positivo com teto, ou o padrão (envNumber do handler da Edge). */
export function numeroDoAmbiente(valor: string | undefined, padrao: number, maximo: number): number {
  const n = Number(valor);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, maximo) : padrao;
}

export function lerConfigDiagnostico(env: NodeJS.ProcessEnv = process.env): ConfigDiagnostico {
  return {
    segredoLimite: texto(env.DIAGNOSTIC_RATE_LIMIT_SECRET) ?? texto(env.PUBLIC_RATE_LIMIT_SECRET) ?? '',
    iaLigada: env.DIAGNOSTIC_AI_ENABLED === 'true',
    limiteDiarioIa: numeroDoAmbiente(env.DIAGNOSTIC_AI_DAILY_LIMIT, 100, 1000),
    notificacoesLigadas: env.DIAGNOSTIC_NOTIFICATIONS_ENABLED === 'true',
    email: {
      provider: texto(env.EMAIL_PROVIDER) ?? 'resend',
      apiKey: texto(env.EMAIL_API_KEY) ?? texto(env.RESEND_API_KEY),
      from: texto(env.EMAIL_FROM),
      to: texto(env.LEAD_NOTIFICATION_EMAIL),
      publicUrl: texto(env.DIAGNOSTIC_PUBLIC_URL),
    },
    segredoWorker: texto(env.DIAGNOSTIC_WORKER_SECRET) ?? '',
  };
}
