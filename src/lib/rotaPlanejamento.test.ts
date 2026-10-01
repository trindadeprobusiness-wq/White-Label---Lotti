import { describe, expect, it } from 'vitest';

import { destinoDoDesvioDaAgenda as destinoDoDesvio } from './rotaPlanejamento';

describe('desvio do endereço antigo da agenda', () => {
  it('leva para o novo nome', () => {
    expect(destinoDoDesvio('', '')).toBe('/planejamento');
  });

  it('preserva a query, que é por onde volta o consentimento do Google', () => {
    expect(destinoDoDesvio('?google_calendar=connected', ''))
      .toBe('/planejamento?google_calendar=connected');
    expect(destinoDoDesvio('?google_calendar=error', ''))
      .toBe('/planejamento?google_calendar=error');
  });

  it('preserva o fragmento, que é o que abre o painel do Google', () => {
    // O onboarding e as Configurações apontam para `#google-agenda`.
    expect(destinoDoDesvio('', '#google-agenda')).toBe('/planejamento#google-agenda');
  });

  it('preserva os dois juntos', () => {
    expect(destinoDoDesvio('?google_calendar=connected', '#google-agenda'))
      .toBe('/planejamento?google_calendar=connected#google-agenda');
  });
});
