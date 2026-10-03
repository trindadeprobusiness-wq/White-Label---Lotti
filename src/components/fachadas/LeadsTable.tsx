import { useMemo, useState } from 'react';
import {
  Users, Phone, Mail, Calendar, MessageCircle, Trash2, Building2, MapPin, Loader2,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { FachadaComImovel, FachadaLead } from '@/types/fachada';
import { linkDeContato, montarMensagemDeContato } from '@/lib/fachadas/mensagemContato';
import { moeda } from '@/lib/formato';
import { DadoSensivel } from '@/components/ui/dado-sensivel';

const TODAS_AS_FACHADAS = 'todas-as-fachadas';

interface LeadsTableProps {
  leads: FachadaLead[];
  /** As placas, para a abordagem lembrar qual imóvel o lead escaneou. */
  fachadas?: FachadaComImovel[];
  fachadaSelecionadaId?: string | null;
  onFachadaSelecionadaChange?: (fachadaId: string | null) => void;
  loading?: boolean;
  onDeleteLead?: (id: string) => Promise<boolean>;
}

function enderecoResumido(fachada?: FachadaComImovel) {
  if (!fachada?.imovel) return 'Imóvel não encontrado';
  return [fachada.imovel.endereco, fachada.imovel.bairro, fachada.imovel.cidade]
    .filter(Boolean)
    .join(', ');
}

export function LeadsTable({
  leads,
  fachadas = [],
  fachadaSelecionadaId = null,
  onFachadaSelecionadaChange,
  loading = false,
  onDeleteLead,
}: LeadsTableProps) {
  const porFachada = useMemo(
    () => new Map(fachadas.map((fachada) => [fachada.id, fachada])),
    [fachadas],
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fachadaSelecionada = fachadaSelecionadaId
    ? porFachada.get(fachadaSelecionadaId)
    : undefined;
  const descricaoEscopo = fachadaSelecionada
    ? `Mostrando somente os contatos interessados em ${fachadaSelecionada.imovel?.titulo ?? 'este imóvel'}.`
    : 'Veja todos os contatos e identifique imediatamente qual fachada despertou o interesse.';

  const handleConfirmDelete = async () => {
    if (!deletingId || !onDeleteLead) return;
    await onDeleteLead(deletingId);
    setDeletingId(null);
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">Leads por fachada</h2>
            {!loading && (
              <Badge variant="secondary" className="font-normal">
                {leads.length} {leads.length === 1 ? 'contato' : 'contatos'}
              </Badge>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{descricaoEscopo}</p>
        </div>

        <div className="w-full shrink-0 sm:w-80">
          <label htmlFor="filtro-fachada-leads" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Filtrar por fachada ou imóvel
          </label>
          <Select
            value={fachadaSelecionadaId ?? TODAS_AS_FACHADAS}
            onValueChange={(value) => onFachadaSelecionadaChange?.(
              value === TODAS_AS_FACHADAS ? null : value,
            )}
          >
            <SelectTrigger id="filtro-fachada-leads" aria-label="Filtrar leads por fachada ou imóvel">
              <SelectValue placeholder="Todas as fachadas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS_AS_FACHADAS}>Todas as fachadas</SelectItem>
              {fachadas.map((fachada) => (
                <SelectItem key={fachada.id} value={fachada.id}>
                  {fachada.imovel?.titulo ?? 'Imóvel sem título'}
                  {!fachada.ativo ? ' · Inativa' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-56 items-center justify-center rounded-xl border border-border text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando leads desta fachada...
        </div>
      ) : leads.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 text-center text-muted-foreground">
          <Users className="mb-3 h-10 w-10 opacity-40" />
          <p className="font-medium text-foreground">
            {fachadaSelecionada ? 'Nenhum lead nesta fachada' : 'Nenhum lead capturado ainda'}
          </p>
          <p className="mt-1 text-sm">
            {fachadaSelecionada
              ? 'Quando alguém escanear o QR Code deste imóvel, o contato aparecerá aqui.'
              : 'Os leads aparecerão aqui quando alguém escanear um QR Code.'}
          </p>
        </div>
      ) : (
      <div className="overflow-hidden rounded-xl border border-border">
        <Table className="min-w-[1120px]">
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Fachada / imóvel</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => {
              const fachada = porFachada.get(lead.fachada_id);
              return (
              <TableRow key={lead.id}>
                <TableCell className="font-medium">{lead.nome}</TableCell>
                <TableCell>
                  <div className="flex max-w-72 items-start gap-2.5">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-brand text-primary">
                      <Building2 className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">
                        {fachada?.imovel?.titulo ?? 'Fachada não identificada'}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{enderecoResumido(fachada)}</span>
                      </span>
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5 text-primary">
                    <Phone className="h-3.5 w-3.5" />
                    <DadoSensivel
                      valor={lead.telefone}
                      tipo="telefone"
                      href={`https://wa.me/55${lead.telefone.replace(/\D/g, '')}`}
                    />
                  </span>
                </TableCell>
                <TableCell>
                  {lead.email ? (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Mail className="h-3.5 w-3.5" />
                      <DadoSensivel valor={lead.email} tipo="email" href={`mailto:${lead.email}`} />
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(lead.created_at).toLocaleDateString('pt-BR')}{' '}
                    {new Date(lead.created_at).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={lead.convertido ? 'default' : 'outline'}
                    className={
                      lead.convertido
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100/80'
                        : ''
                    }
                  >
                    {lead.convertido ? 'Convertido' : 'Novo'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-emerald-600 border-emerald-600/30 hover:bg-emerald-600/10 hover:text-emerald-500"
                      asChild
                    >
                      <a
                        href={(() => {
                          return linkDeContato(lead.telefone, montarMensagemDeContato(fachada?.mensagem_contato, {
                            nome: lead.nome,
                            imovel: fachada?.imovel?.titulo,
                            valor: fachada?.imovel?.valor ? moeda(fachada.imovel.valor) : null,
                          }));
                        })()}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        Contactar
                      </a>
                    </Button>
                    {onDeleteLead && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeletingId(lead.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Excluir
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      )}

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lead?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O lead será removido permanentemente da base de dados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={handleConfirmDelete}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
