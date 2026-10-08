import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { PaginacaoAdmin } from '@/components/admin/PaginacaoAdmin';
import { EstadoErro, EstadoVazio } from '@/components/admin/Estados';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDiagnostics, diagnosticStatusLabels, DIAGNOSTICS_PAGE_SIZE, type DiagnosticFilters } from '@/hooks/admin/useDiagnostics';
import { segmentLabel, getQuestion } from '../../../supabase/functions/_shared/diagnostic/engine';

const segments = ['real_estate', 'construction', 'saas', 'health', 'automotive', 'food', 'services', 'ecommerce', 'other'];
const defaults: DiagnosticFilters = { search: '', status: '', temperature: '', segment: '', source: '', page: 1 };
const selectClass = 'h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const percent = (value: number, total: number) => total ? `${Math.round(value / total * 100)}%` : '—';

export default function AdminDiagnostics() {
  const [filters, setFilters] = useState(defaults);
  const search = useDeferredValue(filters.search);
  const query = useDiagnostics({ ...filters, search });
  const filter = (key: keyof DiagnosticFilters, value: string) => setFilters(previous => ({ ...previous, [key]: value, page: 1 }));
  const metrics = query.data?.metrics;
  return <>
    <CabecalhoAdmin titulo="Diagnósticos de crescimento" descricao="Da primeira resposta à próxima conversa. Leads da operação Gabriel Trindade."
      migalhas={[{ label: 'Back office', href: '/admin' }, { label: 'Diagnósticos GT' }]}
      acoes={<><Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button><Button asChild><Link to="/diagnostico" target="_blank">Abrir diagnóstico<ArrowUpRight className="ml-2 h-4 w-4" /></Link></Button></>} />
    <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        ['Inícios', metrics?.started, 'Sessões iniciadas'],
        ['Contatos recuperáveis', metrics?.contacts, metrics ? `${percent(metrics.contacts, metrics.started)} dos inícios` : ''],
        ['Concluídos', metrics?.completed, metrics ? `${percent(metrics.completed, metrics.started)} dos inícios` : ''],
        ['Abandonados', metrics?.abandoned, '24 horas sem atividade'],
      ].map(([label, value, subtitle]) => <div key={label} className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="my-1 text-3xl font-semibold tabular-nums">{value ?? '—'}</p><p className="text-xs text-muted-foreground">{subtitle}</p></div>)}
    </div>
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <label className="text-xs font-medium">Buscar<Input value={filters.search} onChange={e => filter('search', e.target.value)} placeholder="Nome, empresa ou contato" className="mt-1" /></label>
      <label className="text-xs font-medium">Status<select className={`${selectClass} mt-1`} value={filters.status} onChange={e => filter('status', e.target.value)}><option value="">Todos</option>{Object.entries(diagnosticStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="text-xs font-medium">Temperatura<select className={`${selectClass} mt-1`} value={filters.temperature} onChange={e => filter('temperature', e.target.value)}><option value="">Todas</option>{['HOT', 'WARM', 'COLD'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="text-xs font-medium">Segmento<select className={`${selectClass} mt-1`} value={filters.segment} onChange={e => filter('segment', e.target.value)}><option value="">Todos</option>{segments.map(value => <option key={value} value={value}>{segmentLabel(value)}</option>)}</select></label>
      <label className="text-xs font-medium">Origem<Input className="mt-1" value={filters.source} onChange={e => filter('source', e.target.value)} placeholder="Ex.: instagram" /></label>
    </div>
    {Object.entries(filters).some(([key, value]) => key !== 'page' && value) && <Button variant="ghost" size="sm" className="mb-3" onClick={() => setFilters(defaults)}>Limpar filtros</Button>}
    {query.isLoading ? <p role="status" className="py-12 text-center text-muted-foreground">Carregando diagnósticos…</p> : query.error ? <EstadoErro erro={query.error} aoTentarNovamente={() => void query.refetch()} /> : !query.data?.items.length ? <EstadoVazio titulo="Nenhum diagnóstico neste recorte" descricao="Os primeiros contatos aparecerão aqui assim que forem salvos na conversa." /> : <>
      <div className="overflow-hidden rounded-xl border bg-card"><Table><TableHeader><TableRow>{['Nome / empresa', 'Contato', 'Segmento', 'Score', 'Temperatura', 'Status', 'Origem', 'Data'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>
        {query.data.items.map(row => <TableRow key={row.id}>
          <TableCell className="min-w-40"><Link className="font-medium underline-offset-4 hover:underline focus-visible:underline" to={`/admin/diagnosticos/${row.id}`}>{row.lead?.name || 'Sem contato ainda'}</Link><p className="text-xs text-muted-foreground">{row.lead?.company || '—'}</p></TableCell>
          <TableCell className="text-xs"><div>{row.lead?.phone || '—'}</div><div>{row.lead?.email}</div></TableCell>
          <TableCell>{row.lead?.segment ? segmentLabel(row.lead.segment) : '—'}</TableCell>
          <TableCell>{row.score ?? '—'}</TableCell><TableCell><Badge variant={row.temperature === 'HOT' ? 'default' : 'secondary'}>{row.temperature || 'Sem avaliação'}</Badge></TableCell>
          <TableCell className="whitespace-nowrap">{diagnosticStatusLabels[row.status]}</TableCell><TableCell>{row.utm_source || row.source || 'Direto'}</TableCell><TableCell className="whitespace-nowrap">{new Date(row.started_at).toLocaleDateString('pt-BR')}</TableCell>
        </TableRow>)}
      </TableBody></Table></div>
      <div className="mt-4"><PaginacaoAdmin pagina={filters.page} porPagina={DIAGNOSTICS_PAGE_SIZE} total={query.data.total} aoMudarPagina={page => setFilters(previous => ({ ...previous, page }))} /></div>
    </>}
    {metrics && <div className="mt-8 grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border p-5"><h2 className="font-serif text-lg">Qualificação e interesse</h2><p className="mt-2 text-sm">{metrics.hot} HOT · {metrics.warm} WARM · {metrics.cold} COLD</p><p className="mt-2 text-sm text-muted-foreground">{metrics.cta} solicitações de conversa ({percent(metrics.cta, metrics.completed)} dos concluídos).</p><p className="mt-3 text-xs text-muted-foreground">As métricas consideram o recorte dos filtros. A temperatura é uma regra comercial interna, não uma previsão de compra.</p></section>
      <section className="rounded-xl border p-5"><h2 className="font-serif text-lg">Última resposta antes do abandono</h2>{query.data.dropoff.length ? <ul className="mt-3 space-y-2 text-sm">{query.data.dropoff.map(item => <li key={item.question_id} className="flex justify-between gap-4"><span>{getQuestion(item.question_id)?.prompt || item.question_id}</span><strong>{item.count}</strong></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">Ainda não há abandono registrado neste recorte.</p>}</section>
      {!!query.data.source_quality.length && <section className="rounded-xl border p-5 lg:col-span-2"><h2 className="mb-3 font-serif text-lg">Qualidade por origem</h2><div className="flex flex-wrap gap-5">{query.data.source_quality.map(item => <p key={item.source} className="text-sm"><strong>{item.source || 'Direto'}</strong><br />{item.total} sessões · {item.hot} HOT · {item.warm} WARM · {item.cold} COLD</p>)}</div></section>}
    </div>}
  </>;
}
