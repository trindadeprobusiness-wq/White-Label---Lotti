export type PersonaOnboarding =
  | 'corretor_autonomo'
  | 'gestor_imobiliaria'
  | 'usuario_convidado'
  | 'profissional_administrativo';

export type ObjetivoOnboarding =
  | 'meus_leads'
  | 'meus_imoveis'
  | 'meu_funil'
  | 'minha_rotina'
  | 'minhas_locacoes'
  | 'meus_contratos'
  | 'minha_equipe'
  | 'todo_negocio';

export interface EvidenciasAtivacao {
  perfilCompleto: boolean;
  totalImoveisReais: number;
  totalClientesReais: number;
  totalOportunidadesReais: number;
  totalTarefasReais: number;
  calendarioConectado: boolean;
  whatsappConfigurado: boolean;
  totalConvites: number;
  iaUsada: boolean;
  totalRegistrosDemo?: number;
}

export interface ItemChecklist {
  chave:
    | 'perfil'
    | 'imovel'
    | 'cliente'
    | 'oportunidade'
    | 'followup'
    | 'calendario'
    | 'whatsapp'
    | 'equipe'
    | 'ia';
  titulo: string;
  concluido: boolean;
  rota: string;
}

const ETAPAS_POR_PERSONA: Record<PersonaOnboarding, string[]> = {
  corretor_autonomo: [
    'boas_vindas',
    'persona',
    'perfil',
    'objetivo',
    'entrada_dados',
    'primeiro_imovel',
    'primeiro_cliente',
    'primeira_oportunidade',
    'primeira_rotina',
    'conclusao',
  ],
  gestor_imobiliaria: [
    'boas_vindas',
    'persona',
    'perfil',
    'empresa',
    'objetivo',
    'entrada_dados',
    'primeiro_imovel',
    'primeiro_cliente',
    'primeira_oportunidade',
    'primeira_rotina',
    'equipe',
    'conclusao',
  ],
  usuario_convidado: [
    'boas_vindas',
    'persona',
    'aceitar_convite',
    'perfil',
    'objetivo',
    'conclusao',
  ],
  profissional_administrativo: [
    'boas_vindas',
    'persona',
    'perfil',
    'objetivo',
    'primeira_rotina',
    'conclusao',
  ],
};

export function etapasDaPersona(persona: PersonaOnboarding): string[] {
  return [...ETAPAS_POR_PERSONA[persona]];
}

export function calcularProgresso(
  total: number,
  concluidas: string[],
  puladas: string[],
): number {
  if (total <= 0) return 0;
  const resolvidas = new Set([...concluidas, ...puladas]).size;
  return Math.min(100, Math.round((resolvidas / total) * 100));
}

export function checklistDaAtivacao(e: EvidenciasAtivacao): ItemChecklist[] {
  return [
    { chave: 'perfil', titulo: 'Completar perfil profissional', concluido: e.perfilCompleto, rota: '/configuracoes' },
    { chave: 'imovel', titulo: 'Cadastrar primeiro imóvel', concluido: e.totalImoveisReais > 0, rota: '/imoveis' },
    { chave: 'cliente', titulo: 'Cadastrar primeiro cliente', concluido: e.totalClientesReais > 0, rota: '/clientes' },
    { chave: 'oportunidade', titulo: 'Criar oportunidade no funil', concluido: e.totalOportunidadesReais > 0, rota: '/crm' },
    { chave: 'followup', titulo: 'Agendar primeiro follow-up', concluido: e.totalTarefasReais > 0, rota: '/rotina' },
    { chave: 'calendario', titulo: 'Conectar Google Agenda', concluido: e.calendarioConectado, rota: '/rotina' },
    { chave: 'whatsapp', titulo: 'Configurar WhatsApp', concluido: e.whatsappConfigurado, rota: '/configuracoes' },
    { chave: 'equipe', titulo: 'Convidar alguém da equipe', concluido: e.totalConvites > 0, rota: '/onboarding?etapa=equipe' },
    { chave: 'ia', titulo: 'Conhecer o Assistente IA', concluido: e.iaUsada, rota: '/assistente' },
  ];
}

export function primeiroValorAtingido(e: EvidenciasAtivacao): boolean {
  return e.totalImoveisReais > 0
    && e.totalClientesReais > 0
    && e.totalOportunidadesReais > 0
    && e.totalTarefasReais > 0;
}

export function proximaMelhorAcao(
  objetivo: ObjetivoOnboarding | null,
  evidencias: EvidenciasAtivacao,
): ItemChecklist {
  const itens = checklistDaAtivacao(evidencias);
  const porChave = new Map(itens.map((item) => [item.chave, item]));
  const prioridadePorObjetivo: Partial<Record<ObjetivoOnboarding, ItemChecklist['chave'][]>> = {
    meus_imoveis: ['imovel', 'cliente', 'oportunidade', 'followup'],
    meus_leads: ['cliente', 'oportunidade', 'followup', 'imovel'],
    meu_funil: ['cliente', 'imovel', 'oportunidade', 'followup'],
    minha_rotina: ['followup', 'cliente', 'oportunidade', 'imovel'],
    minhas_locacoes: ['imovel', 'cliente', 'followup', 'oportunidade'],
    meus_contratos: ['cliente', 'imovel', 'oportunidade', 'followup'],
    minha_equipe: ['equipe', 'perfil', 'cliente', 'imovel'],
    todo_negocio: ['perfil', 'imovel', 'cliente', 'oportunidade', 'followup'],
  };
  const prioridade = objetivo ? prioridadePorObjetivo[objetivo] ?? [] : [];
  const ordem = [...prioridade, 'perfil', 'imovel', 'cliente', 'oportunidade', 'followup', 'ia'] as ItemChecklist['chave'][];

  for (const chave of ordem) {
    const item = porChave.get(chave);
    if (item && !item.concluido) return item;
  }

  return porChave.get('ia') ?? itens[0];
}
