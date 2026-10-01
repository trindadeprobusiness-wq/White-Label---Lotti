import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
// O cliente do Supabase é criado no import e pede localStorage; aqui nada
// chega à rede, então basta um dublê.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: vi.fn(async () => ({ data: null, error: new Error('offline') })) } },
}));

import { RoutineCommandBar } from './RoutineCommandBar';
import { interpretRoutineCommandLocally } from '@/lib/routine/command';
import type { RoutineInboxItem } from '@/types/routine';

const padrao = {
  userId: 'user-1',
  timezone: 'America/Sao_Paulo',
  clients: [],
  properties: [],
  checkConflicts: vi.fn(async () => []),
  onConfirm: vi.fn(async () => undefined),
  onEdit: vi.fn(),
  onAddInbox: vi.fn(async () => undefined),
  onArchiveInbox: vi.fn(async () => undefined),
};

const anotacao = (id: string, content: string): RoutineInboxItem => ({
  id, content, organization_id: 'org-1', user_id: 'user-1', kind: 'note',
  attachment_url: null, status: 'unprocessed', extracted_data: {},
  converted_event_id: null, converted_task_id: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
});

describe('comando da Lotti', () => {
  // A caixa de entrada mudou de componente e a lista chegou aqui como `inbox`.
  // Sem este teste, uma chamada que esquecesse a prop só aparecia como tela
  // branca com "Cannot read properties of undefined (reading 'length')".
  it('renderiza sem nenhuma anotação guardada', () => {
    const html = renderToStaticMarkup(<RoutineCommandBar {...padrao} inbox={[]} />);

    expect(html).toContain('Comando da Lotti');
    expect(html).toContain('O que você quer marcar ou anotar?');
    // Sem anotação, a lista não ocupa espaço.
    expect(html).not.toContain('Guardado sem data');
  });

  it('mostra as anotações guardadas, no máximo três', () => {
    const html = renderToStaticMarkup(
      <RoutineCommandBar
        {...padrao}
        inbox={['uma', 'duas', 'três', 'quatro'].map((t, i) => anotacao(`i${i}`, `Anotação ${t}`))}
      />,
    );

    expect(html).toContain('Guardado sem data');
    expect(html).toContain('Anotação uma');
    expect(html).toContain('Anotação três');
    expect(html).not.toContain('Anotação quatro');
  });
});

describe('o que decide entre compromisso e anotação', () => {
  const agora = new Date('2026-10-01T09:00:00');

  it('com data e hora, vira compromisso com horário', () => {
    const p = interpretRoutineCommandLocally('Marque uma visita com a Ana amanhã às 15h', agora);
    expect(p.start_at ?? p.due_at).not.toBeNull();
  });

  it('sem data nenhuma, não há o que marcar — é anotação', () => {
    // É esta a condição que o cartão usa para oferecer "Guardar sem data" em
    // vez de cobrar um horário que a pessoa pode não ter.
    const p = interpretRoutineCommandLocally('ligar para o Rafael sobre o contrato', agora);
    expect(p.start_at).toBeNull();
    expect(p.due_at).toBeNull();
  });
});
