import { describe, expect, it } from 'vitest';
import {
  deveAbrirOnboarding,
  normalizarContextoOnboarding,
  responderAjudaOnboarding,
} from './contexto';

describe('contexto do onboarding', () => {
  it('falha aberto quando a migration ainda não existe ou a leitura falha', () => {
    expect(deveAbrirOnboarding(null, '/')).toBe(false);
  });

  it('direciona somente perfil novo e não dispensado para o wizard', () => {
    const contexto = normalizarContextoOnboarding({
      profile: { id: 'p1', persona: null, primary_goal: null },
      progress: { current_step: 'boas_vindas', completed_steps: [], skipped_steps: [] },
      evidence: {},
    });

    expect(deveAbrirOnboarding(contexto, '/')).toBe(true);
    expect(deveAbrirOnboarding(contexto, '/onboarding')).toBe(false);
    expect(deveAbrirOnboarding(contexto, '/admin')).toBe(false);
    expect(deveAbrirOnboarding(contexto, '/rotina')).toBe(false);
    expect(deveAbrirOnboarding(contexto, '/plano')).toBe(false);
    expect(deveAbrirOnboarding(contexto, '/planejamento')).toBe(true);
  });

  it('não reapresenta wizard concluído ou dispensado', () => {
    const concluido = normalizarContextoOnboarding({
      profile: { id: 'p1' },
      progress: { completed_at: '2026-08-20T12:00:00Z' },
    });
    const dispensado = normalizarContextoOnboarding({
      profile: { id: 'p2' },
      progress: { dismissed_at: '2026-08-20T12:00:00Z' },
    });

    expect(deveAbrirOnboarding(concluido, '/')).toBe(false);
    expect(deveAbrirOnboarding(dispensado, '/')).toBe(false);
  });

  it('normaliza evidências ausentes sem contar demonstração como dado real', () => {
    const contexto = normalizarContextoOnboarding({
      profile: { id: 'p1' },
      evidence: { total_imoveis_reais: 2, total_imoveis_demo: 4 },
    });

    expect(contexto.evidencias.totalImoveisReais).toBe(2);
    expect(contexto.evidencias.totalClientesReais).toBe(0);
  });

  it('preserva organização, plano, checklist e tours necessários à experiência', () => {
    const contexto = normalizarContextoOnboarding({
      profile: { id: 'p1', organization_id: 'o1', metadata: { draft: { nome: 'Lotti' } } },
      organization: { id: 'o1', nome: 'Imobiliária Horizonte', tipo_organizacao: 'imobiliaria' },
      membership: { papel: 'gestor' },
      subscription: { status: 'trialing', plan_name: 'Profissional', trial_ends_at: '2026-09-01T00:00:00Z' },
      checklist: { minimized: true },
      tours: [{ tour_key: 'clientes', completed_at: '2026-08-20T12:00:00Z' }],
    });

    expect(contexto.organizacao?.nome).toBe('Imobiliária Horizonte');
    expect(contexto.papel).toBe('gestor');
    expect(contexto.assinatura?.plano).toBe('Profissional');
    expect(contexto.checklistMinimizado).toBe(true);
    expect(contexto.toursConcluidos).toEqual(['clientes']);
    expect(contexto.metadata).toEqual({ draft: { nome: 'Lotti' } });
  });

  it('assistente transforma pedido de follow-up em pré-preenchimento, sem alegar execução', () => {
    const resposta = responderAjudaOnboarding(
      'Crie um follow-up para amanhã',
      { persona: 'corretor_autonomo', etapa: 'primeira_rotina' },
    );

    expect(resposta.acao?.tipo).toBe('preencher_tarefa');
    expect(resposta.texto).toContain('preenchi');
    expect(resposta.texto).not.toContain('criei');
  });

  it('assistente orienta planilha sem inventar importação concluída', () => {
    const resposta = responderAjudaOnboarding(
      'Tenho meus clientes em uma planilha',
      { persona: 'gestor_imobiliaria', etapa: 'entrada_dados' },
    );

    expect(resposta.acao?.tipo).toBe('abrir_importacao');
    expect(resposta.texto).toContain('prévia');
  });
});
