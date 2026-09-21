import type { RoutinePriority } from '@/types/routine';

export interface RoutineCategory {
  id: string;
  label: string;
  icon: string;
  color: string;
  surface: string;
  defaultMinutes: number;
  defaultPriority: RoutinePriority;
}

export const ROUTINE_CATEGORIES: RoutineCategory[] = [
  ['prospeccao', 'Prospecção', 'Search', '#2563EB', '#EFF6FF', 45, 'medium'],
  ['primeiro_atendimento', 'Primeiro atendimento', 'MessageCircle', '#0F766E', '#F0FDFA', 30, 'high'],
  ['follow_up', 'Follow-up', 'RefreshCw', '#7C3AED', '#F5F3FF', 30, 'high'],
  ['qualificacao_lead', 'Qualificação de lead', 'BadgeCheck', '#2563EB', '#EFF6FF', 30, 'high'],
  ['ligacao', 'Ligação', 'Phone', '#0284C7', '#F0F9FF', 20, 'medium'],
  ['reuniao', 'Reunião', 'Users', '#475569', '#F8FAFC', 60, 'medium'],
  ['visita_imovel', 'Visita ao imóvel', 'MapPin', '#B45309', '#FFFBEB', 60, 'high'],
  ['captacao_imovel', 'Captação de imóvel', 'Home', '#047857', '#ECFDF5', 90, 'high'],
  ['avaliacao', 'Avaliação', 'ClipboardCheck', '#0369A1', '#F0F9FF', 90, 'medium'],
  ['producao_midias', 'Produção de fotos e vídeos', 'Camera', '#BE185D', '#FDF2F8', 120, 'medium'],
  ['publicacao_anuncio', 'Publicação de anúncio', 'Megaphone', '#C2410C', '#FFF7ED', 45, 'medium'],
  ['envio_proposta', 'Envio de proposta', 'Send', '#6D28D9', '#F5F3FF', 30, 'high'],
  ['negociacao', 'Negociação', 'Handshake', '#7C2D12', '#FFF7ED', 60, 'high'],
  ['separacao_documentos', 'Separação de documentos', 'FolderOpen', '#475569', '#F8FAFC', 60, 'medium'],
  ['analise_juridica', 'Análise jurídica', 'Scale', '#7F1D1D', '#FEF2F2', 90, 'high'],
  ['assinatura_contrato', 'Assinatura de contrato', 'PenLine', '#166534', '#F0FDF4', 60, 'urgent'],
  ['vistoria', 'Vistoria', 'ScanLine', '#A16207', '#FEFCE8', 90, 'high'],
  ['entrega_chaves', 'Entrega de chaves', 'KeyRound', '#047857', '#ECFDF5', 45, 'high'],
  ['cobranca', 'Cobrança', 'ReceiptText', '#B91C1C', '#FEF2F2', 30, 'urgent'],
  ['pagamento', 'Pagamento', 'WalletCards', '#15803D', '#F0FDF4', 30, 'high'],
  ['renovacao_contratual', 'Renovação contratual', 'FileClock', '#9A3412', '#FFF7ED', 60, 'high'],
  ['manutencao', 'Manutenção', 'Wrench', '#52525B', '#FAFAFA', 60, 'high'],
  ['reuniao_interna', 'Reunião interna', 'BriefcaseBusiness', '#334155', '#F8FAFC', 45, 'medium'],
  ['tarefa_administrativa', 'Tarefa administrativa', 'ListTodo', '#64748B', '#F8FAFC', 30, 'medium'],
  ['compromisso_pessoal', 'Compromisso pessoal', 'Lock', '#9333EA', '#FAF5FF', 60, 'medium'],
  ['outro', 'Outro', 'CircleEllipsis', '#64748B', '#F8FAFC', 30, 'medium'],
].map(([id, label, icon, color, surface, defaultMinutes, defaultPriority]) => ({
  id: String(id),
  label: String(label),
  icon: String(icon),
  color: String(color),
  surface: String(surface),
  defaultMinutes: Number(defaultMinutes),
  defaultPriority: defaultPriority as RoutinePriority,
}));

export const ROUTINE_CATEGORY_BY_ID = Object.fromEntries(
  ROUTINE_CATEGORIES.map((category) => [category.id, category]),
) as Record<string, RoutineCategory>;

export function getRoutineCategory(id: string): RoutineCategory {
  return ROUTINE_CATEGORY_BY_ID[id] ?? ROUTINE_CATEGORY_BY_ID.outro;
}
