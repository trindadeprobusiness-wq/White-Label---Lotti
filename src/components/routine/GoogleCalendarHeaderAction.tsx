import { CalendarSync, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface GoogleCalendarHeaderActionProps {
  connected: boolean;
  pending: boolean;
  onConnect: () => void;
}

export function GoogleCalendarHeaderAction({
  connected,
  pending,
  onConnect,
}: GoogleCalendarHeaderActionProps) {
  if (connected) {
    return (
      <Button
        type="button"
        variant="outline"
        className="min-h-11 gap-2 px-3 sm:px-4"
        disabled
        aria-label="Agenda conectada"
      >
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <span className="hidden sm:inline">Agenda conectada</span>
        <span className="sm:hidden">Conectada</span>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="min-h-11 gap-2 px-3 sm:px-4"
      onClick={onConnect}
      disabled={pending}
      aria-label="Conectar Google Agenda"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarSync className="h-4 w-4" />}
      <span className="hidden sm:inline">Conectar Google Agenda</span>
      <span className="sm:hidden">Google Agenda</span>
    </Button>
  );
}
