export type TipoInteresse = 'COMPRA' | 'LOCACAO' | 'AMBOS';

export type StatusFunil = 
  | 'QUALIFICACAO' 
  | 'VISITA_PROPOSTA' 
  | 'DOCUMENTACAO' 
  | 'FECHADO_GANHO' 
  | 'FECHADO_PERDIDO';

export type TipoContato = 
  | 'LIGACAO' 
  | 'EMAIL' 
  | 'WHATSAPP' 
  | 'VISITA' 
  | 'PROPOSTA' 
  | 'NOTA';

export type TipoImovel = 
  | 'APARTAMENTO' 
  | 'CASA' 
  | 'COMERCIAL' 
  | 'TERRENO';

export type TipoContrato = 
  | 'COMPRA_VENDA' 
  | 'LOCACAO_RESIDENCIAL' 
  | 'LOCACAO_COMERCIAL' 
  | 'EXCLUSIVIDADE_VENDA' 
  | 'EXCLUSIVIDADE_LOCACAO' 
  | 'DISTRATO' 
  | 'PROCURACAO'
  | 'OUTRO';

export type PrioridadeAlerta = 'ALTA' | 'MEDIA' | 'BAIXA';

export interface Cliente {
  id: string;
  nome: string;
  telefone: string;
  email?: string;
  tipo_interesse: TipoInteresse;
  status_funil: StatusFunil;
  ultimo_contato: string;
  proximo_followup?: string;
  observacoes?: string;
  documentos: Documento[];
  imoveis_interesse: string[];
  created_at: string;
  tracking_data?: Record<string, any>;
}

export interface Imovel {
  id: string;
  titulo: string;
  tipo: TipoImovel;
  valor: number;
  area_m2: number;
  dormitorios: number;
  suites?: number;
  banheiros?: number;
  garagem: number;
  endereco: string;
  bairro: string;
  cidade: string;
  descricao?: string;
  exclusividade_ate?: string;
  finalidade?: 'VENDA' | 'LOCACAO' | 'AMBOS';
  proprietario_nome: string;
  proprietario_cpf?: string;
  proprietario_telefone?: string;
  clientes_interessados: string[];
  fotos?: string[];
  created_at: string;
  status_venda?: 'DISPONIVEL' | 'VENDIDO' | 'ALUGADO';
  tracking_data?: Record<string, any>;
  anunciado?: boolean;
}

export interface Documento {
  id: string;
  nome: string;
  tipo: string;
  arquivo_path?: string;
  arquivo_url?: string;
  cliente_id?: string;
  imovel_id?: string;
  corretor_id: string;
  validado: boolean;
  data_validade?: string;
  observacoes?: string;
  created_at: string;
  updated_at?: string;
}

export interface HistoricoContato {
  id: string;
  cliente_id: string;
  tipo: TipoContato;
  descricao: string;
  data: string;
  created_at: string;
}

export interface Alerta {
  id: string;
  mensagem: string;
  prioridade: PrioridadeAlerta;
  cliente_id?: string;
  imovel_id?: string;
  tipo: 'FOLLOWUP' | 'DOCUMENTO' | 'EXCLUSIVIDADE' | 'GERAL';
  lido: boolean;
  created_at: string;
}

export interface Contrato {
  id: string;
  tipo: TipoContrato;
  cliente_id: string;
  imovel_id: string;
  valor: number;
  data_inicio: string;
  prazo_meses?: number;
  dia_vencimento?: number;
  indice_reajuste?: string;
  clausulas_adicionais?: string[];
  conteudo: string;
  status: 'RASCUNHO' | 'FINALIZADO';
  created_at: string;
  // Campos de versionamento e IA
  versao?: number;
  modelo_ia?: string;
  tempo_geracao_ms?: number;
}

export const STATUS_FUNIL_LABELS: Record<StatusFunil, string> = {
  QUALIFICACAO: 'Qualificação',
  VISITA_PROPOSTA: 'Visita/Proposta',
  DOCUMENTACAO: 'Documentação',
  FECHADO_GANHO: 'Fechado Ganho',
  FECHADO_PERDIDO: 'Fechado Perdido',
};

export const TIPO_CONTATO_LABELS: Record<TipoContato, string> = {
  LIGACAO: 'Ligação',
  EMAIL: 'Email',
  WHATSAPP: 'WhatsApp',
  VISITA: 'Visita',
  PROPOSTA: 'Proposta',
  NOTA: 'Nota',
};

export const TIPO_CONTRATO_LABELS: Record<TipoContrato, string> = {
  COMPRA_VENDA: 'Compra e Venda',
  LOCACAO_RESIDENCIAL: 'Locação Residencial',
  LOCACAO_COMERCIAL: 'Locação Comercial',
  EXCLUSIVIDADE_VENDA: 'Exclusividade (Venda)',
  EXCLUSIVIDADE_LOCACAO: 'Exclusividade (Locação)',
  DISTRATO: 'Termo de Distrato',
  PROCURACAO: 'Procuração',
  OUTRO: 'Outro (Personalizado)',
};

// Configurações do Corretor
export interface Corretor {
  id: string;
  nome: string;
  creci: string;
  creci_estado: string;
  email: string;
  telefone: string;
  endereco?: string;
  website?: string;
  razao_social?: string;
  cnpj_cpf?: string;
  endereco_completo?: string;
  foto_url?: string;
}

export interface PreferenciasNotificacoes {
  followup_atrasado: boolean;
  exclusividade_vencendo: boolean;
  documento_vencendo: boolean;
  novo_cliente: boolean;
}

export type TemaAparencia = 'light' | 'dark' | 'system';
export type FormatoMoeda = 'completo' | 'abreviado';
export type OrdenacaoClientes = 'nome' | 'ultimo_contato' | 'created_at';

export interface Preferencias {
  notificacoes: PreferenciasNotificacoes;
  antecedencia_exclusividade_dias: number;
  antecedencia_documento_dias: number;
  tema: TemaAparencia;
  sidebar_expandida: boolean;
  formato_moeda: FormatoMoeda;
  ordenacao_clientes: OrdenacaoClientes;
}
