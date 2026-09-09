// ============================================================
// Lotti — Dados estáticos de exibição dos planos
// Preços e limites reais vêm do Supabase; aqui ficam apenas
// textos, ícones e listas de features para a UI.
// ============================================================

import {
  Building2,
  Crown,
  Rocket,
  Users,
  QrCode,
  Sparkles,
  MessageSquareText,
  HardDrive,
  Banknote,
  FileSignature,
  BarChart3,
  ShieldCheck,
  Headphones,
  type LucideIcon,
} from 'lucide-react';
import type { AddonDefinition } from '@/types/subscription';

// ── Informações visuais por plano ──
export interface PlanDisplayInfo {
  code: 'essencial' | 'profissional' | 'imobiliaria';
  icon: LucideIcon;
  audience: string;
  cta: string;
  features: string[];
  /** Features que NÃO estão incluídas (exibidas riscadas ou omitidas) */
  excluded?: string[];
}

export const plansDisplay: PlanDisplayInfo[] = [
  {
    code: 'essencial',
    icon: Rocket,
    audience: 'Corretor autônomo ou operação pequena',
    cta: 'Começar teste gratuito',
    features: [
      '100 leads atendidos pela IA / mês',
      'Qualificação e resumo do lead para o corretor',
      'Dashboard principal',
      'Cadastro de clientes e imóveis',
      'Funil de vendas Kanban',
      'Tarefas, lembretes e follow-ups',
      'Controle financeiro básico',
      'Mensagens personalizadas para WhatsApp',
      '10 contratos com IA / mês',
      '15 Fachadas Inteligentes',
      'Landing pages dos imóveis',
      'Tema claro e escuro',
      'Suporte padrão',
    ],
    excluded: [
      'Relatórios avançados',
      'Gestão de equipe',
    ],
  },
  {
    code: 'profissional',
    icon: Crown,
    audience: 'Equipes menores em crescimento',
    cta: 'Começar teste gratuito',
    features: [
      '250 leads atendidos pela IA / mês',
      'Qualificação e resumo do lead para o corretor',
      'Tudo do Inteligente, mais:',
      'Até 3 usuários',
      'Controle financeiro completo',
      'Gestão de comissões e projeção anual',
      'Gestão completa de aluguéis',
      'Integração com Asaas',
      '25 contratos com IA / mês',
      'Análise de contratos existentes',
      'Exportação PDF e DOCX',
      'Assistente de IA integrado ao CRM',
      '60 Fachadas Inteligentes',
      'Métricas detalhadas de Fachadas',
      'Relatórios comerciais e financeiros',
      'Automações e alertas',
      'Suporte prioritário',
    ],
  },
  {
    code: 'imobiliaria',
    icon: Building2,
    audience: 'Imobiliárias com operação maior',
    cta: 'Começar teste gratuito',
    features: [
      '600 leads atendidos pela IA / mês',
      'Qualificação e resumo do lead para o corretor',
      'Tudo do Profissional, mais:',
      'Até 10 usuários',
      'Imóveis ilimitados',
      'Gestão completa de equipe',
      'Perfis e permissões (admin, gestor, corretor)',
      'Distribuição de leads',
      'Indicadores por corretor e ranking',
      '40 contratos com IA / mês',
      'Fachadas Inteligentes sem limite',
      'Relatórios avançados com exportação',
      'Histórico de auditoria',
      'Atendimento prioritário',
      'Onboarding orientado',
      'Suporte prioritário',
    ],
  },
];

// ── Limites resumidos para os cards ──
export interface PlanLimit {
  icon: LucideIcon;
  label: string;
  essencial: string;
  profissional: string;
  imobiliaria: string;
}

export const planLimits: PlanLimit[] = [
  { icon: MessageSquareText, label: 'Leads atendidos pela IA / mês', essencial: '100', profissional: '250', imobiliaria: '600' },
  { icon: Users,             label: 'Usuários',                 essencial: '1',         profissional: '3',       imobiliaria: '10' },
  { icon: Building2,         label: 'Imóveis ativos',           essencial: '250',       profissional: '1.500',     imobiliaria: 'Ilimitado' },
  { icon: QrCode,            label: 'Fachadas Inteligentes',    essencial: '15',        profissional: '60',      imobiliaria: 'Ilimitado' },
  { icon: FileSignature,     label: 'Contratos com IA / mês',   essencial: '10',        profissional: '25',      imobiliaria: '40' },
  { icon: MessageSquareText, label: 'Assistente IA / mês',      essencial: '60',        profissional: '200',     imobiliaria: '500' },
  { icon: HardDrive,         label: 'Armazenamento',            essencial: '3 GB',      profissional: '15 GB',   imobiliaria: '50 GB' },
];

// ── Categorias para tabela comparativa ──
export interface ComparisonCategory {
  key: string;
  label: string;
  icon: LucideIcon;
}

export const comparisonCategories: ComparisonCategory[] = [
  { key: 'crm',         label: 'CRM e clientes',              icon: Users },
  { key: 'imoveis',     label: 'Imóveis e proprietários',     icon: Building2 },
  { key: 'fachadas',    label: 'Fachadas Inteligentes',        icon: QrCode },
  { key: 'contratos',   label: 'Contratos e documentos',       icon: FileSignature },
  { key: 'ia',          label: 'Inteligência artificial',       icon: Sparkles },
  { key: 'financeiro',  label: 'Financeiro',                    icon: Banknote },
  { key: 'alugueis',    label: 'Gestão de aluguéis',           icon: Banknote },
  { key: 'equipe',      label: 'Equipe e permissões',          icon: Users },
  { key: 'relatorios',  label: 'Relatórios',                    icon: BarChart3 },
  { key: 'midias',      label: 'Mídias',                        icon: HardDrive },
  { key: 'suporte',     label: 'Suporte',                       icon: Headphones },
];

// ── Adicionais ──
export const addonsCatalog: AddonDefinition[] = [
  {
    code: 'extra_user',
    name: 'Usuário adicional',
    description: 'Adicione mais corretores à sua conta.',
    price: 29,
    unit: '/mês',
    perUnit: 'por usuário',
  },
  {
    code: 'extra_fachadas_25',
    name: 'Pacote 25 Fachadas',
    description: '25 Fachadas Inteligentes adicionais.',
    price: 19,
    unit: '/mês',
    perUnit: 'por pacote',
  },
  {
    code: 'extra_ai_100',
    name: 'Pacote 100 operações de IA',
    description: '100 gerações ou análises de contratos + interações do assistente.',
    price: 29,
    unit: '/mês',
    perUnit: 'por pacote',
  },
  {
    code: 'extra_storage_50',
    name: '50 GB adicionais',
    description: 'Espaço extra para fotos, vídeos e documentos.',
    price: 19,
    unit: '/mês',
  },
  {
    code: 'whatsapp_api',
    name: 'WhatsApp API oficial',
    description: 'Conexão oficial com a API do WhatsApp Business. Custos da Meta/provedor à parte.',
    price: 49,
    unit: '/mês + custos Meta',
  },
  {
    code: 'migration_onboarding',
    name: 'Migração e onboarding assistido',
    description: 'A gente monta a sua conta com você. Importação de contratos, configuração completa.',
    price: 299,
    unit: 'único',
  },
];

// ── FAQ ──
export interface FAQItem {
  question: string;
  answer: string;
}

export const pricingFAQ: FAQItem[] = [
  {
    question: 'Preciso de cartão de crédito para testar?',
    answer: 'Não. O teste gratuito de 14 dias não pede cartão. Você escolhe o plano só quando decidir continuar.',
  },
  {
    question: 'O que acontece quando o teste termina?',
    answer: 'Seus dados ficam seguros em modo somente leitura por 7 dias. Nada é apagado. Basta escolher um plano para continuar usando.',
  },
  {
    question: 'Posso trocar de plano depois?',
    answer: 'Sim. Upgrade é imediato — os novos limites são liberados na hora. Downgrade vale a partir do próximo ciclo.',
  },
  {
    question: 'E se eu ultrapassar um limite?',
    answer: 'Seus dados existentes ficam intactos. Só novas operações naquele recurso são bloqueadas até você fazer upgrade ou contratar um adicional.',
  },
  {
    question: 'O plano anual tem desconto?',
    answer: 'Sim. São dois meses gratuitos: você paga 10 meses pelo preço de 12. Cerca de 16,7% de economia.',
  },
  {
    question: 'Os dados são meus?',
    answer: 'Totalmente. Seus clientes, imóveis, contratos e finanças pertencem a você. Oferecemos exportação a qualquer momento.',
  },
  {
    question: 'Como funciona a cobrança dos boletos pelo Asaas?',
    answer: 'A Lotti organiza as faturas e repasses. O processamento financeiro passa pelo Asaas, que é uma instituição regulada. As tarifas de boleto, Pix e cartão são as do próprio Asaas — não adicionamos margem escondida.',
  },
  {
    question: 'Posso cancelar quando quiser?',
    answer: 'Sim. O cancelamento é feito direto na plataforma, sem precisar ligar para ninguém. Você mantém acesso até o fim do período pago.',
  },
  {
    question: 'O que é a geração de mensagens para WhatsApp?',
    answer: 'É um gerador de texto pronto para copiar e enviar. Funciona sem API e está incluso em todos os planos. A integração com a API oficial do WhatsApp é um adicional separado porque envolve custos da Meta.',
  },
  {
    question: 'Qual é o preço de fundador?',
    answer: 'Os 100 primeiros clientes ganham até 20% de desconto por 12 meses. Depois disso, o valor passa para o preço oficial — avisamos com 30 dias de antecedência.',
  },
];

// ── Textos da página ──
export const pricingCopy = {
  title: 'Tudo o que sua operação imobiliária precisa em um só lugar',
  subtitle: 'Organize clientes, imóveis, contratos, finanças, aluguéis e oportunidades em uma plataforma criada para o mercado imobiliário.',
  trialBadge: 'Teste grátis por 14 dias — sem cartão de crédito',
  annualSaveBadge: 'Economize 2 meses',
  founderBadge: 'Preço especial de lançamento',
  highlightBadge: 'MAIS ESCOLHIDO',
  addonsTitle: 'Precisa de mais? Contrate adicionais.',
  addonsSubtitle: 'Expanda seu plano conforme a operação cresce.',
  faqTitle: 'Perguntas frequentes',
  ctaFinal: {
    title: 'Pronto para parar de operar e começar a gerir?',
    subtitle: 'Comece com 14 dias grátis. Sem cartão, sem compromisso.',
    cta: 'Começar teste gratuito',
  },
} as const;
