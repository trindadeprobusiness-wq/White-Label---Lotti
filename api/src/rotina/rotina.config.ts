import { MODELO_RAPIDO } from '../contratos/ia/gemini';
import { chaveAes } from './google/cripto';

export interface ConfigRotina {
  google: {
    clientId: string | null;
    clientSecret: string | null;
    /** Texto cru da chave; só fica preenchido quando decodifica em 32 bytes. */
    chaveCripto: string | null;
    redirectUri: string | null;
    appRedirectUrl: string;
    webhookUrl: string | null;
    /** client id, secret e chave de cifra presentes e válidos. */
    configurado: boolean;
  };
  gemini: { apiKey: string | null; modelo: string };
  maintainHabilitado: boolean;
}

const texto = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

function chaveValida(raw: string | null): string | null {
  if (!raw) return null;
  try {
    chaveAes(raw);
    return raw;
  } catch {
    return null;
  }
}

/** Lida a cada uso: os testes trocam variáveis sem reiniciar o módulo. Nenhum valor é registrado em log. */
export function lerConfigRotina(env: NodeJS.ProcessEnv = process.env): ConfigRotina {
  const clientId = texto(env.GOOGLE_CALENDAR_CLIENT_ID);
  const clientSecret = texto(env.GOOGLE_CALENDAR_CLIENT_SECRET);
  const chaveCripto = chaveValida(texto(env.GOOGLE_TOKEN_ENCRYPTION_KEY));
  const supabaseUrl = texto(env.SUPABASE_URL);
  const redirectUri = texto(env.GOOGLE_CALENDAR_REDIRECT_URI)
    ?? (supabaseUrl ? `${supabaseUrl}/functions/v1/google-calendar-auth/callback` : null);
  return {
    google: {
      clientId,
      clientSecret,
      chaveCripto,
      redirectUri,
      appRedirectUrl: texto(env.GOOGLE_CALENDAR_APP_REDIRECT_URL) ?? 'http://localhost:8085/rotina',
      webhookUrl: texto(env.GOOGLE_CALENDAR_WEBHOOK_URL),
      configurado: !!(clientId && clientSecret && chaveCripto),
    },
    gemini: { apiKey: texto(env.GEMINI_API_KEY), modelo: texto(env.LOTTI_AI_FAST_MODEL) ?? MODELO_RAPIDO },
    maintainHabilitado: env.ROUTINE_CALENDAR_MAINTAIN_ENABLED === 'true',
  };
}
