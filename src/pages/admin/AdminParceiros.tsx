import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Plus, Download } from 'lucide-react';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { PaginacaoAdmin } from '@/components/admin/PaginacaoAdmin';
import { EstadoErro, EstadoVazio } from '@/components/admin/Estados';
import { FormularioParceiro } from '@/components/admin/FormularioParceiro';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useParceiros, ITENS_POR_PAGINA } from '@/hooks/admin/useAdminDados';
import { usePapeis } from '@/hooks/admin/usePapeis';
import { moeda, numero, percentual, documentoMascarado } from '@/lib/formato';
import { montarCsv, baixarCsv, nomeArquivoCsv } from '@/lib/admin/csv';
import { cn } from '@/lib/utils';

const COR_STATUS: Record<string, string> = {
  ativo: 'bg-success/10 text-success border-success/20',
  inativo: 'bg-muted text-muted-foreground border-border',
  suspenso: 'bg-warning/10 text-warning border-warning/20',
  encerrado: 'bg-destructive/10 text-destructive border-destructive/20',
};

const TODOS = 'TODOS';

export default function AdminParceiros() {
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState(TODOS);
  const [pagina, setPagina] = useState(1);
  const [criando, setCriando] = useState(false);

  const { podeExecutar } = usePapeis();
  const { data, isLoading, error, refetch } = useParceiros({
    busca: busca.trim() || undefined,
    status: status === TODOS ? undefined : status,
    pagina,
  });

  const itens = data?.itens ?? [];
  const total = data?.total ?? 0;
  const comFiltro = !!busca.trim() || status !== TODOS;

  const exportar = () => {
    baixarCsv(
      montarCsv(itens, [
        { cabecalho: 'Nome', valor: (p) => p.nome },
        { cabecalho: 'Empresa', valor: (p) => p.empresa },
        { cabecalho: 'E-mail', valor: (p) => p.email },
        { cabecalho: 'Status', valor: (p) => p.status },
        { cabecalho: 'Percentual vigente', valor: (p) => p.percentual_vigente },
        { cabecalho: 'Cliques', valor: (p) => p.total_cliques },
        { cabecalho: 'Cadastros', valor: (p) => p.total_conversoes },
        { cabecalho: 'Receita atribuída', valor: (p) => p.receita_atribuida },
        { cabecalho: 'Comissão pendente', valor: (p) => p.comissao_pendente },
        { cabecalho: 'Comissão aprovada', valor: (p) => p.comissao_aprovada },
        { cabecalho: 'Comissão paga', valor: (p) => p.comissao_paga },
      ]),
      nomeArquivoCsv('parceiros'),
    );
  };

  return (
    <>
      <CabecalhoAdmin
        titulo="Parceiros"
        descricao="Quem indica a Lotti, com que percentual e quanto já gerou."
        migalhas={[{ label: 'Back office', href: '/admin' }, { label: 'Parceiros' }]}
        acoes={
          <>
            {podeExecutar('exportar_dados') && itens.length > 0 && (
              <Button variant="outline" size="sm" onClick={exportar}>
                <Download className="mr-2 h-4 w-4" />
                Exportar
              </Button>
            )}
            {podeExecutar('criar_parceiro') && (
              <Button size="sm" onClick={() => setCriando(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Novo parceiro
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="busca-parceiros" className="text-xs text-muted-foreground">
            Buscar
          </Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="busca-parceiros"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setPagina(1);
              }}
              placeholder="Nome, empresa ou e-mail"
              className="pl-10"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filtro-status-parceiro" className="text-xs text-muted-foreground">
            Status
          </Label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPagina(1);
            }}
          >
            <SelectTrigger id="filtro-status-parceiro" className="w-full sm:w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              <SelectItem value="ativo">Ativo</SelectItem>
              <SelectItem value="inativo">Inativo</SelectItem>
              <SelectItem value="suspenso">Suspenso</SelectItem>
              <SelectItem value="encerrado">Encerrado</SelectItem>
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
          titulo={comFiltro ? 'Nenhum parceiro com esses filtros' : 'Nenhum parceiro cadastrado'}
          descricao={
            comFiltro
              ? 'Ajuste a busca ou limpe os filtros.'
              : 'Cadastre o primeiro parceiro para gerar o link exclusivo e começar a medir a origem dos cadastros.'
          }
          acao={
            comFiltro ? (
              <Button
                variant="outline"
                onClick={() => {
                  setBusca('');
                  setStatus(TODOS);
                  setPagina(1);
                }}
              >
                Limpar filtros
              </Button>
            ) : podeExecutar('criar_parceiro') ? (
              <Button variant="outline" onClick={() => setCriando(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Cadastrar primeiro parceiro
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
                    <TableHead>Parceiro</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Percentual</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Cliques</TableHead>
                    <TableHead className="text-right">Cadastros</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">
                      Receita atribuída
                    </TableHead>
                    <TableHead className="hidden text-right lg:table-cell">
                      Comissão em aberto
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itens.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link
                          to={`/admin/parceiros/${p.id}`}
                          className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {p.nome}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {p.empresa ?? p.email}
                          {p.documento ? ` · ${documentoMascarado(p.documento)}` : ''}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(COR_STATUS[p.status])}>
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.percentual_vigente === null ? (
                          // Parceiro sem regra vigente não gera comissão. Precisa
                          // ficar visível na listagem, não só no detalhe.
                          <span className="text-xs text-warning">Sem regra</span>
                        ) : (
                          percentual(p.percentual_vigente)
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {numero(p.total_cliques)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {numero(p.total_conversoes)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">
                        {moeda(p.receita_atribuida, true)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">
                        {moeda(p.comissao_pendente + p.comissao_aprovada, true)}
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
        </>
      )}

      <FormularioParceiro aberto={criando} aoFechar={() => setCriando(false)} />
    </>
  );
}
