import { useState } from 'react';
import { CalendarDays, CalendarSync, Loader2, RefreshCw } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface GoogleCalendarHeaderActionProps {
  connected: boolean;
  pending: boolean;
  providerEmail?: string | null;
  lastSyncAt?: string | null;
  syncing: boolean;
  disconnecting: boolean;
  onConnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
}

function formatLastSync(value?: string | null) {
  if (!value) return 'Ainda não sincronizado';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function GoogleCalendarHeaderAction({
  connected,
  pending,
  providerEmail,
  lastSyncAt,
  syncing,
  disconnecting,
  onConnect,
  onSync,
  onDisconnect,
}: GoogleCalendarHeaderActionProps) {
  const [open, setOpen] = useState(false);

  if (connected) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            className="h-9 gap-2 rounded-lg bg-emerald-600 px-3 text-sm text-white shadow-sm hover:bg-emerald-700"
            aria-label="Abrir configurações do Google Agenda"
          >
            <CalendarDays className="h-4 w-4" />
            Conectado
          </Button>
        </DialogTrigger>

        <DialogContent className="max-w-[560px] gap-0 overflow-hidden rounded-2xl p-0">
          <DialogHeader className="border-b px-7 py-6 pr-12">
            <DialogTitle>Agenda</DialogTitle>
            <DialogDescription>Conecte e sincronize seu Google Agenda.</DialogDescription>
          </DialogHeader>

          <div className="p-7">
            <div className="rounded-2xl border bg-card p-5">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sky-50 text-lg font-semibold text-[#4285F4] dark:bg-sky-950/40">
                  G
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">Google Agenda conectado</p>
                  <p className="truncate text-sm text-muted-foreground">{providerEmail || 'Conta Google'}</p>
                </div>
              </div>

              <p className="mt-5 text-sm text-muted-foreground">
                Última sincronização: <span className="text-foreground">{formatLastSync(lastSyncAt)}</span>
              </p>

              <div className="mt-5 space-y-2.5">
                <Button className="w-full" onClick={onSync} disabled={syncing}>
                  {syncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {!syncing && <RefreshCw className="mr-2 h-4 w-4" />}
                  Sincronizar agora
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
                      disabled={disconnecting}
                    >
                      {disconnecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Desconectar Google Agenda
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Desconectar o Google Agenda?</AlertDialogTitle>
                      <AlertDialogDescription>
                        A Lotti deixará de sincronizar novos compromissos. Você poderá conectar a conta novamente quando quiser.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => {
                          onDisconnect();
                          setOpen(false);
                        }}
                      >
                        Sim, desconectar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
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
