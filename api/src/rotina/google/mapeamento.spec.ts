import {
  activityFromGoogle, buildGoogleEventPayload, googleEventIdForRoutine, googleTimes, hasBidirectionalConflict, recurrenceFromGoogle,
} from './mapeamento';

// Mesmos casos de _shared/routine/calendar-mapping.deno.ts.
describe('mapeamento Google ↔ Lotti', () => {
  it('googleTimes: evento com hora e dia inteiro em America/Sao_Paulo', () => {
    const timed = googleTimes({
      id: 'g1',
      start: { dateTime: '2026-08-22T15:00:00-03:00', timeZone: 'America/Sao_Paulo' },
      end: { dateTime: '2026-08-22T16:00:00-03:00', timeZone: 'America/Sao_Paulo' },
    }, 'UTC');
    const allDay = googleTimes({ id: 'g2', start: { date: '2026-08-22' }, end: { date: '2026-08-23' } }, 'America/Sao_Paulo');
    expect(timed).toEqual({ startAt: '2026-08-22T18:00:00.000Z', endAt: '2026-08-22T19:00:00.000Z', allDay: false, timeZone: 'America/Sao_Paulo' });
    expect(allDay).toEqual({ startAt: '2026-08-22T03:00:00.000Z', endAt: '2026-08-23T03:00:00.000Z', allDay: true, timeZone: 'America/Sao_Paulo' });
    expect(googleTimes({ id: 'g3', start: {} }, 'UTC')).toBeNull();
  });

  it('activityFromGoogle', () => {
    expect(activityFromGoogle('Visita ao imóvel Florença')).toBe('visita_imovel');
    expect(activityFromGoogle('Vistoria final')).toBe('vistoria');
    expect(activityFromGoogle('Reunião')).toBe('reuniao');
    expect(activityFromGoogle('Assinatura')).toBe('assinatura_contrato');
    expect(activityFromGoogle('Ligação')).toBe('ligacao');
    expect(activityFromGoogle('Almoço')).toBe('outro');
    expect(activityFromGoogle()).toBe('outro');
  });

  it('googleEventIdForRoutine é determinístico', () => {
    expect(googleEventIdForRoutine('11111111-2222-4333-8444-555555555555')).toBe('lotti11111111222243338444555555555555');
  });

  it('hasBidirectionalConflict', () => {
    expect(hasBidirectionalConflict('2026-08-22T12:05:00Z', '2026-08-22T12:00:00Z', 4, 3)).toBe(true);
    expect(hasBidirectionalConflict('2026-08-22T11:55:00Z', '2026-08-22T12:00:00Z', 4, 3)).toBe(false);
    expect(hasBidirectionalConflict('2026-08-22T12:05:00Z', '2026-08-22T12:00:00Z', 3, 3)).toBe(false);
    expect(hasBidirectionalConflict(null, null, 4, 3)).toBe(false);
  });

  it('recurrenceFromGoogle', () => {
    expect(recurrenceFromGoogle(['EXDATE:x', 'RRULE:FREQ=DAILY'])).toBe('FREQ=DAILY');
    expect(recurrenceFromGoogle(undefined)).toBeNull();
  });

  const event = {
    id: '11111111-2222-4333-8444-555555555555', organization_id: 'org-1', title: 'Visita com Maria Silva',
    description: 'Telefone privado: 62999999999', activity_type: 'visita_imovel', location: 'Rua privada, 10', visibility: 'team',
    start_at: '2026-08-22T18:00:00.000Z', end_at: '2026-08-22T19:00:00.000Z', timezone: 'America/Sao_Paulo',
    recurrence_rule: 'FREQ=WEEKLY', source: 'lotti', sync_version: 3,
  };

  it('buildGoogleEventPayload full', () => {
    const p = buildGoogleEventPayload(event, 'full', null);
    expect(p.summary).toBe('Visita com Maria Silva');
    expect(p.description).toBe('Telefone privado: 62999999999');
    expect(p.location).toBe('Rua privada, 10');
    expect(p.start).toEqual({ dateTime: event.start_at, timeZone: 'America/Sao_Paulo' });
    expect(p.visibility).toBe('default');
  });

  it('buildGoogleEventPayload partial esconde dados pessoais', () => {
    const p = buildGoogleEventPayload(event, 'partial', 'Jardim Europa · São Paulo');
    expect(p.summary).toBe('Visita imobiliária — Jardim Europa · São Paulo');
    expect(p.description).toBeUndefined();
    expect(p.extendedProperties.private.lottiSyncVersion).toBe('3');
    expect(p.recurrence).toEqual(['RRULE:FREQ=WEEKLY']);
  });

  it('buildGoogleEventPayload busy_only não manda título, descrição nem endereço; dia inteiro usa date', () => {
    const p = buildGoogleEventPayload({ ...event, visibility: 'private', all_day: true }, 'busy_only', null);
    expect(p.summary).toBe('Ocupado');
    expect(p.description).toBeUndefined();
    expect(p.location).toBeUndefined();
    expect(p.visibility).toBe('private');
    expect(p.start).toEqual({ date: '2026-08-22' });
  });
});
