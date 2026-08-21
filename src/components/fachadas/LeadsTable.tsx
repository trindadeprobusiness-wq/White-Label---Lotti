import { useState } from 'react';
import { Users, Phone, Mail, Calendar, MessageCircle, Trash2 } from 'lucide-react';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { FachadaLead } from '@/types/fachada';
import { DadoSensivel } from '@/components/ui/dado-sensivel';

interface LeadsTableProps {
  leads: FachadaLead[];
  onDeleteLead?: (id: string) => Promise<boolean>;
}

export function LeadsTable({ leads, onDeleteLead }: LeadsTableProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleConfirmDelete = async () => {
    if (!deletingId || !onDeleteLead) return;
    await onDeleteLead(deletingId);
    setDeletingId(null);
  };

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Users className="h-12 w-12 mb-3 opacity-40" />
        <p className="font-medium">Nenhum lead capturado ainda</p>
        <p className="text-sm">Os leads aparecerão aqui quando alguém escanear um QR Code.</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => (
              <TableRow key={lead.id}>
                <TableCell className="font-medium">{lead.nome}</TableCell>
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
                        href={`https://wa.me/55${lead.telefone.replace(/\D/g, '')}`}
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
            ))}
          </TableBody>
        </Table>
      </div>

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
