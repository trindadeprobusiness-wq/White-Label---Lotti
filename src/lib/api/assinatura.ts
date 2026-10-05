import { chamarApi } from '@/lib/api';
import { corpoJson, escolher, lerErroApi, lerJson } from './http';

// Assinatura, catálogo de planos e onboarding pela API Lotti (fase 4, onda 3).
// Só é chamado atrás de apiDisponivel(). As listas de chaves espelham os DTOs da
// API: chave fora delas dá 400, então o front só manda as aceitas.

export const CHAVES_PERFIL_ONBOARDING = [
  'nome', 'telefone', 'foto_url', 'cidade', 'estado', 'tipo_atuacao',
  'creci', 'regioes_atendidas', 'especialidade', 'fuso_horario', 'creci_status',
] as const;
export const CHAVES_ORGANIZACAO_ONBOARDING = [
  'nome', 'nome_comercial', 'cnpj', 'telefone', 'email', 'cidade',
  'estado', 'logo_url', 'tamanho_equipe', 'tipo_operacao', 'tipo_organizacao', 'fuso_horario',
] as const;

type Linha = Record<string, unknown>;

export interface UsoApi {
  period_start: string;
  period_end: string;
  contadores: Array<Record<string, unknown>>;
  ativos: { max_imoveis: number; max_contratos_locacao: number; max_fachadas: number };
}

export interface CotaApi {
  permitido: boolean;
  usado: number;
  limite: number | null;
  ilimitado: boolean;
  habilitado: boolean;
}

export interface SalvarOnboardingApiInput {
  profile?: Record<string, unknown>;
  progress?: Record<string, unknown>;
  stepKey?: string;
  stepStatus?: string;
}

const id = (v: string) => encodeURIComponent(v);

/**
 * Como lerJson, mas 503 (`onboarding_indisponivel`) vale como "migration ainda
 * não aplicada": o onboarding nunca bloqueia o produto nesse intervalo, igual
 * ao `recursoAindaNaoAplicado` do ramo Supabase.
 */
async function lerTolerando503<T>(res: Response, padrao: string, aoFaltar: T): Promise<T> {
  if (res.status === 503) return aoFaltar;
  if (!res.ok) throw await lerErroApi(res, padrao);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// ── Catálogo (rotas públicas) ────────────────────────────────────────────

export async function listarPlanosApi(): Promise<Linha[]> {
  return lerJson(await chamarApi('/api/planos'), 'Não foi possível carregar os planos.');
}

export async function listarEntitlementsApi(): Promise<Linha[]> {
  return lerJson(await chamarApi('/api/planos/entitlements'), 'Não foi possível carregar os recursos dos planos.');
}

export async function campanhaAtivaApi(): Promise<Linha | null> {
  return lerJson(await chamarApi('/api/planos/campanha'), 'Não foi possível carregar a campanha.');
}

// ── Assinatura ───────────────────────────────────────────────────────────

export async function assinaturaAtualApi(): Promise<Linha | null> {
  return lerJson(await chamarApi('/api/assinatura'), 'Não foi possível carregar a assinatura.');
}

export async function usoAssinaturaApi(): Promise<UsoApi> {
  return lerJson(await chamarApi('/api/assinatura/uso'), 'Não foi possível carregar o consumo.');
}

export async function addonsApi(): Promise<Linha[]> {
  return lerJson(await chamarApi('/api/assinatura/addons'), 'Não foi possível carregar os adicionais.');
}

export async function contaAntigaSemLimiteApi(): Promise<boolean> {
  const r = await lerJson<{ sem_limite: boolean }>(
    await chamarApi('/api/assinatura/conta-antiga'),
    'Não foi possível verificar a sua conta.',
  );
  return r.sem_limite === true;
}

export async function cotaApi(chave: string): Promise<CotaApi> {
  return lerJson(
    await chamarApi(`/api/assinatura/cota/${id(chave)}`),
    'Não foi possível verificar o limite do plano.',
  );
}

// ── Onboarding ───────────────────────────────────────────────────────────

export async function contextoOnboardingApi(): Promise<unknown | null> {
  return lerTolerando503<unknown | null>(
    await chamarApi('/api/onboarding/contexto'),
    'Não foi possível carregar o onboarding.',
    null,
  );
}

export async function salvarOnboardingApi(input: SalvarOnboardingApiInput): Promise<unknown | null> {
  return lerJson(
    await chamarApi('/api/onboarding/salvar', corpoJson('POST', escolher(input, ['profile', 'progress', 'stepKey', 'stepStatus'] as const))),
    'Não foi possível salvar o onboarding.',
  );
}

export async function executarAcaoOnboardingApi(
  action: string,
  payload?: Record<string, unknown>,
): Promise<{ id?: string; reused?: boolean; removed?: boolean }> {
  return lerJson(
    await chamarApi('/api/onboarding/acoes', corpoJson('POST', { action, payload: payload ?? {} })),
    'Não foi possível concluir esta ação.',
  );
}

export async function registrarEventoOnboardingApi(
  eventName: string,
  stepKey?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await lerTolerando503<void>(
    await chamarApi('/api/onboarding/eventos', corpoJson('POST', {
      eventName,
      stepKey: stepKey ?? null,
      metadata: metadata ?? {},
    })),
    'Não foi possível registrar o evento.',
    undefined as void,
  );
}

export async function salvarTourOnboardingApi(tourKey: string, status: string, currentStep = 0): Promise<void> {
  return lerJson(
    await chamarApi('/api/onboarding/tours', corpoJson('PUT', { tourKey, status, currentStep })),
    'Não foi possível salvar o tour.',
  );
}

export async function salvarChecklistOnboardingApi(dados: { minimized?: boolean; dismissed?: boolean }): Promise<void> {
  return lerJson(
    await chamarApi('/api/onboarding/checklist', corpoJson('PATCH', escolher(dados, ['minimized', 'dismissed'] as const))),
    'Não foi possível salvar o checklist.',
  );
}

export async function atualizarPerfilOnboardingApi(campos: object): Promise<void> {
  return lerJson(
    await chamarApi('/api/onboarding/perfil', corpoJson('PATCH', escolher(campos, CHAVES_PERFIL_ONBOARDING))),
    'Não foi possível salvar o perfil.',
  );
}

export async function atualizarOrganizacaoOnboardingApi(organizacaoId: string, campos: object): Promise<void> {
  return lerJson(
    await chamarApi(
      `/api/onboarding/organizacoes/${id(organizacaoId)}`,
      corpoJson('PATCH', escolher(campos, CHAVES_ORGANIZACAO_ONBOARDING)),
    ),
    'Não foi possível salvar a empresa.',
  );
}

export async function criarConviteApi(
  dados: { email: string; papel?: string },
): Promise<{ id: string; token: string; expires_in_days: number }> {
  return lerJson(
    await chamarApi('/api/onboarding/convites', corpoJson('POST', escolher(dados, ['email', 'papel'] as const))),
    'Não foi possível preparar o convite.',
  );
}

export async function aceitarConviteApi(token: string): Promise<{ organization_id: string; papel: string }> {
  return lerJson(
    await chamarApi('/api/onboarding/convites/aceitar', corpoJson('POST', { token })),
    'Não foi possível aceitar o convite.',
  );
}
