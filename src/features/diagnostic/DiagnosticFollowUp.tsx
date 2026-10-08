import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useDiagnosticFollowUp, type DiagnosticLead } from '@/hooks/admin/useDiagnostics';
import { followUpLabels, type FollowUpStatus } from './contact-links';

export function DiagnosticFollowUp({ sessionId, lead }: { sessionId: string; lead: DiagnosticLead }) {
  const [status, setStatus] = useState<FollowUpStatus>(lead.follow_up_status || 'new');
  const [notes, setNotes] = useState(lead.follow_up_notes || '');
  const mutation = useDiagnosticFollowUp(sessionId);
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); mutation.mutate({ status, notes }); }}>
    <label className="block text-sm">Etapa do contato<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={status} onChange={event => setStatus(event.target.value as FollowUpStatus)}>{Object.entries(followUpLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    <label className="block text-sm">Anotações privadas<Textarea className="mt-1" value={notes} onChange={event => setNotes(event.target.value)} maxLength={3000} rows={4} placeholder="Próximo contato, contexto e combinados" /></label>
    <p className="text-xs text-muted-foreground">Visíveis apenas no painel administrativo. Abrir WhatsApp ou e-mail prepara uma mensagem; você revisa e envia.</p>
    {lead.last_contact_at && <p className="text-xs text-muted-foreground">Último contato registrado: {new Date(lead.last_contact_at).toLocaleString('pt-BR')}</p>}
    {mutation.isError && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
    {mutation.isSuccess && <p role="status" className="text-sm">Acompanhamento salvo.</p>}
    <Button size="sm" type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Salvando…' : 'Salvar acompanhamento'}</Button>
  </form>;
}
