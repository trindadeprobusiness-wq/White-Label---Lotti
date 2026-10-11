import type { AIMessage } from '@/types/ai';

/** Rodapé da resposta, como o do Oráculo: quantas consultas a IA fez e quanto tempo levou. */
export function rodapeDaResposta(metadata: AIMessage['metadata']): string | null {
  const consultas = metadata?.consultas;
  const ms = metadata?.duracao_ms;
  if (typeof ms !== 'number') return null;
  const segundos = `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;
  if (typeof consultas !== 'number' || consultas <= 0) return segundos;
  return `${consultas} ${consultas === 1 ? 'consulta' : 'consultas'} · ${segundos}`;
}
