import { useState } from 'react';
import { addDays, addHours, startOfDay } from 'date-fns';
import { RoutineCalendar } from '@/components/routine/RoutineCalendar';
import { RoutineBriefing } from '@/components/routine/RoutineBriefing';
import { RoutineCommandBar } from '@/components/routine/RoutineCommandBar';
import type { RoutineEvent, RoutineMember, RoutineScope, RoutineTask, RoutineView } from '@/types/routine';

/**
 * Prévia do calendário só para desenvolvimento.
 *
 * O Planejamento vive atrás do login, e medir altura e desempenho do
 * calendário dependia de uma sessão real. Aqui ele recebe compromissos de
 * mentira e nada mais: é o componente de verdade, com o CSS de verdade, sem
 * rede e sem conta. A rota existe apenas em `import.meta.env.DEV`.
 */

const hoje = startOfDay(new Date());

const membro: RoutineMember = {
  id: 'm1', organization_id: 'org', user_id: 'u1', role: 'corretor',
  status: 'active', team_name: null, unit_name: null, display_name: 'Evandro',
};

// Um dia realmente cheio: oito compromissos por dia, a semana inteira. É o
// pior caso que o corretor veria, e é nele que a lentidão apareceria.
const eventos: RoutineEvent[] = Array.from({ length: 7 }).flatMap((_, dia) =>
  Array.from({ length: 8 }).map((__, i) => {
    const inicio = addHours(addDays(hoje, dia), 8 + i * 1.5);
    return {
      id: `e${dia}-${i}`, organization_id: 'org', assigned_to: 'u1', created_by: 'u1',
      title: `Visita ${i + 1} · dia ${dia + 1}`, description: null,
      activity_type: 'visita_imovel', status: 'confirmed', priority: 'medium',
      start_at: inicio.toISOString(), end_at: addHours(inicio, 1).toISOString(),
      all_day: false, timezone: 'America/Sao_Paulo', recurrence_rule: null,
      location: 'Rua das Flores, 10', visibility: 'team', source: 'lotti',
      client_id: null, property_id: null, deal_id: null, contract_id: null,
      rental_id: null, sync_status: 'local', sync_version: 1, completed_at: null,
      deleted_at: null, created_at: hoje.toISOString(), updated_at: hoje.toISOString(),
    } as RoutineEvent;
  }),
);

const tarefas: RoutineTask[] = [];

export default function PlanejamentoPreview() {
  const [view, setView] = useState<RoutineView>('week');
  const [anchor, setAnchor] = useState(new Date());
  const [scope, setScope] = useState<RoutineScope>('mine');
  const [memberId, setMemberId] = useState<string>();
  const [category, setCategory] = useState('all');

  return (
    <div className="min-h-screen bg-secondary">
      <div className="mx-auto w-full max-w-[1600px] space-y-6 px-5 pb-16 pt-8 md:px-8">
        <RoutineBriefing
          currentUserName="Evandro Lopes"
          currentUserId="u1"
          events={[]}
          tasks={[]}
          members={[membro]}
          onOpen={() => {}}
          onComplete={async () => {}}
          onCreate={() => {}}
          comando={(
            <RoutineCommandBar
              userId="u1"
              timezone="America/Sao_Paulo"
              clients={[]}
              properties={[]}
              checkConflicts={async () => []}
              onConfirm={async () => undefined}
              onEdit={() => {}}
              inbox={[]}
              onAddInbox={async () => undefined}
              onArchiveInbox={async () => undefined}
            />
          )}
        />

        <RoutineCalendar
          view={view}
          onViewChange={setView}
          anchor={anchor}
          onAnchorChange={setAnchor}
          scope={scope}
          onScopeChange={setScope}
          canViewTeam
          memberId={memberId}
          onMemberChange={setMemberId}
          category={category}
          onCategoryChange={setCategory}
          members={[membro]}
          events={eventos}
          tasks={tarefas}
          onCreateAt={() => {}}
          onOpen={() => {}}
          onMoveEvent={async () => {}}
        />
      </div>
    </div>
  );
}
