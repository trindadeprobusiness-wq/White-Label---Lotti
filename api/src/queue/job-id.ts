/**
 * jobId customizado para o BullMQ. O BullMQ 5 rejeita ':' em id customizado
 * (salvo exatamente 3 partes), o que já quebrou o follow-up do Clix.
 */
export function jobId(...parts: Array<string | number>): string {
  const id = parts.map(String).join('-');
  if (!id || /[:\s]/.test(id) || parts.some((p) => String(p) === '')) throw new Error('jobid_invalido');
  return id;
}
