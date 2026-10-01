import { describe, expect, it } from 'vitest';
import { FILTROS_VAZIOS, aplicarFiltros, contarFiltros, type FiltrosFunil } from './filtros';
import type { CrmOportunidade } from './tipos';

const AGORA = new Date('2026-10-01T12:00:00Z');
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * 86_400_000).toISOString();

const negocio = (p: Partial<CrmOportunidade> = {}): CrmOportunidade => ({
  id: 'o1', corretor_id: 'c', cliente_id: null, imovel_id: null, etapa_id: 'e1',
  titulo: 'Negócio', valor_estimado: 0, probabilidade: 0,
  data_prevista_fechamento: null, motivo_perda: null, origem: null, ordem: 0,
  observacoes: null, fechada_em: null,
  created_at: diasAtras(90), updated_at: diasAtras(1), ...p,
});

const com = (f: Partial<FiltrosFunil>): FiltrosFunil => ({ ...FILTROS_VAZIOS, ...f });

describe('filtros do funil', () => {
  it('sem filtro ligado, devolve a mesma lista', () => {
    const lista = [negocio(), negocio({ id: 'o2' })];
    expect(aplicarFiltros(lista, FILTROS_VAZIOS, AGORA)).toBe(lista);
    expect(contarFiltros(FILTROS_VAZIOS)).toBe(0);
  });

  it('conta quantos filtros estão ligados, para o número no botão', () => {
    expect(contarFiltros(com({ periodo: '7d', atrasados: true }))).toBe(2);
    expect(contarFiltros(com({ comValor: true, comImovel: true, periodo: 'hoje' }))).toBe(3);
  });

  it('corta pela janela de atualização', () => {
    const lista = [
      negocio({ id: 'hoje', updated_at: diasAtras(0.2) }),
      negocio({ id: 'semana', updated_at: diasAtras(5) }),
      negocio({ id: 'velho', updated_at: diasAtras(45) }),
    ];
    const ids = (f: FiltrosFunil) => aplicarFiltros(lista, f, AGORA).map((o) => o.id);
    expect(ids(com({ periodo: 'hoje' }))).toEqual(['hoje']);
    expect(ids(com({ periodo: '7d' }))).toEqual(['hoje', 'semana']);
    expect(ids(com({ periodo: '30d' }))).toEqual(['hoje', 'semana']);
    // "Parado" é o inverso: serve para achar quem foi esquecido.
    expect(ids(com({ periodo: 'parado' }))).toEqual(['velho']);
  });

  it('atrasado é o que passou do prazo e continua aberto', () => {
    const lista = [
      negocio({ id: 'no-prazo', data_prevista_fechamento: diasAtras(-3) }),
      negocio({ id: 'estourou', data_prevista_fechamento: diasAtras(3) }),
      // Fechado fora do prazo não é pendência: já acabou.
      negocio({ id: 'fechado', data_prevista_fechamento: diasAtras(3), fechada_em: diasAtras(1) }),
      negocio({ id: 'sem-prazo' }),
    ];
    expect(aplicarFiltros(lista, com({ atrasados: true }), AGORA).map((o) => o.id)).toEqual(['estourou']);
  });

  it('filtra por valor e por imóvel vinculado', () => {
    const lista = [
      negocio({ id: 'nada' }),
      negocio({ id: 'so-valor', valor_estimado: 1850 }),
      negocio({ id: 'so-imovel', imovel_id: 'i1' }),
      negocio({ id: 'ambos', valor_estimado: 500, imovel_id: 'i2' }),
    ];
    expect(aplicarFiltros(lista, com({ comValor: true }), AGORA).map((o) => o.id)).toEqual(['so-valor', 'ambos']);
    expect(aplicarFiltros(lista, com({ comImovel: true }), AGORA).map((o) => o.id)).toEqual(['so-imovel', 'ambos']);
    // Dois filtros se somam, não se substituem.
    expect(aplicarFiltros(lista, com({ comValor: true, comImovel: true }), AGORA).map((o) => o.id)).toEqual(['ambos']);
  });

  it('data inválida não some do quadro', () => {
    // Sumir sem explicação é pior que aparecer fora da janela: o corretor
    // procuraria um negócio que a tela escondeu por causa de um dado torto.
    const lista = [negocio({ id: 'torto', updated_at: 'nao-e-data' })];
    expect(aplicarFiltros(lista, com({ periodo: 'hoje' }), AGORA).map((o) => o.id)).toEqual(['torto']);
  });
});
