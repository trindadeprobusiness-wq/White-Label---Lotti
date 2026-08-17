/**
 * O caso que estes testes protegem: um repasse que FALHOU não pode ficar
 * enterrado embaixo de avisos novos e irrelevantes. É a notificação que
 * significa "o proprietário não recebeu" — e é justamente a que some se a
 * ordenação for só por data.
 *
 * Segundo caso: alertas anteriores à migration 20260817100000 não têm
 * `origem`, `entidade_tipo` nem `metadata`. Tudo aqui precisa funcionar com
 * eles, senão o painel quebra com o histórico que já existe no banco.
 */
import { describe, it, expect } from 'vitest';
import {
  ehFinanceiro,
  filtrarPorCategoria,
  ordenarNotificacoes,
  destinoDoAlerta,
  tempoRelativo,
  tomDoAlerta,
  contarNaoLidas,
  type AlertaNotificacao,
} from './notificacoes';

const alerta = (over: Partial<AlertaNotificacao> = {}): AlertaNotificacao => ({
  id: 'a1',
  tipo: 'GERAL',
  prioridade: 'MEDIA',
  mensagem: 'mensagem',
  lido: false,
  created_at: '2026-08-17T10:00:00Z',
  ...over,
});

describe('ehFinanceiro', () => {
  it('reconhece recebimento e repasse', () => {
    expect(ehFinanceiro({ tipo: 'PAGAMENTO', origem: 'asaas' })).toBe(true);
    expect(ehFinanceiro({ tipo: 'TRANSFERENCIA', origem: 'asaas' })).toBe(true);
  });

  it('reconhece pela origem, mesmo com tipo antigo', () => {
    // Alerta gravado pelo Asaas antes de existirem os tipos novos.
    expect(ehFinanceiro({ tipo: 'GERAL', origem: 'asaas' })).toBe(true);
  });

  it('não confunde alerta operacional com financeiro', () => {
    expect(ehFinanceiro({ tipo: 'FOLLOWUP', origem: 'sistema' })).toBe(false);
    expect(ehFinanceiro({ tipo: 'DOCUMENTO', origem: null })).toBe(false);
  });

  it('funciona com alerta antigo, sem origem', () => {
    expect(ehFinanceiro({ tipo: 'GERAL', origem: undefined })).toBe(false);
  });
});

describe('filtrarPorCategoria', () => {
  const lista = [
    alerta({ id: 'pag', tipo: 'PAGAMENTO', origem: 'asaas' }),
    alerta({ id: 'rep', tipo: 'TRANSFERENCIA', origem: 'asaas' }),
    alerta({ id: 'fup', tipo: 'FOLLOWUP', origem: 'sistema' }),
  ];

  it('separa financeiro de operação sem perder ninguém', () => {
    const fin = filtrarPorCategoria(lista, 'financeiro');
    const ope = filtrarPorCategoria(lista, 'operacao');
    expect(fin.map((a) => a.id)).toEqual(['pag', 'rep']);
    expect(ope.map((a) => a.id)).toEqual(['fup']);
    expect(fin.length + ope.length).toBe(lista.length);
  });

  it('"todas" devolve cópia, não a lista original', () => {
    const r = filtrarPorCategoria(lista, 'todas');
    r.pop();
    expect(lista).toHaveLength(3);
  });
});

describe('ordenarNotificacoes', () => {
  it('não lidas vêm antes das lidas, mesmo sendo mais antigas', () => {
    // O teste central. O repasse falhado é de ontem e não foi lido; o aviso
    // lido é de hoje. Ordenar só por data esconderia o problema.
    const r = ordenarNotificacoes([
      alerta({ id: 'lido-hoje', lido: true, created_at: '2026-08-17T12:00:00Z' }),
      alerta({ id: 'falha-ontem', lido: false, created_at: '2026-08-16T08:00:00Z' }),
    ]);
    expect(r[0].id).toBe('falha-ontem');
  });

  it('dentro do mesmo estado, mais recente primeiro', () => {
    const r = ordenarNotificacoes([
      alerta({ id: 'antiga', created_at: '2026-08-15T10:00:00Z' }),
      alerta({ id: 'nova', created_at: '2026-08-17T10:00:00Z' }),
    ]);
    expect(r.map((a) => a.id)).toEqual(['nova', 'antiga']);
  });

  it('data inválida vai para o fim em vez de embaralhar a lista', () => {
    const r = ordenarNotificacoes([
      alerta({ id: 'quebrada', created_at: 'nao-e-data' }),
      alerta({ id: 'ok', created_at: '2026-08-17T10:00:00Z' }),
    ]);
    expect(r[0].id).toBe('ok');
  });

  it('não altera o array recebido', () => {
    const orig = [
      alerta({ id: 'a', created_at: '2026-08-15T10:00:00Z' }),
      alerta({ id: 'b', created_at: '2026-08-17T10:00:00Z' }),
    ];
    ordenarNotificacoes(orig);
    expect(orig.map((a) => a.id)).toEqual(['a', 'b']);
  });
});

describe('destinoDoAlerta', () => {
  it('repasse e fatura levam a Aluguéis com o id em destaque', () => {
    expect(destinoDoAlerta(alerta({ entidade_tipo: 'repasse', entidade_id: 'r1' })))
      .toBe('/alugueis?destaque=r1');
    expect(destinoDoAlerta(alerta({ entidade_tipo: 'fatura', entidade_id: 'f1' })))
      .toBe('/alugueis?destaque=f1');
  });

  it('cliente e imóvel vão para o detalhe', () => {
    expect(destinoDoAlerta(alerta({ entidade_tipo: 'cliente', entidade_id: 'c1' })))
      .toBe('/clientes/c1');
    expect(destinoDoAlerta(alerta({ entidade_tipo: 'imovel', entidade_id: 'i1' })))
      .toBe('/imoveis/i1');
  });

  it('sem entidade não vira link', () => {
    // Alerta antigo. Precisa aparecer no painel, mas sem clique morto.
    expect(destinoDoAlerta(alerta())).toBeNull();
    expect(destinoDoAlerta(alerta({ entidade_tipo: null }))).toBeNull();
  });

  it('entidade sem id cai na listagem, não numa URL quebrada', () => {
    expect(destinoDoAlerta(alerta({ entidade_tipo: 'repasse', entidade_id: null })))
      .toBe('/alugueis');
  });
});

describe('tempoRelativo', () => {
  const agora = new Date('2026-08-17T12:00:00Z');

  it('cobre a escala de minutos a semanas', () => {
    expect(tempoRelativo('2026-08-17T11:59:30Z', agora)).toBe('agora');
    expect(tempoRelativo('2026-08-17T11:30:00Z', agora)).toBe('há 30 min');
    expect(tempoRelativo('2026-08-17T09:00:00Z', agora)).toBe('há 3 h');
    expect(tempoRelativo('2026-08-16T10:00:00Z', agora)).toBe('ontem');
    expect(tempoRelativo('2026-08-14T10:00:00Z', agora)).toBe('há 3 dias');
    expect(tempoRelativo('2026-08-05T10:00:00Z', agora)).toBe('há 1 sem');
  });

  it('acima de 30 dias mostra a data', () => {
    expect(tempoRelativo('2026-06-01T10:00:00Z', agora)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('data futura não vira "há -5 min"', () => {
    // Relógio do servidor adiantado em relação ao do navegador acontece.
    expect(tempoRelativo('2026-08-17T12:05:00Z', agora)).toBe('agora');
  });

  it('data inválida devolve string vazia, não "Invalid Date"', () => {
    expect(tempoRelativo('nao-e-data', agora)).toBe('');
  });
});

describe('tomDoAlerta', () => {
  it('prioridade ALTA vence o tipo', () => {
    // Repasse confirmado e repasse falhado são ambos TRANSFERENCIA. O que os
    // separa visualmente é a prioridade — sem isso, uma falha leria como
    // informação neutra.
    expect(tomDoAlerta({ tipo: 'TRANSFERENCIA', prioridade: 'ALTA' })).toBe('destructive');
    expect(tomDoAlerta({ tipo: 'TRANSFERENCIA', prioridade: 'MEDIA' })).toBe('info');
  });

  it('recebimento lê como positivo', () => {
    expect(tomDoAlerta({ tipo: 'PAGAMENTO', prioridade: 'MEDIA' })).toBe('success');
  });

  it('alerta antigo sem prioridade não quebra', () => {
    expect(tomDoAlerta({ tipo: 'GERAL', prioridade: null })).toBe('neutro');
  });
});

describe('contarNaoLidas', () => {
  it('conta total, financeiro e críticas separadamente', () => {
    const r = contarNaoLidas([
      alerta({ id: '1', tipo: 'PAGAMENTO', origem: 'asaas', lido: false }),
      alerta({ id: '2', tipo: 'TRANSFERENCIA', origem: 'asaas', lido: false, prioridade: 'ALTA' }),
      alerta({ id: '3', tipo: 'FOLLOWUP', lido: false }),
      alerta({ id: '4', tipo: 'PAGAMENTO', origem: 'asaas', lido: true }),
    ]);
    expect(r).toEqual({ total: 3, financeiro: 2, criticas: 1 });
  });

  it('lista vazia devolve zeros, não NaN', () => {
    expect(contarNaoLidas([])).toEqual({ total: 0, financeiro: 0, criticas: 0 });
  });
});
