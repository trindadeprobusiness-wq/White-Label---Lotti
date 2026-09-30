import { describe, expect, it } from 'vitest';
import { contratosVencendo, fimDaVigencia, tempoDeEspera } from './inicio';

const emDias = (dias: number) => {
  const d = new Date('2026-06-15T12:00:00');
  d.setDate(d.getDate() + dias);
  return d;
};
const agora = new Date('2026-06-15T12:00:00');

describe('contratos que pedem atenção', () => {
  const contrato = (id: string, status: 'RASCUNHO' | 'FINALIZADO', inicioDias: number, prazo?: number) => ({
    id, status, data_inicio: emDias(inicioDias).toISOString(), prazo_meses: prazo,
  });

  it('lista os que vencem dentro da janela, do mais próximo ao mais distante', () => {
    const lista = [
      contrato('longe', 'FINALIZADO', -30, 12),   // vence daqui a ~11 meses
      contrato('perto', 'FINALIZADO', -350, 12),  // vence em poucos dias
      contrato('medio', 'FINALIZADO', -335, 12),
    ];

    expect(contratosVencendo(lista, agora).map((c) => c.id)).toEqual(['perto', 'medio']);
  });

  it('rascunho não vence porque não está valendo', () => {
    expect(contratosVencendo([contrato('r', 'RASCUNHO', -350, 12)], agora)).toEqual([]);
  });

  it('sem prazo não há vencimento a cobrar', () => {
    expect(contratosVencendo([contrato('sem', 'FINALIZADO', -350)], agora)).toEqual([]);
    expect(fimDaVigencia({ id: 'x', status: 'FINALIZADO', data_inicio: emDias(0).toISOString() })).toBeNull();
  });

  it('já vencido continua na lista — passou do prazo é o que mais pede ação', () => {
    const vencido = contrato('vencido', 'FINALIZADO', -400, 12);
    expect(contratosVencendo([vencido], agora).map((c) => c.id)).toEqual(['vencido']);
  });
});

describe('tempo de espera', () => {
  it('fala como quem atende', () => {
    expect(tempoDeEspera(new Date(agora.getTime() - 30_000).toISOString(), agora)).toBe('agora');
    expect(tempoDeEspera(new Date(agora.getTime() - 12 * 60_000).toISOString(), agora)).toBe('há 12 min');
    expect(tempoDeEspera(new Date(agora.getTime() - 3 * 3_600_000).toISOString(), agora)).toBe('há 3 h');
    expect(tempoDeEspera(new Date(agora.getTime() - 50 * 3_600_000).toISOString(), agora)).toBe('há 2 d');
  });

  it('não mostra número negativo quando a data está no futuro', () => {
    expect(tempoDeEspera(new Date(agora.getTime() + 60_000).toISOString(), agora)).toBe('agora');
  });

  it('sem data, nada a dizer', () => {
    expect(tempoDeEspera(null, agora)).toBe('');
    expect(tempoDeEspera('data-invalida', agora)).toBe('');
  });
});
