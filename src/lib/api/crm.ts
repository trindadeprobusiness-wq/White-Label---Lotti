import { chamarApi } from '@/lib/api';
import type { CrmEtapa, CrmOportunidade, CrmTarefa } from '@/lib/crm/tipos';
import { corpoJson, lerJson } from './http';

// Clientes e funil do CRM pela API Lotti (fase 4, módulo 2). Só é chamado atrás
// de apiDisponivel(). As listas de chaves espelham os DTOs: chave fora delas dá 400.

export const CHAVES_CRIAR_CLIENTE = ['nome', 'telefone', 'email', 'cpf', 'tipo_interesse', 'status_funil', 'observacoes', 'ultimo_contato', 'tracking_data'] as const;
export const CHAVES_ALTERAR_CLIENTE = ['nome', 'telefone', 'email', 'tipo_interesse', 'observacoes', 'ultimo_contato'] as const;
export const CHAVES_NOVA_OPORTUNIDADE = ['etapa_id', 'titulo', 'cliente_id', 'imovel_id', 'valor_estimado', 'probabilidade', 'data_prevista_fechamento', 'motivo_perda', 'origem', 'ordem', 'observacoes'] as const;
export const CHAVES_NOVA_TAREFA = ['titulo', 'descricao', 'tipo', 'data_prevista', 'oportunidade_id', 'cliente_id'] as const;

type Linha = Record<string, unknown>;

const cliente = (id: string) => `/api/clientes/${encodeURIComponent(id)}`;

// ── Clientes ─────────────────────────────────────────────────────────────

export async function listarClientesApi(): Promise<Array<Linha & { id: string; cliente_imovel?: Array<{ imovel_id: string }> }>> {
  return lerJson(await chamarApi('/api/clientes'), 'Não foi possível carregar os clientes.');
}

export async function obterClienteApi(id: string): Promise<Linha> {
  return lerJson(await chamarApi(cliente(id)), 'Cliente não encontrado.');
}

export async function criarClienteApi(dados: Linha): Promise<{ status: string; cliente_id?: string; candidatos?: unknown }> {
  return lerJson(await chamarApi('/api/clientes', corpoJson('POST', dados)), 'Não foi possível cadastrar o cliente.');
}

export async function buscarCandidatosApi(q: { telefone?: string | null; email?: string | null; cpf?: string | null }): Promise<unknown> {
  const params = new URLSearchParams();
  for (const chave of ['telefone', 'email', 'cpf'] as const) {
    const valor = q[chave];
    if (valor !== null && valor !== undefined) params.set(chave, valor);
  }
  const busca = params.toString();
  return lerJson(
    await chamarApi(`/api/clientes/candidatos${busca ? `?${busca}` : ''}`),
    'Não foi possível procurar clientes parecidos.',
  );
}

export async function atualizarClienteApi(id: string, dados: Linha): Promise<Linha> {
  return lerJson(await chamarApi(cliente(id), corpoJson('PATCH', dados)), 'Não foi possível atualizar o cliente.');
}

export async function moverClienteNoFunilApi(id: string, status: string): Promise<{ id: string }> {
  return lerJson(
    await chamarApi(`${cliente(id)}/status`, corpoJson('PATCH', { status_funil: status })),
    'Não foi possível mover o cliente no funil.',
  );
}

export async function removerClienteApi(id: string): Promise<void> {
  return lerJson(await chamarApi(cliente(id), corpoJson('DELETE')), 'Não foi possível excluir o cliente.');
}

export async function definirImovelDeInteresseApi(
  clienteId: string,
  imovelId: string | null,
): Promise<{ cliente_id: string; imovel_id: string | null }> {
  return lerJson(
    await chamarApi(`${cliente(clienteId)}/imovel-interesse`, corpoJson('PUT', { imovel_id: imovelId })),
    'Não foi possível vincular o imóvel ao cliente.',
  );
}

export async function completarCpfApi(clienteId: string, cpf: string): Promise<{ atualizado: boolean }> {
  return lerJson(
    await chamarApi(`${cliente(clienteId)}/completar-cpf`, corpoJson('POST', { cpf })),
    'Não foi possível guardar o CPF do cliente.',
  );
}

export async function listarHistoricoApi(clienteId: string): Promise<Linha[]> {
  return lerJson(await chamarApi(`${cliente(clienteId)}/historico`), 'Não foi possível carregar o histórico.');
}

export async function registrarHistoricoApi(
  clienteId: string,
  r: { tipo: string; direcao?: 'IN' | 'OUT'; conteudo: string; metadata?: Record<string, unknown> },
): Promise<Linha> {
  return lerJson(
    await chamarApi(`${cliente(clienteId)}/historico`, corpoJson('POST', r)),
    'Não foi possível registrar o contato.',
  );
}

export async function converterLeadApi(a: {
  lead_id: string;
  etapa_id: string | null;
  nome?: string;
  telefone?: string;
  email?: string | null;
  cliente_id?: string | null;
}): Promise<unknown> {
  return lerJson(await chamarApi('/api/clientes/converter-lead', corpoJson('POST', a)), 'Não foi possível converter o lead.');
}

// ── Funil ────────────────────────────────────────────────────────────────

export async function listarEtapasApi(): Promise<CrmEtapa[]> {
  return lerJson(await chamarApi('/api/crm/etapas'), 'Não foi possível carregar as etapas.');
}

export async function salvarEtapasApi(
  etapas: Array<{ id: string; nome: string; cor: string; tipo: string; ordem: number }>,
): Promise<{ atualizadas: number }> {
  return lerJson(await chamarApi('/api/crm/etapas', corpoJson('PATCH', { etapas })), 'Não foi possível salvar as etapas.');
}

export async function listarOportunidadesApi(): Promise<CrmOportunidade[]> {
  return lerJson(await chamarApi('/api/crm/oportunidades'), 'Não foi possível carregar os negócios.');
}

export async function moverOportunidadeApi(a: { id: string; etapaId: string; ordem: number; updatedAt: string }): Promise<{ id: string }> {
  return lerJson(
    await chamarApi(
      `/api/crm/oportunidades/${encodeURIComponent(a.id)}/mover`,
      corpoJson('PATCH', { etapa_id: a.etapaId, ordem: a.ordem, updated_at: a.updatedAt }),
    ),
    'Não foi possível mover o negócio.',
  );
}

export async function excluirOportunidadesApi(ids: string[]): Promise<{ excluidas: number }> {
  return lerJson(await chamarApi('/api/crm/oportunidades/excluir', corpoJson('POST', { ids })), 'Não foi possível excluir os negócios.');
}

/** Recebe o objeto já filtrado por CHAVES_NOVA_OPORTUNIDADE (sem id nem corretor_id). */
export async function criarOportunidadeApi(nova: Linha): Promise<{ id: string }> {
  return lerJson(await chamarApi('/api/crm/oportunidades', corpoJson('POST', nova)), 'Não foi possível criar a oportunidade.');
}

export async function listarTarefasApi(): Promise<CrmTarefa[]> {
  return lerJson(await chamarApi('/api/crm/tarefas'), 'Não foi possível carregar as tarefas.');
}

export async function concluirTarefaApi(id: string, concluida: boolean): Promise<Linha> {
  return lerJson(
    await chamarApi(`/api/crm/tarefas/${encodeURIComponent(id)}/concluir`, corpoJson('PATCH', { concluida })),
    'Não foi possível atualizar a tarefa.',
  );
}

/** Recebe o objeto já filtrado por CHAVES_NOVA_TAREFA (sem id nem corretor_id). */
export async function criarTarefaApi(nova: Linha): Promise<Linha> {
  return lerJson(await chamarApi('/api/crm/tarefas', corpoJson('POST', nova)), 'Não foi possível criar a tarefa.');
}
