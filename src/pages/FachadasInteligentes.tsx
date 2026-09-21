import { useEffect, useState } from 'react';
import {
  Plus, QrCode, BarChart3, Users, LayoutTemplate, ImagePlus,
  Trash2, Eye, Loader2, Building2, TrendingUp, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useFachadas } from '@/hooks/useFachadas';
import { useFileUpload } from '@/hooks/useFileUpload';
import { FachadaCard } from '@/components/fachadas/FachadaCard';
import { FachadaPreview } from '@/components/fachadas/FachadaPreview';
import { CriarFachadaDialog } from '@/components/fachadas/CriarFachadaDialog';
import { AssistenteTemplateDialog } from '@/components/fachadas/AssistenteTemplateDialog';
import type { DadosNovoTemplate } from '@/components/fachadas/AssistenteTemplateDialog';
import { FachadaDashboard } from '@/components/fachadas/FachadaDashboard';
import { LeadsTable } from '@/components/fachadas/LeadsTable';
import { DEFAULT_TEMPLATES } from '@/types/fachada';
import type { FachadaComImovel } from '@/types/fachada';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { PageHeader } from '@/components/shell/PageHeader';
import { MetricStrip, SectionCard } from '@/components/shell/primitivos';
import { abasSublinhadas } from '@/components/shell/primitivos';
import { LimitGuard } from '@/components/subscription/LimitGuard';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * `fachada_templates` nao esta no `types.ts` gerado (que cobre 11 das ~40
 * tabelas do projeto). Em vez de espalhar `as any` por tres chamadas, o acesso
 * passa por um cliente sem o generico de schema — mesmo padrao ja usado em
 * `hooks/crm/useCrm.ts` e em `CriarFachadaDialog`. Some quando os tipos forem
 * regerados.
 */
const db = () => supabase as unknown as SupabaseClient;

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
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [previewCustomTemplate, setPreviewCustomTemplate] = useState<CustomTemplate | null>(null);
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

      const { data, error } = await db()
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

  const handleSaveCustomTemplate = async ({
    nome, arquivo, qrPosition, qrSize,
  }: DadosNovoTemplate) => {
    setSavingTemplate(true);

    try {
      // O corretor é resolvido ANTES do upload porque o caminho precisa
      // carregá-lo: a policy de storage escopa a gravação por
      // `fachadas/<corretor_id>/`. Buscar o id depois era tarde demais — foi
      // essa ordem que deixou o caminho sem dono e fez a RLS negar todo envio.
      const { data: corretorId } = await supabase.rpc('get_corretor_id');
      if (!corretorId) {
        throw new Error('Não foi possível identificar sua conta. Recarregue a página e tente de novo.');
      }

      const ext = arquivo.name.split('.').pop();
      const fileName = `fachada-template-custom-${Date.now()}.${ext}`;
      const result = await upload(arquivo, `fachadas/${corretorId}/${fileName}`);
      if (!result?.url) throw new Error('Falha no upload');

      // O erro desta gravação NÃO é mais engolido. Antes era, e a tela dizia
      // "Template salvo com sucesso!" mesmo sem nada ter sido gravado: o
      // template aparecia na lista vindo só do estado local e sumia no primeiro
      // reload. Falhar visivelmente é melhor que perder em silêncio.
      const { data: salvo, error: erroInsert } = await db()
        .from('fachada_templates')
        .insert({
          corretor_id: corretorId,
          nome,
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
            qrSize,
          },
        } as any)
        // O genérico tipa a linha devolvida sem `as any`: `db()` perde o
        // schema, mas o formato deste SELECT é conhecido aqui.
        .select('id, created_at')
        .single<{ id: string; created_at: string | null }>();

      if (erroInsert) throw erroInsert;

      // Usa o id real da linha. Antes era `local-<timestamp>`, que não é UUID —
      // excluir o template recém-criado sem recarregar a página falhava.
      setCustomTemplates((prev) => [
        {
          id: salvo.id,
          nome,
          imagem_url: result.url,
          qrPosition: { x: qrPosition.x, y: qrPosition.y },
          qrSize,
          created_at: salvo.created_at ?? new Date().toISOString(),
        },
        ...prev,
      ]);

      toast({ title: 'Template salvo com sucesso!' });
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

  const handleDeleteCustomTemplate = async (template: CustomTemplate) => {
    setCustomTemplates((prev) => prev.filter((t) => t.id !== template.id));
    try {
      if (!template.id.startsWith('local-')) {
        await db().from('fachada_templates').delete().eq('id', template.id);
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
            <LimitGuard featureKey="max_fachadas">
              <Button
                className="h-control"
                onClick={() => { setEditingFachada(null); setDialogOpen(true); }}
              >
                <Plus className="mr-2 h-[18px] w-[18px]" />
                Nova fachada
              </Button>
            </LimitGuard>
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
              <LimitGuard featureKey="max_fachadas">
                <Button onClick={() => setDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" /> Criar Primeira Fachada
                </Button>
              </LimitGuard>
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
                  onViewLeads={() => setAbaAtiva('leads')}
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-xl text-sm text-muted-foreground">
                Não tem arte pronta? O assistente monta o pedido a partir da sua marca e
                abre um gerador de imagem com ele já escrito.
              </p>
              <Button onClick={() => setUploadDialogOpen(true)} className="h-control gap-2">
                <Sparkles className="h-[18px] w-[18px]" />
                Criar meu template
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

      {/* Assistente de criacao de template (briefing -> prompt -> arte) */}
      <AssistenteTemplateDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        salvando={savingTemplate || uploading}
        onSalvar={handleSaveCustomTemplate}
      />

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

