import { chamarApi } from '@/lib/api';
import { corpoJson, escolher, lerJson } from './http';

// Perfil de quem está logado pela API Lotti (bloco B0 da virada). Só é chamado
// atrás de apiDisponivel(): sem VITE_API_URL, o crmStore e as telas seguem
// lendo public.corretores e o rpc('get_corretor_id') direto no Supabase.

type Linha = Record<string, unknown>;

/** Colunas que o PATCH aceita (o DTO recusa as outras com 400). */
export const CHAVES_PERFIL_CORRETOR = [
  'nome', 'creci', 'creci_estado', 'email', 'telefone', 'endereco', 'website',
  'razao_social', 'cnpj_cpf', 'endereco_completo', 'foto_url',
] as const;

/**
 * `corretor`: a linha do próprio usuário em public.corretores (null se não há).
 * `corretor_id`: o get_corretor_id() — a conta em uso (para membro de equipe, a
 * do dono; null se a conta está suspensa ou sem vínculo).
 */
export interface PerfilApi {
  corretor: (Linha & { id: string }) | null;
  corretor_id: string | null;
}

export async function obterPerfilApi(): Promise<PerfilApi> {
  return lerJson(await chamarApi('/api/perfil/corretor'), 'Não foi possível carregar o seu perfil.');
}

export async function atualizarCorretorApi(dados: object): Promise<Linha> {
  return lerJson(
    await chamarApi('/api/perfil/corretor', corpoJson('PATCH', escolher(dados, CHAVES_PERFIL_CORRETOR))),
    'Não foi possível salvar o seu perfil.',
  );
}

/** Telemetria de presença (public.registrar_atividade). */
export async function registrarAtividadeApi(tipo: 'login' | 'sessao' | 'acao', rota: string | null): Promise<void> {
  await lerJson(
    await chamarApi('/api/perfil/atividade', corpoJson('POST', { tipo, rota })),
    'Não foi possível registrar a atividade.',
  );
}
