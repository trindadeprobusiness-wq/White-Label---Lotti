import { Users, Phone, Mail, Calendar } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { FachadaLead } from '@/types/fachada';

interface LeadsTableProps {
  leads: FachadaLead[];
}

export function LeadsTable({ leads }: LeadsTableProps) {
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
    <div className="rounded-lg border">
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => (
              <TableRow key={lead.id}>
                <TableCell className="font-medium">{lead.nome}</TableCell>
                <TableCell>
                  <a
                    href={`https://wa.me/55${lead.telefone.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-primary hover:underline"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    {lead.telefone}
                  </a>
                </TableCell>
                <TableCell>
                  {lead.email ? (
                    <a
                      href={`mailto:${lead.email}`}
                      className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      {lead.email}
                    </a>
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
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100/80 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : ''
                    }
                  >
                    {lead.convertido ? 'Convertido' : 'Novo'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="md:hidden flex flex-col divide-y">
        {leads.map((lead) => (
          <div key={lead.id} className="p-4 flex flex-col gap-3">
            <div className="flex justify-between items-start">
              <span className="font-medium text-foreground">{lead.nome}</span>
              <Badge
                variant={lead.convertido ? 'default' : 'outline'}
                className={
                  lead.convertido
                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100/80 dark:bg-emerald-900/30 dark:text-emerald-400 shrink-0'
                    : 'shrink-0'
                }
              >
                {lead.convertido ? 'Convertido' : 'Novo'}
              </Badge>
            </div>
            
            <div className="grid grid-cols-1 gap-2 text-sm bg-muted/20 p-3 rounded-lg border border-border/50">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <a
                  href={`https://wa.me/55${lead.telefone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {lead.telefone}
                </a>
              </div>
              {lead.email && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a
                    href={`mailto:${lead.email}`}
                    className="text-muted-foreground hover:text-foreground truncate"
                  >
                    {lead.email}
                  </a>
                </div>
              )}
            </div>
            
            <div className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              {new Date(lead.created_at).toLocaleDateString('pt-BR')}{' '}
              {new Date(lead.created_at).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
