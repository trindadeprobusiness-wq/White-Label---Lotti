import { STATUS_FUNIL_LABELS, TIPO_CONTATO_LABELS } from '@/types/crm';
import { CATEGORIA_LABELS } from '@/types/financeiro';
import type { AISuggestedAction } from '@/types/ai';

/** Cartão de ação do Assistente: o que vai ser gravado, com os rótulos e formatos das telas. */
const CAMPOS: Record<string, string> = {
  nome: 'Nome', telefone: 'Telefone', tipo_interesse: 'Interesse', status: 'Status', date: 'Data', data: 'Data',
  mensagem: 'Mensagem', tipo: 'Tipo', prioridade: 'Prioridade', descricao: 'Descrição', titulo: 'Título', valor: 'Valor',
  area_m2: 'Área (m²)', dormitorios: 'Quartos', garagem: 'Vagas', endereco: 'Endereço', bairro: 'Bairro', cidade: 'Cidade',
  proprietario_nome: 'Proprietário', categoria: 'Categoria', recorrente: 'Recorrente',
};

const CODIGOS: Record<string, string> = {
  ...STATUS_FUNIL_LABELS,
  ...CATEGORIA_LABELS,
  ...TIPO_CONTATO_LABELS,
  COMPRA: 'Compra', LOCACAO: 'Locação', AMBOS: 'Compra e locação',
  APARTAMENTO: 'Apartamento', CASA: 'Casa', COMERCIAL: 'Comercial', TERRENO: 'Terreno',
  RECEITA: 'Receita', DESPESA: 'Despesa', ALTA: 'Alta', MEDIA: 'Média', BAIXA: 'Baixa',
  // Tipos de alerta com os nomes do sino de Notificações.
  FOLLOWUP: 'Follow-up', DOCUMENTO: 'Documento', EXCLUSIVIDADE: 'Exclusividade', GERAL: 'Aviso',
};

/** Valor do jeito que a tela mostra: R$, dd/mm/aaaa, rótulo do código, Sim/Não. */
export function valorDoCampo(campo: string, valor: unknown): string {
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  if (typeof valor === 'number') {
    return campo === 'valor'
      ? valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : valor.toLocaleString('pt-BR');
  }
  const texto = String(valor ?? '');
  const dia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (dia) return `${dia[3]}/${dia[2]}/${dia[1]}`;
  return CODIGOS[texto] ?? texto;
}

/** O que vai ser gravado, campo a campo. IDs não aparecem: o cliente vem pelo nome. */
export function camposDaAcao(action: AISuggestedAction): Array<{ rotulo: string; valor: string }> {
  const linhas: Array<{ rotulo: string; valor: string }> = [];
  if (action.cliente_nome) linhas.push({ rotulo: 'Cliente', valor: action.cliente_nome });
  for (const [campo, valor] of Object.entries(action.params ?? {})) {
    if (campo.endsWith('_id') || valor === null || valor === undefined || valor === '') continue;
    linhas.push({ rotulo: CAMPOS[campo] ?? campo, valor: valorDoCampo(campo, valor) });
  }
  return linhas;
}
