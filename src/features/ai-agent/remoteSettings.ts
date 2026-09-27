import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { normalizeAgentSettings, saveAgentSettings, type AgentSettings } from './settings';

// A configuração vive no banco (lotti_agent_settings) e a ponte do WhatsApp a lê
// a cada resposta. Até a migration 20260927130000 ser aplicada, a tela continua
// salvando no navegador e diz isso ao corretor.
const db = supabase as unknown as SupabaseClient;
export type SettingsSource = 'server' | 'browser';

const notInstalled = (code?: string) => ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(code ?? '');

/** Configuração salva no banco, ou null quando ainda não existe (ou o banco não tem a tabela). */
export async function fetchServerSettings(): Promise<AgentSettings | null> {
  const { data, error } = await db.from('lotti_agent_settings').select('settings').maybeSingle();
  if (error) {
    if (notInstalled(error.code)) return null;
    throw error;
  }
  return data ? normalizeAgentSettings((data as { settings: unknown }).settings) : null;
}

export async function storeSettings(settings: AgentSettings): Promise<SettingsSource> {
  const { error } = await db.rpc('lotti_agent_save_settings', { p_settings: settings });
  if (!error) {
    saveAgentSettings(settings); // cópia local para abrir a tela na hora
    return 'server';
  }
  if (notInstalled(error.code) && saveAgentSettings(settings)) return 'browser';
  throw error;
}
