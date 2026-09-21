import { useState } from 'react';
import { Plus, Undo2, Info } from 'lucide-react';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { PaginacaoAdmin } from '@/components/admin/PaginacaoAdmin';
import { EstadoErro, EstadoVazio } from '@/components/admin/Estados';
import { DialogoConfirmacao } from '@/components/admin/DialogoConfirmacao';
import { DialogoNovaReceita } from '@/components/admin/DialogoNovaReceita';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useReceita, useEstornarReceita, ITENS_POR_PAGINA } from '@/hooks/admin/useAdminDados';
import { usePapeis } from '@/hooks/admin/usePapeis';
import { competenciaBR, dataBR, moeda, numero } from '@/lib/formato';
import { cn } from '@/lib/utils';
import type { EventoReceita } from '@/integrations/supabase/admin-types';

const COR_STATUS: Record<string, string> = {
  confirmado: 'bg-success/10 text-success border-success/20',
  estornado: 'bg-destructive/10 text-destructive border-destructive/20',
  cancelado: 'bg-muted text-muted-foreground border-border',
};

const ROTULO_ORIGEM: Record<string, string> = {
  manual_admin: 'Lançamento manual',
  asaas: 'Asaas',
  stripe: 'Stripe',
};

const TODOS = 'TODOS';

export default function AdminReceita() {
  const [status, setStatus] = useState(TODOS);
  const [pagina, setPagina] = useState(1);
  const [criando, setCriando] = useState(false);
  const [estornando, setEstornando] = useState<EventoReceita | null>(null);

  const { podeExecutar } = usePapeis();
  const estornar = useEstornarReceita();

  const { data, isLoading, error, refetch } = useReceita({
    status: status === TODOS ? undefined : status,
    pagina,
  });

  const itens = data?.itens ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <CabecalhoAdmin
        titulo="Receita"
        descricao="Ledger de receita da Lotti. É daqui que nascem as comissões de parceiro."
        migalhas={[{ label: 'Back office', href: '/admin' }, { label: 'Receita' }]}
        acoes={
          podeExecutar('registrar_receita') ? (
            <Button size="sm" onClick={() => setCriando(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Registrar receita
            </Button>
          ) : null
        }
      />

      {/* O operador precisa saber por que a tabela está vazia e o que ela vai
          receber quando a cobrança entrar — senão parece funcionalidade quebrada. */}
      <Card className="mb-6 border-dashed">
        <CardContent className="flex gap-3 py-4">
          <Info className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">
            <p>
              A cobrança automática de assinatura ainda não está ligada. Até lá, a receita
              entra por lançamento manual, sempre com justificativa e registro na auditoria.
            </p>
            <p className="mt-1">
              Quando o gateway for integrado, os eventos passam a chegar por webhook nesta
              mesma tabela, com controle de duplicidade — nada precisa ser refeito.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="filtro-status-receita" className="text-xs text-muted-foreground">
            Status
          </Label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPagina(1);
            }}
          >
            <SelectTrigger id="filtro-status-receita" className="w-full sm:w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              <SelectItem value="confirmado">Confirmado</SelectItem>
              <SelectItem value="estornado">Estornado</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <EstadoErro erro={error} aoTentarNovamente={() => void refetch()} />
      ) : isLoading && itens.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : itens.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum evento de receita registrado"
          descricao="Assim que houver um pagamento confirmado — manual agora, por webhook depois — ele aparece aqui e gera a comissão do parceiro, se o cliente tiver um."
          acao={
            podeExecutar('registrar_receita') ? (
              <Button variant="outline" onClick={() => setCriando(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Registrar o primeiro
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <Card>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="hidden md:table-cell">Origem</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Confirmado</TableHead>
                    <TableHead className="hidden lg:table-cell">Competência</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itens.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm font-medium">
                        {r.corretor_nome ?? '—'}
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">
                        {ROTULO_ORIGEM[r.origem] ?? r.origem}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {moeda(r.valor_bruto)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(COR_STATUS[r.status])}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">
                        {dataBR(r.confirmado_em)}
                      </TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">
                        {competenciaBR(r.competencia)}
                      </TableCell>
                      <TableCell>
                        {r.status === 'confirmado' && podeExecutar('estornar_receita') && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setEstornando(r)}
                            aria-label="Estornar receita"
                          >
                            <Undo2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          <div className="mt-4">
            <PaginacaoAdmin
              pagina={pagina}
              porPagina={ITENS_POR_PAGINA}
              total={total}
              aoMudarPagina={setPagina}
            />
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            {numero(total)} evento(s) no total.
          </p>
        </>
      )}

      <DialogoNovaReceita aberto={criando} aoFechar={() => setCriando(false)} />

      <DialogoConfirmacao
        aberto={!!estornando}
        aoFechar={() => setEstornando(null)}
        titulo="Estornar receita?"
        descricao={
          estornando
            ? `${moeda(estornando.valor_bruto)} de ${estornando.corretor_nome ?? 'cliente'} passa a estornado. As comissões em aberto ligadas a este evento são estornadas junto — comissão já paga não é revertida automaticamente e precisa de acerto manual.`
            : ''
        }
        rotuloConfirmar="Estornar"
        destrutivo
        exigirMotivo
        aoConfirmar={async (motivo) => {
          if (!estornando) return;
          await estornar.mutateAsync({ receitaId: estornando.id, motivo });
        }}
      />
    </>
  );
}
