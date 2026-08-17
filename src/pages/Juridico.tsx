import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, ArrowUpDown, Building, Check, CheckCircle, Clock, Download, Edit, Eye, File, FileImage, FileSignature, FileText, Plus, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { format, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { GerarContratoDialog } from '@/components/juridico/GerarContratoDialog';
import { DocumentoUploadArea } from '@/components/juridico/DocumentoUploadArea';
import { DocumentoViewer } from '@/components/juridico/DocumentoViewer';
import { EditarDocumentoDialog } from '@/components/juridico/EditarDocumentoDialog';
import { useDocumentos, DocumentoRow } from '@/hooks/useDocumentos';
import { ContratosCentral } from '@/components/juridico/ContratosCentral';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
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
import { PageHeader } from '@/components/shell/PageHeader';
import {
  abasSublinhadas, SectionCard, QuickActionRow,
} from '@/components/shell/primitivos';
import { numero } from '@/lib/formato';

interface ClienteSimples {
  id: string;
  nome: string;
}

interface ImovelSimples {
  id: string;
  titulo: string;
}

type StatusFilter = 'TODOS' | 'validado' | 'pendente' | 'vencendo' | 'vencido';
type SortOption = 'recentes' | 'antigos' | 'nome' | 'validade';

// Mapeamento de tipos para labels legíveis
const TIPO_LABELS: Record<string, string> = {
  'RG': 'RG',
  'CPF': 'CPF',
  'CNH': 'CNH',
  'CERTIDAO_NASCIMENTO': 'Cert. Nascimento',
  'CERTIDAO_CASAMENTO': 'Cert. Casamento',
  'COMPROVANTE_RESIDENCIA': 'Comp. Residência',
  'COMPROVANTE_RENDA': 'Comp. Renda',
  'EXTRATO_BANCARIO': 'Extrato Bancário',
  'IRPF': 'IRPF',
  'ESCRITURA': 'Escritura',
  'MATRICULA': 'Matrícula',
  'IPTU': 'IPTU',
  'LAUDO_VISTORIA': 'Laudo Vistoria',
  'PLANTA': 'Planta',
  'HABITE_SE': 'Habite-se',
  'CND_FEDERAL': 'CND Federal',
  'CND_ESTADUAL': 'CND Estadual',
  'CND_MUNICIPAL': 'CND Municipal',
  'CND_TRABALHISTA': 'CND Trabalhista',
  'CERTIDAO_DISTRIBUIDOR': 'Cert. Distribuidor',
  'PROCURACAO': 'Procuração',
  'CONTRATO': 'Contrato',
  'CRECI': 'CRECI',
  'FICHA_CADASTRO': 'Ficha Cadastro',
  'OUTRO': 'Outro',
};

// Cores por categoria de tipo
const TIPO_CORES: Record<string, string> = {
  'RG': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  'CPF': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  'CNH': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  'CERTIDAO_NASCIMENTO': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  'CERTIDAO_CASAMENTO': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  'COMPROVANTE_RESIDENCIA': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  'COMPROVANTE_RENDA': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  'EXTRATO_BANCARIO': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  'IRPF': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  'ESCRITURA': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'MATRICULA': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'IPTU': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'LAUDO_VISTORIA': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'PLANTA': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'HABITE_SE': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'CND_FEDERAL': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  'CND_ESTADUAL': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  'CND_MUNICIPAL': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  'CND_TRABALHISTA': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  'CERTIDAO_DISTRIBUIDOR': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  'PROCURACAO': 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  'CONTRATO': 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  'CRECI': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  'FICHA_CADASTRO': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  'OUTRO': 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300',
};

export default function Juridico() {
  const {
    documentos,
    loading,
    uploading,
    uploadDocumento,
    deleteDocumento,
    getSignedUrl,
    downloadDocumento,
    toggleValidacao,
    fetchDocumentos,
  } = useDocumentos();

  const [contratoDialogOpen, setContratoDialogOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<DocumentoRow | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [docToDelete, setDocToDelete] = useState<DocumentoRow | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [docToEdit, setDocToEdit] = useState<DocumentoRow | null>(null);
  const [clientes, setClientes] = useState<ClienteSimples[]>([]);
  const [imoveis, setImoveis] = useState<ImovelSimples[]>([]);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('TODOS');
  const [clienteFilter, setClienteFilter] = useState<string>('TODOS');
  const [sortOption, setSortOption] = useState<SortOption>('recentes');

  // Fetch clientes and imoveis from Supabase
  useEffect(() => {
    const fetchData = async () => {
      const [clientesRes, imoveisRes] = await Promise.all([
        supabase.from('clientes').select('id, nome').order('nome'),
        supabase.from('imoveis').select('id, titulo').order('titulo'),
      ]);
      if (clientesRes.data) setClientes(clientesRes.data);
      if (imoveisRes.data) setImoveis(imoveisRes.data);
    };
    fetchData();
  }, []);

  const getDocumentoStatus = (doc: DocumentoRow): 'validado' | 'pendente' | 'vencendo' | 'vencido' => {
    if (!doc.data_validade) {
      return doc.validado ? 'validado' : 'pendente';
    }
    const days = differenceInDays(new Date(doc.data_validade), new Date());
    if (days < 0) return 'vencido';
    if (days <= 7) return 'vencendo';
    return doc.validado ? 'validado' : 'pendente';
  };

  const getClienteNome = (clienteId?: string | null) => {
    if (!clienteId) return null;
    const cliente = clientes.find((c) => c.id === clienteId);
    return cliente?.nome || null;
  };

  const getImovelNome = (imovelId?: string | null) => {
    if (!imovelId) return null;
    const imovel = imoveis.find((i) => i.id === imovelId);
    return imovel?.titulo || null;
  };

  const getFileIcon = (arquivoPath?: string | null) => {
    if (!arquivoPath) return FileText;
    const ext = arquivoPath.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png'].includes(ext || '')) return FileImage;
    if (['doc', 'docx'].includes(ext || '')) return File;
    return FileText;
  };

  // KPIs
  const kpis = useMemo(() => {
    const total = documentos.length;
    let validados = 0;
    let pendentes = 0;
    let vencendo = 0;
    let vencidos = 0;

    documentos.forEach(doc => {
      const status = getDocumentoStatus(doc);
      switch (status) {
        case 'validado': validados++; break;
        case 'pendente': pendentes++; break;
        case 'vencendo': vencendo++; break;
        case 'vencido': vencidos++; break;
      }
    });

    return { total, validados, pendentes, vencendo, vencidos };
  }, [documentos]);

  // Filtered and sorted documents
  const filteredDocumentos = useMemo(() => {
    const result = documentos.filter(doc => {
      const status = getDocumentoStatus(doc);
      const matchesStatus = statusFilter === 'TODOS' || status === statusFilter;
      const matchesCliente = clienteFilter === 'TODOS' || 
        (clienteFilter === 'SEM_CLIENTE' && !doc.cliente_id) ||
        doc.cliente_id === clienteFilter;
      const matchesSearch = !searchTerm || 
        doc.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doc.tipo.toLowerCase().includes(searchTerm.toLowerCase());
      
      return matchesStatus && matchesCliente && matchesSearch;
    });

    // Ordenação
    switch (sortOption) {
      case 'recentes':
        result.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        break;
      case 'antigos':
        result.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
        break;
      case 'nome':
        result.sort((a, b) => a.nome.localeCompare(b.nome));
        break;
      case 'validade':
        result.sort((a, b) => {
          if (!a.data_validade && !b.data_validade) return 0;
          if (!a.data_validade) return 1;
          if (!b.data_validade) return -1;
          return new Date(a.data_validade).getTime() - new Date(b.data_validade).getTime();
        });
        break;
    }

    return result;
  }, [documentos, statusFilter, clienteFilter, searchTerm, sortOption]);

  const handleView = (doc: DocumentoRow) => {
    setSelectedDoc(doc);
    setViewerOpen(true);
  };

  const handleDownload = (doc: DocumentoRow) => {
    if (doc.arquivo_path) {
      downloadDocumento(doc.arquivo_path, doc.nome);
    }
  };

  const handleDeleteClick = (doc: DocumentoRow) => {
    setDocToDelete(doc);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (docToDelete) {
      await deleteDocumento(docToDelete.id, docToDelete.arquivo_path);
      setDeleteDialogOpen(false);
      setDocToDelete(null);
    }
  };

  const handleEditClick = (doc: DocumentoRow) => {
    setDocToEdit(doc);
    setEditDialogOpen(true);
  };

  const handleUpload = async (
    file: File,
    nome: string,
    tipo: string,
    clienteId?: string,
    imovelId?: string,
    dataValidade?: string,
    observacoes?: string
  ) => {
    await uploadDocumento(file, nome, tipo, clienteId, imovelId, dataValidade, observacoes);
  };

  const handleToggleValidacao = (doc: DocumentoRow) => {
    toggleValidacao(doc.id, !doc.validado);
  };

  const handleKpiClick = (status: StatusFilter) => {
    setStatusFilter(status);
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        titulo="Jurídico"
        subtitulo="Centralize documentos, contratos e prazos com segurança."
        comUtilitarios
        acoes={
          <>
            <Button
              variant="outline"
              className="h-control"
              onClick={() => {
                document.querySelector<HTMLInputElement>('input[type="file"]')?.click();
              }}
            >
              <Upload className="mr-2 h-[18px] w-[18px]" />
              Enviar documento
            </Button>
            <Button className="h-control" onClick={() => setContratoDialogOpen(true)}>
              <Sparkles className="mr-2 h-[18px] w-[18px]" />
              Gerar contrato com IA
            </Button>
          </>
        }
      />

      <Tabs defaultValue="documentos" className="space-y-5">
        <TabsList className={abasSublinhadas.lista}>
          <TabsTrigger value="documentos" className={abasSublinhadas.gatilho}>
            <FileText className="mr-2 h-4 w-4" />
            Documentos
          </TabsTrigger>
          <TabsTrigger value="contratos" className={abasSublinhadas.gatilho}>
            <FileSignature className="mr-2 h-4 w-4" />
            Contratos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="documentos" className="mt-0 space-y-5">
          {/* Faixa de indicadores com dot colorido. Um cartão só, dividido —
              os cinco números são lidos em conjunto ("0 de 18 pendentes"), e
              separá-los em caixas independentes quebra essa leitura.
              Cada um filtra a tabela: o número é ação, não enfeite. */}
          <div className="grid grid-cols-2 rounded-card border border-border bg-card shadow-card sm:grid-cols-5">
            {([
              { chave: 'TODOS',    rotulo: 'Total',     valor: kpis.total,     dot: 'bg-foreground' },
              { chave: 'validado', rotulo: 'Validados', valor: kpis.validados, dot: 'bg-success' },
              { chave: 'pendente', rotulo: 'Pendentes', valor: kpis.pendentes, dot: 'bg-muted-foreground' },
              { chave: 'vencendo', rotulo: 'Vencendo',  valor: kpis.vencendo,  dot: 'bg-warning' },
              { chave: 'vencido',  rotulo: 'Vencidos',  valor: kpis.vencidos,  dot: 'bg-destructive' },
            ] as const).map((item, i) => (
              <button
                key={item.chave}
                type="button"
                onClick={() => handleKpiClick(item.chave as StatusFilter)}
                aria-pressed={statusFilter === item.chave}
                className={cn(
                  'flex flex-col items-start gap-1 p-5 text-left transition-colors duration-150',
                  'hover:bg-muted focus-ring',
                  i > 0 && 'sm:border-l sm:border-border',
                  i % 2 === 1 && 'border-l border-border sm:border-l',
                  i < 4 && 'border-b border-border sm:border-b-0',
                  statusFilter === item.chave && 'bg-surface-brand hover:bg-surface-brand',
                )}
              >
                <span className="flex items-center gap-2">
                  <span className={cn('h-2 w-2 rounded-full', item.dot)} aria-hidden="true" />
                  <span className="text-sm text-muted-foreground">{item.rotulo}</span>
                </span>
                <span className="text-kpi tabular text-foreground">{numero(item.valor)}</span>
              </button>
            ))}
          </div>

          {/* Envio à esquerda, orientação à direita — quem chega sem documento
              nenhum precisa das duas coisas na mesma dobra. */}
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <SectionCard titulo="Adicionar documento">
              <DocumentoUploadArea
                clientes={clientes}
                uploading={uploading}
                onUpload={handleUpload}
              />
            </SectionCard>

            <SectionCard titulo="Comece por aqui">
              <ol className="space-y-3">
                {[
                  'Envie ou gere um documento',
                  'Vincule ao cliente ou imóvel',
                  'Acompanhe status e validade',
                ].map((passo, i) => (
                  <li key={passo} className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-brand text-xs font-semibold text-primary">
                      {i + 1}
                    </span>
                    <span className="min-w-0 text-sm text-foreground">{passo}</span>
                  </li>
                ))}
              </ol>

              <div className="mt-4 space-y-1 border-t border-border pt-3">
                <QuickActionRow
                  icone={<Sparkles className="h-[18px] w-[18px]" />}
                  titulo="Gerar contrato com IA"
                  onClick={() => setContratoDialogOpen(true)}
                />
                <QuickActionRow
                  icone={<Upload className="h-[18px] w-[18px]" />}
                  titulo="Enviar documento existente"
                  onClick={() => {
                    document
                      .querySelector<HTMLInputElement>('input[type="file"]')
                      ?.click();
                  }}
                />
              </div>
            </SectionCard>
          </div>

          {/* Filters */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por nome ou tipo..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                  <SelectTrigger className="w-full sm:w-36">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TODOS">Todos</SelectItem>
                    <SelectItem value="validado">Validados</SelectItem>
                    <SelectItem value="pendente">Pendentes</SelectItem>
                    <SelectItem value="vencendo">Vencendo</SelectItem>
                    <SelectItem value="vencido">Vencidos</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={clienteFilter} onValueChange={setClienteFilter}>
                  <SelectTrigger className="w-full sm:w-44">
                    <SelectValue placeholder="Cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TODOS">Todos os clientes</SelectItem>
                    <SelectItem value="SEM_CLIENTE">Sem cliente</SelectItem>
                    {clientes.filter(cliente => cliente.id).map((cliente) => (
                      <SelectItem key={cliente.id} value={cliente.id}>
                        {cliente.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={sortOption} onValueChange={(v) => setSortOption(v as SortOption)}>
                  <SelectTrigger className="w-full sm:w-40">
                    <ArrowUpDown className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="Ordenar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recentes">Mais recentes</SelectItem>
                    <SelectItem value="antigos">Mais antigos</SelectItem>
                    <SelectItem value="nome">Alfabética (A-Z)</SelectItem>
                    <SelectItem value="validade">Por validade</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Documents List */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-4">
              <CardTitle className="text-lg">Documentos</CardTitle>
              <span className="text-sm text-muted-foreground">
                {filteredDocumentos.length} de {documentos.length} documento(s)
              </span>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <Skeleton className="w-10 h-10 rounded-lg" />
                        <div>
                          <Skeleton className="h-4 w-40 mb-2" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Skeleton className="h-8 w-16" />
                        <Skeleton className="h-8 w-20" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredDocumentos.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  {documentos.length === 0 
                    ? 'Nenhum documento cadastrado ainda.'
                    : 'Nenhum documento encontrado com os filtros aplicados.'}
                </p>
              ) : (
                <TooltipProvider>
                  <div className="space-y-3">
                    {filteredDocumentos.map((doc) => {
                      const status = getDocumentoStatus(doc);
                      const FileIcon = getFileIcon(doc.arquivo_path);
                      const clienteNome = getClienteNome(doc.cliente_id);
                      const imovelNome = getImovelNome(doc.imovel_id);
                      const tipoLabel = TIPO_LABELS[doc.tipo] || doc.tipo;
                      const tipoCor = TIPO_CORES[doc.tipo] || TIPO_CORES['OUTRO'];

                      return (
                        <div
                          key={doc.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-muted/50 rounded-lg gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={cn(
                              'p-2 rounded-lg shrink-0',
                              status === 'validado' && 'bg-success/10',
                              status === 'vencendo' && 'bg-warning/10',
                              status === 'vencido' && 'bg-destructive/10',
                              status === 'pendente' && 'bg-muted'
                            )}>
                              {status === 'validado' && <CheckCircle className="w-5 h-5 text-success" />}
                              {status === 'vencendo' && <AlertTriangle className="w-5 h-5 text-warning" />}
                              {status === 'vencido' && <AlertTriangle className="w-5 h-5 text-destructive" />}
                              {status === 'pendente' && <Clock className="w-5 h-5 text-muted-foreground" />}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium truncate">{doc.nome}</p>
                                <Badge variant="secondary" className={cn("text-xs shrink-0", tipoCor)}>
                                  {tipoLabel}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                                {clienteNome && <span>{clienteNome}</span>}
                                {clienteNome && imovelNome && <span>•</span>}
                                {imovelNome && (
                                  <span className="flex items-center gap-1">
                                    <Building className="w-3 h-3" />
                                    {imovelNome}
                                  </span>
                                )}
                                {(clienteNome || imovelNome) && <span>•</span>}
                                <span>
                                  {doc.created_at && format(new Date(doc.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                                </span>
                                {doc.data_validade && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className={cn(
                                        "cursor-help",
                                        status === 'vencendo' && "text-warning",
                                        status === 'vencido' && "text-destructive"
                                      )}>
                                        • Validade: {format(new Date(doc.data_validade), 'dd/MM/yyyy', { locale: ptBR })}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {status === 'vencido' 
                                        ? `Vencido há ${Math.abs(differenceInDays(new Date(doc.data_validade), new Date()))} dias`
                                        : status === 'vencendo'
                                        ? `Vence em ${differenceInDays(new Date(doc.data_validade), new Date())} dias`
                                        : `Válido por ${differenceInDays(new Date(doc.data_validade), new Date())} dias`
                                      }
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                            {status === 'vencendo' && doc.data_validade && (
                              <Badge variant="outline" className="text-warning border-warning">
                                Vence em {differenceInDays(new Date(doc.data_validade), new Date())} dias
                              </Badge>
                            )}
                            {status === 'vencido' && (
                              <Badge variant="destructive">Vencido</Badge>
                            )}
                            
                            {/* Validation toggle button */}
                            <Button
                              variant={doc.validado ? "outline" : "secondary"}
                              size="sm"
                              onClick={() => handleToggleValidacao(doc)}
                              className={cn(
                                doc.validado && "border-success text-success hover:text-success"
                              )}
                            >
                              {doc.validado ? (
                                <>
                                  <Check className="w-4 h-4 mr-1" />
                                  Validado
                                </>
                              ) : (
                                <>
                                  <X className="w-4 h-4 mr-1" />
                                  Pendente
                                </>
                              )}
                            </Button>

                            {/* Edit button */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEditClick(doc)}
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Editar documento</TooltipContent>
                            </Tooltip>

                            {doc.arquivo_path && (
                              <>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleView(doc)}
                                    >
                                      <Eye className="w-4 h-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Visualizar</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleDownload(doc)}
                                    >
                                      <Download className="w-4 h-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Download</TooltipContent>
                                </Tooltip>
                              </>
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => handleDeleteClick(doc)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Excluir</TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </TooltipProvider>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contratos" className="mt-6">
          <ContratosCentral />
        </TabsContent>
      </Tabs>

      <GerarContratoDialog
        open={contratoDialogOpen}
        onOpenChange={setContratoDialogOpen}
      />

      {/* Document Viewer */}
      {selectedDoc && (
        <DocumentoViewer
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          nome={selectedDoc.nome}
          arquivoPath={selectedDoc.arquivo_path}
          getSignedUrl={getSignedUrl}
          onDownload={downloadDocumento}
        />
      )}

      {/* Edit Document Dialog */}
      <EditarDocumentoDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        documento={docToEdit}
        clientes={clientes}
        onUpdate={fetchDocumentos}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o documento "{docToDelete?.nome}"?
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
