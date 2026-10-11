// Ferramentas do Assistente. Nasceram como cópia de TOOLS da Edge Function ai-assistant; em 11/10/2026 as
// consultas foram refeitas para devolver os mesmos números das telas (funil por etapa, contratos pelo status
// real, financeiro pelo período da tela, sem retorno como a aba da tela Clientes) e rótulos prontos.
/* eslint-disable */
import { CATEGORIA_FINANCEIRA, CATEGORIAS_DESPESA, CATEGORIAS_RECEITA, TIPO_CONTRATO } from './rotulos';

const STATUS_CONTRATO = ['RASCUNHO', 'ATIVO', 'VIGENTE', 'ENCERRANDO', 'ENCERRADO', 'CANCELADO', 'ARQUIVADO', 'RESCINDIDO'];
const DIA = 'Dia no formato AAAA-MM-DD';
/** Grupos aceitos no filtro de contrato, além dos tipos exatos. */
const GRUPOS_CONTRATO: Record<string, string[]> = {
  LOCACAO: ['LOCACAO_RESIDENCIAL', 'LOCACAO_COMERCIAL'],
  EXCLUSIVIDADE: ['EXCLUSIVIDADE_VENDA', 'EXCLUSIVIDADE_LOCACAO'],
};

export const FERRAMENTAS_ASSISTENTE = [
  {
    type: 'function' as const,
    function: {
      name: 'search_clients',
      description:
        'Buscar clientes cadastrados por nome, e-mail ou telefone, ou listar quem está sem retorno ou com follow-up marcado. ' +
        'status_funil é o status do cadastro do cliente (tela Clientes), não a etapa do Funil de Vendas. ' +
        'Devolve total, mostrando e a lista.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Nome, e-mail ou telefone (pode ser parte)' },
          status_funil: {
            type: 'string',
            enum: ['QUALIFICACAO', 'VISITA_PROPOSTA', 'DOCUMENTACAO', 'FECHADO_GANHO', 'FECHADO_PERDIDO'],
          },
          tipo_interesse: { type: 'string', enum: ['COMPRA', 'LOCACAO', 'AMBOS'] },
          ordem: {
            type: 'string',
            enum: ['recentes', 'sem_contato', 'proximo_followup'],
            description:
              'recentes (padrão): cadastrados mais recentes primeiro. sem_contato: sem retorno (sem fechados), há mais tempo sem contato primeiro. ' +
              'proximo_followup: só quem tem follow-up marcado (sem perdidos e sem demonstração), o mais próximo primeiro; total = quantos follow-ups marcados.',
          },
          sem_contato_dias: { type: 'number', description: 'Com ordem sem_contato: só quem está há mais destes dias sem contato (padrão 30, como a aba Sem retorno)' },
          followup_ate: { type: 'string', description: `Com ordem proximo_followup: só os follow-ups até este dia, atrasados incluídos (${DIA}; para "hoje", o hoje de <agora>)` },
          limit: { type: 'number', description: 'Máximo de itens (padrão 10, máximo 50)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_client_details',
      description: 'Ficha de um cliente: cadastro, negócios no Funil de Vendas e os últimos contatos',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'ID do cliente, vindo de uma consulta ou dos registros citados' },
        },
        required: ['client_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_properties',
      description: 'Buscar imóveis cadastrados por título, endereço ou bairro, tipo, finalidade, situação (disponível, vendido, alugado), cidade e faixa de preço. Devolve total, mostrando e a lista.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Título, rua ou bairro (pode ser parte)' },
          tipo: { type: 'string', enum: ['APARTAMENTO', 'CASA', 'COMERCIAL', 'TERRENO'] },
          finalidade: { type: 'string', enum: ['VENDA', 'LOCACAO'], description: 'Inclui os imóveis de venda e locação' },
          disponivel: { type: 'boolean', description: 'true: só os disponíveis (nem vendidos nem alugados, e ativos)' },
          situacao: { type: 'string', enum: ['DISPONIVEL', 'VENDIDO', 'ALUGADO'], description: 'Só os desta situação (ex.: VENDIDO para "quantos vendi")' },
          cidade: { type: 'string' },
          preco_min: { type: 'number' },
          preco_max: { type: 'number' },
          limit: { type: 'number', description: 'Máximo de itens (padrão 10, máximo 50)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_property_details',
      description: 'Detalhes de um imóvel específico, com os links dos anúncios e a página da Lotti',
      parameters: {
        type: 'object',
        properties: {
          property_id: { type: 'string', description: 'ID do imóvel, vindo de uma consulta ou dos registros citados' },
        },
        required: ['property_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_financial_summary',
      description:
        'Receitas, despesas e saldo de um período, com os mesmos números da tela Financeiro. ' +
        'period month = mês atual inteiro; quarter = os três últimos meses (o atual e os dois anteriores); year = ano atual. ' +
        'Para outro período, mande date_from e date_to. Separa o que já foi lançado até hoje do previsto.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['month', 'quarter', 'year'], description: 'Período da tela (padrão: month)' },
          date_from: { type: 'string', description: `${DIA}; com date_to, substitui period` },
          date_to: { type: 'string', description: `${DIA} (padrão: hoje)` },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_financial_entries',
      description: 'Listar lançamentos financeiros com filtros. Devolve total, as somas de receitas e despesas do filtro inteiro e a lista.',
      parameters: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['RECEITA', 'DESPESA'] },
          categoria: { type: 'string', enum: Object.keys(CATEGORIA_FINANCEIRA) },
          date_from: { type: 'string', description: DIA },
          date_to: { type: 'string', description: DIA },
          limit: { type: 'number', description: 'Máximo de itens (padrão 10, máximo 100)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_contracts',
      description:
        'Listar contratos. ativos=true são os ativos da tela Aluguéis. vence_em_dias: os que terminam de hoje até N dias; vencidos: os que já passaram do fim. ' +
        'Devolve total, a soma dos valores do filtro e a lista com o fim de cada contrato.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: STATUS_CONTRATO },
          ativos: { type: 'boolean' },
          vence_em_dias: { type: 'number', description: 'Ex.: 30' },
          vencidos: { type: 'boolean' },
          tipo: {
            type: 'string',
            enum: [...Object.keys(TIPO_CONTRATO), ...Object.keys(GRUPOS_CONTRATO)],
            description: 'LOCACAO = locação residencial e comercial; EXCLUSIVIDADE = exclusividade de venda e de locação',
          },
          client_id: { type: 'string' },
          limit: { type: 'number', description: 'Máximo de itens (padrão 10, máximo 50)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_alerts',
      description: 'Alertas não lidos. Devolve total, mostrando e a lista.',
      parameters: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['FOLLOWUP', 'DOCUMENTO', 'EXCLUSIVIDADE', 'GERAL', 'LEAD_QUENTE', 'PAGAMENTO', 'TRANSFERENCIA'] },
          prioridade: { type: 'string', enum: ['URGENTE', 'ALTA', 'MEDIA', 'BAIXA'] },
          limit: { type: 'number', description: 'Máximo de itens (padrão 10, máximo 50)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_funnel_stats',
      description:
        'Funil de Vendas (o kanban da tela Funil): negócios e valor por etapa e o resumo (em aberto, ganhos, perdidos, taxa de conversão). ' +
        'Com etapa, devolve também os negócios daquela etapa.',
      parameters: {
        type: 'object',
        properties: {
          etapa: { type: 'string', description: 'Nome da etapa (ex.: Visita agendada), para listar os negócios dela' },
          limit: { type: 'number', description: 'Com etapa: máximo de negócios (padrão 10, máximo 50)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_contact_history',
      description: 'Histórico de contatos de um cliente (ligações, mensagens de WhatsApp registradas, visitas...), do mais recente para o mais antigo',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'ID do cliente' },
          limit: { type: 'number', description: 'Máximo de itens (padrão 10, máximo 30)' },
        },
        required: ['client_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'suggest_action',
      description:
        'Propor uma ação de escrita para o usuário CONFIRMAR antes de executar. NUNCA execute direto. ' +
        'Use só quando o usuário pedir para criar/cadastrar/lançar/alterar algo — inclusive quando ele enviar um ' +
        'documento (o texto aparece em <external_data kind="uploaded_document">) e pedir para colocá-lo ' +
        "em uma aba da plataforma. Extraia os dados do documento e preencha 'params'.\n\n" +
        'Formato de params por action_type:\n' +
        "- create_client: { nome, telefone, tipo_interesse? ('COMPRA'|'LOCACAO'|'AMBOS') }\n" +
        "- update_client_status: { client_id, status ('QUALIFICACAO'|'VISITA_PROPOSTA'|'DOCUMENTACAO'|'FECHADO_GANHO'|'FECHADO_PERDIDO') }. " +
        'Muda só o status do cadastro (tela Clientes); não move negócio no Funil de Vendas, e não existe ação para isso.\n' +
        '- schedule_followup: { client_id, date (AAAA-MM-DD) }\n' +
        "- create_alert: { mensagem, tipo? ('FOLLOWUP'|'DOCUMENTO'|'EXCLUSIVIDADE'|'GERAL'), prioridade? ('ALTA'|'MEDIA'|'BAIXA') }\n" +
        "- register_contact: { client_id, tipo ('LIGACAO'|'EMAIL'|'WHATSAPP'|'VISITA'|'PROPOSTA'|'NOTA'), descricao }\n" +
        "- create_property (aba Imóveis): { titulo, tipo ('APARTAMENTO'|'CASA'|'COMERCIAL'|'TERRENO'), valor (número), " +
        'area_m2?, dormitorios?, garagem?, endereco, bairro, cidade, proprietario_nome? }\n' +
        "- create_financial_entry (aba Financeiro): { tipo ('RECEITA'|'DESPESA'), categoria (um dos códigos válidos), " +
        'descricao, valor (número), data (AAAA-MM-DD; use hoje de <agora> se não for dita), recorrente? (boolean) }\n\n' +
        `Categorias financeiras válidas (as da tela Financeiro) — DESPESA: ${CATEGORIAS_DESPESA.join(', ')}. ` +
        `RECEITA: ${CATEGORIAS_RECEITA.join(', ')}. Escolha a mais próxima do tipo; se incerto, use OUTROS.`,
      parameters: {
        type: 'object',
        properties: {
          action_type: {
            type: 'string',
            enum: [
              'create_client',
              'update_client_status',
              'schedule_followup',
              'create_alert',
              'register_contact',
              'create_property',
              'create_financial_entry',
            ],
          },
          params: {
            type: 'object',
            description: 'Parâmetros da ação (schema depende do action_type — veja a descrição da tool)',
          },
          description: {
            type: 'string',
            description:
              'Resumo para o usuário confirmar, só com nomes do negócio: nome do cliente (e o final do telefone se houver ' +
              'homônimo), valores em R$ e datas dd/mm/aaaa; nunca ID nem código interno (ex.: \'Mudar Maria Souza ' +
              '(final 4321) para Visita/Proposta\' ou \'Cadastrar imóvel "Apto Centro", R$ 320.000,00, 2 quartos, Rua X, Anápolis\').',
          },
        },
        required: ['action_type', 'params', 'description'],
      },
    },
  },
];

/** Nomes que cada modo oferece ao modelo. Chamada fora da lista não roda (defesa contra modelo que inventa). */
export const LEITURAS_ASSISTENTE = FERRAMENTAS_ASSISTENTE.map((f) => f.function.name).filter((n) => n !== 'suggest_action');

// ---------------------------------------------------------------- argumentos vindos do modelo

export function argTexto(args: Record<string, unknown>, chave: string, max = 160): string {
  const v = args[chave];
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export function argUuid(args: Record<string, unknown>, chave: string): string | null {
  const v = argTexto(args, chave, 36);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v) ? v : null;
}

export function limiteEntre(valor: unknown, padrao: number, maximo: number): number {
  const n = Number(valor);
  return Number.isInteger(n) ? Math.min(Math.max(n, 1), maximo) : padrao;
}

/** safePostgrestSearch: tira , % ( ) para o termo não virar curinga nem sintaxe. */
export function termoDeBusca(valor: unknown): string {
  if (typeof valor !== 'string') return '';
  return valor.trim().slice(0, 120).replace(/[,%()]/g, ' ');
}

/**
 * Palavras da busca (até 6), sem curinga nem pontuação. Cada palavra precisa aparecer em algum campo:
 * "Rua X, 120" acha "Rua X, 120", e "(62) 99999-0001" acha o telefone pelos dígitos.
 */
export function palavrasDeBusca(valor: unknown): string[] {
  return termoDeBusca(valor).replace(/[_\\]/g, ' ').split(/\s+/).map((p) => p.replace(/^[.\-:;!?"']+|[.\-:;!?"']+$/g, '')).filter(Boolean).slice(0, 6);
}

/**
 * Busca que é só um telefone ("+55 62 99999-0001", "5562999990001"): os dígitos, sem o 55 do país, para
 * comparar com o cadastro, que guarda o número sem o código do país. Outra busca: null.
 */
export function telefoneDaBusca(valor: unknown): string | null {
  if (typeof valor !== 'string' || !/^[0-9\s().+\-]+$/.test(valor.trim())) return null;
  let digitos = valor.replace(/[^0-9]/g, '');
  if (digitos.length < 8) return null;
  if (digitos.length > 11 && digitos.startsWith('55')) digitos = digitos.slice(2);
  return digitos;
}

/** Tipos de contrato do filtro: null = sem filtro; [] = valor que não existe (a consulta diz os válidos). */
export function tiposDeContrato(valor: unknown): string[] | null {
  const v = filtroTexto(valor)?.trim().toUpperCase();
  if (!v) return null;
  if (v in TIPO_CONTRATO) return [v];
  return GRUPOS_CONTRATO[v] ?? [];
}

/** Filtro opcional vindo do modelo: o PostgREST usava `if (args.x) .eq(...)`; só texto não vazio entra. */
export function filtroTexto(valor: unknown): string | null {
  if (valor === undefined || valor === null || valor === '' || valor === false || valor === 0) return null;
  return String(valor);
}

/** Número para gte/lte: `if (args.preco_min)` da função (0 é ignorado). */
export function filtroNumero(valor: unknown): number | null {
  if (!valor) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}
