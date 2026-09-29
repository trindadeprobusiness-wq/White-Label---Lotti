import { normalizarTelefoneBR } from '@/lib/telefone';
import { formatarTelefone } from '@/lib/validators';
import type { CrmEtapa, CrmOportunidade, ColunaPipeline } from './tipos';

/**
 * Lógica de domínio do CRM — pura, sem rede e sem React.
 *
 * Fica separada da UI e da camada de dados justamente para ser testável: é aqui
 * que moram as regras que, se quebrarem, movem um negócio para a coluna errada
 * ou duplicam um lead.
 */

/** Monta as colunas do Kanban. Etapa sem negócio continua aparecendo, vazia. */
export function agruparPorEtapa(
  etapas: CrmEtapa[],
  oportunidades: CrmOportunidade[],
): ColunaPipeline[] {
  return etapas
    .filter((e) => e.ativo)
    .slice()
    .sort((a, b) => a.ordem - b.ordem)
    .map((etapa) => {
      const daEtapa = oportunidades
        .filter((o) => o.etapa_id === etapa.id)
        .sort((a, b) => a.ordem - b.ordem);
      return { etapa, oportunidades: daEtapa, total: totalPorEtapa(daEtapa) };
    });
}

/** Pesquisa local do quadro por negócio, cliente ou imóvel, sem alterar os dados. */
export function filtrarOportunidades<T extends CrmOportunidade & {
  clientes?: { nome?: string };
  imoveis?: { titulo?: string };
}>(oportunidades: T[], busca: string): T[] {
  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  if (!termo) return oportunidades;

  return oportunidades.filter((oportunidade) => [
    oportunidade.titulo,
    oportunidade.clientes?.nome,
    oportunidade.imoveis?.titulo,
  ].some((valor) => valor?.toLocaleLowerCase('pt-BR').includes(termo)));
}

/**
 * Move um negócio para outra etapa/posição e RENUMERA as colunas afetadas.
 * Renumerar evita buraco e empate em `ordem` — empate deixaria a coluna
 * embaralhando a cada carregamento, que é o defeito que já existe nas fotos.
 */
export function moverOportunidade(
  oportunidades: CrmOportunidade[],
  oportunidadeId: string,
  etapaDestino: string,
  posicaoDestino: number,
): CrmOportunidade[] {
  const alvo = oportunidades.find((o) => o.id === oportunidadeId);
  if (!alvo) return oportunidades;
  if (alvo.etapa_id === etapaDestino && alvo.ordem === posicaoDestino) return oportunidades;

  const naEtapa = (id: string) =>
    oportunidades
      .filter((o) => o.etapa_id === id && o.id !== oportunidadeId)
      .sort((a, b) => a.ordem - b.ordem);

  const destino = naEtapa(etapaDestino);
  destino.splice(Math.max(0, Math.min(posicaoDestino, destino.length)), 0, {
    ...alvo,
    etapa_id: etapaDestino,
  });

  const renumerados = new Map<string, CrmOportunidade>();
  destino.forEach((o, i) => renumerados.set(o.id, { ...o, ordem: i }));
  if (alvo.etapa_id !== etapaDestino) {
    naEtapa(alvo.etapa_id).forEach((o, i) => renumerados.set(o.id, { ...o, ordem: i }));
  }

  return oportunidades.map((o) => renumerados.get(o.id) ?? o);
}

export function totalPorEtapa(oportunidades: CrmOportunidade[]): number {
  return oportunidades.reduce((soma, o) => soma + (Number(o.valor_estimado) || 0), 0);
}

/**
 * Ganhos sobre negócios ENCERRADOS (ganhos + perdidos) — não sobre o total.
 * Contar os que ainda estão abertos afundaria a taxa sem significar nada.
 */
export function taxaConversao(etapas: CrmEtapa[], oportunidades: CrmOportunidade[]): number {
  const tipoDaEtapa = new Map(etapas.map((e) => [e.id, e.tipo]));
  let ganhos = 0;
  let encerrados = 0;
  for (const o of oportunidades) {
    const tipo = tipoDaEtapa.get(o.etapa_id);
    if (tipo === 'GANHO') { ganhos++; encerrados++; }
    else if (tipo === 'PERDIDO') { encerrados++; }
  }
  if (encerrados === 0) return 0; // sem encerrados a taxa não existe — 0, nunca NaN
  return Math.round((ganhos / encerrados) * 100);
}

export function tarefaAtrasada(
  tarefa: { data_prevista: string | null; concluida: boolean },
  agora: Date = new Date(),
): boolean {
  if (tarefa.concluida || !tarefa.data_prevista) return false;
  const prazo = new Date(tarefa.data_prevista);
  return !Number.isNaN(prazo.getTime()) && prazo < agora;
}

/** Limpa o lead antes de virar cliente. */
export function normalizarLead(lead: { nome: string; telefone: string; email?: string | null }) {
  const { digitos, formatado } = normalizarTelefoneBR(lead.telefone);
  const email = (lead.email ?? '').trim().toLowerCase();
  return {
    nome: lead.nome.replace(/\s+/g, ' ').trim(),
    // Irrecuperável fica como veio: descartar apagaria o único contato do lead,
    // e o corretor precisa ver o que foi digitado para corrigir.
    telefone: digitos ? formatado || formatarTelefone(digitos) : lead.telefone,
    email: email || null,
  };
}
