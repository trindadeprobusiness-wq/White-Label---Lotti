import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import { listarContratosCentralApi, opcoesClientesApi, opcoesImoveisApi } from '@/lib/api/contratos';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  FileSignature, Sparkles, Search, Building, User, CalendarClock, AlertTriangle,
  CheckCircle, Eye, Handshake, KeyRound,
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { TIPO_CONTRATO_LABELS } from '@/types/crm';
import type { TipoContrato } from '@/types/crm';
import { useDocumentos } from '@/hooks/useDocumentos';
import { DocumentoViewer } from './DocumentoViewer';
import { AnalisarContratoDialog } from './AnalisarContratoDialog';

interface ContratoRow {
  id: string;
  tipo: TipoContrato;
  status: string | null;
  valor: number | null;
  data_inicio: string | null;
  data_fim: string | null;
  observacoes: string | null;
  arquivo_url: string | null;
  imovel_id: string | null;
  cliente_id: string | null;
  created_at: string | null;
  imoveis?: { titulo: string | null } | null;
  clientes?: { nome: string | null } | null;
}

type VencFiltro = 'TODOS' | 'PROXIMOS' | 'VENCIDOS' | 'VIGENTES';
type TipoFiltro = 'TODOS' | 'EXCLUSIVIDADE' | 'COMPRA_VENDA' | 'OUTROS';

const EXCLUSIVIDADE = ['EXCLUSIVIDADE_VENDA', 'EXCLUSIVIDADE_LOCACAO'];

function diasParaVencer(dataFim: string | null): number | null {
  if (!dataFim) return null;
  return differenceInDays(new Date(dataFim + 'T00:00:00'), new Date(new Date().toDateString()));
}

/** Faixa de vencimento com cor — mesma lógica dos documentos. */
function vencInfo(dias: number | null) {
  if (dias === null) return { label: 'Sem vencimento', cls: 'text-muted-foreground', border: 'border-border' };
  if (dias < 0) return { label: `Vencido há ${Math.abs(dias)}d`, cls: 'text-destructive', border: 'border-destructive/40' };
  if (dias === 0) return { label: 'Vence hoje', cls: 'text-destructive', border: 'border-destructive/40' };
  if (dias <= 10) return { label: `Vence em ${dias}d`, cls: 'text-destructive', border: 'border-destructive/40' };
  if (dias <= 20) return { label: `Vence em ${dias}d`, cls: 'text-warning', border: 'border-warning/40' };
  return { label: `Vence em ${dias}d`, cls: 'text-muted-foreground', border: 'border-border' };
}

export function ContratosCentral() {
  const { getSignedUrl, downloadDocumento } = useDocumentos();
  const [contratos, setContratos] = useState<ContratoRow[]>([]);
  const [imoveis, setImoveis] = useState<{ id: string; titulo: string; endereco?: string | null }[]>([]);
  const [clientes, setClientes] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [analisarOpen, setAnalisarOpen] = useState(false);
  const [viewerPath, setViewerPath] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState<TipoFiltro>('TODOS');
  const [vencFiltro, setVencFiltro] = useState<VencFiltro>('TODOS');

  const fetchContratos = useCallback(async () => {
    setLoading(true);
    if (apiDisponivel()) {
      // Erro de leitura ignorado como hoje: lista vazia.
      const linhas = await listarContratosCentralApi().catch(() => []);
      setContratos(linhas as unknown as ContratoRow[]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('contratos')
      .select('id, tipo, status, valor, data_inicio, data_fim, observacoes, arquivo_url, imovel_id, cliente_id, created_at, imoveis(titulo), clientes(nome)')
      .order('data_fim', { ascending: true, nullsFirst: false });
    setContratos((data as unknown as ContratoRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchContratos();
    (async () => {
      if (apiDisponivel()) {
        const [imApi, clApi] = await Promise.all([
          opcoesImoveisApi<{ id: string; titulo: string; endereco?: string | null }>(['id', 'titulo', 'endereco']).catch(() => null),
          opcoesClientesApi<{ id: string; nome: string }>(['id', 'nome']).catch(() => null),
        ]);
        if (imApi) setImoveis(imApi);
        if (clApi) setClientes(clApi);
        return;
      }
      const [im, cl] = await Promise.all([
        supabase.from('imoveis').select('id, titulo, endereco').order('titulo'),
        supabase.from('clientes').select('id, nome').order('nome'),
      ]);
      if (im.data) setImoveis(im.data);
      if (cl.data) setClientes(cl.data);
    })();
  }, [fetchContratos]);

  const kpis = useMemo(() => {
    let exclusividades = 0, proximos = 0, vencidos = 0;
    for (const c of contratos) {
      if (EXCLUSIVIDADE.includes(c.tipo)) exclusividades++;
      const d = diasParaVencer(c.data_fim);
      if (d !== null) {
        if (d < 0) vencidos++;
        else if (d <= 30) proximos++;
      }
    }
    return { total: contratos.length, exclusividades, proximos, vencidos };
  }, [contratos]);

  const filtrados = useMemo(() => {
    return contratos.filter((c) => {
      const d = diasParaVencer(c.data_fim);
      const okTipo =
        tipoFiltro === 'TODOS' ? true :
        tipoFiltro === 'EXCLUSIVIDADE' ? EXCLUSIVIDADE.includes(c.tipo) :
        tipoFiltro === 'COMPRA_VENDA' ? c.tipo === 'COMPRA_VENDA' :
        !EXCLUSIVIDADE.includes(c.tipo) && c.tipo !== 'COMPRA_VENDA';
      const okVenc =
        vencFiltro === 'TODOS' ? true :
        vencFiltro === 'VENCIDOS' ? d !== null && d < 0 :
        vencFiltro === 'PROXIMOS' ? d !== null && d >= 0 && d <= 30 :
        d !== null && d > 30; // VIGENTES
      const q = search.toLowerCase();
      const okSearch = !q ||
        c.imoveis?.titulo?.toLowerCase().includes(q) ||
        c.clientes?.nome?.toLowerCase().includes(q) ||
        (TIPO_CONTRATO_LABELS[c.tipo] || '').toLowerCase().includes(q);
      return okTipo && okVenc && okSearch;
    });
  }, [contratos, tipoFiltro, vencFiltro, search]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-primary" /> Central de Contratos
          </h2>
          <p className="text-sm text-muted-foreground">
            Exclusividade e compra e venda — a IA lê o contrato e o sistema avisa antes do vencimento.
          </p>
        </div>
        <Button onClick={() => setAnalisarOpen(true)}>
          <Sparkles className="h-4 w-4 mr-2" /> Analisar Contrato
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total" value={kpis.total} />
        <KpiCard label="Exclusividades" value={kpis.exclusividades} tone="primary" />
        <KpiCard label="Próximos (30d)" value={kpis.proximos} tone="warning" />
        <KpiCard label="Vencidos" value={kpis.vencidos} tone="destructive" />
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Buscar por imóvel, cliente ou tipo..." value={search}
                onChange={(e) => setSearch(e.target.value)} className="pl-10" />
            </div>
            <Select value={tipoFiltro} onValueChange={(v) => setTipoFiltro(v as TipoFiltro)}>
              <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">Todos os tipos</SelectItem>
                <SelectItem value="EXCLUSIVIDADE">Exclusividade</SelectItem>
                <SelectItem value="COMPRA_VENDA">Compra e Venda</SelectItem>
                <SelectItem value="OUTROS">Outros</SelectItem>
              </SelectContent>
            </Select>
            <Select value={vencFiltro} onValueChange={(v) => setVencFiltro(v as VencFiltro)}>
              <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">Todos os prazos</SelectItem>
                <SelectItem value="PROXIMOS">Próximos (30 dias)</SelectItem>
                <SelectItem value="VENCIDOS">Vencidos</SelectItem>
                <SelectItem value="VIGENTES">Vigentes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-4">
          <CardTitle className="text-lg">Contratos</CardTitle>
          <span className="text-sm text-muted-foreground">{filtrados.length} de {contratos.length}</span>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
            </div>
          ) : filtrados.length === 0 ? (
            <div className="text-center py-12">
              <div className="p-4 rounded-full bg-primary/10 w-fit mx-auto mb-4">
                <FileSignature className="w-8 h-8 text-primary" />
              </div>
              <h3 className="font-medium mb-1">
                {contratos.length === 0 ? 'Nenhum contrato ainda' : 'Nenhum contrato com esses filtros'}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Envie um contrato de exclusividade ou compra e venda para a IA analisar.
              </p>
              <Button onClick={() => setAnalisarOpen(true)}>
                <Sparkles className="w-4 h-4 mr-2" /> Analisar Contrato
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {filtrados.map((c) => {
                const dias = diasParaVencer(c.data_fim);
                const v = vencInfo(dias);
                const isExc = EXCLUSIVIDADE.includes(c.tipo);
                return (
                  <div key={c.id} className={cn('flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-muted/50 rounded-lg gap-3 border', v.border)}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn('p-2 rounded-lg shrink-0', isExc ? 'bg-primary/10' : 'bg-blue-500/10')}>
                        {isExc ? <KeyRound className="w-5 h-5 text-primary" /> : <Handshake className="w-5 h-5 text-blue-500" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium truncate">{c.imoveis?.titulo || 'Contrato sem imóvel'}</p>
                          <Badge variant="secondary" className="text-xs shrink-0">{TIPO_CONTRATO_LABELS[c.tipo]}</Badge>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                          {c.clientes?.nome && <span className="flex items-center gap-1"><User className="w-3 h-3" />{c.clientes.nome}</span>}
                          {c.valor ? <span>• R$ {Number(c.valor).toLocaleString('pt-BR')}</span> : null}
                          {c.data_fim && (
                            <span className={cn('flex items-center gap-1', v.cls)}>
                              <CalendarClock className="w-3 h-3" />
                              {format(new Date(c.data_fim + 'T00:00:00'), 'dd/MM/yyyy', { locale: ptBR })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 justify-end">
                      <Badge variant="outline" className={cn('shrink-0', v.cls, v.border)}>{v.label}</Badge>
                      {c.arquivo_url && (
                        <Button variant="ghost" size="sm" onClick={() => setViewerPath(c.arquivo_url)} title="Ver contrato">
                          <Eye className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AnalisarContratoDialog
        open={analisarOpen}
        onOpenChange={setAnalisarOpen}
        imoveis={imoveis}
        clientes={clientes}
        onSaved={fetchContratos}
      />

      {viewerPath && (
        <DocumentoViewer
          open={!!viewerPath}
          onOpenChange={(o) => !o && setViewerPath(null)}
          nome="Contrato"
          arquivoPath={viewerPath}
          getSignedUrl={getSignedUrl}
          onDownload={downloadDocumento}
        />
      )}
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: number; tone?: 'primary' | 'warning' | 'destructive' }) {
  const color = tone === 'primary' ? 'text-primary'
    : tone === 'warning' ? 'text-warning'
    : tone === 'destructive' ? 'text-destructive'
    : 'text-foreground';
  return (
    <Card>
      <CardContent className="pt-4 pb-4 text-center">
        <p className={cn('text-2xl font-bold', value > 0 && tone === 'destructive' ? color : color)}>{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
