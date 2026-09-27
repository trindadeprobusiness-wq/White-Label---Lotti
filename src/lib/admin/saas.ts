/**
 * Domínio das telas de operação do SaaS: assinaturas, pagamentos,
 * cancelamentos e repasses.
 *
 * Tudo aqui é função pura e constante — o vitest deste projeto roda em node,
 * sem jsdom, então regra que mora em JSX não é testável. Rótulo e cor ficam
 * juntos do domínio pela mesma razão que `comissao.ts` já faz: a tela não
 * inventa nome de status.
 */

// ── Assinaturas ────────────────────────────────────────────────────────────
export type StatusAssinatura =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'read_only';

export const ROTULO_ASSINATURA: Record<StatusAssinatura, string> = {
  trialing: 'Em teste',
  active: 'Ativa',
  past_due: 'Em atraso',
  canceled: 'Cancelada',
  expired: 'Expirada',
  read_only: 'Somente leitura',
};

export const COR_ASSINATURA: Record<StatusAssinatura, string> = {
  trialing: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  past_due: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  canceled: 'border-muted-foreground/30 bg-muted text-muted-foreground',
  expired: 'border-muted-foreground/30 bg-muted text-muted-foreground',
  read_only: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
};

/** Mesmo nome em todas as telas; valor desconhecido aparece cru em vez de sumir. */
export function rotuloAssinatura(status: string | null | undefined): string {
  if (!status) return 'Sem assinatura';
  return ROTULO_ASSINATURA[status as StatusAssinatura] ?? status;
}

// ── Conta e atividade ─────────────────────────────────────────────────────
// Status da conta (`corretores.status`) e atividade de uso são coisas
// diferentes: "inativo" existe nos dois e precisa de nomes distintos.
const ROTULO_STATUS_CONTA: Record<string, string> = {
  ativo: 'Ativa',
  suspenso: 'Suspensa',
  inativo: 'Desativada',
};

const ROTULO_ATIVIDADE: Record<string, string> = {
  ativo: 'Em uso',
  inativo: 'Sem uso recente',
  sem_dados: 'Sem dados',
};

export function rotuloStatusConta(status: string): string {
  return ROTULO_STATUS_CONTA[status] ?? status;
}

export function rotuloAtividade(atividade: string): string {
  return ROTULO_ATIVIDADE[atividade] ?? atividade;
}

// ── Pagamentos do checkout ────────────────────────────────────────────────
export type StatusPagamento =
  | 'creating'
  | 'awaiting_payment'
  | 'processing'
  | 'active'
  | 'failed'
  | 'overdue'
  | 'refunded';

/**
 * Os rótulos traduzem o status bruto do pedido para a linguagem do negócio.
 * O status cru continua disponível na linha para diagnóstico — normalizar sem
 * preservar o original impediria conferir contra o painel do gateway.
 */
export const ROTULO_PAGAMENTO: Record<StatusPagamento, string> = {
  creating: 'Iniciando',
  awaiting_payment: 'Aguardando pagamento',
  processing: 'Processando',
  active: 'Pago',
  failed: 'Falhou',
  overdue: 'Vencido',
  refunded: 'Estornado',
};

export const COR_PAGAMENTO: Record<StatusPagamento, string> = {
  creating: 'border-muted-foreground/30 bg-muted text-muted-foreground',
  awaiting_payment: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  processing: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
  overdue: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  refunded: 'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300',
};

export const ROTULO_METODO: Record<string, string> = {
  PIX: 'Pix',
  CREDIT_CARD: 'Cartão de crédito',
};

export const ROTULO_CICLO: Record<string, string> = {
  monthly: 'Mensal',
  annual: 'Anual',
};

// ── Cancelamento ───────────────────────────────────────────────────────────
export type MotivoCancelamento =
  | 'preco_alto'
  | 'pouco_uso'
  | 'dificuldade_implantacao'
  | 'faltam_funcionalidades'
  | 'faltam_integracoes'
  | 'problemas_tecnicos'
  | 'outra_solucao'
  | 'atendimento_ruim'
  | 'encerrou_operacao'
  | 'outro';

/** Ordem de exibição no formulário; espelha o CHECK da tabela. */
export const MOTIVOS: { valor: MotivoCancelamento; label: string }[] = [
  { valor: 'preco_alto', label: 'Preço alto' },
  { valor: 'pouco_uso', label: 'Não usou o suficiente' },
  { valor: 'dificuldade_implantacao', label: 'Dificuldade de implantação' },
  { valor: 'faltam_funcionalidades', label: 'Faltam funcionalidades' },
  { valor: 'faltam_integracoes', label: 'Faltam integrações' },
  { valor: 'problemas_tecnicos', label: 'Problemas técnicos / instabilidade' },
  { valor: 'outra_solucao', label: 'Encontrou outra solução' },
  { valor: 'atendimento_ruim', label: 'Atendimento ruim' },
  { valor: 'encerrou_operacao', label: 'Encerrou a operação imobiliária' },
  { valor: 'outro', label: 'Outro' },
];

export type OrigemCancelamento =
  | 'whatsapp'
  | 'suporte'
  | 'ligacao'
  | 'formulario'
  | 'sistema'
  | 'outro';

export const ORIGENS: { valor: OrigemCancelamento; label: string }[] = [
  { valor: 'whatsapp', label: 'WhatsApp' },
  { valor: 'suporte', label: 'Suporte' },
  { valor: 'ligacao', label: 'Ligação' },
  { valor: 'formulario', label: 'Formulário' },
  { valor: 'sistema', label: 'Sistema' },
  { valor: 'outro', label: 'Outro' },
];

export function rotuloMotivo(valor: string): string {
  return MOTIVOS.find((m) => m.valor === valor)?.label ?? valor;
}

export function rotuloOrigem(valor: string): string {
  return ORIGENS.find((o) => o.valor === valor)?.label ?? valor;
}

// ── Lotes de repasse ───────────────────────────────────────────────────────
export type StatusLote = 'rascunho' | 'exportado' | 'pago' | 'falhou' | 'cancelado';

export const ROTULO_LOTE: Record<StatusLote, string> = {
  rascunho: 'Rascunho',
  exportado: 'Exportado',
  pago: 'Pago',
  falhou: 'Falhou',
  cancelado: 'Cancelado',
};

export const COR_LOTE: Record<StatusLote, string> = {
  rascunho: 'border-muted-foreground/30 bg-muted text-muted-foreground',
  exportado: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  pago: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  falhou: 'border-destructive/30 bg-destructive/10 text-destructive',
  cancelado: 'border-muted-foreground/30 bg-muted text-muted-foreground',
};

export const TIPOS_CHAVE_PIX: { valor: string; label: string }[] = [
  { valor: 'cpf', label: 'CPF' },
  { valor: 'cnpj', label: 'CNPJ' },
  { valor: 'email', label: 'E-mail' },
  { valor: 'telefone', label: 'Telefone' },
  { valor: 'aleatoria', label: 'Chave aleatória' },
];

// ── Dinheiro ───────────────────────────────────────────────────────────────
/**
 * Soma valores em centavos inteiros.
 *
 * O Postgres devolve NUMERIC exato, mas ele chega aqui como `number` do JSON e
 * a partir daí `0.1 + 0.2 === 0.30000000000000004`. Com 40 parceiros num lote,
 * a soma exibida na tela e a soma do CSV divergiriam em centavos — e o critério
 * do repasse é que elas sejam idênticas.
 *
 * Trabalhar em centavos e converter uma vez no fim elimina o desvio.
 */
export function somarValores(valores: readonly number[]): number {
  const centavos = valores.reduce((acc, v) => {
    if (!Number.isFinite(v)) return acc;
    return acc + Math.round(v * 100);
  }, 0);
  return centavos / 100;
}

export interface ParceiroElegivel {
  parceiro_id: string;
  nome: string;
  email: string;
  documento: string | null;
  chave_pix: string | null;
  tipo_chave_pix: string | null;
  comissoes: number;
  valor: number;
  elegivel: boolean;
}

/**
 * Total dos parceiros selecionados.
 *
 * É a ÚNICA fonte do número, usada tanto pelo rodapé da tela quanto pela
 * conferência do CSV. Duas contas independentes para a mesma coisa é como se
 * cria a diferença de centavo que ninguém consegue explicar depois.
 */
export function totalSelecionado(
  itens: readonly ParceiroElegivel[],
  selecionados: ReadonlySet<string>,
): number {
  return somarValores(
    itens.filter((i) => selecionados.has(i.parceiro_id)).map((i) => i.valor),
  );
}

/** Quantos parceiros e quantas comissões o lote levaria. */
export function resumoSelecao(
  itens: readonly ParceiroElegivel[],
  selecionados: ReadonlySet<string>,
): { parceiros: number; comissoes: number; total: number } {
  const escolhidos = itens.filter((i) => selecionados.has(i.parceiro_id));
  return {
    parceiros: escolhidos.length,
    comissoes: escolhidos.reduce((acc, i) => acc + i.comissoes, 0),
    total: somarValores(escolhidos.map((i) => i.valor)),
  };
}

/**
 * Só entra em lote quem o servidor aceitaria: ativo, com PIX e acima do saldo
 * mínimo. A RPC repete a checagem — esta existe para a tela não oferecer uma
 * caixa de seleção que resultaria em erro.
 */
export function podeSelecionar(item: ParceiroElegivel): boolean {
  return item.elegivel && !!item.chave_pix && !!item.tipo_chave_pix;
}

/** Motivo pelo qual a linha está desabilitada, para a tela poder explicar. */
export function motivoInelegivel(
  item: ParceiroElegivel,
  saldoMinimo: number,
): string | null {
  if (!item.chave_pix || !item.tipo_chave_pix) return 'Sem chave PIX cadastrada';
  if (!item.elegivel) {
    return `Saldo abaixo do mínimo de ${saldoMinimo.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    })}`;
  }
  return null;
}
