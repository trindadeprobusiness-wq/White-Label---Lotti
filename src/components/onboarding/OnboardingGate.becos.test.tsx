// @vitest-environment jsdom
/**
 * Auditoria SCRUM-16 — o próprio wizard oferece links para rotas protegidas
 * pelo OnboardingGate. Com o onboarding em andamento, o gate devolve a pessoa
 * para /onboarding: o link vira um laço (clica, volta para o wizard).
 *
 * Falhava na main 052327d; corrigido em lib/onboarding/contexto.ts. Ver docs/jira/onboarding.md.
 *   - Onboarding.tsx:557  "Conectar Google Agenda"  -> /rotina#google-agenda
 *   - Onboarding.tsx:589  "Gerenciar assinatura"    -> /plano
 */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { onboarding } = vi.hoisted(() => ({ onboarding: { atual: {} as Record<string, unknown> } }));
vi.mock('@/hooks/useOnboarding', () => ({ useOnboarding: () => onboarding.atual }));

import { OnboardingGate } from './OnboardingGate';

afterEach(cleanup);

describe('OnboardingGate — destinos oferecidos pelo próprio onboarding', () => {
  it.each([
    ['/rotina', 'Conectar Google Agenda (Onboarding.tsx:557)'],
    ['/plano', 'Gerenciar assinatura (Onboarding.tsx:589)'],
  ])('%s é alcançável durante o onboarding — %s', (rota) => {
    onboarding.atual = {
      carregando: false,
      erro: null,
      // Onboarding em andamento: nem concluído nem dispensado.
      contexto: { profileId: 'perfil-1', concluidoEm: null, dispensadoEm: null },
    };

    render(
      <MemoryRouter initialEntries={[rota]}>
        <Routes>
          <Route path={rota} element={<OnboardingGate><p>Destino alcançado</p></OnboardingGate>} />
          <Route path="/onboarding" element={<p>De volta ao wizard</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('De volta ao wizard')).toBeNull();
    expect(screen.getByText('Destino alcançado')).not.toBeNull();
  });
});
