/**
 * A especificação escrita das regras de comissão.
 *
 * O caso que dá nome ao arquivo: alterar o percentual de um parceiro NÃO pode
 * mudar comissão já gerada. Sem versionamento por vigência, baixar de 10% para
 * 5% reescreveria retroativamente todo o histórico, e a conversa com o parceiro
 * viraria uma discussão sobre o passado.
 *
 * Estas regras existem em dois lugares — aqui e nas funções SQL
 * gerar_comissao_de_receita() / admin_transicionar_comissao(). Se um mudar sem
 * o outro, a interface passa a oferecer ações que o banco recusa.
 */
import { describe, it, expect } from 'vitest';
import {
  calcularComissao,
  percentualVigenteEm,
  transicaoValida,
  proximosStatus,
  exigeJustificativa,
  estornoAutomaticoPermitido,
  type RegraComissao,
} from './comissao';
import type { StatusComissao } from '@/integrations/supabase/admin-types';

const regra = (over: Partial<RegraComissao> = {}): RegraComissao => ({
  percentual: 10,
  base_calculo: 'receita_bruta',
  vigencia_inicio: '2026-01-01',
  vigencia_fim: null,
  ...over,
});

describe('calcularComissao', () => {
  it('aplica o percentual sobre a receita bruta', () => {
    const r = calcularComissao({ valorBruto: 1000 }, regra({ percentual: 10 }));
    expect(r.valorComissao).toBe(100);
    expect(r.valorBase).toBe(1000);
    expect(r.motivoSemComissao).toBeNull();
  });

  it('arredonda a centavos como o round(x,2) do Postgres', () => {
    // 149.90 * 7.5% = 11.2425 → 11.24. Sem arredondar igual ao banco, a tela
    // mostraria um valor e o extrato outro.
    const r = calcularComissao({ valorBruto: 149.9 }, regra({ percentual: 7.5 }));
    expect(r.valorComissao).toBe(11.24);
  });

  it('usa a receita líquida quando a base pede', () => {
    const r = calcularComissao(
      { valorBruto: 1000, valorLiquido: 900 },
      regra({ base_calculo: 'receita_liquida' }),
    );
    expect(r.valorBase).toBe(900);
    expect(r.valorComissao).toBe(90);
  });

  it('sem líquido informado, a base líquida cai para o bruto', () => {
    // Espelha o COALESCE do SQL. A alternativa seria gerar comissão zero em
    // silêncio, e o parceiro só descobrir no extrato.
    const r = calcularComissao(
      { valorBruto: 1000, valorLiquido: null },
      regra({ base_calculo: 'receita_liquida' }),
    );
    expect(r.valorBase).toBe(1000);
    expect(r.valorComissao).toBe(100);
  });

  it('valor fixo ignora o percentual', () => {
    const r = calcularComissao(
      { valorBruto: 1000 },
      regra({ base_calculo: 'valor_fixo', valor_fixo: 50, percentual: 10 }),
    );
    expect(r.valorComissao).toBe(50);
  });

  it('valor fixo sem valor definido não vira comissão zero silenciosa', () => {
    const r = calcularComissao(
      { valorBruto: 1000 },
      regra({ base_calculo: 'valor_fixo', valor_fixo: null }),
    );
    expect(r.valorComissao).toBe(0);
    expect(r.motivoSemComissao).toMatch(/valor fixo/i);
  });

  it('primeiro_pagamento remunera só a primeira receita', () => {
    const primeira = calcularComissao(
      { valorBruto: 1000, jaHouveReceitaAnterior: false },
      regra({ base_calculo: 'primeiro_pagamento' }),
    );
    expect(primeira.valorComissao).toBe(100);

    const recorrente = calcularComissao(
      { valorBruto: 1000, jaHouveReceitaAnterior: true },
      regra({ base_calculo: 'primeiro_pagamento' }),
    );
    expect(recorrente.valorComissao).toBe(0);
    expect(recorrente.motivoSemComissao).toMatch(/primeiro pagamento/i);
  });

  it('percentual zero é regra válida, não ausência de regra', () => {
    const r = calcularComissao({ valorBruto: 1000 }, regra({ percentual: 0 }));
    expect(r.valorComissao).toBe(0);
    expect(r.motivoSemComissao).toBeNull();
  });
});

describe('percentualVigenteEm', () => {
  // Parceiro entrou com 10%, renegociou para 5% a partir de 01/06.
  const historico: RegraComissao[] = [
    { percentual: 10, base_calculo: 'receita_bruta', vigencia_inicio: '2026-01-01', vigencia_fim: '2026-05-31' },
    { percentual: 5, base_calculo: 'receita_bruta', vigencia_inicio: '2026-06-01', vigencia_fim: null },
  ];

  it('receita de março usa os 10% que valiam em março', () => {
    expect(percentualVigenteEm(historico, '2026-03-15')?.percentual).toBe(10);
  });

  it('receita de agosto usa os 5% atuais', () => {
    expect(percentualVigenteEm(historico, '2026-08-14')?.percentual).toBe(5);
  });

  it('a mudança vale a partir do primeiro dia da nova vigência, inclusive', () => {
    expect(percentualVigenteEm(historico, '2026-05-31')?.percentual).toBe(10);
    expect(percentualVigenteEm(historico, '2026-06-01')?.percentual).toBe(5);
  });

  it('antes de qualquer vigência não há regra — não se inventa percentual', () => {
    expect(percentualVigenteEm(historico, '2025-12-31')).toBeNull();
  });

  it('histórico vazio devolve null', () => {
    expect(percentualVigenteEm([], '2026-08-14')).toBeNull();
  });

  it('com vigências sobrepostas, ganha a que começou mais tarde', () => {
    const sujo: RegraComissao[] = [
      { percentual: 10, base_calculo: 'receita_bruta', vigencia_inicio: '2026-01-01', vigencia_fim: null },
      { percentual: 5, base_calculo: 'receita_bruta', vigencia_inicio: '2026-06-01', vigencia_fim: null },
    ];
    expect(percentualVigenteEm(sujo, '2026-08-14')?.percentual).toBe(5);
  });
});

describe('alterar percentual não reescreve o passado', () => {
  it('a comissão de março continua 10% depois da renegociação para 5%', () => {
    // O teste central deste arquivo.
    const historico: RegraComissao[] = [
      { percentual: 10, base_calculo: 'receita_bruta', vigencia_inicio: '2026-01-01', vigencia_fim: '2026-05-31' },
      { percentual: 5, base_calculo: 'receita_bruta', vigencia_inicio: '2026-06-01', vigencia_fim: null },
    ];

    const marco = calcularComissao(
      { valorBruto: 1000 },
      percentualVigenteEm(historico, '2026-03-15')!,
    );
    const agosto = calcularComissao(
      { valorBruto: 1000 },
      percentualVigenteEm(historico, '2026-08-14')!,
    );

    expect(marco.valorComissao).toBe(100);
    expect(agosto.valorComissao).toBe(50);
  });
});

describe('transicaoValida', () => {
  it('segue o fluxo normal até o pagamento', () => {
    expect(transicaoValida('pendente', 'em_validacao')).toBe(true);
    expect(transicaoValida('em_validacao', 'aprovada')).toBe(true);
    expect(transicaoValida('aprovada', 'paga')).toBe(true);
    expect(transicaoValida('paga', 'estornada')).toBe(true);
  });

  it('permite aprovar direto, sem passar pela validação', () => {
    expect(transicaoValida('pendente', 'aprovada')).toBe(true);
  });

  it('não deixa pular a aprovação e pagar direto', () => {
    // Pagar sem aprovar contornaria a conferência — o único passo em que
    // alguém olha o valor antes do dinheiro sair.
    expect(transicaoValida('pendente', 'paga')).toBe(false);
    expect(transicaoValida('em_validacao', 'paga')).toBe(false);
  });

  it('não volta atrás', () => {
    expect(transicaoValida('aprovada', 'pendente')).toBe(false);
    expect(transicaoValida('paga', 'aprovada')).toBe(false);
  });

  it('cancelada e estornada são terminais', () => {
    // Um valor desfeito não volta à vida: registra-se um evento novo, e o
    // histórico do parceiro continua legível.
    const terminais: StatusComissao[] = ['cancelada', 'estornada'];
    const todos: StatusComissao[] = [
      'pendente', 'em_validacao', 'aprovada', 'paga', 'cancelada', 'estornada',
    ];
    for (const de of terminais) {
      for (const para of todos) {
        expect(transicaoValida(de, para)).toBe(false);
      }
      expect(proximosStatus(de)).toEqual([]);
    }
  });

  it('não permite transição para o mesmo status', () => {
    expect(transicaoValida('aprovada', 'aprovada')).toBe(false);
  });
});

describe('exigeJustificativa', () => {
  it('exige nas transições que retiram valor do parceiro', () => {
    expect(exigeJustificativa('cancelada')).toBe(true);
    expect(exigeJustificativa('estornada')).toBe(true);
  });

  it('não exige no caminho feliz', () => {
    expect(exigeJustificativa('aprovada')).toBe(false);
    expect(exigeJustificativa('paga')).toBe(false);
  });
});

describe('estornoAutomaticoPermitido', () => {
  it('comissão paga não é estornada automaticamente pelo estorno da receita', () => {
    // O dinheiro já saiu. Desfazer é decisão humana — acerto no próximo
    // pagamento —, não efeito colateral de uma trigger.
    expect(estornoAutomaticoPermitido('paga')).toBe(false);
  });

  it('as demais em aberto são estornadas junto com a receita', () => {
    expect(estornoAutomaticoPermitido('pendente')).toBe(true);
    expect(estornoAutomaticoPermitido('em_validacao')).toBe(true);
    expect(estornoAutomaticoPermitido('aprovada')).toBe(true);
  });
});
