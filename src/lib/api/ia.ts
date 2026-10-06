import { chamarApi, obterTokenApi } from '@/lib/api';
import { corpoJson, lerErroApi, lerJson } from './http';

// IA pela API Lotti (porte das Edge Functions ai-assistant, ai-action, ai-process-file, analisar-foto,
// analisar-fotos-imovel, generate-whatsapp-message e inbox-suggest). Só é chamado atrás de apiDisponivel().
// As respostas têm o mesmo formato das funções; os erros chegam como ErroApi (texto em português em .message).

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '');

export type LinhaIa = Record<string, unknown>;

/**
 * Abre o stream do Assistente (text/event-stream) com fetch e o token do login próprio no cabeçalho
 * (nunca na URL). Erro antes do stream (sessão, limite, cota, corpo) vira ErroApi; com 2xx devolve a
 * Response para quem chama ler os eventos `data: {"type": ...}`, iguais aos da Edge Function.
 */
export async function abrirAssistenteApi(corpo: Record<string, unknown>, sinal?: AbortSignal): Promise<Response> {
  if (!BASE) throw new Error('API Lotti indisponível no momento.');
  const token = await obterTokenApi();
  const res = await fetch(`${BASE}/api/ia/assistente`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(corpo),
    signal: sinal,
  });
  if (!res.ok || !res.body) throw await lerErroApi(res, 'O assistente não respondeu. Tente novamente.');
  return res;
}

// ------------------------------------------------------------------ conversas (ai_conversations / ai_messages)

const conversa = (id: string) => `/api/ia/conversas/${encodeURIComponent(id)}`;

export async function listarConversasIaApi(): Promise<LinhaIa[]> {
  return lerJson(await chamarApi('/api/ia/conversas'), 'Não foi possível carregar as conversas.');
}

export async function listarMensagensIaApi(id: string): Promise<LinhaIa[]> {
  return lerJson(await chamarApi(`${conversa(id)}/mensagens`), 'Não foi possível carregar a conversa.');
}

export async function alterarConversaIaApi(id: string, dados: { title?: string; pinned?: boolean }): Promise<LinhaIa> {
  return lerJson(await chamarApi(conversa(id), corpoJson('PATCH', dados)), 'Não foi possível salvar a conversa.');
}

export async function apagarConversaIaApi(id: string): Promise<void> {
  return lerJson(await chamarApi(conversa(id), { method: 'DELETE' }), 'Não foi possível excluir a conversa.');
}

// ------------------------------------------------------------------ ações propostas pelo assistente (ai-action)

export interface RespostaAcaoIa {
  status: 'executed' | 'rejected';
  proposal_id: string;
  record_id?: string;
  existing?: boolean;
  idempotent?: boolean;
}

export async function decidirAcaoIaApi(proposalId: string, decision: 'confirm' | 'reject'): Promise<RespostaAcaoIa> {
  const padrao = decision === 'confirm' ? 'Não foi possível executar a ação.' : 'Não foi possível recusar a ação.';
  return lerJson(await chamarApi('/api/ia/acao', corpoJson('POST', { proposal_id: proposalId, decision })), padrao);
}

// ------------------------------------------------------------------ anexo do chat (ai-process-file)

export interface AnexoIa {
  storage_path: string;
  extracted_text: string;
  metadata: Record<string, unknown>;
  file_name: string;
  file_type: string;
  file_size: number;
}

/** Multipart com o campo `file`, como a função. O navegador monta o boundary: sem Content-Type aqui. */
export async function enviarAnexoIaApi(file: File, messageId?: string): Promise<AnexoIa> {
  const form = new FormData();
  form.append('file', file);
  if (messageId) form.append('message_id', messageId);
  return lerJson(await chamarApi('/api/ia/anexos', { method: 'POST', body: form }), 'Erro ao processar arquivo');
}

// ------------------------------------------------------------------ fotos

export interface ParametrosRealceIa {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  shadows: number;
  highlights: number;
  sharpness: number;
}

export async function analisarFotoApi(dados: { imageBase64: string; mimeType: string }): Promise<{ params: ParametrosRealceIa }> {
  return lerJson(await chamarApi('/api/ia/analisar-foto', corpoJson('POST', dados)), 'Não foi possível analisar a foto.');
}

export interface DadosFotosImovelIa {
  imagens: string[];
  descricao_atual?: string;
  dados_imovel?: { titulo?: unknown; tipo?: unknown; bairro?: unknown; cidade?: unknown };
}

export async function analisarFotosImovelApi(
  dados: DadosFotosImovelIa,
): Promise<{ fotos: Array<{ indice: number; categoria: string }>; descricao_sugerida: string | null }> {
  return lerJson(await chamarApi('/api/ia/analisar-fotos-imovel', corpoJson('POST', dados)), 'Não foi possível analisar as fotos.');
}

/** "Usar a sugestão" do OrganizarFotosIA: grava só a descrição do imóvel. */
export async function salvarDescricaoImovelApi(imovelId: string, descricao: string): Promise<{ id: string; descricao: string }> {
  return lerJson(
    await chamarApi(`/api/ia/imoveis/${encodeURIComponent(imovelId)}/descricao`, corpoJson('PATCH', { descricao })),
    'Não foi possível salvar a descrição.',
  );
}

// ------------------------------------------------------------------ mensagens

export interface PedidoMensagemWhatsapp {
  clientName: string;
  messageType?: string;
  tone?: string;
  details?: unknown;
}

export async function gerarMensagemWhatsappApi(
  dados: PedidoMensagemWhatsapp,
): Promise<{ message: string; model: string; prompt_version: string }> {
  return lerJson(await chamarApi('/api/ia/mensagem-whatsapp', corpoJson('POST', dados)), 'Não foi possível gerar a mensagem.');
}

/** Imóveis ativos da conta para o seletor do "Sugerir resposta" do Inbox. */
export async function listarImoveisSugestaoApi(): Promise<Array<{ id: string; titulo: string }>> {
  return lerJson(await chamarApi('/api/ia/sugestao-inbox/imoveis'), 'Não foi possível carregar seus imóveis.');
}

export async function sugerirRespostaInboxApi(
  dados: { propertyId: string; question: string },
): Promise<{ suggestion: string; propertyId: string; requiresReview: boolean }> {
  return lerJson(await chamarApi('/api/ia/sugestao-inbox', corpoJson('POST', dados)), 'Não foi possível gerar a sugestão.');
}
