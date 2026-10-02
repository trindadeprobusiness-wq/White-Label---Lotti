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
};

/** Todo motivo que banco e ponte sabem gravar. Serve de trava no teste. */
export const MOTIVOS_CONHECIDOS = Object.keys(MOTIVO_DA_PARADA);
