import type { EvidenciasAtivacao, ObjetivoOnboarding, PersonaOnboarding } from './regras';

export interface ContextoOnboarding {
  profileId: string;
  organizationId: string | null;
  persona: PersonaOnboarding | null;
  objetivo: ObjetivoOnboarding | null;
  etapaAtual: string;
  etapasConcluidas: string[];
  etapasPuladas: string[];
  concluidoEm: string | null;
  dispensadoEm: string | null;
  organizacao: {
    id: string;
    nome: string;
    nomeComercial: string | null;
    tipo: string;
  } | null;
  papel: string | null;
  userId: string | null;
  membros: Array<{ userId: string; nome: string; papel: string }>;
  assinatura: {
    status: string;
    plano: string;
    planoCodigo: string | null;
    trialTerminaEm: string | null;
  } | null;
  checklistMinimizado: boolean;
  checklistDispensadoEm: string | null;
  toursConcluidos: string[];
  toursDispensados: string[];
  metadata: Record<string, unknown>;
  evidencias: EvidenciasAtivacao;
}

export type ContextoOnboardingBruto = Record<string, unknown>;

export interface RespostaAjudaOnboarding {
  texto: string;
  acao?: { tipo: 'preencher_tarefa' | 'abrir_importacao' | 'navegar'; destino?: string };
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === 'object' && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : {};
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor : null;
}

function numero(valor: unknown): number {
  const convertido = Number(valor);
  return Number.isFinite(convertido) && convertido > 0 ? convertido : 0;
}

function booleano(valor: unknown): boolean {
  return valor === true;
}

function listaTexto(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((item): item is string => typeof item === 'string') : [];
}

export function normalizarContextoOnboarding(raw: ContextoOnboardingBruto): ContextoOnboarding {
  const profile = objeto(raw.profile);
  const progress = objeto(raw.progress);
  const evidence = objeto(raw.evidence);
  const organization = objeto(raw.organization);
  const membership = objeto(raw.membership);
  const members = Array.isArray(raw.members) ? raw.members.map(objeto) : [];
  const subscription = objeto(raw.subscription);
  const checklist = objeto(raw.checklist);
  const tours = Array.isArray(raw.tours) ? raw.tours.map(objeto) : [];
  const organizationId = texto(organization.id);
  const subscriptionStatus = texto(subscription.status);

  return {
    profileId: texto(profile.id) ?? '',
    organizationId: texto(profile.organization_id),
    persona: texto(profile.persona) as PersonaOnboarding | null,
    objetivo: texto(profile.primary_goal) as ObjetivoOnboarding | null,
    etapaAtual: texto(progress.current_step) ?? 'boas_vindas',
    etapasConcluidas: listaTexto(progress.completed_steps),
    etapasPuladas: listaTexto(progress.skipped_steps),
    concluidoEm: texto(progress.completed_at),
    dispensadoEm: texto(progress.dismissed_at),
    organizacao: organizationId
      ? {
          id: organizationId,
          nome: texto(organization.nome) ?? 'Minha operação',
          nomeComercial: texto(organization.nome_comercial),
          tipo: texto(organization.tipo_organizacao) ?? 'individual',
        }
      : null,
    papel: texto(membership.papel),
    userId: texto(membership.user_id),
    membros: members.flatMap((member) => {
      const userId = texto(member.user_id);
      if (!userId) return [];
      return [{
        userId,
        nome: texto(member.nome) ?? 'Membro da equipe',
        papel: texto(member.papel) ?? 'colaborador',
      }];
    }),
    assinatura: subscriptionStatus
      ? {
          status: subscriptionStatus,
          plano: texto(subscription.plan_name) ?? 'Plano atual',
          planoCodigo: texto(subscription.plan_code),
          trialTerminaEm: texto(subscription.trial_ends_at),
        }
      : null,
    checklistMinimizado: booleano(checklist.minimized),
    checklistDispensadoEm: texto(checklist.dismissed_at),
    toursConcluidos: tours.filter((tour) => texto(tour.completed_at)).map((tour) => texto(tour.tour_key)!).filter(Boolean),
    toursDispensados: tours.filter((tour) => texto(tour.dismissed_at)).map((tour) => texto(tour.tour_key)!).filter(Boolean),
    metadata: objeto(profile.metadata),
    evidencias: {
      perfilCompleto: booleano(evidence.perfil_completo),
      totalImoveisReais: numero(evidence.total_imoveis_reais),
      totalClientesReais: numero(evidence.total_clientes_reais),
      totalOportunidadesReais: numero(evidence.total_oportunidades_reais),
      totalTarefasReais: numero(evidence.total_tarefas_reais),
      calendarioConectado: booleano(evidence.calendario_conectado),
      whatsappConfigurado: booleano(evidence.whatsapp_configurado),
      totalConvites: numero(evidence.total_convites),
      iaUsada: booleano(evidence.ia_usada),
      totalRegistrosDemo: numero(evidence.total_registros_demo),
    },
  };
}

// Páginas que o próprio wizard oferece (conectar agenda, ver assinatura): mandar
// de volta ao onboarding transformaria esses botões num laço.
const ROTAS_LIBERADAS_NO_ONBOARDING = ['/onboarding', '/admin', '/planejamento', '/plano'];

export function deveAbrirOnboarding(contexto: ContextoOnboarding | null, pathname: string): boolean {
  if (!contexto?.profileId) return false;
  if (ROTAS_LIBERADAS_NO_ONBOARDING.some((rota) => pathname === rota || pathname.startsWith(`${rota}/`) || pathname.startsWith(`${rota}#`))) return false;
  return !contexto.concluidoEm && !contexto.dispensadoEm;
}

export function responderAjudaOnboarding(
  pergunta: string,
  contexto: { persona: PersonaOnboarding | null; etapa: string },
): RespostaAjudaOnboarding {
  const normalizada = pergunta.toLocaleLowerCase('pt-BR');

  if (/follow[- ]?up|retorno|ligar|amanh[ãa]|tarefa/.test(normalizada)) {
    return {
      texto: 'Eu preenchi uma sugestão de follow-up para amanhã. Revise o cliente, o horário e confirme para salvar — nenhuma ação é executada sem você.',
      acao: { tipo: 'preencher_tarefa' },
    };
  }

  if (/planilha|csv|xlsx|excel|import/.test(normalizada)) {
    return {
      texto: 'Você pode abrir a importação, mapear as colunas e revisar uma prévia antes de gravar. Linhas inválidas ficam separadas para correção; nada é importado silenciosamente.',
      acao: { tipo: 'abrir_importacao' },
    };
  }

  if (/im[oó]vel|an[uú]ncio/.test(normalizada)) {
    return {
      texto: 'Comece com tipo, finalidade, título, cidade, bairro e valor. Depois você completa fotos e detalhes sem travar este início.',
      acao: { tipo: 'navegar', destino: '/onboarding?etapa=primeiro_imovel' },
    };
  }

  if (/cliente|lead|instagram/.test(normalizada)) {
    return {
      texto: 'Cadastre ao menos um contato e o interesse. Em seguida, relacione um imóvel e crie a próxima ação para o lead não ficar parado.',
      acao: { tipo: 'navegar', destino: '/onboarding?etapa=primeiro_cliente' },
    };
  }

  if (/equipe|convid|corretor/.test(normalizada) && contexto.persona === 'gestor_imobiliaria') {
    return {
      texto: 'Na etapa de equipe, informe o e-mail e a função. O convite fica pendente para você compartilhar; a Lotti não envia nem aceita em nome da pessoa.',
      acao: { tipo: 'navegar', destino: '/onboarding?etapa=equipe' },
    };
  }

  const porEtapa: Record<string, string> = {
    boas_vindas: 'Vamos configurar só o essencial. Você pode sair, explorar a plataforma e continuar depois.',
    persona: 'Escolha o perfil que representa como você vai usar a Lotti; isso remove etapas que não fazem sentido para sua rotina.',
    perfil: 'Esses dados identificam sua atuação. O CRECI informado fica aguardando validação; a Lotti não o marca como validado automaticamente.',
    empresa: 'A empresa define a operação compartilhada. Corretores autônomos recebem uma organização individual sem precisar lidar com essa estrutura.',
    objetivo: 'Seu objetivo reorganiza o checklist e determina a primeira ação recomendada no painel.',
    entrada_dados: 'Use cadastro manual, importação revisada ou demonstração isolada. Dados de demonstração não entram nos indicadores reais.',
    primeira_oportunidade: 'A oportunidade une cliente, imóvel, etapa, valor e próxima ação. Depois de salva, ela aparece no funil real.',
  };

  return {
    texto: porEtapa[contexto.etapa]
      ?? 'Posso explicar esta etapa ou ajudar com imóvel, cliente, planilha, funil, equipe e follow-up.',
  };
}
