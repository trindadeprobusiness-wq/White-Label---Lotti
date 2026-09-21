import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, MoreHorizontal } from 'lucide-react';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { PaginacaoAdmin } from '@/components/admin/PaginacaoAdmin';
import { EstadoErro, EstadoVazio } from '@/components/admin/Estados';
import { DialogoConfirmacao } from '@/components/admin/DialogoConfirmacao';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useComissoes, useTransicionarComissao, ITENS_POR_PAGINA } from '@/hooks/admin/useAdminDados';
import { usePapeis } from '@/hooks/admin/usePapeis';
import {
  ROTULO_STATUS, COR_STATUS, proximosStatus, exigeJustificativa,
} from '@/lib/admin/comissao';
import { dataBR, moeda, numero, percentual } from '@/lib/formato';
import { montarCsv, baixarCsv, nomeArquivoCsv } from '@/lib/admin/csv';
import { cn } from '@/lib/utils';
import type { Comissao, StatusComissao } from '@/integrations/supabase/admin-types';

const TODOS = 'TODOS';

export default function AdminComissoes() {
  const [status, setStatus] = useState(TODOS);
  const [pagina, setPagina] = useState(1);
  const [alvo, setAlvo] = useState<{ comissao: Comissao; novo: StatusComissao } | null>(null);

  const { podeExecutar } = usePapeis();
  const transicionar = useTransicionarComissao();

  const { data, isLoading, error, refetch } = useComissoes({
    status: status === TODOS ? undefined : status,
    pagina,
  });

  const itens = data?.itens ?? [];
  const total = data?.total ?? 0;

  // Uma transição só aparece se o servidor aceitaria: proximosStatus() espelha
  // a máquina de estados do SQL, e podeExecutar() espelha o guard de papel.
  const acoesPara = (c: Comissao): StatusComissao[] =>
    proximosStatus(c.status).filter((s) => {
      if (s === 'paga') return podeExecutar('pagar_comissao');
      if (s === 'estornada') return podeExecutar('estornar_comissao');
      if (s === 'aprovada') return podeExecutar('aprovar_comissao');
      return podeExecutar('aprovar_comissao');
    });

  const exportar = () => {
    baixarCsv(
      montarCsv(itens, [
        { cabecalho: 'Parceiro', valor: (c) => c.parceiro_nome },
        { cabecalho: 'Cliente', valor: (c) => c.corretor_nome },
        { cabecalho: 'Valor base', valor: (c) => c.valor_base },
        { cabecalho: 'Percentual', valor: (c) => c.percentual_aplicado },
        { cabecalho: 'Comissão', valor: (c) => c.valor_comissao },
        { cabecalho: 'Status', valor: (c) => ROTULO_STATUS[c.status] },
        { cabecalho: 'Gerada em', valor: (c) => dataBR(c.gerada_em) },
        { cabecalho: 'Aprovada em', valor: (c) => dataBR(c.aprovada_em) },
        { cabecalho: 'Paga em', valor: (c) => dataBR(c.paga_em) },
      ]),
      nomeArquivoCsv('comissoes'),
    );
  };

  return (
    <>
      <CabecalhoAdmin
        titulo="Comissões"
        descricao="Geradas automaticamente quando uma receita é confirmada para um cliente com parceiro."
        migalhas={[{ label: 'Back office', href: '/admin' }, { label: 'Comissões' }]}
        acoes={
          podeExecutar('exportar_dados') && itens.length > 0 ? (
            <Button variant="outline" size="sm" onClick={exportar}>
              <Download className="mr-2 h-4 w-4" />
              Exportar
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="filtro-status-comissao" className="text-xs text-muted-foreground">
            Status
          </Label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPagina(1);
            }}
          >
            <SelectTrigger id="filtro-status-comissao" className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas</SelectItem>
              {(Object.keys(ROTULO_STATUS) as StatusComissao[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {ROTULO_STATUS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {data?.totais && total > 0 && (
          <p className="pb-2 text-sm text-muted-foreground">
            {numero(total)} comissão(ões) · total{' '}
            <span className="font-medium text-foreground tabular-nums">
              {moeda(data.totais.valor_total)}
            </span>
          </p>
        )}
      </div>

      {error ? (
        <EstadoErro erro={error} aoTentarNovamente={() => void refetch()} />
      ) : isLoading && itens.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : itens.length === 0 ? (
        <EstadoVazio
          titulo={
            status !== TODOS ? 'Nenhuma comissão com esse status' : 'Nenhuma comissão gerada'
          }
          descricao={
            status !== TODOS
              ? 'Tente outro status.'
              : 'Comissões nascem de eventos de receita confirmados. Enquanto não houver receita registrada para clientes com parceiro, esta lista fica vazia.'
          }
          acao={
            status !== TODOS ? (
              <Button variant="outline" onClick={() => { setStatus(TODOS); setPagina(1); }}>
                Ver todas
              </Button>
            ) : (
              <Button variant="outline" asChild>
                <Link to="/admin/receita">Ir para Receita</Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <Card>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parceiro</TableHead>
                    <TableHead className="hidden md:table-cell">Cliente</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">%</TableHead>
                    <TableHead className="text-right">Comissão</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Gerada</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itens.map((c) => {
                    const acoes = acoesPara(c);
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Link
                            to={`/admin/parceiros/${c.parceiro_id}`}
                            className="text-sm font-medium hover:underline"
                          >
                            {c.parceiro_nome}
                          </Link>
                        </TableCell>
                        <TableCell className="hidden text-sm md:table-cell">
                          {c.corretor_id ? (
                            <Link
                              to={`/admin/usuarios/${c.corretor_id}`}
                              className="hover:underline"
                            >
                              {c.corretor_nome ?? 'Ver conta'}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {moeda(c.valor_base, true)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {percentual(c.percentual_aplicado)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {moeda(c.valor_comissao)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn(COR_STATUS[c.status])}>
                            {ROTULO_STATUS[c.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden text-sm lg:table-cell">
                          {dataBR(c.gerada_em)}
                        </TableCell>
                        <TableCell>
                          {acoes.length > 0 && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Ações da comissão de ${c.parceiro_nome}`}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {acoes.map((s) => (
                                  <DropdownMenuItem
                                    key={s}
                                    className={cn(
                                      (s === 'cancelada' || s === 'estornada') &&
                                        'text-destructive focus:text-destructive',
                                    )}
                                    onClick={() => setAlvo({ comissao: c, novo: s })}
                                  >
                                    Marcar como {ROTULO_STATUS[s].toLowerCase()}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
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
        </>
      )}

      <DialogoConfirmacao
        aberto={!!alvo}
        aoFechar={() => setAlvo(null)}
        titulo={alvo ? `Marcar como ${ROTULO_STATUS[alvo.novo].toLowerCase()}?` : ''}
        descricao={
          alvo
            ? alvo.novo === 'paga'
              ? `Registra ${moeda(alvo.comissao.valor_comissao)} como pago a ${alvo.comissao.parceiro_nome}. Depois disso, só um estorno reverte.`
              : alvo.novo === 'estornada'
                ? `Estorna ${moeda(alvo.comissao.valor_comissao)} de ${alvo.comissao.parceiro_nome}. A linha é preservada com o motivo, não excluída.`
                : `A comissão de ${alvo.comissao.parceiro_nome} passa para ${ROTULO_STATUS[alvo.novo].toLowerCase()}.`
            : ''
        }
        rotuloConfirmar="Confirmar"
        destrutivo={alvo?.novo === 'cancelada' || alvo?.novo === 'estornada'}
        exigirMotivo={alvo ? exigeJustificativa(alvo.novo) : false}
        aoConfirmar={async (motivo) => {
          if (!alvo) return;
          await transicionar.mutateAsync({
            comissaoId: alvo.comissao.id,
            novoStatus: alvo.novo,
            motivo: motivo || undefined,
          });
        }}
      />
    </>
  );
}
