import { useEffect, useState } from 'react';
import { Plus, QrCode, BarChart3, Users, LayoutTemplate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFachadas } from '@/hooks/useFachadas';
import { FachadaCard } from '@/components/fachadas/FachadaCard';
import { FachadaPreview } from '@/components/fachadas/FachadaPreview';
import { CriarFachadaDialog } from '@/components/fachadas/CriarFachadaDialog';
import { FachadaDashboard } from '@/components/fachadas/FachadaDashboard';
import { LeadsTable } from '@/components/fachadas/LeadsTable';
import { DEFAULT_TEMPLATES } from '@/types/fachada';
import type { FachadaComImovel } from '@/types/fachada';

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

  useEffect(() => {
    fetchFachadas();
    fetchLeads();
    fetchMetricas();
  }, [fetchFachadas, fetchLeads, fetchMetricas]);

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
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Templates disponíveis para suas fachadas. Os templates padrão
              estão sempre disponíveis.
            </p>
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
    </div>
  );
}
