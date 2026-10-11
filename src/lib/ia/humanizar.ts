/**
 * Rede de segurança do contrato de apresentação do Assistente: o prompt já proíbe nome de consulta, campo
 * técnico e código interno, mas se algum escapar, a tela mostra o rótulo do negócio. Só troca identificadores
 * EXATOS (com _ ou códigos que não existem em português escrito), nunca palavras comuns em maiúsculas:
 * "CASA À VENDA" no título de um imóvel continua como foi cadastrado.
 */
import { STATUS_FUNIL_LABELS, TIPO_CONTRATO_LABELS } from '@/types/crm';
import { CATEGORIA_LABELS } from '@/types/financeiro';

const ROTULOS: Record<string, string> = {
  // consultas do Assistente
  search_clients: 'busca de clientes',
  get_client_details: 'ficha do cliente',
  search_properties: 'busca de imóveis',
  get_property_details: 'ficha do imóvel',
  get_financial_summary: 'resumo do Financeiro',
  get_financial_entries: 'lançamentos do Financeiro',
  get_contracts: 'contratos',
  get_alerts: 'alertas',
  get_funnel_stats: 'Funil de Vendas',
  get_contact_history: 'histórico de contatos',
  suggest_action: 'proposta de ação',
  // campos
  status_funil: 'status',
  tipo_interesse: 'interesse',
  links_anuncio: 'links dos anúncios',
  pagina_lotti: 'página da Lotti',
  ultimo_contato: 'último contato',
  proximo_followup: 'próximo follow-up',
  dias_sem_contato: 'dias sem contato',
  client_id: 'cliente',
  property_id: 'imóvel',
  cliente_id: 'cliente',
  imovel_id: 'imóvel',
  valor_estimado: 'valor estimado',
  status_venda: 'situação',
  data_fim: 'fim do contrato',
  data_inicio: 'início',
  date_from: 'data inicial',
  date_to: 'data final',
  // códigos. De contrato e categoria, só os com _: OUTRO, DISTRATO, CONSULTORIA... são palavras comuns e ficam como vieram
  ...STATUS_FUNIL_LABELS,
  ...comSublinhado(TIPO_CONTRATO_LABELS),
  ...comSublinhado(CATEGORIA_LABELS),
};

function comSublinhado(mapa: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(mapa).filter(([codigo]) => codigo.includes('_')));
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Sem lookbehind: Safari antes do 16.4 não aceita e o erro derrubaria o app inteiro ao carregar o módulo.
// A fronteira da esquerda é capturada e devolvida na troca.
const PADRAO = new RegExp(
  `(^|[^A-Za-z0-9_])(${Object.keys(ROTULOS).sort((a, b) => b.length - a.length).map(escapar).join('|')})(?![A-Za-z0-9_])`,
  'g',
);

/** Troca os identificadores conhecidos num texto solto (ex.: a descrição do cartão de ação). */
export function humanizarTexto(texto: string): string {
  return texto.replace(PADRAO, (_, antes: string, achado: string) => antes + (ROTULOS[achado] ?? achado));
}

interface No {
  type: string;
  tagName?: string;
  value?: string;
  children?: No[];
}

/** Elementos cujo texto não muda: link (o texto pode ser a URL) e bloco de código. */
const INTOCAVEIS = new Set(['a', 'pre']);

function percorrer(no: No): void {
  if (no.type === 'element' && no.tagName && INTOCAVEIS.has(no.tagName)) return;
  if (no.type === 'text' && typeof no.value === 'string') {
    no.value = humanizarTexto(no.value);
    return;
  }
  no.children?.forEach(percorrer);
}

/** Plugin rehype: aplica a troca só nos nós de texto da resposta já convertida em HTML. */
export function rehypeHumanizar() {
  return (arvore: No) => {
    percorrer(arvore);
  };
}
