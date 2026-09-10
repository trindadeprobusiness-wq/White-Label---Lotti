import type { WhatsAppContactProfile, WhatsAppConversation, WhatsAppMessage } from './types';

export const demoConversations: WhatsAppConversation[] = [
  {
    id: 'conv-marina', contactId: 'marina', contactName: 'Marina Alves', phone: '(62) 98765-4321',
    avatar: 'MA', lastMessage: 'Quero entender como funciona o financiamento.', lastMessageAt: '15:42',
    unreadCount: 2, serviceMode: 'ai', status: 'open', assignee: 'Evandro',
  },
  {
    id: 'conv-carlos', contactId: 'carlos', contactName: 'Carlos Henrique', phone: '(62) 99123-7788',
    avatar: 'CH', lastMessage: 'Pode marcar a visita para sábado?', lastMessageAt: '14:18',
    unreadCount: 0, serviceMode: 'human', status: 'open', assignee: 'Evandro',
  },
  {
    id: 'conv-bianca', contactId: 'bianca', contactName: 'Bianca Souza', phone: '(62) 98555-0199',
    avatar: 'BS', lastMessage: 'Obrigada! Vou conversar com meu marido.', lastMessageAt: 'Ontem',
    unreadCount: 0, serviceMode: 'paused', status: 'waiting', assignee: 'Sem responsável',
  },
  {
    id: 'conv-rodrigo', contactId: 'rodrigo', contactName: 'Rodrigo Lima', phone: '(62) 99888-4400',
    avatar: 'RL', lastMessage: 'Vocês têm apartamento no Setor Bueno?', lastMessageAt: 'Ontem',
    unreadCount: 4, serviceMode: 'ai', status: 'open', assignee: 'Lotti IA',
  },
];

export const demoMessagesByConversation: Record<string, WhatsAppMessage[]> = {
  'conv-marina': [
    { id: 'm1', direction: 'incoming', content: 'Olá! Vi um apartamento de vocês e queria mais informações.', sentAt: '15:36', sender: 'Marina' },
    { id: 'm2', direction: 'outgoing', content: 'Oi, Marina! Sou a assistente da Lotti. Você busca um imóvel para morar ou investir?', sentAt: '15:37', sender: 'Lotti IA', status: 'read' },
    { id: 'm3', direction: 'incoming', content: 'Para morar. Quero entender como funciona o financiamento.', sentAt: '15:42', sender: 'Marina' },
  ],
  'conv-carlos': [
    { id: 'c1', direction: 'outgoing', content: 'Carlos, separei duas opções dentro do seu orçamento.', sentAt: '14:05', sender: 'Evandro', status: 'read' },
    { id: 'c2', direction: 'incoming', content: 'Pode marcar a visita para sábado?', sentAt: '14:18', sender: 'Carlos' },
  ],
  'conv-bianca': [
    { id: 'b1', direction: 'outgoing', content: 'Enviei a simulação e as condições do imóvel.', sentAt: 'Ontem, 17:20', sender: 'Evandro', status: 'read' },
    { id: 'b2', direction: 'incoming', content: 'Obrigada! Vou conversar com meu marido.', sentAt: 'Ontem, 17:26', sender: 'Bianca' },
  ],
  'conv-rodrigo': [
    { id: 'r1', direction: 'incoming', content: 'Vocês têm apartamento no Setor Bueno?', sentAt: 'Ontem, 10:11', sender: 'Rodrigo' },
  ],
};

const profile = (
  id: string, name: string, phone: string, interest: string, budget: string, assignee: string,
): WhatsAppContactProfile => ({
  id, name, phone, email: `${id}@email.com`, stageId: 'QUALIFICACAO', stage: 'Qualificação', interest, budget, assignee,
  tags: ['Lead WhatsApp', 'Compra'],
  notes: ['Busca imóvel com boa localização e possibilidade de financiamento.'],
  timeline: [
    { id: `${id}-t1`, title: 'Conversou no WhatsApp', detail: 'Atendimento iniciado pelo Inbox', occurredAt: 'Hoje' },
    { id: `${id}-t2`, title: 'Lead criado', detail: 'Origem: Fachada Inteligente', occurredAt: 'Há 2 dias' },
  ],
});

export const demoProfilesByContact: Record<string, WhatsAppContactProfile> = {
  marina: profile('marina', 'Marina Alves', '(62) 98765-4321', 'Apartamento · 2 quartos', 'Até R$ 450 mil', 'Evandro'),
  carlos: profile('carlos', 'Carlos Henrique', '(62) 99123-7788', 'Casa · 3 quartos', 'Até R$ 700 mil', 'Evandro'),
  bianca: profile('bianca', 'Bianca Souza', '(62) 98555-0199', 'Apartamento · 3 quartos', 'Até R$ 600 mil', 'Sem responsável'),
  rodrigo: profile('rodrigo', 'Rodrigo Lima', '(62) 99888-4400', 'Apartamento · Setor Bueno', 'Até R$ 520 mil', 'Lotti IA'),
};
