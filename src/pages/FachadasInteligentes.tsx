import { useEffect, useState, useRef } from 'react';
import { Plus, QrCode, BarChart3, Users, LayoutTemplate, Upload, ImagePlus, Trash2, Eye, Loader2 } from 'lucide-react';
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

interface CustomTemplate {
  id: string;
  nome: string;
  imagem_url: string;
  created_at: string;
}

export default function FachadasInteligentes() {
  const {
    fachadas,
    leads,
    metricas,
    loading,
    fetchFachadas,
    createFachada,
    deleteFachada,
    fetchLeads,
    fetchMetricas,
  } = useFachadas();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewFachada, setPreviewFachada] = useState<FachadaComImovel | null>(null);

  // Custom template states
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [templateNome, setTemplateNome] = useState('');
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [templatePreviewUrl, setTemplatePreviewUrl] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [previewCustomUrl, setPreviewCustomUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { upload, uploading } = useFileUpload('imoveis-fotos');

  useEffect(() => {
    fetchFachadas();
    fetchLeads();
    fetchMetricas();
    fetchCustomTemplates();
  }, [fetchFachadas, fetchLeads, fetchMetricas]);

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
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <QrCode className="h-7 w-7 text-primary" />
            Fachadas Inteligentes
          </h1>
          <p className="text-muted-foreground">
            Gere materiais com QR Code que capturam leads automaticamente
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Criar Nova Fachada
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="fachadas" className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full max-w-lg">
          <TabsTrigger value="fachadas" className="gap-1.5">
            <QrCode className="h-4 w-4" />
            <span className="hidden sm:inline">Fachadas</span>
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="gap-1.5">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </TabsTrigger>
          <TabsTrigger value="leads" className="gap-1.5">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Leads</span>
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-1.5">
            <LayoutTemplate className="h-4 w-4" />
            <span className="hidden sm:inline">Templates</span>
          </TabsTrigger>
        </TabsList>

        {/* Aba: Minhas Fachadas */}
        <TabsContent value="fachadas">
          {loading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {fachadas.map((f) => (
                <FachadaCard
                  key={f.id}
                  fachada={f}
                  onPreview={setPreviewFachada}
                  onDeactivate={deleteFachada}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Aba: Dashboard */}
        <TabsContent value="dashboard">
          <FachadaDashboard metricas={metricas} />
        </TabsContent>

        {/* Aba: Leads */}
        <TabsContent value="leads">
          <LeadsTable leads={leads} />
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
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {customTemplates.map((ct) => (
                    <div
                      key={ct.id}
                      className="rounded-xl overflow-hidden shadow-md hover:shadow-xl transition-all group relative border border-border"
                    >
                      <div className="h-40 overflow-hidden bg-black relative">
                        <img
                          src={ct.imagem_url}
                          alt={ct.nome}
                          className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500"
                        />
                        {/* QR Code overlay indicator */}
                        <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-sm rounded-lg px-2 py-1 flex items-center gap-1">
                          <QrCode className="h-3 w-3 text-white" />
                          <span className="text-[9px] text-white font-medium">QR será aplicado</span>
                        </div>
                        {/* Hover actions */}
                        <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setPreviewCustomUrl(ct.imagem_url)}
                            className="p-1.5 bg-black/60 backdrop-blur-sm rounded-lg hover:bg-black/80 transition"
                          >
                            <Eye className="h-3.5 w-3.5 text-white" />
                          </button>
                          <button
                            onClick={() => handleDeleteCustomTemplate(ct)}
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
                <LayoutTemplate className="h-4 w-4" />
                Templates Padrão
              </h3>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
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

      {/* Dialog de criação */}
      <CriarFachadaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={createFachada}
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
                  <div className="relative rounded-xl overflow-hidden border-2 border-primary/30 bg-black">
                    <img
                      src={templatePreviewUrl}
                      alt="Preview"
                      className="w-full max-h-80 object-contain mx-auto"
                    />
                    {/* QR Code position indicator */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="border-2 border-dashed border-white/50 rounded-xl p-4 flex flex-col items-center bg-black/30 backdrop-blur-sm">
                        <QrCode className="h-10 w-10 text-white/70 mb-1" />
                        <p className="text-[10px] text-white/70 font-medium">QR Code aqui</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setTemplateFile(null);
                        URL.revokeObjectURL(templatePreviewUrl);
                        setTemplatePreviewUrl(null);
                      }}
                      className="absolute top-2 right-2 p-1.5 bg-red-500/80 rounded-lg hover:bg-red-600 transition"
                    >
                      <Trash2 className="h-4 w-4 text-white" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-48 border-2 border-dashed border-muted-foreground/30 rounded-xl flex flex-col items-center justify-center gap-3 hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer group"
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
      <Dialog open={!!previewCustomUrl} onOpenChange={(o) => { if (!o) setPreviewCustomUrl(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Preview do Template</DialogTitle>
          </DialogHeader>
          {previewCustomUrl && (
            <div className="bg-black rounded-xl overflow-hidden">
              <img
                src={previewCustomUrl}
                alt="Preview"
                className="w-full max-h-[70vh] object-contain mx-auto"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

