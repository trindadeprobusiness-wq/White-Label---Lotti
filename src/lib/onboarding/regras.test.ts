import { describe, expect, it } from 'vitest';
import {
  calcularProgresso,
  checklistDaAtivacao,
  etapasDaPersona,
  primeiroValorAtingido,
  proximaMelhorAcao,
} from './regras';

describe('regras do onboarding', () => {
  it('não obriga corretor autônomo a configurar equipe ou empresa', () => {
    expect(etapasDaPersona('corretor_autonomo')).toEqual([
      'boas_vindas',
      'persona',
      'perfil',
      'objetivo',
      'asaas',
      'entrada_dados',
      'primeiro_imovel',
      'primeiro_cliente',
      'primeira_oportunidade',
      'primeira_rotina',
      'conclusao',
    ]);
  });

  it('leva convidado por aceite e perfil sem criar outra empresa', () => {
    expect(etapasDaPersona('usuario_convidado')).toEqual([
      'boas_vindas',
      'persona',
      'aceitar_convite',
      'perfil',
      'objetivo',
      'conclusao',
    ]);
  });

  it('inclui configuração da empresa e equipe somente no caminho gestor', () => {
    const etapas = etapasDaPersona('gestor_imobiliaria');
    expect(etapas).toContain('empresa');
    expect(etapas).toContain('asaas');
    expect(etapas).toContain('equipe');
    expect(etapas.indexOf('empresa')).toBeLessThan(etapas.indexOf('primeiro_imovel'));
  });

  it('oferece conexão Asaas a contas próprias, mas não ao usuário convidado', () => {
    expect(etapasDaPersona('corretor_autonomo')).toContain('asaas');
    expect(etapasDaPersona('gestor_imobiliaria')).toContain('asaas');
    expect(etapasDaPersona('profissional_administrativo')).toContain('asaas');
    expect(etapasDaPersona('usuario_convidado')).not.toContain('asaas');
  });

  it('calcula progresso com etapas concluídas e puladas sem ultrapassar 100%', () => {
    expect(calcularProgresso(10, ['perfil', 'objetivo'], ['entrada_dados'])).toBe(30);
    expect(calcularProgresso(2, ['a', 'b', 'c'], ['d'])).toBe(100);
    expect(calcularProgresso(0, [], [])).toBe(0);
  });

  it('reconhece ações reais feitas fora do wizard no checklist', () => {
    const itens = checklistDaAtivacao({
      perfilCompleto: true,
      totalImoveisReais: 1,
      totalClientesReais: 2,
      totalOportunidadesReais: 1,
      totalTarefasReais: 1,
      calendarioConectado: false,
      whatsappConfigurado: false,
      totalConvites: 0,
      iaUsada: false,
    });

    expect(itens.filter((item) => item.concluido).map((item) => item.chave)).toEqual([
      'perfil',
      'imovel',
      'cliente',
      'oportunidade',
      'followup',
    ]);
  });

  it('não conta dados de demonstração como primeiro valor real', () => {
    expect(primeiroValorAtingido({
      perfilCompleto: true,
      totalImoveisReais: 0,
      totalClientesReais: 0,
      totalOportunidadesReais: 0,
      totalTarefasReais: 0,
      calendarioConectado: false,
      whatsappConfigurado: false,
      totalConvites: 0,
      iaUsada: true,
    })).toBe(false);
  });

  it('considera primeiro valor quando existe cliente, oportunidade e próxima ação reais', () => {
    expect(primeiroValorAtingido({
      perfilCompleto: true,
      totalImoveisReais: 1,
      totalClientesReais: 1,
      totalOportunidadesReais: 1,
      totalTarefasReais: 1,
      calendarioConectado: false,
      whatsappConfigurado: false,
      totalConvites: 0,
      iaUsada: false,
    })).toBe(true);
  });

  it('prioriza a próxima ação conforme o objetivo e o que já existe', () => {
    const base = {
      perfilCompleto: true,
      totalImoveisReais: 0,
      totalClientesReais: 0,
      totalOportunidadesReais: 0,
      totalTarefasReais: 0,
      calendarioConectado: false,
      whatsappConfigurado: false,
      totalConvites: 0,
      iaUsada: false,
    };

    expect(proximaMelhorAcao('meus_imoveis', base).chave).toBe('imovel');
    expect(proximaMelhorAcao('meus_leads', base).chave).toBe('cliente');
    expect(proximaMelhorAcao('minha_rotina', { ...base, totalClientesReais: 1 }).chave)
      .toBe('followup');
  });
});
