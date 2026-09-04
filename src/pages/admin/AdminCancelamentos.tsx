import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Download, MessageSquareX } from 'lucide-react';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { CartaoMetrica } from '@/components/admin/CartaoMetrica';
import { FiltroPeriodo } from '@/components/admin/FiltroPeriodo';
import { PaginacaoAdmin } from '@/components/admin/PaginacaoAdmin';
import { EstadoErro, EstadoVazio } from '@/components/admin/Estados';
import { DialogoNovoCancelamento } from '@/components/admin/DialogoNovoCancelamento';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useCancelamentos, useMetricasCancelamento } from '@/hooks/admin/useSaasDados';
import { ITENS_POR_PAGINA } from '@/hooks/admin/useAdminDados';
import { usePapeis } from '@/hooks/admin/usePapeis';
import { MOTIVOS, ORIGENS, rotuloMotivo, rotuloOrigem } from '@/lib/admin/saas';
import { periodoDeAtalho, type AtalhoPeriodo, type Periodo } from '@/lib/admin/periodo';
import { dataBR, numero, percentual } from '@/lib/formato';
import { montarCsv, baixarCsv, nomeArquivoCsv } from '@/lib/admin/csv';

const TODOS = 'TODOS';

export default function AdminCancelamentos() {
  const [atalho, setAtalho] = useState<AtalhoPeriodo | 'personalizado'>('90d');
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDeAtalho('90d'));
  const [motivo, setMotivo] = useState(TODOS);
  const [origem, setOrigem] = useState(TODOS);
  const [pagina, setPagina] = useState(1);
  const [novoAberto, setNovoAberto] = useState(false);

  const { podeExecutar } = usePapeis();
  const metricas = useMetricasCancelamento(periodo);
  const { data, isLoading, error, refetch } = useCancelamentos({
    motivo: motivo === TODOS ? undefined : motivo,
    origem: origem === TODOS ? undefined : origem,
    de: periodo.inicio,
    ate: periodo.fim,
    pagina,
  });

  const itens = data?.itens ?? [];
  const total = data?.total ?? 0;
  const m = metricas.data;
  const maiorMotivo = m?.por_motivo?.[0]?.total ?? 0;

  const exportar = () => {
    baixarCsv(
      montarCsv(itens, [
        { cabecalho: 'Data', valor: (c) => dataBR(c.data_cancelamento) },
        { cabecalho: 'Conta', valor: (c) => c.nome },
        { cabecalho: 'Identificada', valor: (c) => (c.identificado ? 'Sim' : 'Nao') },
        { cabecalho: 'Plano anterior', valor: (c) => c.plano_anterior },
        { cabecalho: 'Motivo', valor: (c) => rotuloMotivo(c.motivo) },
        { cabecalho: 'Origem', valor: (c) => rotuloOrigem(c.origem) },
        { cabecalho: 'Comentario', valor: (c) => c.comentario },
      ]),
      nomeArquivoCsv('cancelamentos'),
    );
  };

  return (
    <>
      <CabecalhoAdmin
        titulo="Cancelamentos"
        descricao="Por que contas Lotti deixam de assinar. O motivo registrado é o que permite agir sobre o churn."
        migalhas={[{ label: 'Back office', href: '/admin' }, { label: 'Cancelamentos' }]}
        acoes={
          <div className="flex gap-2">
            {podeExecutar('exportar_dados') && itens.length > 0 && (
              <Button variant="outline" size="sm" onClick={exportar}>
                <Download className="mr-2 h-4 w-4" />
                Exportar
              </Button>
            )}
            {podeExecutar('registrar_cancelamento') && (
              <Button size="sm" onClick={() => setNovoAberto(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Registrar
              </Button>
            )}
          </div>
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

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CartaoMetrica
          titulo="No período"
          valor={numero(m?.no_periodo ?? 0)}
          icone={<MessageSquareX className="h-4 w-4" />}
          crescerEhRuim
          detalhe={m ? `${numero(m.total_geral)} no total` : undefined}
          carregando={metricas.isLoading}
        />
        <CartaoMetrica
          titulo="Últimos 30 dias"
          valor={numero(m?.ultimos_30 ?? 0)}
          crescerEhRuim
          carregando={metricas.isLoading}
        />
        <CartaoMetrica
          titulo="Motivo mais frequente"
          valor={m?.motivo_principal ? rotuloMotivo(m.motivo_principal) : '—'}
          ajuda="Motivo com mais registros no período escolhido."
          carregando={metricas.isLoading}
        />
      </div>

      {m && m.por_motivo.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Distribuição por motivo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {m.por_motivo.map((linha) => (
              <div key={linha.motivo} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span>{rotuloMotivo(linha.motivo)}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {numero(linha.total)}
                    {m.no_periodo > 0 && (
                      <span className="ml-2">
                        {percentual((linha.total / m.no_periodo) * 100, 0)}
                      </span>
                    )}
                  </span>
                </div>
                {/* Barra proporcional ao maior motivo, não ao total: com dez
                    motivos distribuídos, barras sobre o total ficariam todas
                    quase invisíveis e o ranking não se leria. */}
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: maiorMotivo > 0 ? `${(linha.total / maiorMotivo) * 100}%` : '0%',
                    }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="filtro-motivo" className="text-xs text-muted-foreground">
            Motivo
          </Label>
          <Select
            value={motivo}
            onValueChange={(v) => {
              setMotivo(v);
              setPagina(1);
            }}
          >
            <SelectTrigger id="filtro-motivo" className="w-full sm:w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              {MOTIVOS.map((mo) => (
                <SelectItem key={mo.valor} value={mo.valor}>
                  {mo.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filtro-origem" className="text-xs text-muted-foreground">
            Origem
          </Label>
          <Select
            value={origem}
            onValueChange={(v) => {
              setOrigem(v);
              setPagina(1);
            }}
          >
            <SelectTrigger id="filtro-origem" className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas</SelectItem>
              {ORIGENS.map((o) => (
                <SelectItem key={o.valor} value={o.valor}>
                  {o.label}
                </SelectItem>
              ))}
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
          titulo="Nenhum cancelamento registrado no período"
          descricao="Registre o motivo assim que souber dele. Cancelamento sem motivo registrado é churn que não se aprende a evitar."
          acao={
            podeExecutar('registrar_cancelamento') ? (
              <Button variant="outline" onClick={() => setNovoAberto(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Registrar cancelamento
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Card>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="hidden lg:table-cell">Data</TableHead>
                    <TableHead>Conta</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead className="hidden md:table-cell">Origem</TableHead>
                    <TableHead className="hidden xl:table-cell">Comentário</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itens.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="hidden text-sm lg:table-cell">
                        {dataBR(c.data_cancelamento)}
                      </TableCell>
                      <TableCell>
                        {c.corretor_id ? (
                          <Link
                            to={`/admin/usuarios/${c.corretor_id}`}
                            className="text-sm font-medium hover:underline"
                          >
                            {c.nome}
                          </Link>
                        ) : (
                          <span className="text-sm font-medium">{c.nome ?? '—'}</span>
                        )}
                        {c.plano_anterior && (
                          <p className="text-xs capitalize text-muted-foreground">
                            {c.plano_anterior}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{rotuloMotivo(c.motivo)}</Badge>
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">
                        {rotuloOrigem(c.origem)}
                      </TableCell>
                      <TableCell className="hidden max-w-md text-sm text-muted-foreground xl:table-cell">
                        {c.comentario ?? '—'}
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

      <DialogoNovoCancelamento aberto={novoAberto} aoFechar={() => setNovoAberto(false)} />
    </>
  );
}
