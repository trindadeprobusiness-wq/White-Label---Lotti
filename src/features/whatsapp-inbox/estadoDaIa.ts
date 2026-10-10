/**
 * Em que pé está a IA nesta conversa.
 *
 * O Inbox dizia "IA ligada" enquanto a IA estava em silêncio — e estava certo
 * pela coluna `mode`, que continuava `ai`. O que ninguém via era a `pausa_ia_ate`:
 * responder pelo celular cala a IA por um prazo, e ela volta sozinha quando o
 * prazo vence. Sem mostrar isso, o corretor liga e desliga o interruptor
 * tentando entender por que ela não fala.
 *
 * "Em espera" é um estado de verdade, diferente de ligada e de desligada:
 * a IA continua responsável pela conversa, só não agora.
 */

export type ConversaParaEstado = {
  mode: 'ai' | 'human' | 'paused';
  pausa_ia_ate?: string | null;
  opted_out_at?: string | null;
};

export type EstadoDaIa =
  | { tipo: 'bloqueada' }
  | { tipo: 'em-espera'; ate: Date }
  | { tipo: 'ligada' }
  | { tipo: 'pausada' }
  | { tipo: 'desligada' };

export function estadoDaIa(conversa: ConversaParaEstado, agora: Date = new Date()): EstadoDaIa {
  // Quem pediu para não receber mensagens está acima de qualquer modo.
  if (conversa.opted_out_at) return { tipo: 'bloqueada' };
  if (conversa.mode === 'paused') return { tipo: 'pausada' };
  if (conversa.mode === 'human') return { tipo: 'desligada' };

  const ate = conversa.pausa_ia_ate ? new Date(conversa.pausa_ia_ate) : null;
  // Prazo vencido não é espera: a IA já voltou. Data inválida é tratada como
  // ausência de pausa — melhor a IA parecer ligada do que a tela travar.
  if (ate && Number.isFinite(ate.getTime()) && ate.getTime() > agora.getTime()) {
    return { tipo: 'em-espera', ate };
  }
  return { tipo: 'ligada' };
}

const ROTULOS: Record<EstadoDaIa['tipo'], string> = {
  bloqueada: 'IA bloqueada',
  'em-espera': 'IA em espera',
  ligada: 'IA ligada',
  pausada: 'IA pausada',
  desligada: 'IA desligada',
};

export function rotuloDaIa(estado: EstadoDaIa): string {
  return ROTULOS[estado.tipo];
}

/**
 * "hoje às 18:42", "amanhã às 11:37", "05/10 às 09:00".
 *
 * Mostrar só o horário faz "volta às 11:37" parecer daqui a pouco quando é de
 * outro dia; mostrar a data cheia para daqui a duas horas é informação demais.
 */
export function quandoAIaVolta(ate: Date, agora: Date = new Date()): string {
  const hora = ate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dias = diasDeDiferenca(agora, ate);
  if (dias === 0) return `hoje às ${hora}`;
  if (dias === 1) return `amanhã às ${hora}`;
  return `${ate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora}`;
}

/** Diferença em dias de calendário, não em períodos de 24h. */
function diasDeDiferenca(de: Date, para: Date): number {
  const inicio = new Date(de.getFullYear(), de.getMonth(), de.getDate()).getTime();
  const fim = new Date(para.getFullYear(), para.getMonth(), para.getDate()).getTime();
  return Math.round((fim - inicio) / 86_400_000);
}

/**
 * `last_error` tem duas origens, e a tela só conhecia uma.
 *
 * O banco grava quatro valores nas próprias funções. O runtime da ponte grava
 * outros dois pela RPC `fail` — `qualification_failed` e
 * `delivery_failed_or_uncertain` — e esses dois caíam no texto genérico, que
 * não diz o que houve nem o que fazer. Era o que aparecia justamente quando a
 * IA parava de responder.
 */
export const MOTIVO_DA_PARADA: Record<string, string> = {
  no_active_entitlement: 'A IA não respondeu porque esta conta não tem plano ativo. Reative a assinatura para o agente voltar a atender.',
  quota_exhausted: 'A franquia de atendimentos do plano acabou neste período. A IA volta a responder na renovação.',
  processing_stalled: 'A IA tentou responder e não conseguiu. A conversa foi passada para a equipe.',
  delivery_uncertain: 'Um envio não foi confirmado. Confira no WhatsApp antes de responder de novo.',
  crm_capture_pending: 'Este contato ainda não entrou no CRM. O sistema tentará de novo sozinho.',
  delivery_failed_or_uncertain: 'A IA escreveu uma resposta e o envio não foi confirmado. Confira no WhatsApp se a mensagem chegou antes de responder de novo. A conversa ficou com a equipe; religue a IA quando quiser devolvê-la.',
  qualification_failed: 'A IA não conseguiu montar a resposta e passou a conversa para a equipe. Pode responder por aqui; religar a IA faz ela tentar de novo.',
  // Os três abaixo vêm da separação entre falha certa e dúvida, feita na ponte.
  delivery_rejected: 'O WhatsApp recusou o envio e a mensagem não saiu. A IA tenta de novo sozinha; se repetir, o número pode estar errado ou fora do WhatsApp.',
  delivery_upstream_error: 'O WhatsApp falhou ao responder e não dá para afirmar que a mensagem saiu. Confira na conversa antes de responder de novo.',
  delivery_commit_failed: 'A mensagem foi enviada, mas o sistema não conseguiu registrá-la aqui. Confirme para o histórico ficar certo — não responda por cima sem olhar.',
  // A IA nem chegou a tentar enviar: quebrou antes, do lado do sistema.
  falha_antes_do_envio: 'A IA não chegou a enviar nada: a falha foi antes, no próprio sistema. Ela tenta de novo sozinha.',
  automatic_send_failed: 'Um envio automático (follow-up ou disparo) não saiu. A conversa segue normal; o toque é refeito no próximo ciclo.',
  // Gravado pela ponte quando falta a chave da OpenAI. Caía no texto genérico,
  // logo quando a causa é a mais concreta e acionável de todas.
  ai_not_configured: 'A IA não está configurada no servidor: falta a chave do provedor. Nenhuma conversa é atendida até alguém repor a chave.',
};

/** Todo motivo que banco e ponte sabem gravar. Serve de trava no teste. */
export const MOTIVOS_CONHECIDOS = Object.keys(MOTIVO_DA_PARADA);

/**
 * Os motivos que significam "um envio ficou sem confirmação".
 *
 * São os únicos que o corretor consegue resolver, porque dependem de abrir o
 * WhatsApp e olhar. O banco grava `delivery_uncertain`; a ponte grava
 * `delivery_failed_or_uncertain` para o mesmo acontecimento, e depois da
 * separação entre falha certa e dúvida passa a gravar também
 * `delivery_upstream_error` e `delivery_commit_failed`.
 *
 * `delivery_rejected` fica DE FORA de propósito: ali a recusa é explícita, a
 * mensagem não saiu, o registro é apagado e a IA tenta de novo sozinha. Não há
 * nada para o corretor confirmar, e oferecer o botão só convidaria a responder
 * uma pergunta que o sistema já sabe.
 */
export const ENVIO_SEM_CONFIRMACAO = new Set([
  'delivery_uncertain', 'delivery_failed_or_uncertain',
  'delivery_upstream_error', 'delivery_commit_failed',
]);

/**
 * Motivos que NÃO são parada: são a IA esperando a vez dela, de propósito.
 *
 * O runtime chama `lotti_agent_defer` com um motivo, e a função grava esse
 * motivo em `last_error` — o mesmo campo das falhas. Por isso uma conversa
 * saudável, só aguardando o lead terminar de digitar, aparecia com o aviso
 * amarelo "Esta conversa precisa de revisão operacional". Não precisava.
 *
 * Os três valores são os que `runtime/attend.mjs` produz.
 */
export const ESPERA_DA_IA: Record<string, string> = {
  aggregation: 'Juntando as mensagens do cliente antes de responder, para não interromper quem ainda está digitando.',
  inside_business_hours: 'Dentro do expediente a equipe atende primeiro. A IA entra se ninguém responder.',
  waiting_broker: 'Aguardando a equipe responder. A IA entra se ninguém responder no prazo configurado.',
  // Religar a IA já aparece na linha do tempo ("IA ligada por…"); a faixa repetia o óbvio. Vazio = sem faixa.
  religada_pela_equipe: '',
};
