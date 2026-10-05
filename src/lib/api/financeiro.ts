import { chamarApi } from '@/lib/api';
import { corpoJson, escolher, lerJson } from './http';

// Financeiro (lançamentos, faturas, repasses e Asaas) pela API Lotti (fase 4).
// Só é chamado atrás de apiDisponivel(). As listas de chaves espelham os DTOs:
// chave fora delas dá 400, por isso o corpo passa sempre por escolher().

type Linha = Record<string, unknown>;

export const CHAVES_NOVO_LANCAMENTO = ['tipo', 'categoria', 'descricao', 'valor', 'data', 'data_competencia', 'recorrente', 'contrato_id', 'imovel_id', 'status', 'impacta_dre', 'grupo_dre', 'subcategoria'] as const;
export const CHAVES_ALTERAR_LANCAMENTO = ['tipo', 'categoria', 'descricao', 'valor', 'data', 'recorrente'] as const;

const ERRO_LANCAMENTOS = 'Não foi possível carregar os lançamentos.';
const ERRO_SALVAR_LANCAMENTO = 'Não foi possível salvar o lançamento.';
const ERRO_FATURAS = 'Não foi possível carregar as faturas.';
const ERRO_ASAAS = 'Não foi possível concluir a operação no Asaas.';
const ERRO_REPASSES = 'Não foi possível carregar os repasses.';
const ERRO_CONEXAO = 'Não foi possível concluir a conexão com a Asaas.';

const lancamento = (id: string) => `/api/financeiro/lancamentos/${encodeURIComponent(id)}`;
const fatura = (id: string) => `/api/financeiro/faturas/${encodeURIComponent(id)}`;

// ── Lançamentos ──────────────────────────────────────────────────────────

export async function listarLancamentosApi(f?: { tipo?: string; categoria?: string; de?: string; ate?: string }): Promise<Linha[]> {
  const params = new URLSearchParams();
  for (const chave of ['tipo', 'categoria', 'de', 'ate'] as const) {
    const valor = f?.[chave];
    if (valor !== undefined && valor !== null && valor !== '') params.set(chave, valor);
  }
  const busca = params.toString();
  return lerJson(await chamarApi(`/api/financeiro/lancamentos${busca ? `?${busca}` : ''}`), ERRO_LANCAMENTOS);
}

export async function criarLancamentoApi(dados: object): Promise<Linha[]> {
  return lerJson(
    await chamarApi('/api/financeiro/lancamentos', corpoJson('POST', escolher(dados, CHAVES_NOVO_LANCAMENTO))),
    ERRO_SALVAR_LANCAMENTO,
  );
}

export async function alterarLancamentoApi(id: string, dados: object): Promise<Linha> {
  return lerJson(await chamarApi(lancamento(id), corpoJson('PATCH', escolher(dados, CHAVES_ALTERAR_LANCAMENTO))), ERRO_SALVAR_LANCAMENTO);
}

export async function excluirLancamentoApi(id: string): Promise<void> {
  return lerJson(await chamarApi(lancamento(id), corpoJson('DELETE')), ERRO_SALVAR_LANCAMENTO);
}

// ── Faturas e locação ────────────────────────────────────────────────────

export async function listarContratosAtivosApi(): Promise<Linha[]> {
  return lerJson(await chamarApi('/api/financeiro/contratos-ativos'), ERRO_FATURAS);
}

export async function resumoLocacaoApi(): Promise<{ contratos_ativos: number; soma_valor: number }> {
  return lerJson(await chamarApi('/api/financeiro/locacao/resumo'), ERRO_FATURAS);
}

export async function listarFaturasApi(): Promise<Linha[]> {
  return lerJson(await chamarApi('/api/financeiro/faturas'), ERRO_FATURAS);
}

export async function garantirFaturaApi(a: { contrato_id: string; mes_referencia: string; data_vencimento: string }): Promise<{ id: string; criada: boolean }> {
  const corpo = { contrato_id: a.contrato_id, mes_referencia: a.mes_referencia, data_vencimento: a.data_vencimento };
  return lerJson(await chamarApi('/api/financeiro/faturas', corpoJson('POST', corpo)), ERRO_FATURAS);
}

export async function alterarVencimentoApi(id: string, data_vencimento: string): Promise<Linha> {
  return lerJson(await chamarApi(`${fatura(id)}/vencimento`, corpoJson('PATCH', { data_vencimento })), ERRO_FATURAS);
}

export async function darBaixaApi(id: string, data_pagamento: string): Promise<Linha> {
  return lerJson(await chamarApi(`${fatura(id)}/baixa`, corpoJson('POST', { data_pagamento })), ERRO_FATURAS);
}

export async function estornarFaturaApi(id: string): Promise<{ status: string }> {
  return lerJson(await chamarApi(`${fatura(id)}/estorno`, corpoJson('POST')), ERRO_FATURAS);
}

export async function cancelarFaturaApi(id: string): Promise<Linha> {
  return lerJson(await chamarApi(`${fatura(id)}/cancelar`, corpoJson('POST')), ERRO_FATURAS);
}

export async function reativarFaturaApi(id: string): Promise<Linha> {
  return lerJson(await chamarApi(`${fatura(id)}/reativar`, corpoJson('POST')), ERRO_FATURAS);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- corpo livre da ação, igual ao da Edge Function
export async function acaoAsaasApi(id: string, acao: string, extra?: { data_pagamento?: string }): Promise<Record<string, any>> {
  const corpo: Record<string, unknown> = { acao };
  if (extra?.data_pagamento !== undefined) corpo.data_pagamento = extra.data_pagamento;
  return lerJson(await chamarApi(`${fatura(id)}/asaas`, corpoJson('POST', corpo)), ERRO_ASAAS);
}

export async function saldoAsaasApi(): Promise<{ balance: number | null; unavailable?: boolean; message?: string }> {
  return lerJson(await chamarApi('/api/financeiro/asaas/saldo'), ERRO_ASAAS);
}

// ── Repasses ─────────────────────────────────────────────────────────────

export async function listarRepassesApi(): Promise<Linha[]> {
  return lerJson(await chamarApi('/api/financeiro/repasses'), ERRO_REPASSES);
}

export async function confirmarRepasseApi(id: string): Promise<Linha> {
  return lerJson(
    await chamarApi(`/api/financeiro/repasses/${encodeURIComponent(id)}/confirmar`, corpoJson('POST')),
    ERRO_REPASSES,
  );
}

// ── Conexão Asaas ────────────────────────────────────────────────────────

export async function statusConexaoAsaasApi(): Promise<{ disponivel: boolean; conexao: Linha | null }> {
  return lerJson(await chamarApi('/api/financeiro/asaas/conexao'), ERRO_CONEXAO);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- corpo livre, igual ao da Edge Function
export async function conectarAsaasApi(api_key: string, ambiente: 'sandbox' | 'producao'): Promise<Record<string, any>> {
  return lerJson(await chamarApi('/api/financeiro/asaas/conexao', corpoJson('POST', { api_key, ambiente })), ERRO_CONEXAO);
}

export async function desconectarAsaasApi(): Promise<{ ok: boolean; aviso: string | null }> {
  return lerJson(await chamarApi('/api/financeiro/asaas/conexao', corpoJson('DELETE')), ERRO_CONEXAO);
}
