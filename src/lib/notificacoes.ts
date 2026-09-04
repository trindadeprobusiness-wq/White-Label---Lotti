/**
 * Apresentação das notificações do sino.
 *
 * Lógica pura, separada do componente, porque o vitest deste projeto roda em
 * node sem jsdom — regra em função pura é regra testável.
 *
 * A fonte é a tabela `alertas`, que ganhou `origem`, `entidade_tipo`,
 * `entidade_id` e `metadata` na migration 20260817100000. Alertas antigos não
 * têm esses campos, e tudo aqui precisa continuar funcionando sem eles.
 */

export type TipoAlerta =
  | 'PAGAMENTO'
  | 'TRANSFERENCIA'
  | 'FOLLOWUP'
  | 'DOCUMENTO'
  | 'EXCLUSIVIDADE'
  | 'GERAL';

export type PrioridadeAlerta = 'ALTA' | 'MEDIA' | 'BAIXA';

export interface AlertaNotificacao {
  id: string;
  tipo: string | null;
  prioridade: string | null;
  mensagem: string;
  lido: boolean;
  created_at: string;
  origem?: string | null;
  entidade_tipo?: string | null;
  entidade_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Categorias do filtro do painel. */
export type CategoriaNotificacao = 'todas' | 'financeiro' | 'operacao';

/**
 * Financeiro = dinheiro que entrou ou saiu. É o que o corretor confere primeiro
 * e o que motivou a existência deste painel.
 */
export function ehFinanceiro(alerta: Pick<AlertaNotificacao, 'tipo' | 'origem'>): boolean {
  return (
    alerta.tipo === 'PAGAMENTO' ||
    alerta.tipo === 'TRANSFERENCIA' ||
    alerta.origem === 'asaas'
  );
}

export function filtrarPorCategoria(
  alertas: readonly AlertaNotificacao[],
  categoria: CategoriaNotificacao,
): AlertaNotificacao[] {
  if (categoria === 'todas') return [...alertas];
  if (categoria === 'financeiro') return alertas.filter(ehFinanceiro);
  return alertas.filter((a) => !ehFinanceiro(a));
}

/**
 * Ordena para leitura: não lidas primeiro, depois mais recentes.
 *
 * Ordenar só por data enterraria um repasse que falhou embaixo de avisos
 * novos e irrelevantes — e repasse falhado é justamente o que não pode passar
 * despercebido.
 */
export function ordenarNotificacoes(
  alertas: readonly AlertaNotificacao[],
): AlertaNotificacao[] {
  return [...alertas].sort((a, b) => {
    if (a.lido !== b.lido) return a.lido ? 1 : -1;
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    // Data inválida vai para o fim, em vez de virar NaN e embaralhar a lista.
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });
}

/** Destino ao clicar. Sem entidade, o alerta não leva a lugar nenhum. */
export function destinoDoAlerta(alerta: AlertaNotificacao): string | null {
  switch (alerta.entidade_tipo) {
    case 'fatura':
    case 'repasse':
      // As duas vivem na tela de Aluguéis; o id vai como âncora para a tela
      // poder destacar a linha correspondente.
      return alerta.entidade_id ? `/alugueis?destaque=${alerta.entidade_id}` : '/alugueis';
    case 'plano':
      // Aviso de cota. Leva direto para onde dá para resolver.
      return '/plano';
    case 'contrato':
      return '/juridico';
    case 'cliente':
      return alerta.entidade_id ? `/clientes/${alerta.entidade_id}` : '/clientes';
    case 'imovel':
      return alerta.entidade_id ? `/imoveis/${alerta.entidade_id}` : '/imoveis';
    default:
      return null;
  }
}

/**
 * Tempo relativo, curto. "há 3 h" cabe na largura do painel; data completa
 * não cabe e obriga o olho a processar número em vez de reconhecer recência.
 */
export function tempoRelativo(iso: string, agora = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';

  const seg = Math.floor((agora.getTime() - t) / 1000);
  if (seg < 0) return 'agora';
  if (seg < 60) return 'agora';
  if (seg < 3600) return `há ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `há ${Math.floor(seg / 3600)} h`;
  const dias = Math.floor(seg / 86400);
  if (dias === 1) return 'ontem';
  if (dias < 7) return `há ${dias} dias`;
  if (dias < 30) return `há ${Math.floor(dias / 7)} sem`;
  return new Date(t).toLocaleDateString('pt-BR');
}

export const ROTULO_TIPO: Record<string, string> = {
  PAGAMENTO: 'Recebimento',
  TRANSFERENCIA: 'Repasse',
  FOLLOWUP: 'Follow-up',
  DOCUMENTO: 'Documento',
  EXCLUSIVIDADE: 'Exclusividade',
  GERAL: 'Aviso',
};

/**
 * Tom visual. Prioridade ALTA sempre vence o tipo: um repasse que falhou é
 * ALTA e precisa ler como problema, mesmo sendo da mesma família de um
 * repasse confirmado.
 */
export function tomDoAlerta(
  alerta: Pick<AlertaNotificacao, 'tipo' | 'prioridade'>,
): 'success' | 'destructive' | 'warning' | 'info' | 'neutro' {
  if (alerta.prioridade === 'ALTA') return 'destructive';
  if (alerta.tipo === 'PAGAMENTO') return 'success';
  if (alerta.tipo === 'TRANSFERENCIA') return 'info';
  if (alerta.prioridade === 'MEDIA') return 'warning';
  return 'neutro';
}

/** Resumo para o badge do sino. */
export function contarNaoLidas(alertas: readonly AlertaNotificacao[]): {
  total: number;
  financeiro: number;
  criticas: number;
} {
  const naoLidas = alertas.filter((a) => !a.lido);
  return {
    total: naoLidas.length,
    financeiro: naoLidas.filter(ehFinanceiro).length,
    criticas: naoLidas.filter((a) => a.prioridade === 'ALTA').length,
  };
}

/**
 * Rótulo do badge numérico do sino.
 *
 * O sino do Asaas mostra o número, não um ponto: "3" e "1" pedem ações
 * diferentes do corretor, e o ponto colapsa os dois no mesmo sinal. Acima de
 * 99 o número deixa de informar e só quebra o círculo — vira "99+".
 */
export function rotuloContagem(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '';
  if (total > 99) return '99+';
  return String(Math.floor(total));
}

/**
 * Direção do dinheiro. Recebimento entra, repasse sai.
 *
 * Existe porque a primeira leitura de uma notificação financeira é o sinal,
 * não o texto: o corretor precisa saber num relance se aquilo aumentou ou
 * diminuiu o saldo dele.
 */
export function sinalDoAlerta(
  alerta: Pick<AlertaNotificacao, 'tipo' | 'prioridade'>,
): 'entrada' | 'saida' | null {
  if (alerta.tipo === 'PAGAMENTO') return 'entrada';
  if (alerta.tipo === 'TRANSFERENCIA') return 'saida';
  return null;
}

/**
 * Valor do alerta, quando o webhook gravou um.
 *
 * `metadata` é JSONB solto — o Asaas manda número, mas alerta antigo pode ter
 * string, e alerta não financeiro não tem nada. Devolver `null` em vez de
 * `NaN` é o que impede "R$ NaN" de chegar na tela.
 */
export function valorDoAlerta(alerta: AlertaNotificacao): number | null {
  const bruto = alerta.metadata?.valor;
  if (bruto === null || bruto === undefined) return null;
  const n = typeof bruto === 'string' ? Number(bruto.replace(',', '.')) : Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/**
 * O dinheiro chegou a se mover?
 *
 * Um repasse que falhou NÃO tirou nada da conta. Mostrar "− R$ 970,00" ao lado
 * de "NÃO foi concluído" diz o contrário do próprio texto do alerta, e o valor
 * é justamente a parte que o olho lê primeiro — o corretor concluiria que o
 * proprietário recebeu.
 *
 * O critério é a convenção do webhook: transferência só nasce com prioridade
 * ALTA no caminho de falha (`asaas-webhook/index.ts`, ramo FAILED/CANCELLED).
 * Recebimento nunca é ALTA.
 */
export function movimentouSaldo(
  alerta: Pick<AlertaNotificacao, 'tipo' | 'prioridade'>,
): boolean {
  return !(alerta.tipo === 'TRANSFERENCIA' && alerta.prioridade === 'ALTA');
}

/**
 * Agrupa por dia para os cabeçalhos "Hoje" / "Ontem" / data.
 *
 * O painel do Asaas separa assim, e o motivo é prático: sem a quebra, dez
 * linhas seguidas de "há 3 h" e "há 5 h" viram um bloco onde não dá para
 * distinguir o que é de hoje do que ficou pendente da semana passada.
 */
export function rotuloDoDia(iso: string, agora = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Sem data';

  const dia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((dia(agora) - dia(d)) / 86400000);

  if (diff <= 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  if (diff < 7) return 'Esta semana';
  if (diff < 30) return 'Este mês';
  return 'Mais antigas';
}

/**
 * Quebra a lista já ordenada em seções por dia, preservando a ordem recebida.
 *
 * Não reordena: `ordenarNotificacoes` já decidiu a ordem (não lidas primeiro),
 * e reordenar aqui desfaria isso silenciosamente.
 */
export function agruparPorDia(
  alertas: readonly AlertaNotificacao[],
  agora = new Date(),
): { rotulo: string; itens: AlertaNotificacao[] }[] {
  const grupos: { rotulo: string; itens: AlertaNotificacao[] }[] = [];
  for (const alerta of alertas) {
    const rotulo = rotuloDoDia(alerta.created_at, agora);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.rotulo === rotulo) ultimo.itens.push(alerta);
    else grupos.push({ rotulo, itens: [alerta] });
  }
  return grupos;
}
