// Definições das ferramentas do Assistente: cópia LITERAL de TOOLS em supabase/functions/ai-assistant/index.ts.
/* eslint-disable */

export const FERRAMENTAS_ASSISTENTE = [
  {
    type: 'function' as const,
    function: {
      name: 'search_clients',
      description: 'Buscar clientes no CRM por nome, status do funil ou tipo de interesse',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Termo de busca (nome, email, telefone)' },
          status_funil: {
            type: 'string',
            enum: ['QUALIFICACAO', 'VISITA_PROPOSTA', 'DOCUMENTACAO', 'FECHADO_GANHO', 'FECHADO_PERDIDO'],
          },
          tipo_interesse: { type: 'string', enum: ['COMPRA', 'LOCACAO', 'AMBOS'] },
          limit: { type: 'number', description: 'Máximo de resultados (padrão 10)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_client_details',
      description: 'Obter detalhes completos de um cliente específico, incluindo histórico de contatos',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'UUID do cliente' },
        },
        required: ['client_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_properties',
      description: 'Buscar imóveis por tipo, cidade, faixa de preço',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Termo de busca (título, endereço)' },
          tipo: { type: 'string', enum: ['APARTAMENTO', 'CASA', 'COMERCIAL', 'TERRENO'] },
          cidade: { type: 'string' },
          preco_min: { type: 'number' },
          preco_max: { type: 'number' },
          limit: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_property_details',
      description: 'Obter detalhes completos de um imóvel específico',
      parameters: {
        type: 'object',
        properties: {
          property_id: { type: 'string', description: 'UUID do imóvel' },
        },
        required: ['property_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_financial_summary',
      description: 'Obter resumo financeiro (receitas e despesas) por período',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['month', 'quarter', 'year'],
            description: 'Período (padrão: month)',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_financial_entries',
      description: 'Listar lançamentos financeiros com filtros',
      parameters: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['RECEITA', 'DESPESA'] },
          categoria: { type: 'string' },
          date_from: { type: 'string', description: 'Data início (YYYY-MM-DD)' },
          date_to: { type: 'string', description: 'Data fim (YYYY-MM-DD)' },
          limit: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_contracts',
      description: 'Listar contratos com filtros',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['RASCUNHO', 'FINALIZADO'] },
          tipo: { type: 'string' },
          client_id: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_alerts',
      description: 'Obter alertas pendentes',
      parameters: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['FOLLOWUP', 'DOCUMENTO', 'EXCLUSIVIDADE', 'GERAL'] },
          prioridade: { type: 'string', enum: ['ALTA', 'MEDIA', 'BAIXA'] },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_funnel_stats',
      description: 'Obter estatísticas do funil de vendas',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_contact_history',
      description: 'Obter histórico de contatos de um cliente',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'UUID do cliente' },
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
        'Use quando o usuário pedir para criar/cadastrar/lançar algo — inclusive quando ele enviar um ' +
        "documento (o texto do arquivo aparece em 'Contexto de Arquivo Enviado') e pedir para colocá-lo " +
        "em uma aba da plataforma. Extraia os dados do documento e preencha 'params'.\n\n" +
        'Formato de params por action_type:\n' +
        "- create_client: { nome, telefone, tipo_interesse? ('COMPRA'|'LOCACAO'|'AMBOS') }\n" +
        "- update_client_status: { client_id, status ('QUALIFICACAO'|'VISITA_PROPOSTA'|'DOCUMENTACAO'|'FECHADO_GANHO'|'FECHADO_PERDIDO') }\n" +
        '- schedule_followup: { client_id, date (YYYY-MM-DD) }\n' +
        "- create_alert: { mensagem, tipo? ('FOLLOWUP'|'DOCUMENTO'|'EXCLUSIVIDADE'|'GERAL'), prioridade? ('ALTA'|'MEDIA'|'BAIXA') }\n" +
        '- register_contact: { client_id, tipo, descricao }\n' +
        "- create_property (aba Imóveis): { titulo, tipo ('APARTAMENTO'|'CASA'|'COMERCIAL'|'TERRENO'), valor (número), " +
        'area_m2?, dormitorios?, garagem?, endereco, bairro, cidade, proprietario_nome? }\n' +
        "- create_financial_entry (aba Financeiro): { tipo ('RECEITA'|'DESPESA'), categoria (um dos códigos válidos), " +
        'descricao, valor (número), data? (YYYY-MM-DD, padrão hoje), recorrente? (boolean) }\n\n' +
        'Categorias financeiras válidas — DESPESA: ANUNCIO_PORTAL, ANUNCIO_SOCIAL, ANUNCIO_TRADICIONAL, ' +
        'OPERACIONAL_ESCRITORIO, OPERACIONAL_TRANSPORTE, OPERACIONAL_SISTEMA, IMPOSTO_ISS, IMPOSTO_IR, ' +
        'TAXA_BANCARIA, COMISSAO_PARCEIRO, OUTROS. RECEITA: COMISSAO_VENDA, COMISSAO_LOCACAO, ' +
        'TAXA_INTERMEDIACAO, HONORARIO_AVALIACAO, CONSULTORIA, OUTROS. Escolha a mais próxima; se incerto, use OUTROS.',
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
              'Resumo legível do que será feito, citando os dados-chave extraídos (ex.: \'Cadastrar imóvel ' +
              '"Apto Centro", R$ 320.000, 2 dorms, Rua X, Anápolis\'). Mostrado ao usuário para confirmação.',
          },
        },
        required: ['action_type', 'params', 'description'],
      },
    },
  },
];

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
