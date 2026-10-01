import { describe, expect, it } from 'vitest';
import { resolverDestinoConfiguracoes } from './configuracoes';

describe('navegação das configurações', () => {
  it('leva links antigos da Agenda para o painel existente na Rotina', () => {
    expect(resolverDestinoConfiguracoes('agenda')).toEqual({
      tipo: 'redirecionar',
      destino: '/planejamento#google-agenda',
    });
  });

  it('mantém as abas válidas e usa Perfil para valores desconhecidos', () => {
    expect(resolverDestinoConfiguracoes('assinatura')).toEqual({ tipo: 'aba', aba: 'assinatura' });
    expect(resolverDestinoConfiguracoes('qualquer')).toEqual({ tipo: 'aba', aba: 'perfil' });
  });
});
