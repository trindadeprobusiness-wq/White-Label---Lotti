export const followUpLabels = { new: 'Novo contato', contacted: 'Contato realizado', meeting: 'Conversa agendada', won: 'Fechado', lost: 'Sem interesse' };
export type FollowUpStatus = keyof typeof followUpLabels;

export function diagnosticContactLinks(lead: { name?: string | null; phone?: string | null; email?: string | null }) {
  const phone = (lead.phone || '').replace(/[\s()+.-]/g, '');
  const email = (lead.email || '').trim();
  const firstName = (lead.name || '').trim().split(/\s+/)[0];
  const greeting = `Olá${firstName ? `, ${firstName}` : ''}! Aqui é o Gabriel Trindade. Recebi seu pedido de diagnóstico de crescimento. Podemos conversar sobre o momento da sua operação?`;
  return {
    whatsapp: /^[1-9]\d{7,14}$/.test(phone) ? `https://wa.me/${phone}?text=${encodeURIComponent(greeting)}` : null,
    email: /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(email) ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Seu diagnóstico de crescimento')}&body=${encodeURIComponent(greeting)}` : null,
  };
}
