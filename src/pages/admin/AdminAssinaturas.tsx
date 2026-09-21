import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, CreditCard, TrendingDown, AlertTriangle, Wallet } from 'lucide-react';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { CartaoMetrica } from '@/components/admin/CartaoMetrica';
import { FiltroPeriodo } from '@/components/admin/FiltroPeriodo';
import { PaginacaoAdmin } from '@/components/admin/PaginacaoAdmin';
import { EstadoErro, EstadoVazio, SemDadosAinda } from '@/components/admin/Estados';
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
import { useAssinaturas, useMetricasSaas } from '@/hooks/admin/useSaasDados';
import { ITENS_POR_PAGINA } from '@/hooks/admin/useAdminDados';
import { usePapeis } from '@/hooks/admin/usePapeis';
import {
  ROTULO_ASSINATURA, COR_ASSINATURA, ROTULO_CICLO,
  type StatusAssinatura,
} from '@/lib/admin/saas';
import { periodoDeAtalho, type AtalhoPeriodo, type Periodo } from '@/lib/admin/periodo';
import { dataBR, moeda, numero, percentual } from '@/lib/formato';
import { montarCsv, baixarCsv, nomeArquivoCsv } from '@/lib/admin/csv';
import { cn } from '@/lib/utils';

const TODOS = 'TODOS';

export default function AdminAssinaturas() {
  const [atalho, setAtalho] = useState<AtalhoPeriodo | 'personalizado'>('30d');
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDeAtalho('30d'));
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState(TODOS);
  const [ciclo, setCiclo] = useState(TODOS);
  const [pagina, setPagina] = useState(1);

  const { podeExecutar } = usePapeis();
  const metricas = useMetricasSaas(periodo);
  const { data, isLoading, error, refetch } = useAssinaturas({
    busca: busca.trim() || undefined,
    status: status === TODOS ? undefined : status,
    ciclo: ciclo === TODOS ? undefined : ciclo,
    pagina,
  });

  const itens = data?.itens ?? [];
  const total = data?.total ?? 0;
  const m = metricas.data;
  // As tabelas de plano e assinatura vivem na migration 20260807120000, que
  // pode nao ter sido aplicada. Sem elas a resposta honesta e "nao instalado",
  // nao uma lista vazia que pareceria "ninguem assinou".
  const assinaturasIndisponiveis = data?.disponivel === false;
  const contagens = m?.assinaturas.disponivel ? m.assinaturas : null;

  const exportar = () => {
    baixarCsv(
      montarCsv(itens, [
        { cabecalho: 'Conta', valor: (a) => a.conta_nome },
        { cabecalho: 'E-mail', valor: (a) => a.conta_email },
        { cabecalho: 'Plano', valor: (a) => a.plano_nome },
        { cabecalho: 'Ciclo', valor: (a) => ROTULO_CICLO[a.ciclo] ?? a.ciclo },
        { cabecalho: 'Status', valor: (a) => ROTULO_ASSINATURA[a.status as StatusAssinatura] ?? a.status },
        { cabecalho: 'Valor mensal', valor: (a) => a.valor_mensal },
        { cabecalho: 'Proxima cobranca', valor: (a) => dataBR(a.proxima_cobranca) },
        { cabecalho: 'ID no gateway', valor: (a) => a.id_externo },
        { cabecalho: 'Criada em', valor: (a) => dataBR(a.criada_em) },
      ]),
      nomeArquivoCsv('assinaturas'),
    );
  };

  return (
    <>
      <CabecalhoAdmin
        titulo="Assinaturas"
        descricao="Contratos das contas Lotti. Não confundir com o Financeiro do CRM, que trata a operação imobiliária do cliente."
        migalhas={[{ label: 'Back office', href: '/admin' }, { label: 'Assinaturas' }]}
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
          }}
        />
      </div>

      {metricas.error ? (
        <div className="mb-6">
          <EstadoErro erro={metricas.error} aoTentarNovamente={() => void metricas.refetch()} />
        </div>
      ) : (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* MRR só vira número quando existe assinatura. Antes disso, "R$ 0,00"
              seria uma afirmação sobre o negócio que ninguém mediu. */}
          {m && !m.mrr.tem_dados ? (
            <SemDadosAinda
              titulo="MRR"
              explicacao="Nenhuma assinatura registrada ainda. O valor aparece quando o primeiro contrato entrar."
            />
          ) : (
            <CartaoMetrica
              titulo="MRR"
              valor={moeda(m?.mrr.valor ?? 0)}
              icone={<Wallet className="h-4 w-4" />}
              ajuda="Receita recorrente mensal das assinaturas ativas. Plano anual entra dividido por 12."
              detalhe={
                m && m.mrr.em_risco > 0
                  ? `${moeda(m.mrr.em_risco)} em risco (vencidas)`
                  : undefined
              }
              carregando={metricas.isLoading}
            />
          )}

          <CartaoMetrica
            titulo="Assinaturas ativas"
            valor={numero(contagens?.ativas ?? 0)}
            icone={<CreditCard className="h-4 w-4" />}
            detalhe={contagens ? `${numero(contagens.trials)} em teste` : undefined}
            carregando={metricas.isLoading}
          />

          <CartaoMetrica
            titulo="Inadimplência"
            valor={numero(m?.inadimplencia.assinaturas ?? 0)}
            icone={<AlertTriangle className="h-4 w-4" />}
            crescerEhRuim
            ajuda="Assinaturas com pagamento vencido. O valor é o MRR que deixou de entrar."
            detalhe={
              m && m.inadimplencia.valor_mensal > 0
                ? moeda(m.inadimplencia.valor_mensal)
                : undefined
            }
            carregando={metricas.isLoading}
          />

          <CartaoMetrica
            titulo="Churn no período"
            // Taxa nula significa que não havia base no início do período —
            // diferente de 0%, que afirmaria retenção perfeita.
            valor={m?.churn.taxa === null || m?.churn.taxa === undefined
              ? '—'
              : percentual(m.churn.taxa)}
            icone={<TrendingDown className="h-4 w-4" />}
            crescerEhRuim
            ajuda="Cancelamentos no período sobre as assinaturas que existiam no início dele."
            detalhe={
              m
                ? `${numero(m.churn.cancelados)} de ${numero(m.churn.ativos_inicio)} no início`
                : undefined
            }
            carregando={metricas.isLoading}
          />
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="busca-assinatura" className="text-xs text-muted-foreground">
            Buscar
          </Label>
          <Input
            id="busca-assinatura"
            placeholder="Nome ou e-mail da conta"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPagina(1);
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filtro-status-assinatura" className="text-xs text-muted-foreground">
            Status
          </Label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPagina(1);
            }}
          >
            <SelectTrigger id="filtro-status-assinatura" className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              {(Object.keys(ROTULO_ASSINATURA) as StatusAssinatura[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {ROTULO_ASSINATURA[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filtro-ciclo" className="text-xs text-muted-foreground">
            Ciclo
          </Label>
          <Select
            value={ciclo}
            onValueChange={(v) => {
              setCiclo(v);
              setPagina(1);
            }}
          >
            <SelectTrigger id="filtro-ciclo" className="w-full sm:w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              <SelectItem value="monthly">Mensal</SelectItem>
              <SelectItem value="annual">Anual</SelectItem>
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
      ) : assinaturasIndisponiveis ? (
        <EstadoVazio
          titulo="Planos e assinaturas ainda não existem nesta base"
          descricao="As tabelas `plans` e `subscriptions` vêm da migration 20260807120000_plans_subscriptions.sql, que não foi aplicada neste banco. Sem elas não há contrato para listar — e o provisionamento do checkout do site também não consegue ativar assinatura."
          acao={
            <Button variant="outline" asChild>
              <Link to="/admin/integracoes">Ver status das integrações</Link>
            </Button>
          }
        />
      ) : itens.length === 0 ? (
        <EstadoVazio
          titulo={
            busca || status !== TODOS || ciclo !== TODOS
              ? 'Nenhuma assinatura com esses filtros'
              : 'Nenhuma assinatura registrada'
          }
          descricao={
            busca || status !== TODOS || ciclo !== TODOS
              ? 'Tente outra combinação de filtros.'
              : 'As assinaturas nascem do checkout do site da Lotti. Enquanto ninguém tiver assinado, esta lista fica vazia.'
          }
          acao={
            busca || status !== TODOS || ciclo !== TODOS ? (
              <Button
                variant="outline"
                onClick={() => {
                  setBusca('');
                  setStatus(TODOS);
                  setCiclo(TODOS);
                  setPagina(1);
                }}
              >
                Limpar filtros
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
                    <TableHead>Conta</TableHead>
                    <TableHead className="hidden md:table-cell">Plano</TableHead>
                    <TableHead className="hidden lg:table-cell">Ciclo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Valor/mês</TableHead>
                    <TableHead className="hidden lg:table-cell">Próxima cobrança</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itens.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Link
                          to={`/admin/usuarios/${a.corretor_id}`}
                          className="text-sm font-medium hover:underline"
                        >
                          {a.conta_nome}
                        </Link>
                        <p className="text-xs text-muted-foreground">{a.conta_email}</p>
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">
                        {a.plano_nome}
                      </TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">
                        {ROTULO_CICLO[a.ciclo] ?? a.ciclo}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(COR_ASSINATURA[a.status as StatusAssinatura])}
                        >
                          {ROTULO_ASSINATURA[a.status as StatusAssinatura] ?? a.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {moeda(a.valor_mensal)}
                      </TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">
                        {a.status === 'trialing' && a.trial_termina_em
                          ? `Teste até ${dataBR(a.trial_termina_em)}`
                          : dataBR(a.proxima_cobranca)}
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
    </>
  );
}
