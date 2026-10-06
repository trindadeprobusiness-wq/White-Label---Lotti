import { useState, useEffect, useMemo } from 'react';
import {
  ArrowDownUp, Building2, Eye, Film, Filter, Grid3X3, Link as LinkIcon, List,
  Loader2, Megaphone, Plane, Plus, Rotate3d, Search, Sparkles, Trash2, Upload, Video,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useVideos, VideoRow, TipoVideo } from '@/hooks/useVideos';
import { VideoUploadArea } from '@/components/midias/VideoUploadArea';
import { VideoCard } from '@/components/midias/VideoCard';
import { VideoPlayerDialog } from '@/components/midias/VideoPlayerDialog';
import { EditarVideoDialog } from '@/components/midias/EditarVideoDialog';
import { CompartilharVideoDialog } from '@/components/midias/CompartilharVideoDialog';
import { FotosIA } from '@/components/midias/FotosIA';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import { opcoesImoveisApi } from '@/lib/api/contratos';
import { PageHeader } from '@/components/shell/PageHeader';
import {
  abasSublinhadas, MetricStrip, SectionCard, EmptyState,
} from '@/components/shell/primitivos';
import { numero } from '@/lib/formato';

interface ImovelSimples {
  id: string;
  titulo: string;
}

type SortOption = 'recentes' | 'antigos' | 'nome' | 'visualizacoes';

const TIPOS_VIDEO: { value: TipoVideo | 'TODOS'; label: string }[] = [
  { value: 'TODOS', label: 'Todos os tipos' },
  { value: 'TOUR_VIRTUAL', label: 'Tour Virtual' },
  { value: 'APRESENTACAO', label: 'Apresentação' },
  { value: 'DEPOIMENTO', label: 'Depoimento' },
  { value: 'DRONE', label: 'Drone/Aéreo' },
  { value: 'INSTITUCIONAL', label: 'Institucional' },
  { value: 'OUTRO', label: 'Outro' },
];

export default function Midias() {
  const { videos, loading, uploading, uploadProgress, uploadVideo, deleteVideo, updateVideo, incrementVisualizacoes, getTemporaryShareUrl } = useVideos();

  const [abaAtiva, setAbaAtiva] = useState('videos');
  const [searchTerm, setSearchTerm] = useState('');
  const [tipoFilter, setTipoFilter] = useState<TipoVideo | 'TODOS'>('TODOS');
  const [imovelFilter, setImovelFilter] = useState<string>('TODOS');
  const [sortBy, setSortBy] = useState<SortOption>('recentes');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const [imoveis, setImoveis] = useState<ImovelSimples[]>([]);
  const [playerVideo, setPlayerVideo] = useState<VideoRow | null>(null);
  const [editVideo, setEditVideo] = useState<VideoRow | null>(null);
  const [deleteVideoData, setDeleteVideoData] = useState<VideoRow | null>(null);
  const [shareVideo, setShareVideo] = useState<VideoRow | null>(null);

  useEffect(() => {
    const fetchImoveis = async () => {
      if (apiDisponivel()) {
        // Lista de imóveis da API, só id e título, ordenada por título como abaixo.
        setImoveis(await opcoesImoveisApi<ImovelSimples>(['id', 'titulo']).catch(() => []));
        return;
      }
      const { data } = await supabase.from('imoveis').select('id, titulo').order('titulo');
      if (data) setImoveis(data);
    };
    fetchImoveis();
  }, []);

  const getImovelNome = (imovelId: string | null) => {
    if (!imovelId) return undefined;
    return imoveis.find(i => i.id === imovelId)?.titulo;
  };

  const filteredVideos = useMemo(() => {
    let result = [...videos];

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(v =>
        v.titulo.toLowerCase().includes(term) ||
        v.descricao?.toLowerCase().includes(term)
      );
    }

    // Type filter
    if (tipoFilter !== 'TODOS') {
      result = result.filter(v => v.tipo === tipoFilter);
    }

    // Property filter
    if (imovelFilter !== 'TODOS') {
      if (imovelFilter === 'SEM_IMOVEL') {
        result = result.filter(v => !v.imovel_id);
      } else {
        result = result.filter(v => v.imovel_id === imovelFilter);
      }
    }

    // Sort
    switch (sortBy) {
      case 'recentes':
        result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
      case 'antigos':
        result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case 'nome':
        result.sort((a, b) => a.titulo.localeCompare(b.titulo));
        break;
      case 'visualizacoes':
        result.sort((a, b) => b.visualizacoes - a.visualizacoes);
        break;
    }

    return result;
  }, [videos, searchTerm, tipoFilter, imovelFilter, sortBy]);

  // KPIs
  const kpis = useMemo(() => ({
    total: videos.length,
    tourVirtual: videos.filter(v => v.tipo === 'TOUR_VIRTUAL').length,
    drone: videos.filter(v => v.tipo === 'DRONE').length,
    vinculados: videos.filter(v => v.imovel_id).length,
    visualizacoes: videos.reduce((sum, v) => sum + v.visualizacoes, 0),
  }), [videos]);

  const handlePlay = (video: VideoRow) => {
    setPlayerVideo(video);
  };

  const handleEdit = (video: VideoRow) => {
    setEditVideo(video);
  };

  const handleDeleteClick = (video: VideoRow) => {
    setDeleteVideoData(video);
  };

  const handleShare = (video: VideoRow) => {
    setShareVideo(video);
  };

  const handleConfirmDelete = async () => {
    if (!deleteVideoData) return;
    await deleteVideo(deleteVideoData.id, deleteVideoData.video_path);
    setDeleteVideoData(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        titulo="Mídias"
        subtitulo="Organize vídeos, fotos e conteúdos dos seus imóveis."
        comUtilitarios
        mostrarPrivacidade={false}
        acoes={
          <>
            <Button
              variant="outline"
              className="h-control"
              onClick={() => setAbaAtiva('fotos-ia')}
            >
              <Building2 className="mr-2 h-[18px] w-[18px]" />
              Gerar fotos com IA
            </Button>
            <Button className="h-control" onClick={() => setAbaAtiva('upload')}>
              <Plus className="mr-2 h-[18px] w-[18px]" />
              Enviar mídia
            </Button>
          </>
        }
      />

      <Tabs value={abaAtiva} onValueChange={setAbaAtiva} className="space-y-5">
        <TabsList className={abasSublinhadas.lista}>
          <TabsTrigger value="videos" className={abasSublinhadas.gatilho}>
            <Video className="mr-2 h-4 w-4" />
            Biblioteca
          </TabsTrigger>
          <TabsTrigger value="upload" className={abasSublinhadas.gatilho}>
            <Upload className="mr-2 h-4 w-4" />
            Upload
          </TabsTrigger>
          <TabsTrigger value="fotos-ia" className={abasSublinhadas.gatilho}>
            <Sparkles className="mr-2 h-4 w-4" />
            Fotos IA
          </TabsTrigger>
        </TabsList>

        {/* Fotos IA Tab */}
        <TabsContent value="fotos-ia">
          <FotosIA />
        </TabsContent>

        {/* Upload Tab */}
        <TabsContent value="upload">
          <Card>
            <CardHeader>
              <CardTitle>Upload de Vídeo</CardTitle>
              <CardDescription>
                Envie vídeos de tours virtuais, apresentações, depoimentos e mais
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VideoUploadArea
                onUpload={uploadVideo}
                uploading={uploading}
                uploadProgress={uploadProgress}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Videos Tab */}
        <TabsContent value="videos" className="space-y-6">
          {/* Faixa de indicadores. Cada um é um filtro: clicar em "Drone"
              mostra só os vídeos de drone — o número vira ação, não enfeite. */}
          <MetricStrip
            className="lg:grid-cols-5"
            carregando={loading}
            itens={[
              { id: 'total', valor: numero(kpis.total), label: 'Total',
                icone: <Film className="h-5 w-5" />, tom: 'brand' },
              { id: 'tours', valor: numero(kpis.tourVirtual), label: 'Tours virtuais',
                icone: <Rotate3d className="h-5 w-5" />, tom: 'info' },
              { id: 'drone', valor: numero(kpis.drone), label: 'Drone',
                icone: <Plane className="h-5 w-5" />, tom: 'warning' },
              { id: 'vinculados', valor: numero(kpis.vinculados), label: 'Vinculados',
                icone: <LinkIcon className="h-5 w-5" />, tom: 'success' },
              { id: 'views', valor: numero(kpis.visualizacoes), label: 'Visualizações',
                icone: <Eye className="h-5 w-5" />, tom: 'brand' },
            ]}
          />

          {/* Filtros */}
          <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-3 md:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar mídias..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-control pl-11"
              />
            </div>

            <Select value={tipoFilter} onValueChange={(v) => setTipoFilter(v as TipoVideo | 'TODOS')}>
              <SelectTrigger className="h-control w-full md:w-44">
                <Filter className="mr-2 h-[18px] w-[18px] text-muted-foreground" />
                <SelectValue placeholder="Tipo de mídia" />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_VIDEO.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={imovelFilter} onValueChange={setImovelFilter}>
              <SelectTrigger className="h-control w-full md:w-48">
                <Building2 className="mr-2 h-[18px] w-[18px] text-muted-foreground" />
                <SelectValue placeholder="Todos os imóveis" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">Todos os imóveis</SelectItem>
                <SelectItem value="SEM_IMOVEL">Sem imóvel</SelectItem>
                {imoveis.map((im) => (
                  <SelectItem key={im.id} value={im.id}>{im.titulo}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
              <SelectTrigger className="h-control w-full md:w-44">
                <ArrowDownUp className="mr-2 h-[18px] w-[18px] text-muted-foreground" />
                <SelectValue placeholder="Ordenar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recentes">Mais recentes</SelectItem>
                <SelectItem value="antigos">Mais antigos</SelectItem>
                <SelectItem value="nome">Alfabética</SelectItem>
                <SelectItem value="visualizacoes">Mais vistos</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex shrink-0 gap-1 rounded-lg border border-border p-1">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'ghost'}
                size="icon"
                className="h-9 w-9"
                onClick={() => setViewMode('grid')}
                aria-label="Ver em grade"
                aria-pressed={viewMode === 'grid'}
              >
                <Grid3X3 className="h-[18px] w-[18px]" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                size="icon"
                className="h-9 w-9"
                onClick={() => setViewMode('list')}
                aria-label="Ver em lista"
                aria-pressed={viewMode === 'list'}
              >
                <List className="h-[18px] w-[18px]" />
              </Button>
            </div>
          </div>

          {/* Videos Grid */}
          {filteredVideos.length === 0 ? (
            <SectionCard>
              {videos.length === 0 ? (
                // Banco vazio e busca sem resultado são situações diferentes:
                // uma pede o primeiro upload, a outra pede limpar o filtro.
                <EmptyState
                  icone={<Film className="h-6 w-6" />}
                  titulo="Seu banco de mídia está vazio"
                  descricao="Envie fotos e vídeos para organizar o material de cada imóvel e reutilizar nos seus anúncios."
                  acao={
                    <Button className="h-control" onClick={() => setAbaAtiva('upload')}>
                      <Upload className="mr-2 h-[18px] w-[18px]" />
                      Enviar primeira mídia
                    </Button>
                  }
                  secundaria={
                    <Button variant="ghost" onClick={() => setAbaAtiva('fotos-ia')}>
                      Criar fotos com IA
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icone={<Search className="h-6 w-6" />}
                  titulo="Nenhuma mídia encontrada"
                  descricao="Nenhum item corresponde aos filtros aplicados."
                  acao={
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSearchTerm('');
                        setTipoFilter('TODOS');
                        setImovelFilter('TODOS');
                      }}
                    >
                      Limpar filtros
                    </Button>
                  }
                />
              )}
            </SectionCard>
          ) : (
            <div className={viewMode === 'grid'
              ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
              : "flex flex-col gap-2"
            }>
              {filteredVideos.map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  imovelNome={getImovelNome(video.imovel_id)}
                  onPlay={handlePlay}
                  onEdit={handleEdit}
                  onDelete={handleDeleteClick}
                  onShare={handleShare}
                />
              ))}
            </div>
          )}

          <SectionCard titulo="Como funciona">
            <ol className="grid gap-5 sm:grid-cols-3">
              {[
                { n: 1, icone: <Upload className="h-[18px] w-[18px]" />,
                  titulo: 'Envie seus arquivos',
                  texto: 'Fotos, vídeos, tours ou imagens de drone' },
                { n: 2, icone: <LinkIcon className="h-[18px] w-[18px]" />,
                  titulo: 'Vincule ao imóvel',
                  texto: 'Mantenha todo o material organizado' },
                { n: 3, icone: <Megaphone className="h-[18px] w-[18px]" />,
                  titulo: 'Use nos anúncios',
                  texto: 'Encontre e reutilize o conteúdo com rapidez' },
              ].map((passo, i, todos) => (
                <li key={passo.n} className="relative flex min-w-0 items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {passo.n}
                  </span>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-brand text-primary">
                    {passo.icone}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{passo.titulo}</span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">{passo.texto}</span>
                  </span>
                  {/* Conector pontilhado só entre passos, e só quando estão
                      lado a lado — empilhados, a linha cairia no vazio. */}
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
      </Tabs>

      {/* Dialogs */}
      <VideoPlayerDialog
        video={playerVideo}
        open={!!playerVideo}
        onOpenChange={(open) => !open && setPlayerVideo(null)}
        onView={incrementVisualizacoes}
      />

      <EditarVideoDialog
        video={editVideo}
        open={!!editVideo}
        onOpenChange={(open) => !open && setEditVideo(null)}
        onUpdate={updateVideo}
      />

      <CompartilharVideoDialog
        video={shareVideo}
        imovelNome={shareVideo ? getImovelNome(shareVideo.imovel_id) : undefined}
        open={!!shareVideo}
        onOpenChange={(open) => !open && setShareVideo(null)}
        getTemporaryShareUrl={getTemporaryShareUrl}
      />

      <AlertDialog open={!!deleteVideoData} onOpenChange={(open) => !open && setDeleteVideoData(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Vídeo</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir "{deleteVideoData?.titulo}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              <Trash2 className="h-4 w-4 mr-2" />
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
