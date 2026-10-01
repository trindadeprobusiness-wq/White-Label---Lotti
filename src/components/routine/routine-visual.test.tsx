import { renderToStaticMarkup } from 'react-dom/server';
import { addHours, subMinutes } from 'date-fns';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RoutineEvent, RoutineMember, RoutineTask } from '@/types/routine';
import { RoutineBriefing } from './RoutineBriefing';
import { RoutineCalendar } from './RoutineCalendar';

// Relógio congelado às 9h de hoje. O arquivo monta o evento em `agora + 1h`
// e compara com o que o componente considera "próximo": rodando perto da
// meia-noite, esse evento caía no dia seguinte e sumia do calendário do dia.
const today = (() => {
  const base = new Date();
  base.setHours(9, 0, 0, 0);
  return base;
})();

beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(today);
});
afterAll(() => {
  vi.useRealTimers();
});
const member: RoutineMember = {
  id: 'member-1', organization_id: 'org-1', user_id: 'user-1', role: 'corretor',
  status: 'active', team_name: null, unit_name: null, display_name: 'Gabri Teste',
};
const event: RoutineEvent = {
  id: 'event-1', organization_id: 'org-1', assigned_to: 'user-1', created_by: 'user-1',
  title: 'Visita no Jardim América', description: null, activity_type: 'visita_imovel', status: 'confirmed',
  priority: 'high', start_at: addHours(today, 1).toISOString(), end_at: addHours(today, 2).toISOString(),
  all_day: false, timezone: 'America/Sao_Paulo', recurrence_rule: null, location: 'Rua das Flores, 10',
  visibility: 'team', source: 'lotti', client_id: null, property_id: null, deal_id: null,
  contract_id: null, rental_id: null, sync_status: 'local', sync_version: 1, completed_at: null,
  deleted_at: null, created_at: today.toISOString(), updated_at: today.toISOString(),
};
const task: RoutineTask = {
  id: 'task-1', organization_id: 'org-1', assigned_to: 'user-1', created_by: 'user-1',
  title: 'Enviar documentos', description: null, activity_type: 'documentacao', status: 'todo',
  priority: 'medium', due_at: subMinutes(today, 1).toISOString(), estimated_minutes: 20,
  timezone: 'America/Sao_Paulo', recurrence_rule: null, visibility: 'team', source: 'lotti',
  client_id: null, property_id: null, deal_id: null, contract_id: null, rental_id: null,
  completed_at: null, deleted_at: null, created_at: today.toISOString(), updated_at: today.toISOString(),
};

describe('acabamento visual e responsivo da Central de Rotina', () => {
  it('mantém a linha do tempo navegável no mobile e oferece as quatro visualizações no desktop', () => {
    const html = renderToStaticMarkup(
      <RoutineCalendar
        view="day" onViewChange={vi.fn()} anchor={today} onAnchorChange={vi.fn()}
        scope="mine" onScopeChange={vi.fn()} canViewTeam onMemberChange={vi.fn()} category="all"
        onCategoryChange={vi.fn()} members={[member]} events={[event]} tasks={[task]}
        onCreateAt={vi.fn()} onOpen={vi.fn()} onMoveEvent={vi.fn()}
      />,
    );

    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('min-w-[440px]');
    expect(html).toContain('>Dia<');
    expect(html).toContain('>Semana<');
    expect(html).toContain('>Mês<');
    expect(html).toContain('>Lista<');
    expect(html).toContain('aria-label="Visita no Jardim América,');
  });

  it('prioriza próxima ação, tarefas e captura rápida nessa ordem', () => {
    const html = renderToStaticMarkup(
      <RoutineBriefing
        currentUserName="Gabri Teste" currentUserId="user-1" events={[event]} tasks={[task]}
        members={[member]} clients={[]} alerts={[]} inbox={[]} onOpen={vi.fn()}
        onComplete={vi.fn()} onCreate={vi.fn()} onAddInbox={vi.fn()} onArchiveInbox={vi.fn()}
      />,
    );

    expect(html.indexOf('Próxima ação · Gabri')).toBeLessThan(html.indexOf('Tarefas que pedem ação'));
    expect(html.indexOf('Tarefas que pedem ação')).toBeLessThan(html.indexOf('Caixa de entrada'));
    expect(html).toContain('Visita no Jardim América');
    expect(html).toContain('Enviar documentos');
  });

  // A tela abria com seis cartões e cinco deles anunciando que não havia nada:
  // "Tudo em dia", "0 compromissos · 0 tarefas", "Tudo organizado". Uma tela
  // inteira para dizer que o dia está vazio, com o calendário abaixo da dobra.
  it('sem nada a dizer, não gasta um cartão para dizer que não há nada', () => {
    const html = renderToStaticMarkup(
      <RoutineBriefing
        currentUserName="Gabri Teste" currentUserId="user-1" events={[]} tasks={[]}
        members={[member]} clients={[]} alerts={[]} inbox={[]} onOpen={vi.fn()}
        onComplete={vi.fn()} onCreate={vi.fn()} onAddInbox={vi.fn()} onArchiveInbox={vi.fn()}
      />,
    );

    expect(html).not.toContain('Tarefas que pedem ação');
    expect(html).not.toContain('Sinais da operação');
    expect(html).not.toContain('Carga da equipe');
    // Sobram os dois que servem para agir, não para informar.
    expect(html).toContain('Próxima ação · Gabri');
    expect(html).toContain('Caixa de entrada');
  });

  it('a sugestão vive dentro dos sinais, e não num cartão só dela', () => {
    const atrasado = { ...task, id: 'task-2' };
    const html = renderToStaticMarkup(
      <RoutineBriefing
        currentUserName="Gabri Teste" currentUserId="user-1" events={[]} tasks={[atrasado]}
        members={[member]}
        clients={[{ id: 'c1', nome: 'Anadiana', ultimo_contato: '2026-09-01' } as never]}
        alerts={[]} inbox={[]} onOpen={vi.fn()}
        onComplete={vi.fn()} onCreate={vi.fn()} onAddInbox={vi.fn()} onArchiveInbox={vi.fn()}
      />,
    );

    // Eram dois cartões para o mesmo dado: a sugestão saía de staleClients[0]
    // e a lista ao lado começava pelo mesmo contato.
    expect(html).not.toContain('Próxima melhor ação');
    const sinais = html.indexOf('Sinais da operação');
    expect(sinais).toBeGreaterThan(-1);
    expect(html.indexOf('Anadiana', sinais)).toBeGreaterThan(sinais);
  });

  it('carga da equipe só aparece quando existe equipe', () => {
    const sozinho = { members: [member], esperado: false };
    const acompanhado = {
      members: [member, { ...member, id: 'member-2', user_id: 'user-2', display_name: 'Outra pessoa' }],
      esperado: true,
    };
    for (const { members, esperado } of [sozinho, acompanhado]) {
      const html = renderToStaticMarkup(
        <RoutineBriefing
          currentUserName="Gabri Teste" currentUserId="user-1" events={[]} tasks={[]}
          members={members} clients={[]} alerts={[]} inbox={[]} onOpen={vi.fn()}
          onComplete={vi.fn()} onCreate={vi.fn()} onAddInbox={vi.fn()} onArchiveInbox={vi.fn()}
        />,
      );
      expect(html.includes('Carga da equipe')).toBe(esperado);
    }
  });
});
