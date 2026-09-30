import { useState } from 'react';
import { format } from 'date-fns';
import { Inbox, UserPlus, Link2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { normalizarLead } from '@/lib/crm/pipeline';
import { MOTIVO_CANDIDATO, type CandidatoCliente } from '@/lib/crm/duplicidade';
import { useLeadsPendentes, useEtapas, useConverterLead, useClientesParecidos } from '@/hooks/crm/useCrm';
import { DadoSensivel } from '@/components/ui/dado-sensivel';

type Lead = { id: string; nome: string; telefone: string; email?: string | null; created_at: string };

/**
 * Caixa de Leads — a lacuna real do sistema.
 *
 * Os leads das fachadas eram gravados em `fachada_leads` e ficavam parados:
 * `convertido` só aparecia como badge e `cliente_id` nunca era preenchido.
 * Aqui eles viram cliente + oportunidade. Antes, o servidor procura o cliente
 * que já tem o mesmo telefone (em qualquer grafia) ou e-mail; havendo um, o
 * lead só pode ser vinculado a ele, porque a conta não pode ter dois clientes
 * com o mesmo telefone.
 */
export function CrmLeadsInbox() {
  const { data: leads, isLoading } = useLeadsPendentes();
  const { data: etapas } = useEtapas();
  const converter = useConverterLead();
  const [emAnalise, setEmAnalise] = useState<Lead | null>(null);
  // O que o servidor recusou na conversão vale mais que a consulta da tela:
  // outro cadastro pode ter entrado entre abrir o diálogo e clicar.
  const [recusados, setRecusados] = useState<CandidatoCliente[] | null>(null);
  const parecidos = useClientesParecidos({ telefone: emAnalise?.telefone, email: emAnalise?.email }, !!emAnalise);

  const primeiraEtapa = etapas?.[0];
  const candidatos = recusados ?? parecidos.data ?? [];

  const fechar = () => { setEmAnalise(null); setRecusados(null); converter.reset(); };

  const converterAgora = (clienteExistente?: string | null) => {
    if (!emAnalise || !primeiraEtapa) return;
    converter.mutate(
      { lead: emAnalise, etapaId: primeiraEtapa.id, clienteExistente },
      { onSuccess: (resultado) => (resultado.status === 'duplicate' ? setRecusados(resultado.candidatos) : fechar()) },
    );
  };

  if (isLoading) {
    return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>;
  }

  if (!leads?.length) {
    return (
      <Card className="border-border shadow-sm">
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
          <Card key={lead.id} className="border-border shadow-sm hover:border-primary/30 transition-colors">
            <CardContent className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{lead.nome}</p>
                <p className="text-sm text-muted-foreground">
                  <DadoSensivel valor={lead.telefone} tipo="telefone" />
                  {lead.email && <><span className="mx-1">·</span><DadoSensivel valor={lead.email} tipo="email" /></>}
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

      <Dialog open={!!emAnalise} onOpenChange={(o) => !o && fechar()}>
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
                <DadoSensivel valor={normalizarLead(emAnalise).telefone} tipo="telefone" className="text-muted-foreground" />
              </div>

              {parecidos.isLoading && !recusados && (
                <p role="status" className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Procurando cliente com este telefone ou e-mail...
                </p>
              )}

              {candidatos.length > 0 && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
                  <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                    {candidatos.length === 1
                      ? `Este lead já é o cliente ${candidatos[0].nome}`
                      : 'Este lead já está no CRM'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Vincule ao cadastro existente. A conta não pode ter dois clientes com o mesmo telefone.
                  </p>
                  {candidatos.map((c) => (
                    <Button
                      key={c.id}
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                      disabled={converter.isPending}
                      onClick={() => converterAgora(c.id)}
                    >
                      <Link2 className="h-4 w-4 mr-1.5" /> Vincular a {c.nome}
                      <span className="ml-auto text-xs text-muted-foreground">mesmo {MOTIVO_CANDIDATO[c.motivo]}</span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={fechar} disabled={converter.isPending}>
              Cancelar
            </Button>
            {candidatos.length === 0 && (
              <Button onClick={() => converterAgora(null)} disabled={converter.isPending || (parecidos.isLoading && !recusados)}>
                {converter.isPending
                  ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Convertendo...</>
                  : 'Converter'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
