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
  prioridadeDoAlerta,
  visitaPendente,
  ehFinanceiro,
  filtrarPorCategoria,
  ordenarNotificacoes,
  destinoDoAlerta,
  tempoRelativo,
  tomDoAlerta,
  contarNaoLidas,
  rotuloContagem,
  sinalDoAlerta,
  valorDoAlerta,
  movimentouSaldo,
  rotuloDoDia,
  agruparPorDia,
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

describe('rotuloContagem', () => {
  it('esconde o badge quando não há nada não lido', () => {
    expect(rotuloContagem(0)).toBe('');
    expect(rotuloContagem(-1)).toBe('');
  });

  it('mostra o número exato até 99', () => {
    expect(rotuloContagem(1)).toBe('1');
    expect(rotuloContagem(99)).toBe('99');
  });

  it('corta em 99+ para o círculo não deformar', () => {
    expect(rotuloContagem(100)).toBe('99+');
    expect(rotuloContagem(4321)).toBe('99+');
  });

  it('não quebra com valor inválido vindo de contagem assíncrona', () => {
    expect(rotuloContagem(NaN)).toBe('');
  });
});

describe('sinalDoAlerta', () => {
  it('recebimento entra, repasse sai', () => {
    expect(sinalDoAlerta({ tipo: 'PAGAMENTO', prioridade: 'MEDIA' })).toBe('entrada');
    expect(sinalDoAlerta({ tipo: 'TRANSFERENCIA', prioridade: 'MEDIA' })).toBe('saida');
  });

  it('repasse que falhou continua sendo saída de dinheiro', () => {
    // Prioridade ALTA muda a cor, não a direção — o dinheiro ainda era de saída.
    expect(sinalDoAlerta({ tipo: 'TRANSFERENCIA', prioridade: 'ALTA' })).toBe('saida');
  });

  it('alerta não financeiro não tem sinal', () => {
    expect(sinalDoAlerta({ tipo: 'FOLLOWUP', prioridade: 'BAIXA' })).toBeNull();
  });
});

describe('valorDoAlerta', () => {
  it('lê o valor gravado pelo webhook', () => {
    expect(valorDoAlerta(alerta({ metadata: { valor: 1840.5 } }))).toBe(1840.5);
  });

  it('aceita valor que veio como string', () => {
    expect(valorDoAlerta(alerta({ metadata: { valor: '2300.00' } }))).toBe(2300);
  });

  it('devolve null em vez de NaN — é isso que evita "R$ NaN" na tela', () => {
    expect(valorDoAlerta(alerta({ metadata: { valor: 'indisponível' } }))).toBeNull();
    expect(valorDoAlerta(alerta({ metadata: {} }))).toBeNull();
    expect(valorDoAlerta(alerta())).toBeNull();
  });

  it('zero é um valor legítimo, não ausência', () => {
    expect(valorDoAlerta(alerta({ metadata: { valor: 0 } }))).toBe(0);
  });
});

describe('rotuloDoDia', () => {
  const agora = new Date('2026-08-19T15:00:00');

  it('separa hoje, ontem e o resto', () => {
    expect(rotuloDoDia('2026-08-19T02:00:00', agora)).toBe('Hoje');
    expect(rotuloDoDia('2026-08-18T23:00:00', agora)).toBe('Ontem');
    expect(rotuloDoDia('2026-08-16T10:00:00', agora)).toBe('Esta semana');
    expect(rotuloDoDia('2026-08-01T10:00:00', agora)).toBe('Este mês');
    expect(rotuloDoDia('2026-05-01T10:00:00', agora)).toBe('Mais antigas');
  });

  it('compara por dia do calendário, não por 24 h corridas', () => {
    // 23h50 de ontem e 00h10 de hoje distam 20 minutos, mas são dias
    // diferentes — e é o dia que o corretor enxerga.
    expect(rotuloDoDia('2026-08-19T00:10:00', new Date('2026-08-19T00:30:00'))).toBe('Hoje');
    expect(rotuloDoDia('2026-08-18T23:50:00', new Date('2026-08-19T00:30:00'))).toBe('Ontem');
  });

  it('alerta com data futura (relógio do servidor adiantado) cai em Hoje', () => {
    expect(rotuloDoDia('2026-08-20T10:00:00', agora)).toBe('Hoje');
  });

  it('não quebra com data inválida', () => {
    expect(rotuloDoDia('', agora)).toBe('Sem data');
  });
});

describe('agruparPorDia', () => {
  const agora = new Date('2026-08-19T15:00:00');

  it('preserva a ordem recebida e não reordena por data', () => {
    const lista = [
      alerta({ id: 'nova-nao-lida', created_at: '2026-08-19T09:00:00', lido: false }),
      alerta({ id: 'antiga-nao-lida', created_at: '2026-08-10T09:00:00', lido: false }),
      alerta({ id: 'hoje-lida', created_at: '2026-08-19T08:00:00', lido: true }),
    ];
    const grupos = agruparPorDia(lista, agora);

    // "Hoje" aparece duas vezes porque a ordenação por não-lidas colocou uma
    // antiga no meio. Reordenar aqui desfaria a regra de leitura.
    expect(grupos.map((g) => g.rotulo)).toEqual(['Hoje', 'Este mês', 'Hoje']);
    expect(grupos[0].itens.map((a) => a.id)).toEqual(['nova-nao-lida']);
  });

  it('lista vazia não gera seção vazia', () => {
    expect(agruparPorDia([], agora)).toEqual([]);
  });
});

describe('movimentouSaldo', () => {
  it('repasse que falhou não tirou dinheiro da conta', () => {
    // O alerta diz "NÃO foi concluído". Um "− R$ 970,00" ao lado diria o
    // contrário, e o valor é a parte que o olho lê primeiro.
    expect(movimentouSaldo({ tipo: 'TRANSFERENCIA', prioridade: 'ALTA' })).toBe(false);
  });

  it('repasse confirmado e recebimento moveram o saldo', () => {
    expect(movimentouSaldo({ tipo: 'TRANSFERENCIA', prioridade: 'MEDIA' })).toBe(true);
    expect(movimentouSaldo({ tipo: 'PAGAMENTO', prioridade: 'MEDIA' })).toBe(true);
  });

  it('alerta operacional urgente não é tratado como falha de dinheiro', () => {
    // Contrato vencendo também é ALTA, e não tem valor nenhum envolvido.
    expect(movimentouSaldo({ tipo: 'GERAL', prioridade: 'ALTA' })).toBe(true);
  });
});

describe('alertas de visita', () => {
  const base = { id: 'a1', tipo: 'GERAL', prioridade: null, mensagem: 'x', lido: false, created_at: '2026-10-05T12:00:00Z' };

  it('prioridade vem de metadata quando a coluna não existe', () => {
    expect(prioridadeDoAlerta({ prioridade: null, metadata: { prioridade: 'ALTA' } })).toBe('ALTA');
    expect(prioridadeDoAlerta({ prioridade: 'MEDIA', metadata: { prioridade: 'ALTA' } })).toBe('MEDIA');
    expect(prioridadeDoAlerta({ prioridade: null, metadata: null })).toBeNull();
  });

  it('identifica visita pendente só quando não lida', () => {
    const visita = { ...base, metadata: { tipo: 'visita_conflito', visita_id: 'v1' } };
    expect(visitaPendente(visita)).toBe('v1');
    expect(visitaPendente({ ...visita, lido: true })).toBeNull();
    expect(visitaPendente({ ...base, metadata: { tipo: 'outro', visita_id: 'v1' } })).toBeNull();
  });

  it('alerta de visita fica vermelho', () => {
    expect(tomDoAlerta({ tipo: 'GERAL', prioridade: prioridadeDoAlerta({ prioridade: null, metadata: { prioridade: 'ALTA' } }) })).toBe('destructive');
  });
});
