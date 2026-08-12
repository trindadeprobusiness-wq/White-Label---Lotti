import { useState } from 'react';
import { format } from 'date-fns';
import { Inbox, UserPlus, Link2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useCRMStore } from '@/stores/crmStore';
import { possiveisDuplicados, normalizarLead } from '@/lib/crm/pipeline';
import { useLeadsPendentes, useEtapas, useConverterLead } from '@/hooks/crm/useCrm';

type Lead = { id: string; nome: string; telefone: string; email?: string | null; created_at: string };

/**
 * Caixa de Leads — a lacuna real do sistema.
 *
 * Os leads das fachadas eram gravados em `fachada_leads` e ficavam parados:
 * `convertido` só aparecia como badge e `cliente_id` nunca era preenchido.
 * Aqui eles viram cliente + oportunidade, com checagem de duplicidade antes.
 */
export function CrmLeadsInbox() {
  const { data: leads, isLoading } = useLeadsPendentes();
  const { data: etapas } = useEtapas();
  const converter = useConverterLead();
  const { clientes } = useCRMStore();
  const [emAnalise, setEmAnalise] = useState<Lead | null>(null);

  const primeiraEtapa = etapas?.[0];
  const duplicados = emAnalise ? possiveisDuplicados(clientes, emAnalise) : [];

  const converterAgora = (clienteExistente?: string | null) => {
    if (!emAnalise || !primeiraEtapa) return;
    converter.mutate(
      { lead: emAnalise, etapaId: primeiraEtapa.id, clienteExistente },
      { onSuccess: () => setEmAnalise(null) },
    );
  };

  if (isLoading) {
    return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>;
  }

  if (!leads?.length) {
    return (
      <Card>
        <CardContent className="py-12 flex flex-col items-center gap-2 text-center text-muted-foreground">
          <Inbox className="h-8 w-8 opacity-40" />
          <p className="font-medium text-foreground">Nenhum lead esperando</p>
          <p className="text-sm">Leads capturados pelas fachadas aparecem aqui para virar cliente.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {leads.map((lead: Lead) => (
          <Card key={lead.id}>
            <CardContent className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{lead.nome}</p>
                <p className="text-sm text-muted-foreground">
                  {lead.telefone}{lead.email ? ` · ${lead.email}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-muted-foreground">
                  {format(new Date(lead.created_at), 'dd/MM/yyyy')}
                </span>
                <Button size="sm" onClick={() => setEmAnalise(lead)} disabled={!primeiraEtapa}>
                  <UserPlus className="h-4 w-4 mr-1.5" /> Converter
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!emAnalise} onOpenChange={(o) => !o && setEmAnalise(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Converter lead em cliente</DialogTitle>
            <DialogDescription>
              O lead vira um cliente e uma oportunidade na primeira etapa do pipeline.
            </DialogDescription>
          </DialogHeader>

          {emAnalise && (
            <div className="space-y-3">
              <div className="rounded-lg border p-3 text-sm space-y-0.5">
                <p className="font-medium">{normalizarLead(emAnalise).nome}</p>
                <p className="text-muted-foreground">{normalizarLead(emAnalise).telefone}</p>
              </div>

              {duplicados.length > 0 && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
                  <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                    Este telefone já está cadastrado
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Vincule ao cliente existente para não criar um duplicado.
                  </p>
                  {duplicados.map((c) => (
                    <Button
                      key={c.id}
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                      disabled={converter.isPending}
                      onClick={() => converterAgora(c.id)}
                    >
                      <Link2 className="h-4 w-4 mr-1.5" /> Vincular a {c.nome}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEmAnalise(null)} disabled={converter.isPending}>
              Cancelar
            </Button>
            <Button onClick={() => converterAgora(null)} disabled={converter.isPending}>
              {converter.isPending
                ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Convertendo...</>
                : duplicados.length > 0 ? 'Criar mesmo assim' : 'Converter'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
