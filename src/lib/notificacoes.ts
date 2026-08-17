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
