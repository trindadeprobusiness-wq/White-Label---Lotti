// ────────────────────────────────────────────────────────────
// Tipos da funcionalidade "Fachada Inteligente com QR Code"
// ────────────────────────────────────────────────────────────

export type TipoNegocio = 'VENDA' | 'ALUGUEL' | 'TEMPORADA' | 'LANCAMENTO';

export type CTAPrincipal =
  | 'AGENDAR_VISITA'
  | 'WHATSAPP'
  | 'SOLICITAR_INFO'
  | 'FAZER_PROPOSTA';

export type CategoriaTemplate =
  | 'VENDA'
  | 'ALUGUEL'
  | 'ALTO_PADRAO'
  | 'COMERCIAL'
  | 'RURAL'
  | 'LANCAMENTO';

export type FormatoDownload = 'PDF_A4' | 'PDF_A3' | 'BANNER_VERTICAL' | 'FAIXA_HORIZONTAL' | 'PLACA';

export const TIPO_NEGOCIO_LABELS: Record<TipoNegocio, string> = {
  VENDA: 'Venda',
  ALUGUEL: 'Aluguel',
  TEMPORADA: 'Temporada',
  LANCAMENTO: 'Lançamento',
};

export const CTA_LABELS: Record<CTAPrincipal, string> = {
  AGENDAR_VISITA: 'Agendar Visita',
  WHATSAPP: 'Falar no WhatsApp',
  SOLICITAR_INFO: 'Solicitar Informações',
  FAZER_PROPOSTA: 'Fazer Proposta',
};

export const CATEGORIA_TEMPLATE_LABELS: Record<CategoriaTemplate, string> = {
  VENDA: 'Venda',
  ALUGUEL: 'Aluguel',
  ALTO_PADRAO: 'Alto Padrão',
  COMERCIAL: 'Comercial',
  RURAL: 'Rural',
  LANCAMENTO: 'Lançamentos',
};

export interface Fachada {
  id: string;
  corretor_id: string;
  imovel_id: string;
  tipo_negocio: TipoNegocio;
  template_id: string;
  cta_principal: CTAPrincipal;
  modo_conversao: boolean;
  mensagem_whatsapp?: string;
  logo_url?: string;
  foto_principal_url?: string;
  ativo: boolean;
  total_escaneamentos: number;
  total_leads: number;
  created_at: string;
}

export interface FachadaComImovel extends Fachada {
  imovel?: {
    titulo: string;
    tipo: string;
    valor: number;
    area_m2: number | null;
    dormitorios: number | null;
    garagem: number | null;
    endereco: string;
    bairro: string | null;
    cidade: string;
    descricao: string | null;
  };
  corretor?: {
    nome: string;
    telefone: string;
    email: string;
    creci: string;
    foto_url: string | null;
    razao_social: string | null;
  };
}

export interface FachadaLead {
  id: string;
  fachada_id: string;
  nome: string;
  telefone: string;
  email?: string;
  convertido: boolean;
  cliente_id?: string;
  created_at: string;
}

export interface FachadaEscaneamento {
  id: string;
  fachada_id: string;
  created_at: string;
  user_agent?: string;
}

export interface FachadaTemplate {
  id: string;
  corretor_id?: string;
  nome: string;
  categoria: CategoriaTemplate;
  config: TemplateConfig;
  padrao: boolean;
  created_at: string;
}

export interface TemplateConfig {
  corPrimaria: string;
  corSecundaria: string;
  corTexto: string;
  corFundo: string;
  estilo: 'classico' | 'moderno' | 'luxo' | 'vibrante' | 'natural' | 'profissional';
  layout: 'vertical' | 'horizontal';
}

// Configurações padrão dos 6 templates
export const DEFAULT_TEMPLATES: Omit<FachadaTemplate, 'id' | 'corretor_id' | 'created_at'>[] = [
  {
    nome: 'Venda Clássica',
    categoria: 'VENDA',
    padrao: false,
    config: {
      corPrimaria: '#1e40af',
      corSecundaria: '#ffffff',
      corTexto: '#ffffff',
      corFundo: '#1e3a5f',
      estilo: 'classico',
      layout: 'vertical',
    },
  },
  {
    nome: 'Aluguel Moderno',
    categoria: 'ALUGUEL',
    padrao: false,
    config: {
      corPrimaria: '#059669',
      corSecundaria: '#6b7280',
      corTexto: '#ffffff',
      corFundo: '#064e3b',
      estilo: 'moderno',
      layout: 'vertical',
    },
  },
  {
    nome: 'Alto Padrão',
    categoria: 'ALTO_PADRAO',
    padrao: false,
    config: {
      corPrimaria: '#d4af37',
      corSecundaria: '#1a1a1a',
      corTexto: '#d4af37',
      corFundo: '#0a0a0a',
      estilo: 'luxo',
      layout: 'vertical',
    },
  },
  {
    nome: 'Comercial',
    categoria: 'COMERCIAL',
    padrao: false,
    config: {
      corPrimaria: '#1e3a5f',
      corSecundaria: '#f97316',
      corTexto: '#ffffff',
      corFundo: '#0f172a',
      estilo: 'profissional',
      layout: 'vertical',
    },
  },
  {
    nome: 'Rural',
    categoria: 'RURAL',
    padrao: false,
    config: {
      corPrimaria: '#166534',
      corSecundaria: '#d4a574',
      corTexto: '#ffffff',
      corFundo: '#14532d',
      estilo: 'natural',
      layout: 'vertical',
    },
  },
  {
    nome: 'Lançamento',
    categoria: 'LANCAMENTO',
    padrao: false,
    config: {
      corPrimaria: '#7c3aed',
      corSecundaria: '#ec4899',
      corTexto: '#ffffff',
      corFundo: '#1e1b4b',
      estilo: 'vibrante',
      layout: 'vertical',
    },
  },
  {
    nome: 'Oliver Premium',
    categoria: 'ALTO_PADRAO',
    padrao: true,
    config: {
      corPrimaria: '#d4af37', // Gold
      corSecundaria: '#1a1a1a', // Dark Gray
      corTexto: '#d4af37', // Gold text
      corFundo: '#000000', // Black
      estilo: 'luxo',
      layout: 'vertical',
    },
  },
];

// Métricas do dashboard
export interface FachadaMetricas {
  totalFachadas: number;
  totalEscaneamentos: number;
  totalLeads: number;
  taxaConversao: number;
  fachadasMaisAcessadas: { fachada_id: string; titulo: string; escaneamentos: number }[];
  leadsPorDia: { data: string; leads: number; escaneamentos: number }[];
}
