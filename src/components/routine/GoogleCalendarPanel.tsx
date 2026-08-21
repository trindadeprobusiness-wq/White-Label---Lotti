import { useEffect } from 'react';
import { CalendarSync, Check, CloudOff, Loader2, RefreshCw, Unplug } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useGoogleCalendarConnection, type RoutineContext } from '@/hooks/routine/useRoutine';
import { toast } from 'sonner';

function relativeDate(value?: string | null) {
  if (!value) return 'Ainda não sincronizado';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(value));
}

export function GoogleCalendarPanel({
  context,
  compact = false,
}: {
  context?: RoutineContext | null;
  compact?: boolean;
}) {
  const google = useGoogleCalendarConnection(context);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    const result = params.get('google_calendar');
    if (!result) return;
    if (result === 'connected') {
      toast.success('Google Agenda conectado. A primeira sincronização começou.');
      void google.status.refetch();
      void google.sync.mutateAsync().catch(() => undefined);
    } else {
      toast.error('A conexão com o Google não foi concluída. Tente novamente.');
    }
    const next = new URLSearchParams(params);
    next.delete('google_calendar');
    setParams(next, { replace: true });
  }, [params, setParams]); // eslint-disable-line react-hooks/exhaustive-deps

  if (google.status.isLoading) {
    return <Skeleton className={cn('h-44 rounded-xl', compact && 'h-28')} />;
  }

  if (google.status.isError) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="flex items-start gap-3 py-5">
          <CloudOff className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Integração aguardando publicação</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              A interface está pronta. Publique as Edge Functions e configure as credenciais do Google para conectar.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const connection = google.status.data;
  if (!connection?.connected) {
    return (
      <Card className="overflow-hidden border-border shadow-sm">
        <CardContent className={cn('flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between', compact && 'py-4')}>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-brand text-primary">
              <CalendarSync className="h-5 w-5" />
            </span>
            <div>
              <p className="font-medium">Google Agenda</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Traga seus horários e mantenha alterações sincronizadas.
              </p>
            </div>
          </div>
          <Button onClick={() => google.connect.mutate()} disabled={google.connect.isPending}>
            {google.connect.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Conectar Google Agenda
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className={cn('pb-3', compact && 'p-4 pb-2')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <Check className="h-4 w-4" />
              </span>
              Google Agenda conectado
            </CardTitle>
            <CardDescription className="mt-1">
              {connection.provider_email || 'Conta Google'} · última sincronização {relativeDate(connection.last_sync_at)}
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300">
            Sincronização bidirecional
          </Badge>
        </div>
      </CardHeader>
      <CardContent className={cn('space-y-3', compact && 'px-4 pb-4')}>
        {!compact && (
          <div className="flex flex-col gap-2 rounded-lg bg-secondary/60 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium">Informação enviada ao Google</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">O modo parcial evita nomes de clientes e detalhes do CRM.</p>
            </div>
            <Select
              value={connection.privacy_mode || 'partial'}
              onValueChange={(value) => google.configurePrivacy.mutate(value as 'full' | 'partial' | 'busy_only')}
            >
              <SelectTrigger className="h-8 w-full text-xs sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Conteúdo completo</SelectItem>
                <SelectItem value="partial">Contexto parcial</SelectItem>
                <SelectItem value="busy_only">Somente ocupado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {!compact && google.calendars.data?.map((calendar) => (
          <div key={calendar.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Switch
                checked={calendar.selected}
                onCheckedChange={(selected) => google.configureCalendar.mutate({ id: calendar.id, patch: { selected } })}
                aria-label={`Sincronizar ${calendar.summary}`}
              />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: calendar.color || '#4285F4' }} />
              <span className="truncate text-sm font-medium">{calendar.summary}</span>
              {calendar.is_primary && <Badge variant="secondary">Principal</Badge>}
              {calendar.is_default && <Badge variant="outline">Padrão Lotti</Badge>}
            </div>
            <Select
              value={calendar.sync_direction}
              onValueChange={(sync_direction) => google.configureCalendar.mutate({
                id: calendar.id,
                patch: { sync_direction: sync_direction as typeof calendar.sync_direction },
              })}
            >
              <SelectTrigger className="h-8 w-full text-xs sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bidirectional">Duas direções</SelectItem>
                <SelectItem value="import_only">Somente importar</SelectItem>
                <SelectItem value="export_only">Somente enviar</SelectItem>
                <SelectItem value="disabled">Não sincronizar</SelectItem>
              </SelectContent>
            </Select>
            {!calendar.is_default && ['writer', 'owner'].includes(calendar.access_role || '') && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => google.configureCalendar.mutate({ id: calendar.id, patch: { is_default: true, selected: true } })}
              >
                Usar como padrão
              </Button>
            )}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => google.sync.mutate()} disabled={google.sync.isPending}>
            <RefreshCw className={cn('mr-2 h-4 w-4', google.sync.isPending && 'animate-spin')} />
            Sincronizar agora
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => google.disconnect.mutate()} disabled={google.disconnect.isPending}>
            <Unplug className="mr-2 h-4 w-4" />
            Desconectar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
