import { useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AlertTriangle, ArrowRight, Bot, CalendarClock, Check, Loader2, Inbox, Sparkles, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import { comoResultado } from '@/lib/api/http';
import { interpretarComandoApi } from '@/lib/api/rotina';
import { interpretRoutineCommandLocally, isRoutineActivity } from '@/lib/routine/command';
import { getRoutineCategory } from '@/lib/routine/categories';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RoutineCategoryIcon } from './RoutineCategoryIcon';
import type { RoutineCommandProposal, RoutineDraft, RoutineInboxItem } from '@/types/routine';

type MatchOption = { id: string; label: string; location?: string | null };

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function bestMatch(query: string | null, options: MatchOption[]): MatchOption | null {
  if (!query) return null;
  const wanted = normalize(query);
  return options.find((option) => normalize(option.label) === wanted)
    ?? options.find((option) => normalize(option.label).includes(wanted) || wanted.includes(normalize(option.label)))
    ?? null;
}

function validProposal(value: unknown): value is RoutineCommandProposal {
  if (!value || typeof value !== 'object') return false;
  const proposal = value as Partial<RoutineCommandProposal>;
  return (proposal.kind === 'event' || proposal.kind === 'task')
    && typeof proposal.title === 'string'
    && typeof proposal.activity_type === 'string'
    && isRoutineActivity(proposal.activity_type)
    && Array.isArray(proposal.missing_fields);
}

export function RoutineCommandBar({
  userId,
  timezone,
  clients,
  properties,
  checkConflicts,
  onConfirm,
  onEdit,
  inbox,
  onAddInbox,
  onArchiveInbox,
}: {
  userId: string;
  timezone: string;
  clients: MatchOption[];
  properties: MatchOption[];
  checkConflicts: (assignedTo: string, startAt: string, endAt: string) => Promise<RoutineCommandProposal['conflicts']>;
  onConfirm: (draft: RoutineDraft) => Promise<unknown>;
  onEdit: (draft: Partial<RoutineDraft>) => void;
  inbox: RoutineInboxItem[];
  onAddInbox: (content: string) => Promise<unknown>;
  onArchiveInbox: (id: string) => Promise<unknown>;
}) {
  const [command, setCommand] = useState('');
  const [proposal, setProposal] = useState<RoutineCommandProposal | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Sem dia nem hora reconhecidos, não há compromisso a marcar — é uma
  // anotação. Antes isso era um beco: a barra pedia data e horário, e quem
  // só queria registrar a ideia tinha que achar a outra caixa.
  const semData = !!proposal && !proposal.start_at && !proposal.due_at;

  const guardarSemData = async () => {
    setGuardando(true);
    try {
      await onAddInbox(command.trim());
      setProposal(null);
      setCommand('');
    } finally {
      setGuardando(false);
    }
  };

  const enrich = async (base: RoutineCommandProposal): Promise<RoutineCommandProposal> => {
    const client = bestMatch(base.client_query, clients);
    const property = bestMatch(base.property_query, properties);
    const assignedTo = base.assigned_to || userId;
    const conflicts = base.kind === 'event' && base.start_at && base.end_at
      ? await checkConflicts(assignedTo, base.start_at, base.end_at)
      : [];
    return {
      ...base,
      client_id: base.client_id || client?.id || null,
      property_id: base.property_id || property?.id || null,
      location: base.location || property?.location || null,
      assigned_to: assignedTo,
      conflicts,
    };
  };

  const interpret = async () => {
    if (!command.trim()) return;
    setLoading(true);
    setError('');
    try {
      // Com a API, qualquer erro (inclusive 503 sem GEMINI_API_KEY) cai no intérprete local.
      const { data, error: functionError } = apiDisponivel()
        ? await comoResultado(interpretarComandoApi(command.trim(), timezone))
        : await supabase.functions.invoke('routine-command', {
          body: { command: command.trim(), timezone },
        });
      let base: RoutineCommandProposal;
      if (!functionError && validProposal(data?.proposal)) {
        base = { ...data.proposal, requires_confirmation: true, conflicts: [], interpretation_source: 'ai' };
      } else {
        base = interpretRoutineCommandLocally(command.trim());
      }
      setProposal(await enrich(base));
    } catch {
      try {
        setProposal(await enrich(interpretRoutineCommandLocally(command.trim())));
      } catch {
        setError('Não consegui interpretar esse pedido. Inclua a atividade, a data e o horário.');
      }
    } finally {
      setLoading(false);
    }
  };

  const toDraft = (value: RoutineCommandProposal): RoutineDraft => ({
    kind: value.kind,
    title: value.title,
    activity_type: value.activity_type,
    priority: value.priority,
    assigned_to: value.assigned_to || userId,
    visibility: 'team',
    start_at: value.start_at,
    end_at: value.end_at,
    due_at: value.due_at,
    location: value.location,
    client_id: value.client_id,
    property_id: value.property_id,
    reminder_minutes: value.reminder_minutes,
    source: 'ai',
  });

  const confirm = async () => {
    if (!proposal) return;
    setConfirming(true);
    try {
      await onConfirm(toDraft(proposal));
      setProposal(null);
      setCommand('');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Card className="flex flex-col shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-primary" />
          Comando da Lotti
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Bot className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void interpret();
              }
            }}
            className="h-11 border-0 bg-secondary pl-10 pr-4 shadow-none focus-visible:ring-1"
            placeholder="O que você quer marcar ou anotar?"
            aria-label="Marcar compromisso ou guardar anotação"
          />
        </div>
        <Button className="h-11 px-5" onClick={() => void interpret()} disabled={loading || !command.trim()}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
          Interpretar
        </Button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}

      {proposal && (
        <div className="mt-4 rounded-xl border bg-secondary/60 p-4" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <RoutineCategoryIcon categoryId={proposal.activity_type} withSurface />
              <div>
                <p className="text-sm font-semibold">{proposal.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {getRoutineCategory(proposal.activity_type).label} · {proposal.kind === 'event' ? 'Compromisso' : 'Tarefa'}
                </p>
              </div>
            </div>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setProposal(null)} aria-label="Fechar prévia">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Quando</dt>
              <dd className="mt-0.5 font-medium">
                {proposal.start_at
                  ? format(new Date(proposal.start_at), "EEE, dd 'de' MMM · HH:mm", { locale: ptBR })
                  : proposal.due_at
                    ? format(new Date(proposal.due_at), "dd/MM · HH:mm", { locale: ptBR })
                    : 'Não informado'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cliente</dt>
              <dd className="mt-0.5 font-medium">{proposal.client_query || 'Sem cliente relacionado'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Imóvel / local</dt>
              <dd className="mt-0.5 font-medium">{proposal.property_query || proposal.location || 'Sem imóvel relacionado'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Lembrete</dt>
              <dd className="mt-0.5 font-medium">{proposal.reminder_minutes == null ? 'Padrão da conta' : `${proposal.reminder_minutes} min antes`}</dd>
            </div>
          </dl>

          {proposal.missing_fields.length > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {semData
                  ? <>Não achei data nem horário. Dá para guardar como anotação e marcar depois.</>
                  : <>Preciso somente de: <strong>{proposal.missing_fields.join(' e ')}</strong>.</>}
              </p>
            </div>
          )}
          {proposal.conflicts.length > 0 && (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">Conflito de horário detectado</p>
              {proposal.conflicts.map((conflict) => (
                <p key={conflict.event_id} className="mt-1 text-xs text-muted-foreground">
                  {format(new Date(conflict.start_at), 'HH:mm')}–{format(new Date(conflict.end_at), 'HH:mm')} · {conflict.title}
                </p>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => onEdit(toDraft(proposal))}>
              <CalendarClock className="mr-2 h-4 w-4" />{semData ? 'Marcar uma data' : 'Revisar detalhes'}
            </Button>
            {semData ? (
              <Button onClick={() => void guardarSemData()} disabled={guardando}>
                {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Inbox className="mr-2 h-4 w-4" />}
                Guardar sem data
              </Button>
            ) : (
              <Button
                onClick={() => void confirm()}
                disabled={confirming || proposal.missing_fields.length > 0 || proposal.conflicts.length > 0}
              >
                {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Confirmar e criar
              </Button>
            )}
          </div>
          {proposal.interpretation_source === 'local' && (
            <div className="mt-3 text-right"><Badge variant="outline" className="text-[10px]">Interpretação segura local</Badge></div>
          )}
        </div>
      )}

      {inbox.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Inbox className="h-3.5 w-3.5" />Guardado sem data
          </p>
          <div className="space-y-1">
            {inbox.slice(0, 3).map((item) => (
              <div key={item.id} className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-accent/60">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <p className="line-clamp-2 min-w-0 flex-1 text-xs leading-5">{item.content}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-[10px]"
                  onClick={async () => {
                    onEdit({ kind: 'task', title: item.content, source: 'lotti' });
                    await onArchiveInbox(item.id);
                  }}
                >
                  Marcar data
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-auto px-1 pt-3 text-[11px] text-muted-foreground">
        Com data, vira compromisso; sem data, fica guardado aqui embaixo. A Lotti
        sempre mostra uma prévia. Nada é criado sem a sua confirmação.
      </p>
      </CardContent>
    </Card>
  );
}
