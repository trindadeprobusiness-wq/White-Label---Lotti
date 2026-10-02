import { describe, expect, it } from 'vitest';
import { MOTIVOS_CONHECIDOS, estadoDaIa, quandoAIaVolta, rotuloDaIa } from './estadoDaIa';

const AGORA = new Date('2026-10-02T14:41:00Z');
const daquiA = (horas: number) => new Date(AGORA.getTime() + horas * 3600000).toISOString();

describe('estado da IA na conversa', () => {
  it('modo ai sem pausa é IA ligada', () => {
    expect(estadoDaIa({ mode: 'ai' }, AGORA)).toEqual({ tipo: 'ligada' });
  });

  it('resposta pelo celular deixa a IA em espera, não ligada', () => {
    // É o caso que o corretor relatou: respondeu pelo aparelho, o interruptor
    // continuou dizendo "IA ligada" e ela não falava mais.
    const estado = estadoDaIa({ mode: 'ai', pausa_ia_ate: daquiA(23) }, AGORA);
    expect(estado.tipo).toBe('em-espera');
    expect(rotuloDaIa(estado)).toBe('IA em espera');
  });

  it('prazo vencido é IA ligada de novo, sem precisar de ninguém', () => {
    expect(estadoDaIa({ mode: 'ai', pausa_ia_ate: daquiA(-1) }, AGORA)).toEqual({ tipo: 'ligada' });
  });

  it('data inválida não trava a tela nem inventa espera', () => {
    expect(estadoDaIa({ mode: 'ai', pausa_ia_ate: 'não é data' }, AGORA)).toEqual({ tipo: 'ligada' });
  });

  it('desligada no modo humano, mesmo com pausa gravada', () => {
    // A pausa é um prazo da IA; com a conversa entregue à equipe, o que vale
    // é a entrega. Mostrar "em espera" sugeriria que ela voltaria sozinha.
    expect(estadoDaIa({ mode: 'human', pausa_ia_ate: daquiA(5) }, AGORA)).toEqual({ tipo: 'desligada' });
  });

  it('quem pediu para não receber mensagens vem antes de qualquer modo', () => {
    expect(estadoDaIa({ mode: 'ai', opted_out_at: '2026-09-30T10:00:00Z' }, AGORA)).toEqual({ tipo: 'bloqueada' });
  });
});

describe('quando a IA volta', () => {
  it('no mesmo dia, diz hoje', () => {
    expect(quandoAIaVolta(new Date('2026-10-02T20:30:00'), new Date('2026-10-02T11:41:00'))).toBe('hoje às 20:30');
  });

  it('no dia seguinte, diz amanhã', () => {
    // 24h depois de 11:41 cai no dia seguinte: "às 11:41" sozinho pareceria
    // daqui a pouco.
    expect(quandoAIaVolta(new Date('2026-10-03T11:41:00'), new Date('2026-10-02T11:41:00'))).toBe('amanhã às 11:41');
  });

  it('além de amanhã, mostra a data', () => {
    expect(quandoAIaVolta(new Date('2026-10-05T09:00:00'), new Date('2026-10-02T11:41:00'))).toBe('05/10 às 09:00');
  });

  it('conta dias de calendário, não períodos de 24 horas', () => {
    // 23h depois das 23:00 é amanhã de manhã, não "hoje".
    expect(quandoAIaVolta(new Date('2026-10-03T08:00:00'), new Date('2026-10-02T23:00:00'))).toBe('amanhã às 08:00');
  });
});

describe('motivos de parada', () => {
  it('cobre todo valor de last_error que o banco e a ponte sabem gravar', () => {
    // Quatro vêm das funções SQL; os dois últimos vêm do runtime da ponte, pela
    // RPC `fail` (runtime/server.mjs). Estes dois faltavam, e eram exatamente
    // os que apareciam quando a IA parava — com texto genérico, sem saída.
    for (const motivo of [
      'no_active_entitlement', 'quota_exhausted', 'processing_stalled', 'delivery_uncertain',
      'crm_capture_pending', 'qualification_failed', 'delivery_failed_or_uncertain',
    ]) expect(MOTIVOS_CONHECIDOS).toContain(motivo);
  });
});
