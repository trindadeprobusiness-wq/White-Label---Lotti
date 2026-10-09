import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { crmKeys } from '@/hooks/crm/useCrm';
import ConnectedInbox from '@/features/whatsapp-inbox/ConnectedInbox';

/**
 * Prévia do Inbox só para desenvolvimento.
 *
 * O Inbox só existe depois do login e com um número conectado, então revisar a
 * rolagem, a linha do tempo ou o aviso da IA dependia de uma conta real com
 * conversa real. Aqui o cache do React Query entra preenchido e a tela
 * renderiza o componente de verdade, com o CSS de verdade, sem rede e sem conta.
 *
 * A rota existe apenas em `import.meta.env.DEV`.
 */

const AGORA = Date.parse('2026-10-02T14:41:55Z');
const quando = (minutosAtras: number) => new Date(AGORA - minutosAtras * 60000).toISOString();

const CONVERSAS = [
  { id: 'c1', phone: '5562994586396', contact_name: 'Marina Alves', cliente_id: 'cli-1', mode: 'ai', status: 'open', updated_at: quando(0), qualification: { stage: 'qualificando', temperature: 'morno', reason: 'Procura apartamento de 2 quartos no Setor Bueno.', profile: { intent: 'locacao', region: 'Anápolis', budget: '1900', needs: '2 quartos', nextStep: 'agendar visita' } }, last_error: null, opted_out_at: null, pausa_ia_ate: new Date(AGORA + 23 * 3600000).toISOString() },
  { id: 'c2', phone: '5562991237788', contact_name: 'Carlos Henrique', cliente_id: null, mode: 'human', status: 'open', updated_at: quando(40), qualification: {}, last_error: null, opted_out_at: null, pausa_ia_ate: null },
  { id: 'c3', phone: '5562985550199', contact_name: 'Bianca Souza', cliente_id: null, mode: 'ai', status: 'open', updated_at: quando(180), qualification: {}, last_error: null, opted_out_at: null, pausa_ia_ate: null },
];

/** Conversa longa de propósito: só com rolagem dá para ver onde ela abre. */
const MENSAGENS = Array.from({ length: 40 }, (_, i) => ({
  id: `m${i}`,
  direction: i % 3 === 0 ? ('out' as const) : ('in' as const),
  sender: i % 3 === 0 ? ('ai' as const) : ('lead' as const),
  content: i % 3 === 0
    ? `Resposta ${i}: posso te mandar as opções que separei por aqui mesmo.`
    : `Mensagem ${i}: estou procurando algo até R$ 450 mil, de preferência perto do centro.`,
  media_path: null,
  created_at: quando(120 - i * 3),
}));

const CLIENTE = {
  id: 'cli-1', nome: 'Marina Alves', email: 'marina@exemplo.test',
  telefone: '(62) 99458-6396', status_funil: 'QUALIFICACAO',
  created_at: '2026-09-24T23:06:43Z',
};

export default function InboxPreview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  // As chaves carregam `user?.id`, que sem login é `undefined` — é esse valor
  // que precisa ser semeado para o componente achar os dados no cache.
  client.setQueryData(['lotti-agent-conversations', undefined, false, 'open'], CONVERSAS);
  client.setQueryData(['lotti-agent-message-previews', undefined, false], CONVERSAS.map((c) => ({
    conversation_id: c.id, direction: 'in' as const, content: 'Última mensagem recebida.', created_at: c.updated_at,
  })));
  for (const conversa of CONVERSAS) {
    client.setQueryData(['lotti-agent-messages', undefined, conversa.id, false], MENSAGENS);
    client.setQueryData(['lotti-inbox-events', undefined, conversa.id, false], []);
  }
  client.setQueryData(['lotti-inbox-client', undefined, 'cli-1'], CLIENTE);
  // A pílula de etapa lê o Funil (mesmas chaves do quadro): sem semente, ia à rede sem login.
  client.setQueryDefaults(crmKeys.todos, { staleTime: Infinity });
  client.setQueryData([...crmKeys.todos, 'modo'], 'completo');
  client.setQueryData([...crmKeys.etapas(), 'completo'], [
    { id: 'etapa-novo', corretor_id: 'previa', nome: 'Novo lead', ordem: 1, cor: 'slate', tipo: 'ABERTA', ativo: true },
    { id: 'etapa-quali', corretor_id: 'previa', nome: 'Em qualificação', ordem: 2, cor: 'sky', tipo: 'ABERTA', ativo: true },
    { id: 'etapa-visita', corretor_id: 'previa', nome: 'Visita agendada', ordem: 3, cor: 'amber', tipo: 'ABERTA', ativo: true },
  ]);
  client.setQueryData([...crmKeys.oportunidades(), 'completo'], [
    { id: 'negocio-1', corretor_id: 'previa', cliente_id: 'cli-1', imovel_id: null, etapa_id: 'etapa-quali', titulo: 'Apartamento no Setor Bueno', valor_estimado: 0, probabilidade: 0, data_prevista_fechamento: null, motivo_perda: null, origem: 'whatsapp', ordem: 0, observacoes: null, fechada_em: null, created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z' },
  ]);

  return <QueryClientProvider client={client}><ConnectedInbox connected /></QueryClientProvider>;
}
