import { describe, it, expect } from 'vitest';
import {
  agruparPorEtapa,
  moverOportunidade,
  totalPorEtapa,
  taxaConversao,
  tarefaAtrasada,
  normalizarLead,
} from './pipeline';
import type { CrmEtapa, CrmOportunidade } from './tipos';

const etapa = (id: string, ordem: number, tipo: CrmEtapa['tipo'] = 'ABERTA'): CrmEtapa => ({
  id, corretor_id: 'c1', nome: `Etapa ${ordem}`, ordem, cor: 'slate', tipo, ativo: true,
});

const oport = (id: string, etapa_id: string, valor = 0, ordem = 0): CrmOportunidade => ({
  id, corretor_id: 'c1', cliente_id: null, imovel_id: null, etapa_id,
  titulo: id, valor_estimado: valor, probabilidade: 0,
  data_prevista_fechamento: null, motivo_perda: null, origem: null,
  ordem, observacoes: null, fechada_em: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
});

describe('agruparPorEtapa', () => {
  const etapas = [etapa('e1', 1), etapa('e2', 2)];

  it('devolve uma coluna por etapa, na ordem configurada', () => {
    const cols = agruparPorEtapa(etapas, []);
    expect(cols.map((c) => c.etapa.id)).toEqual(['e1', 'e2']);
  });

  it('etapa sem oportunidade continua aparecendo (coluna vazia)', () => {
    const cols = agruparPorEtapa(etapas, [oport('o1', 'e1')]);
    expect(cols[1].oportunidades).toEqual([]);
  });

  it('respeita a ordem dentro da coluna', () => {
    const cols = agruparPorEtapa(etapas, [
      oport('b', 'e1', 0, 2),
      oport('a', 'e1', 0, 1),
    ]);
    expect(cols[0].oportunidades.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('ignora oportunidade de etapa inexistente em vez de quebrar', () => {
    const cols = agruparPorEtapa(etapas, [oport('orfa', 'e-sumiu')]);
    expect(cols.flatMap((c) => c.oportunidades)).toEqual([]);
  });

  it('não mostra etapa desativada', () => {
    const cols = agruparPorEtapa([...etapas, { ...etapa('e3', 3), ativo: false }], []);
    expect(cols.map((c) => c.etapa.id)).toEqual(['e1', 'e2']);
  });
});

describe('moverOportunidade', () => {
  const ops = [oport('a', 'e1', 0, 0), oport('b', 'e1', 0, 1), oport('c', 'e2', 0, 0)];

  it('move para outra etapa e renumera as duas colunas sem buraco', () => {
    const r = moverOportunidade(ops, 'a', 'e2', 0);
    expect(r.find((o) => o.id === 'a')!.etapa_id).toBe('e2');
    expect(r.filter((o) => o.etapa_id === 'e2').map((o) => o.ordem)).toEqual([0, 1]);
    expect(r.filter((o) => o.etapa_id === 'e1').map((o) => o.ordem)).toEqual([0]);
  });

  it('soltar na mesma posição não altera nada', () => {
    expect(moverOportunidade(ops, 'a', 'e1', 0)).toEqual(ops);
  });

  it('id inexistente devolve a lista intacta', () => {
    expect(moverOportunidade(ops, 'nao-existe', 'e2', 0)).toEqual(ops);
  });
});

describe('totalPorEtapa', () => {
  it('soma o valor estimado da coluna', () => {
    expect(totalPorEtapa([oport('a', 'e1', 1000), oport('b', 'e1', 500)])).toBe(1500);
  });
  it('coluna vazia soma zero', () => {
    expect(totalPorEtapa([])).toBe(0);
  });
});

describe('taxaConversao', () => {
  const etapas = [etapa('e1', 1), etapa('g', 8, 'GANHO'), etapa('p', 9, 'PERDIDO')];

  it('ganhos sobre encerrados — o negócio ainda aberto não entra na conta', () => {
    const ops = [oport('a', 'g'), oport('b', 'g'), oport('c', 'p'), oport('d', 'e1')];
    // 2 ganhos ÷ 3 encerrados = 67%. O 'd' segue aberto e é ignorado; contá-lo
    // afundaria a taxa (50%) sem que nada tivesse sido perdido.
    expect(taxaConversao(etapas, ops)).toBe(67);
  });

  it('sem nenhum negócio encerrado devolve 0, não NaN', () => {
    expect(taxaConversao(etapas, [oport('a', 'e1')])).toBe(0);
  });
});

describe('tarefaAtrasada', () => {
  const agora = new Date('2026-08-11T12:00:00Z');

  it('prazo no passado e não concluída', () => {
    expect(tarefaAtrasada({ data_prevista: '2026-08-10T12:00:00Z', concluida: false }, agora)).toBe(true);
  });
  it('concluída nunca está atrasada', () => {
    expect(tarefaAtrasada({ data_prevista: '2026-08-10T12:00:00Z', concluida: true }, agora)).toBe(false);
  });
  it('sem prazo não está atrasada', () => {
    expect(tarefaAtrasada({ data_prevista: null, concluida: false }, agora)).toBe(false);
  });
  it('prazo no futuro não está atrasada', () => {
    expect(tarefaAtrasada({ data_prevista: '2026-08-12T12:00:00Z', concluida: false }, agora)).toBe(false);
  });
});

describe('normalizarLead', () => {
  it('limpa espaços e normaliza o telefone', () => {
    expect(normalizarLead({ nome: '  Ana  Paula ', telefone: '5562999998888', email: ' A@B.COM ' }))
      .toEqual({ nome: 'Ana Paula', telefone: '(62) 99999-8888', email: 'a@b.com' });
  });

  it('email vazio vira null, não string vazia', () => {
    expect(normalizarLead({ nome: 'X', telefone: '62999998888', email: '   ' }).email).toBeNull();
  });

  it('telefone irrecuperável é preservado como veio, para o corretor corrigir', () => {
    expect(normalizarLead({ nome: 'X', telefone: 'sei lá' }).telefone).toBe('sei lá');
  });
});
