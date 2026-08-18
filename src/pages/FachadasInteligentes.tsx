import { useEffect, useState, useRef } from 'react';
import { QrCodePositioner } from '@/components/fachadas/QrCodePositioner';
import {
  Plus, QrCode, BarChart3, Users, LayoutTemplate, Upload, ImagePlus,
  Trash2, Eye, Loader2, Building2, TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useFachadas } from '@/hooks/useFachadas';
import { useFileUpload } from '@/hooks/useFileUpload';
import { FachadaCard } from '@/components/fachadas/FachadaCard';
import { FachadaPreview } from '@/components/fachadas/FachadaPreview';
import { CriarFachadaDialog } from '@/components/fachadas/CriarFachadaDialog';
import { FachadaDashboard } from '@/components/fachadas/FachadaDashboard';
import { LeadsTable } from '@/components/fachadas/LeadsTable';
import { DEFAULT_TEMPLATES } from '@/types/fachada';
import type { FachadaComImovel } from '@/types/fachada';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { PageHeader } from '@/components/shell/PageHeader';
import { MetricStrip, SectionCard } from '@/components/shell/primitivos';
import { abasSublinhadas } from '@/components/shell/primitivos';

interface CustomTemplate {
  id: string;
  nome: string;
  imagem_url: string;
  qrPosition?: { x: number; y: number };
  qrSize?: number;
  created_at: string;
}

function ProcessingTimer({ createdAt }: { createdAt: string }) {
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const createdTime = new Date(createdAt).getTime();
    const now = Date.now();
    const processingTime = 3000; // 3 segundos de processamento
    if (now - createdTime < processingTime) {
      setIsProcessing(true);
      const startTime = Date.now();
      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const p = Math.min(100, Math.floor((elapsed / processingTime) * 100));
        setProgress(p);
        if (p >= 100) {
          clearInterval(interval);
          setIsProcessing(false);
        }
      }, 50);
      return () => clearInterval(interval);
    }
  }, [createdAt]);

  if (!isProcessing) {
    return (
      <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-sm rounded-lg px-2 py-1 flex items-center gap-1 animate-in fade-in">
        <QrCode className="h-3 w-3 text-white" />
        <span className="text-[9px] text-white font-medium">QR será aplicado</span>
      </div>
    );
  }

  return (
    <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-sm rounded-lg px-2 py-1.5 flex flex-col gap-1 w-28">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-white font-medium flex items-center gap-1">
          <Loader2 className="h-2.5 w-2.5 animate-spin" /> Preparando...
        </span>
        <span className="text-[9px] text-white font-bold">{progress}%</span>
      </div>
      <div className="w-full bg-white/20 rounded-full h-1 overflow-hidden">
        <div className="bg-primary h-full transition-all duration-75" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

export default function FachadasInteligentes() {
  const {
    fachadas,
    leads,
    metricas,
    loading,
    fetchFachadas,
    createFachada,
    updateFachada,
    deleteFachada,
    fetchLeads,
    fetchMetricas,
    deleteLead,
  } = useFachadas();

  const [abaAtiva, setAbaAtiva] = useState('fachadas');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewFachada, setPreviewFachada] = useState<FachadaComImovel | null>(null);
  const [editingFachada, setEditingFachada] = useState<FachadaComImovel | null>(null);
  const [periodo, setPeriodo] = useState(30);

  // Custom template states
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [templateNome, setTemplateNome] = useState('');
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [templatePreviewUrl, setTemplatePreviewUrl] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [previewCustomTemplate, setPreviewCustomTemplate] = useState<CustomTemplate | null>(null);
  const [qrPosition, setQrPosition] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const [qrSizePercent, setQrSizePercent] = useState(45);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { upload, uploading } = useFileUpload('imoveis-fotos');

  useEffect(() => {
    fetchFachadas();
    fetchLeads();
    fetchMetricas(periodo);
    fetchCustomTemplates();
  }, [fetchFachadas, fetchLeads, fetchMetricas]);

  const handlePeriodoChange = (dias: number) => {
    setPeriodo(dias);
    fetchMetricas(dias);
  };

  // Cria (novo) ou atualiza (edição) a fachada, conforme editingFachada.
  const handleFachadaSubmit = async (data: any) => {
    if (editingFachada) {
      await updateFachada(editingFachada.id, data);
    } else {
      await createFachada(data);
    }
  };

  const fetchCustomTemplates = async () => {
    try {
      const { data: corretorId } = await supabase.rpc('get_corretor_id');
      if (!corretorId) return;

      const { data, error } = await supabase
        .from('fachada_templates')
        .select('*')
        .eq('corretor_id', corretorId)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setCustomTemplates(
          data.map((t: any) => ({
            id: t.id,
            nome: t.nome,
            imagem_url: t.config?.imagem_url || '',
            qrPosition: t.config?.qrPosition || undefined,
            qrSize: t.config?.qrSize || undefined,
            created_at: t.created_at,
          }))
        );
      }
    } catch {
      // Table may not exist yet — silently ignore
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTemplateFile(file);
    const url = URL.createObjectURL(file);
    setTemplatePreviewUrl(url);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (file.type.startsWith('image/')) {
        setTemplateFile(file);
        const url = URL.createObjectURL(file);
        setTemplatePreviewUrl(url);
      } else {
        toast({ variant: 'destructive', title: 'Formato inválido', description: 'Por favor, envie uma imagem.' });
      }
    }
  };

  const handleSaveCustomTemplate = async () => {
    if (!templateFile || !templateNome.trim()) return;
    setSavingTemplate(true);

    try {
      const ext = templateFile.name.split('.').pop();
      const fileName = `fachada-template-custom-${Date.now()}.${ext}`;
      const result = await upload(templateFile, `fachadas/${fileName}`);
      if (!result?.url) throw new Error('Falha no upload');

      // Try to save to fachada_templates table
      try {
        const { data: corretorId } = await supabase.rpc('get_corretor_id');
        if (corretorId) {
          await supabase.from('fachada_templates').insert({
            corretor_id: corretorId,
            nome: templateNome.trim(),
            categoria: 'VENDA',
            padrao: false,
            config: {
              imagem_url: result.url,
              corPrimaria: '#000000',
              corSecundaria: '#ffffff',
              corTexto: '#ffffff',
              corFundo: '#000000',
              estilo: 'profissional',
              layout: 'vertical',
              qrPosition: { x: qrPosition.x, y: qrPosition.y },
              qrSize: qrSizePercent,
            },
          } as any);
        }
      } catch {
        // Table might not exist — template still works via URL
      }

      // Add to local state immediately
      setCustomTemplates((prev) => [
        {
          id: `local-${Date.now()}`,
          nome: templateNome.trim(),
          imagem_url: result.url,
          qrPosition: { x: qrPosition.x, y: qrPosition.y },
          qrSize: qrSizePercent,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);

      toast({ title: 'Template salvo com sucesso!' });
      resetUploadForm();
      setUploadDialogOpen(false);
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao salvar template',
        description: err?.message || 'Tente novamente.',
      });
    } finally {
      setSavingTemplate(false);
    }
  };

  const resetUploadForm = () => {
    setTemplateNome('');
    setTemplateFile(null);
    if (templatePreviewUrl) URL.revokeObjectURL(templatePreviewUrl);
    setTemplatePreviewUrl(null);
    setQrPosition({ x: 50, y: 50 });
    setQrSizePercent(20);
  };

  const handleDeleteCustomTemplate = async (template: CustomTemplate) => {
    setCustomTemplates((prev) => prev.filter((t) => t.id !== template.id));
    try {
      if (!template.id.startsWith('local-')) {
        await supabase.from('fachada_templates').delete().eq('id', template.id);
      }
      toast({ title: 'Template removido' });
    } catch {
      // Ignore errors
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        titulo="Fachadas Inteligentes"
        subtitulo="Transforme placas com QR Code em novos contatos."
        comUtilitarios
        acoes={
          <>
            <Button
              variant="outline"
              className="h-control"
              onClick={() => setAbaAtiva('templates')}
            >
              <LayoutTemplate className="mr-2 h-[18px] w-[18px]" />
              Ver templates
            </Button>
            <Button
              className="h-control"
              onClick={() => { setEditingFachada(null); setDialogOpen(true); }}
            >
              <Plus className="mr-2 h-[18px] w-[18px]" />
              Nova fachada
            </Button>
          </>
        }
      />

      {/* Tabs */}
      <Tabs value={abaAtiva} onValueChange={setAbaAtiva} className="space-y-5">
        <TabsList className={abasSublinhadas.lista}>
          <TabsTrigger value="fachadas" className={abasSublinhadas.gatilho}>
            <QrCode className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Fachadas</span>
          </TabsTrigger>
          <TabsTrigger value="dashboard" className={abasSublinhadas.gatilho}>
            <BarChart3 className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </TabsTrigger>
          <TabsTrigger value="leads" className={abasSublinhadas.gatilho}>
            <Users className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Leads</span>
          </TabsTrigger>
          <TabsTrigger value="templates" className={abasSublinhadas.gatilho}>
            <LayoutTemplate className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Templates</span>
          </TabsTrigger>
        </TabsList>

        {/* Aba: Minhas Fachadas */}
        <TabsContent value="fachadas" className="space-y-5">
          {/* Indicadores. Vêm de `metricas`, que o hook já busca para o
              Dashboard — nenhuma query nova foi adicionada. */}
          <MetricStrip
            carregando={loading}
            itens={[
              { id: 'fachadas', valor: fachadas.length, label: 'Fachadas',
                icone: <Building2 className="h-5 w-5" />, tom: 'brand' },
              { id: 'scans', valor: metricas?.totalEscaneamentos ?? 0, label: 'Leituras do QR Code',
                icone: <QrCode className="h-5 w-5" />, tom: 'info' },
              { id: 'leads', valor: metricas?.totalLeads ?? 0, label: 'Leads gerados',
                icone: <Users className="h-5 w-5" />, tom: 'warning' },
              { id: 'conv', valor: `${metricas?.taxaConversao ?? 0}%`, label: 'Conversão',
                icone: <TrendingUp className="h-5 w-5" />, tom: 'success' },
            ]}
          />

          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-64 rounded-xl bg-muted animate-pulse"
                />
              ))}
            </div>
          ) : fachadas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="bg-primary/10 rounded-full p-6 mb-4">
                <QrCode className="h-12 w-12 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-1">
                Nenhuma fachada criada
              </h3>
              <p className="text-muted-foreground max-w-sm mb-4">
                Crie sua primeira fachada inteligente e comece a capturar leads
                diretamente das placas dos seus imóveis.
              </p>
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> Criar Primeira Fachada
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {fachadas.map((f) => (
                <FachadaCard
                  key={f.id}
                  fachada={f}
                  onPreview={setPreviewFachada}
                  onEdit={(fac) => { setEditingFachada(fac); setDialogOpen(true); }}
                  onDeactivate={deleteFachada}
                />
              ))}
            </div>
          )}

          {/* Mesmo padrão de Midias.tsx e Juridico.tsx: explica o caminho que
              vai da placa ao atendimento, que não era óbvio para quem abre a
              tela pela primeira vez. */}
          <SectionCard titulo="Da fachada ao atendimento">
            <ol className="grid gap-5 sm:grid-cols-3">
              {[
                { n: 1, Icone: QrCode, titulo: 'Pessoa escaneia',
                  texto: 'O visitante escaneia o QR Code na placa do imóvel.' },
                { n: 2, Icone: Users, titulo: 'Informa o contato',
                  texto: 'Ele preenche os dados e manifesta interesse pelo imóvel.' },
                { n: 3, Icone: Building2, titulo: 'Lead entra na Lotti',
                  texto: 'O lead é registrado no sistema e fica pronto para o atendimento.' },
              ].map((passo, i, todos) => (
                <li key={passo.n} className="relative flex min-w-0 items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {passo.n}
                  </span>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-brand text-primary">
                    <passo.Icone className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{passo.titulo}</span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">{passo.texto}</span>
                  </span>
                  {i < todos.length - 1 && (
                    <span
                      className="absolute -right-3 top-3.5 hidden w-6 border-t border-dashed border-border sm:block"
                      aria-hidden="true"
                    />
                  )}
                </li>
              ))}
            </ol>
          </SectionCard>
        </TabsContent>

        {/* Aba: Dashboard */}
        <TabsContent value="dashboard">
          <FachadaDashboard metricas={metricas} periodo={periodo} onPeriodoChange={handlePeriodoChange} />
        </TabsContent>

        {/* Aba: Leads */}
        <TabsContent value="leads">
          <LeadsTable leads={leads} onDeleteLead={deleteLead} />
        </TabsContent>

        {/* Aba: Templates */}
        <TabsContent value="templates">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Templates disponíveis para suas fachadas. Crie templates personalizados com suas próprias artes.
              </p>
              <Button onClick={() => setUploadDialogOpen(true)} className="gap-2" variant="outline">
                <Upload className="h-4 w-4" />
                Enviar Meu Template
              </Button>
            </div>

            {/* Meus Templates Personalizados */}
            {customTemplates.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
                  <ImagePlus className="h-4 w-4" />
                  Meus Templates Personalizados
                </h3>
                <div className="space-y-4">
                  {customTemplates.map((ct) => (
                    <div
                      key={ct.id}
                      className="rounded-xl overflow-hidden shadow-md hover:shadow-xl transition-all group relative border border-border cursor-pointer"
                      onClick={() => setPreviewCustomTemplate(ct)}
                    >
                      <div className="h-40 overflow-hidden bg-black relative flex items-center justify-center">
                        <div className="relative w-full h-full group-hover:scale-105 transition-transform duration-500">
                          <img
                            src={ct.imagem_url}
                            alt={ct.nome}
                            className="w-full h-full object-contain"
                          />
                          {/* Mock QR Code Overlay */}
                          {ct.qrPosition && ct.qrSize && (
                            <div
                              className="absolute bg-white flex flex-col items-center justify-center shadow-lg rounded-sm"
                              style={{
                                left: `${ct.qrPosition.x}%`,
                                top: `${ct.qrPosition.y}%`,
                                transform: 'translate(-50%, -50%)',
                                width: `${ct.qrSize}%`,
                                aspectRatio: '1',
                              }}
                            >
                              <QrCode className="w-1/2 h-1/2 text-black opacity-80" />
                            </div>
                          )}
                        </div>
                        {/* QR Code overlay indicator (with processing timer) */}
                        <ProcessingTimer createdAt={ct.created_at} />
                        {/* Hover actions */}
                        <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); setPreviewCustomTemplate(ct); }}
                            className="p-1.5 bg-black/60 backdrop-blur-sm rounded-lg hover:bg-black/80 transition"
                          >
                            <Eye className="h-3.5 w-3.5 text-white" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteCustomTemplate(ct); }}
                            className="p-1.5 bg-red-500/80 backdrop-blur-sm rounded-lg hover:bg-red-600 transition"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-white" />
                          </button>
                        </div>
                      </div>
                      <div className="p-3 bg-card">
                        <p className="font-semibold text-sm">{ct.nome}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Template personalizado • {new Date(ct.created_at).toLocaleDateString('pt-BR')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Templates Padrão */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                <LayoutTemplate className="mr-2 h-4 w-4" />
                Templates Padrão
              </h3>
              <div className="space-y-4">
                {DEFAULT_TEMPLATES.map((t) => (
                  <div
                    key={t.nome}
                    className="rounded-xl overflow-hidden shadow-md hover:shadow-lg transition-shadow"
                  >
                    <div
                      className="h-32 flex items-center justify-center"
                      style={{
                        background: `linear-gradient(135deg, ${t.config.corFundo}, ${t.config.corPrimaria})`,
                      }}
                    >
                      <div className="text-center" style={{ color: t.config.corTexto }}>
                        <QrCode className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-lg font-bold">{t.nome}</p>
                      </div>
                    </div>
                    <div className="p-3 bg-card">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          Categoria: {t.categoria}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Estilo: {t.config.estilo}
                        </span>
                      </div>
                      <div className="flex gap-1.5 mt-2">
                        {[
                          t.config.corPrimaria,
                          t.config.corSecundaria,
                          t.config.corFundo,
                          t.config.corTexto,
                        ].map((cor, i) => (
                          <div
                            key={i}
                            className="h-5 w-5 rounded-full border border-border"
                            style={{ backgroundColor: cor }}
                            title={cor}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Dialog de criação / edição */}
      <CriarFachadaDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditingFachada(null);
        }}
        onSubmit={handleFachadaSubmit}
        fachadaToEdit={editingFachada}
        customTemplates={customTemplates}
      />

      {/* Dialog de preview */}
      <FachadaPreview
        fachada={previewFachada}
        open={!!previewFachada}
        onOpenChange={(o) => {
          if (!o) setPreviewFachada(null);
        }}
      />

      {/* Dialog de Upload de Template Personalizado */}
      <Dialog
        open={uploadDialogOpen}
        onOpenChange={(o) => {
          if (!o) resetUploadForm();
          setUploadDialogOpen(o);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImagePlus className="h-5 w-5 text-primary" />
              Personalizar Template
            </DialogTitle>
            <DialogDescription>
              Faça upload da sua arte personalizada. Ao criar uma fachada com este template, o QR Code do imóvel será sobreposto automaticamente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Nome */}
            <div>
              <Label htmlFor="template-nome">Nome do Template *</Label>
              <Input
                id="template-nome"
                value={templateNome}
                onChange={(e) => setTemplateNome(e.target.value)}
                placeholder="Ex: Placa Dourada, Banner Moderno..."
                className="mt-1.5"
              />
            </div>

            {/* Upload area */}
            <div>
              <Label>Arte / Imagem *</Label>
              <div className="mt-1.5">
                {templatePreviewUrl ? (
                  <QrCodePositioner
                    imageSrc={templatePreviewUrl}
                    position={qrPosition}
                    onPositionChange={setQrPosition}
                    qrSizePercent={qrSizePercent}
                    onSizeChange={setQrSizePercent}
                    removeButton={
                      <button
                        onClick={() => {
                          setTemplateFile(null);
                          URL.revokeObjectURL(templatePreviewUrl);
                          setTemplatePreviewUrl(null);
                        }}
                        className="absolute top-2 right-2 p-1.5 bg-red-500/80 rounded-lg hover:bg-red-600 transition z-50"
                      >
                        <Trash2 className="h-4 w-4 text-white" />
                      </button>
                    }
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`w-full h-48 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-3 transition-all cursor-pointer group ${
                      isDragging 
                        ? 'border-primary bg-primary/10' 
                        : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5'
                    }`}
                  >
                    <div className="p-4 rounded-full bg-primary/10 group-hover:bg-primary/20 transition">
                      <Upload className="h-8 w-8 text-primary" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium">Clique para enviar sua arte</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        PNG, JPG ou WebP • Recomendado: 1080×1920px (vertical)
                      </p>
                    </div>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>
            </div>

            {/* Info tip */}
            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg p-3">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                <strong>💡 Dica:</strong> Crie sua arte no Canva ou editor de sua preferência. Pode incluir ou não um QR Code genérico na imagem — quando você criar a fachada vinculada a um imóvel, o sistema substituirá pelo QR Code real do imóvel automaticamente.
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  resetUploadForm();
                  setUploadDialogOpen(false);
                }}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 gap-2"
                disabled={!templateFile || !templateNome.trim() || savingTemplate || uploading}
                onClick={handleSaveCustomTemplate}
              >
                {savingTemplate || uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <ImagePlus className="h-4 w-4" />
                    Salvar Template
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog de preview de template customizado (imagem ampliada) */}
      <Dialog open={!!previewCustomTemplate} onOpenChange={(o) => { if (!o) setPreviewCustomTemplate(null); }}>
        <DialogContent className="max-w-md sm:max-w-lg lg:max-w-3xl border-border p-4 sm:p-6 overflow-hidden">
          <DialogHeader>
            <DialogTitle>Preview do Template</DialogTitle>
          </DialogHeader>
          {previewCustomTemplate && (
            <div className="relative w-full flex items-center justify-center bg-black rounded-xl overflow-hidden min-h-[50vh] max-h-[75vh]">
              <div className="relative w-full h-full flex items-center justify-center">
                <img
                  src={previewCustomTemplate.imagem_url}
                  alt={previewCustomTemplate.nome}
                  className="w-full max-h-[75vh] object-contain mx-auto"
                />
                {previewCustomTemplate.qrPosition && previewCustomTemplate.qrSize && (
                  <div
                    className="absolute bg-white flex flex-col items-center justify-center shadow-2xl rounded-sm sm:rounded-md lg:rounded-lg"
                    style={{
                      left: `${previewCustomTemplate.qrPosition.x}%`,
                      top: `${previewCustomTemplate.qrPosition.y}%`,
                      transform: 'translate(-50%, -50%)',
                      width: `${previewCustomTemplate.qrSize}%`,
                      aspectRatio: '1',
                    }}
                  >
                    <QrCode className="w-1/2 h-1/2 text-black opacity-80" />
                    {previewCustomTemplate.qrSize >= 15 && (
                      <p className="text-[10px] text-black font-semibold mt-1">QR CODE</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

