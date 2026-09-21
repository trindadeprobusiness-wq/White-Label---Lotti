import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, AlertTriangle } from 'lucide-react';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { FiltroPeriodo } from '@/components/admin/FiltroPeriodo';
import { PaginacaoAdmin } from '@/components/admin/PaginacaoAdmin';
import { EstadoErro, EstadoVazio } from '@/components/admin/Estados';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePagamentos } from '@/hooks/admin/useSaasDados';
import { ITENS_POR_PAGINA } from '@/hooks/admin/useAdminDados';
import { usePapeis } from '@/hooks/admin/usePapeis';
import {
  ROTULO_PAGAMENTO, COR_PAGAMENTO, ROTULO_METODO, ROTULO_CICLO,
  type StatusPagamento,
} from '@/lib/admin/saas';
import { periodoDeAtalho, type AtalhoPeriodo, type Periodo } from '@/lib/admin/periodo';
import { dataBR, dataHoraBR, moeda } from '@/lib/formato';
import { montarCsv, baixarCsv, nomeArquivoCsv } from '@/lib/admin/csv';
import { cn } from '@/lib/utils';

const TODOS = 'TODOS';

export default function AdminPagamentos() {
  const [atalho, setAtalho] = useState<AtalhoPeriodo | 'personalizado'>('30d');
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDeAtalho('30d'));
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState(TODOS);
  const [metodo, setMetodo] = useState(TODOS);
  const [pagina, setPagina] = useState(1);

  const { podeExecutar } = usePapeis();
  const { data, isLoading, error, refetch } = usePagamentos({
    busca: busca.trim() || undefined,
    status: status === TODOS ? undefined : status,
    metodo: metodo === TODOS ? undefined : metodo,
    de: periodo.inicio,
    ate: periodo.fim,
    pagina,
  });

  const itens = data?.itens ?? [];
  const total = data?.total ?? 0;
  const totais = data?.totais;

  const exportar = () => {
    baixarCsv(
      montarCsv(itens, [
        { cabecalho: 'Criado em', valor: (p) => dataBR(p.criado_em) },
        { cabecalho: 'Pagador', valor: (p) => p.pagador },
        { cabecalho: 'E-mail', valor: (p) => p.email },
        { cabecalho: 'Plano', valor: (p) => p.plano },
        { cabecalho: 'Ciclo', valor: (p) => ROTULO_CICLO[p.ciclo] ?? p.ciclo },
        { cabecalho: 'Metodo', valor: (p) => ROTULO_METODO[p.metodo] ?? p.metodo },
        { cabecalho: 'Valor', valor: (p) => p.valor },
        { cabecalho: 'Status', valor: (p) => ROTULO_PAGAMENTO[p.status as StatusPagamento] ?? p.status },
        // Status bruto preservado: é o que permite conferir contra o painel
        // do gateway quando o rótulo traduzido não basta para diagnosticar.
        { cabecalho: 'Status bruto', valor: (p) => p.status },
        { cabecalho: 'ID cobranca', valor: (p) => p.id_cobranca },
        { cabecalho: 'ID assinatura', valor: (p) => p.id_assinatura },
      ]),
      nomeArquivoCsv('pagamentos-saas'),
    );
  };

  // A tabela do checkout vive no repositório do site. Sem ela, a resposta
  // honesta é "não instalado", não uma lista vazia que pareceria "ninguém
  // pagou nada".
  if (data && data.disponivel === false) {
    return (
      <>
        <CabecalhoAdmin
          titulo="Pagamentos"
          descricao="Cobranças das assinaturas da Lotti."
          migalhas={[{ label: 'Back office', href: '/admin' }, { label: 'Pagamentos' }]}
        />
        <EstadoVazio
          titulo="O checkout ainda não está instalado nesta base"
          descricao="Os pedidos de assinatura são gravados pela migration do site da Lotti (20260826090000_asaas_saas_checkout.sql). Enquanto ela não for aplicada neste banco, não há histórico de cobrança para mostrar aqui."
          acao={
            <Button variant="outline" asChild>
              <Link to="/admin/integracoes">Ver status das integrações</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <CabecalhoAdmin
        titulo="Pagamentos"
        descricao="Cobranças das assinaturas da Lotti, como o gateway as reportou."
        migalhas={[{ label: 'Back office', href: '/admin' }, { label: 'Pagamentos' }]}
        acoes={
          podeExecutar('exportar_dados') && itens.length > 0 ? (
            <Button variant="outline" size="sm" onClick={exportar}>
              <Download className="mr-2 h-4 w-4" />
              Exportar
            </Button>
          ) : null
        }
      />

      <div className="mb-4">
        <FiltroPeriodo
          atalho={atalho}
          periodo={periodo}
          aoMudar={(a, p) => {
            setAtalho(a);
            setPeriodo(p);
            setPagina(1);
          }}
        />
      </div>

      {totais && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { rotulo: 'Recebido', valor: totais.recebido, cor: 'text-emerald-600 dark:text-emerald-400' },
            { rotulo: 'Pendente', valor: totais.pendente, cor: 'text-blue-600 dark:text-blue-400' },
            { rotulo: 'Vencido', valor: totais.vencido, cor: 'text-amber-600 dark:text-amber-400' },
            { rotulo: 'Estornado', valor: totais.estornado, cor: 'text-purple-600 dark:text-purple-400' },
          ].map((t) => (
            <Card key={t.rotulo}>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{t.rotulo}</p>
                <p className={cn('mt-1 text-2xl font-semibold tabular-nums', t.cor)}>
                  {moeda(t.valor)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="busca-pagamento" className="text-xs text-muted-foreground">
            Buscar
          </Label>
          <Input
            id="busca-pagamento"
            placeholder="Nome ou e-mail do pagador"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPagina(1);
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filtro-status-pagamento" className="text-xs text-muted-foreground">
            Status
          </Label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPagina(1);
            }}
          >
            <SelectTrigger id="filtro-status-pagamento" className="w-full sm:w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              {(Object.keys(ROTULO_PAGAMENTO) as StatusPagamento[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {ROTULO_PAGAMENTO[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filtro-metodo" className="text-xs text-muted-foreground">
            Método
          </Label>
          <Select
            value={metodo}
            onValueChange={(v) => {
              setMetodo(v);
              setPagina(1);
            }}
          >
            <SelectTrigger id="filtro-metodo" className="w-full sm:w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              <SelectItem value="PIX">Pix</SelectItem>
              <SelectItem value="CREDIT_CARD">Cartão de crédito</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
          titulo="Nenhuma cobrança no período"
          descricao="Ajuste o período ou os filtros. Cobranças aparecem aqui assim que o checkout do site registrar um pedido."
        />
      ) : (
        <>
          <Card>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="hidden lg:table-cell">Data</TableHead>
                    <TableHead>Pagador</TableHead>
                    <TableHead className="hidden md:table-cell">Plano</TableHead>
                    <TableHead className="hidden lg:table-cell">Método</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden xl:table-cell">Conta criada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itens.map((p) => {
                    // Pago sem acesso enviado é o pior estado do funil: o
                    // dinheiro entrou e a pessoa não conseguiu usar. Precisa
                    // saltar aos olhos na linha, não ficar só num relatório.
                    const pagoSemAcesso = p.status === 'active' && !p.acesso_enviado_em;
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="hidden text-sm lg:table-cell">
                          {dataBR(p.criado_em)}
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-medium">{p.pagador}</p>
                          <p className="text-xs text-muted-foreground">{p.email}</p>
                        </TableCell>
                        <TableCell className="hidden text-sm capitalize md:table-cell">
                          {p.plano}
                          <span className="block text-xs text-muted-foreground">
                            {ROTULO_CICLO[p.ciclo] ?? p.ciclo}
                          </span>
                        </TableCell>
                        <TableCell className="hidden text-sm lg:table-cell">
                          {ROTULO_METODO[p.metodo] ?? p.metodo}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {moeda(p.valor)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className={cn(COR_PAGAMENTO[p.status as StatusPagamento])}
                            >
                              {ROTULO_PAGAMENTO[p.status as StatusPagamento] ?? p.status}
                            </Badge>
                            {pagoSemAcesso && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    tabIndex={0}
                                    aria-label="Pago, mas o acesso ainda não foi enviado"
                                  >
                                    <AlertTriangle className="h-4 w-4 text-destructive" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Pago, mas o acesso ainda não foi enviado.
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden text-sm xl:table-cell">
                          {p.corretor_id ? (
                            <Link
                              to={`/admin/usuarios/${p.corretor_id}`}
                              className="hover:underline"
                            >
                              {p.conta_nome ?? 'Ver conta'}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">
                              {p.acesso_enviado_em ? dataHoraBR(p.acesso_enviado_em) : '—'}
                            </span>
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
    </>
  );
}
