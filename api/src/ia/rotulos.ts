/**
 * Rótulos que as telas mostram para os códigos do banco. As consultas do Assistente já devolvem o rótulo,
 * para o modelo nunca precisar (nem poder) mostrar QUALIFICACAO ou COMISSAO_VENDA para a pessoa.
 * Mesmos textos de src/types/crm.ts e src/types/financeiro.ts.
 */
type Mapa = Readonly<Record<string, string>>;

export const STATUS_CLIENTE: Mapa = {
  QUALIFICACAO: 'Qualificação',
  VISITA_PROPOSTA: 'Visita/Proposta',
  DOCUMENTACAO: 'Documentação',
  FECHADO_GANHO: 'Fechado Ganho',
  FECHADO_PERDIDO: 'Fechado Perdido',
};

export const INTERESSE: Mapa = { COMPRA: 'Compra', LOCACAO: 'Locação', AMBOS: 'Compra e locação' };
export const FINALIDADE: Mapa = { VENDA: 'Venda', LOCACAO: 'Locação', AMBOS: 'Venda e locação' };
export const SITUACAO_IMOVEL: Mapa = { DISPONIVEL: 'Disponível', VENDIDO: 'Vendido', ALUGADO: 'Alugado' };
export const TIPO_IMOVEL: Mapa = { APARTAMENTO: 'Apartamento', CASA: 'Casa', COMERCIAL: 'Comercial', TERRENO: 'Terreno' };
export const TIPO_LANCAMENTO: Mapa = { RECEITA: 'Receita', DESPESA: 'Despesa' };

export const CATEGORIA_FINANCEIRA: Mapa = {
  ANUNCIO_PORTAL: 'Portais (ZAP, VivaReal, OLX)',
  ANUNCIO_SOCIAL: 'Redes Sociais (Meta, Google)',
  ANUNCIO_TRADICIONAL: 'Tradicional (Placas, Panfletos)',
  OPERACIONAL_ESCRITORIO: 'Escritório (Aluguel, Luz)',
  OPERACIONAL_TRANSPORTE: 'Transporte (Combustível)',
  OPERACIONAL_SISTEMA: 'Sistemas e Ferramentas',
  IMPOSTO_ISS: 'ISS',
  IMPOSTO_IR: 'Imposto de Renda',
  TAXA_BANCARIA: 'Tarifas Bancárias',
  COMISSAO_PARCEIRO: 'Comissão a Parceiros',
  COMISSAO_VENDA: 'Comissão de Venda',
  COMISSAO_LOCACAO: 'Comissão de Locação',
  TAXA_INTERMEDIACAO: 'Taxa de Intermediação',
  HONORARIO_AVALIACAO: 'Avaliação de Imóveis',
  CONSULTORIA: 'Consultoria',
  OUTROS: 'Outros',
  TAXA_ADMINISTRACAO: 'Taxa de Administração',
  TAXA_CONTRATO: 'Taxa de Contrato',
  SERVICOS: 'Serviços',
  MULTA_JUROS_RECEBIDOS: 'Multas / Juros Recebidos',
  OUTRAS_RECEITAS: 'Outras Receitas',
  MARKETING_ANUNCIO: 'Marketing e Anúncios',
  COMISSAO_CORRETOR: 'Comissão de Corretores',
  EQUIPE_PESSOAL: 'Equipe / Pessoal',
  CONTABILIDADE: 'Contabilidade',
  JURIDICO: 'Jurídico',
  ESCRITORIO: 'Escritório',
  TAXAS_GATEWAY: 'Taxas Asaas / Gateway',
  OUTRAS_DESPESAS: 'Outras Despesas',
  IMPOSTO_FATURAMENTO: 'Imposto sobre Faturamento',
  ESTORNO: 'Estorno',
  DESCONTO_CONCEDIDO: 'Desconto Concedido',
  RECEITA_FINANCEIRA: 'Receita Financeira',
  JUROS_PAGOS: 'Juros Pagos',
  TARIFA_BANCARIA: 'Tarifa Bancária',
};

/** Mesmas listas e ordem da tela Financeiro (CATEGORIAS_DESPESA e CATEGORIAS_RECEITA de src/types/financeiro.ts). */
export const CATEGORIAS_DESPESA = [
  'COMISSAO_CORRETOR', 'COMISSAO_PARCEIRO', 'TAXAS_GATEWAY', 'MARKETING_ANUNCIO', 'ANUNCIO_PORTAL', 'ANUNCIO_SOCIAL',
  'ANUNCIO_TRADICIONAL', 'EQUIPE_PESSOAL', 'OPERACIONAL_ESCRITORIO', 'ESCRITORIO', 'OPERACIONAL_SISTEMA', 'CONTABILIDADE',
  'JURIDICO', 'OPERACIONAL_TRANSPORTE', 'IMPOSTO_FATURAMENTO', 'ESTORNO', 'DESCONTO_CONCEDIDO', 'TAXA_BANCARIA',
  'TARIFA_BANCARIA', 'JUROS_PAGOS', 'IMPOSTO_ISS', 'IMPOSTO_IR', 'OUTRAS_DESPESAS', 'OUTROS',
] as const;
export const CATEGORIAS_RECEITA = [
  'COMISSAO_VENDA', 'COMISSAO_LOCACAO', 'TAXA_ADMINISTRACAO', 'TAXA_INTERMEDIACAO', 'TAXA_CONTRATO', 'HONORARIO_AVALIACAO',
  'CONSULTORIA', 'SERVICOS', 'MULTA_JUROS_RECEBIDOS', 'RECEITA_FINANCEIRA', 'OUTRAS_RECEITAS', 'OUTROS',
] as const;

/** Valores do enum tipo_contrato do banco (o "Outro (Personalizado)" da tela não existe no banco). */
export const TIPO_CONTRATO: Mapa = {
  COMPRA_VENDA: 'Compra e Venda',
  LOCACAO_RESIDENCIAL: 'Locação Residencial',
  LOCACAO_COMERCIAL: 'Locação Comercial',
  EXCLUSIVIDADE_VENDA: 'Exclusividade (Venda)',
  EXCLUSIVIDADE_LOCACAO: 'Exclusividade (Locação)',
  DISTRATO: 'Termo de Distrato',
  PROCURACAO: 'Procuração',
};

/** Os nomes do sino de Notificações (ROTULO_TIPO de src/lib/notificacoes.ts). */
export const TIPO_ALERTA: Mapa = {
  PAGAMENTO: 'Recebimento',
  TRANSFERENCIA: 'Repasse',
  FOLLOWUP: 'Follow-up',
  DOCUMENTO: 'Documento',
  EXCLUSIVIDADE: 'Exclusividade',
  GERAL: 'Aviso',
  LEAD_QUENTE: 'Lead quente',
};

export const PRIORIDADE: Mapa = { URGENTE: 'Urgente', ALTA: 'Alta', MEDIA: 'Média', BAIXA: 'Baixa' };
export const TIPO_ETAPA: Mapa = { ABERTA: 'Em aberto', GANHO: 'Ganho', PERDIDO: 'Perdido' };

/** Código sem rótulo conhecido vira texto legível (LOCACAO_RESIDENCIAL → "Locacao residencial"), nunca o código cru. */
export function rotulo(mapa: Mapa, valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const v = String(valor);
  if (mapa[v]) return mapa[v];
  const texto = v.replace(/_/g, ' ').toLowerCase();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
