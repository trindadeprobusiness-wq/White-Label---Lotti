export function contactDisplay(value: string) {
  const contactName = value.trim().replace(/\s+/g, ' ');
  if (!contactName || contactName.length > 120) throw new Error('Informe um nome de até 120 caracteres.');
  const parts = contactName.split(' ');
  const avatar = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : contactName.slice(0, 2)).toLocaleUpperCase('pt-BR');
  return { contactName, avatar };
}
