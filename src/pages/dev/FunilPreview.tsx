import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { crmKeys } from '@/hooks/crm/useCrm';
import CRM from '@/pages/CRM';

/**
 * Prévia do funil só para desenvolvimento.
 *
 * O quadro só aparece depois do login, e revisar o visual dele exigia uma
 * sessão real — então cada ajuste de layout virava "recarrega aí e me diz se
 * ficou bom". Aqui o cache do React Query entra já preenchido com etapas e
 * negócios de mentira, e a tela renderiza o componente de verdade, com o CSS
 * de verdade, sem rede e sem conta.
 *
 * A rota existe apenas em `import.meta.env.DEV`; no build de produção ela não
 * é registrada.
 */

const ETAPAS = [
  { id: 'e1', corretor_id: 'x', nome: 'Novo lead', ordem: 1, cor: 'slate', tipo: 'ABERTA', ativo: true },
  { id: 'e2', corretor_id: 'x', nome: 'Primeiro contato', ordem: 2, cor: 'blue', tipo: 'ABERTA', ativo: true },
  { id: 'e3', corretor_id: 'x', nome: 'Em qualificação', ordem: 3, cor: 'blue', tipo: 'ABERTA', ativo: true },
  { id: 'e4', corretor_id: 'x', nome: 'Qualificado', ordem: 4, cor: 'blue', tipo: 'ABERTA', ativo: true },
  { id: 'e5', corretor_id: 'x', nome: 'Visita agendada', ordem: 5, cor: 'amber', tipo: 'ABERTA', ativo: true },
  { id: 'e6', corretor_id: 'x', nome: 'Proposta', ordem: 6, cor: 'violet', tipo: 'ABERTA', ativo: true },
];

const NOMES = [
  ['Tatiane C Fernandes', '(91) 99182-7784'],
  ['Meire Rodrigues Esparalha', '556296957220'],
  ['Karine', '559492735723'],
  ['Contato WhatsApp', '558791663175'],
  ['Maxilene de Freitas Ribeiro', '(62) 99999-1006'],
  ['Luan Ferreira Pavide', '(62) 99999-1004'],
  ['doutor erico', '(62) 99257-0430'],
  ['Valter Luiz Moreira de Souza', '(62) 99999-1002'],
];

const OPORTUNIDADES = NOMES.map(([nome, telefone], i) => ({
  id: `o${i}`,
  corretor_id: 'x',
  cliente_id: `c${i}`,
  etapa_id: i < 4 ? 'e1' : 'e3',
  titulo: nome,
  valor_estimado: i === 6 ? 1850 : 0,
  origem: 'whatsapp',
  fechada_em: null,
  data_prevista_fechamento: null,
  is_sample_data: false,
  updated_at: new Date().toISOString(),
  clientes: { nome, telefone },
  imoveis: i === 6 ? { titulo: '401 Residencial Acasias' } : undefined,
}));

export default function FunilPreview() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } },
  });
  cliente.setQueryData([...crmKeys.todos, 'modo'], 'completo');
  cliente.setQueryData([...crmKeys.etapas(), 'completo'], ETAPAS);
  // ?n=150 multiplica os negócios (espalhados nas etapas) para medir o quadro com volume real.
  const n = Number(new URLSearchParams(window.location.search).get('n')) || 0;
  const volume = n > OPORTUNIDADES.length
    ? Array.from({ length: n }, (_, i) => ({ ...OPORTUNIDADES[i % OPORTUNIDADES.length], id: `o${i}`, cliente_id: `c${i}`, etapa_id: ETAPAS[i % ETAPAS.length].id }))
    : OPORTUNIDADES;
  cliente.setQueryData([...crmKeys.oportunidades(), 'completo'], volume);
  cliente.setQueryData(crmKeys.leads(), []);
  cliente.setQueryData(crmKeys.tarefas(), []);

  return (
    <QueryClientProvider client={cliente}>
      {/* Reproduz o enquadramento do AppLayout: fundo da área de trabalho e o
          mesmo respiro, para a altura do painel ser a real. */}
      <div className="min-h-screen bg-secondary">
        <div className="mx-auto w-full max-w-[1600px] px-5 pb-16 pt-8 md:px-8">
          <CRM />
        </div>
      </div>
    </QueryClientProvider>
  );
}
