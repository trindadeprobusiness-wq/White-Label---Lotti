import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { apiDisponivel } from '@/lib/api';
import { comoResultado } from '@/lib/api/http';
import { corretorIdDaContaApi } from '@/stores/crmStore';
import { apagarArquivoApi, enviarArquivoApi, urlPublicaVideo } from '@/lib/api/arquivos';

export type TipoVideo = 'TOUR_VIRTUAL' | 'APRESENTACAO' | 'DEPOIMENTO' | 'DRONE' | 'INSTITUCIONAL' | 'OUTRO';

export interface VideoRow {
  id: string;
  corretor_id: string;
  imovel_id: string | null;
  titulo: string;
  descricao: string | null;
  video_url: string;
  video_path: string;
  thumbnail_url: string | null;
  duracao_segundos: number | null;
  tipo: TipoVideo;
  visualizacoes: number;
  created_at: string;
  updated_at: string;
}

export function useVideos() {
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const fetchVideos = useCallback(async (silent = false) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setVideos((data as VideoRow[]) || []);
    } catch (error: any) {
      console.error('Erro ao buscar vídeos:', error);
      if (!silent) {
        toast.error('Erro ao carregar vídeos');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVideos(true);
  }, [fetchVideos]);

  const uploadVideo = async (
    file: File,
    titulo: string,
    tipo: TipoVideo,
    imovelId?: string,
    descricao?: string
  ) => {
    try {
      setUploading(true);
      setUploadProgress(0);

      // Get corretor_id
      // Com a API ligada não há sessão do Supabase: o corretor da conta vem do perfil.
      const { data: corretorData, error: corretorError } = apiDisponivel()
        ? await comoResultado(corretorIdDaContaApi())
        : await supabase.rpc('get_corretor_id');
      if (corretorError || !corretorData) {
        throw new Error('Não foi possível identificar o corretor. Faça login novamente.');
      }
      const corretorId = corretorData as string;

      // Create file path
      const timestamp = Date.now();
      const fileExt = file.name.split('.').pop();
      const folder = imovelId || 'geral';
      const filePath = `${corretorId}/${folder}/${timestamp}_${file.name}`;

      // Simulate progress for better UX (actual upload doesn't provide progress)
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 500);

      // Upload + URL pública. Com a API ligada, o vídeo (até 500 MB) sobe por streaming
      // para o Garage via API e a URL é a rota pública da API; a key é a mesma.
      let videoUrl: string;
      try {
        if (apiDisponivel()) {
          await enviarArquivoApi('video', filePath, file);
          videoUrl = urlPublicaVideo(filePath);
        } else {
          const { error: uploadError } = await supabase.storage
            .from('videos')
            .upload(filePath, file);
          if (uploadError) throw uploadError;
          videoUrl = supabase.storage.from('videos').getPublicUrl(filePath).data.publicUrl;
        }
      } finally {
        clearInterval(progressInterval);
      }
      setUploadProgress(95);

      // Insert record in database
      const { data: videoData, error: insertError } = await supabase
        .from('videos')
        .insert({
          titulo,
          tipo,
          descricao: descricao || null,
          video_path: filePath,
          video_url: videoUrl,
          imovel_id: imovelId || null,
          corretor_id: corretorId,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      setUploadProgress(100);
      toast.success('Vídeo enviado com sucesso!');
      await fetchVideos();
      return videoData as VideoRow;
    } catch (error: any) {
      console.error('Erro ao enviar vídeo:', error);
      toast.error(error.message || 'Erro ao enviar vídeo');
      throw error;
    } finally {
      setUploading(false);
      setTimeout(() => setUploadProgress(0), 1000);
    }
  };

  const deleteVideo = async (id: string, videoPath?: string) => {
    try {
      // Delete from storage if path provided (Garage via API quando ligada).
      if (videoPath) {
        if (apiDisponivel()) {
          await apagarArquivoApi('video', videoPath);
        } else {
          await supabase.storage
            .from('videos')
            .remove([videoPath]);
        }
      }

      // Delete from database
      const { error } = await supabase
        .from('videos')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Vídeo removido com sucesso!');
      await fetchVideos();
    } catch (error: any) {
      console.error('Erro ao deletar vídeo:', error);
      toast.error('Erro ao remover vídeo');
      throw error;
    }
  };

  const updateVideo = async (id: string, updates: Partial<Pick<VideoRow, 'titulo' | 'descricao' | 'tipo' | 'imovel_id'>>) => {
    try {
      const { error } = await supabase
        .from('videos')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      toast.success('Vídeo atualizado com sucesso!');
      await fetchVideos();
    } catch (error: any) {
      console.error('Erro ao atualizar vídeo:', error);
      toast.error('Erro ao atualizar vídeo');
      throw error;
    }
  };

  const incrementVisualizacoes = async (id: string) => {
    try {
      const video = videos.find(v => v.id === id);
      if (!video) return;

      await supabase
        .from('videos')
        .update({ visualizacoes: video.visualizacoes + 1 })
        .eq('id', id);
      
      // Update local state
      setVideos(prev => prev.map(v => 
        v.id === id ? { ...v, visualizacoes: v.visualizacoes + 1 } : v
      ));
    } catch (error) {
      console.error('Erro ao incrementar visualizações:', error);
    }
  };

  const getTemporaryShareUrl = async (videoPath: string, expiresIn = 604800): Promise<string> => {
    try {
      // Bucket público: com a API ligada, a rota pública serve sem expiração.
      if (apiDisponivel()) {
        return urlPublicaVideo(videoPath);
      }
      const { data, error } = await supabase.storage
        .from('videos')
        .createSignedUrl(videoPath, expiresIn);

      if (error) throw error;
      return data.signedUrl;
    } catch (error: any) {
      console.error('Erro ao gerar link temporário:', error);
      toast.error('Erro ao gerar link de compartilhamento');
      throw error;
    }
  };

  return {
    videos,
    loading,
    uploading,
    uploadProgress,
    fetchVideos,
    uploadVideo,
    deleteVideo,
    updateVideo,
    incrementVisualizacoes,
    getTemporaryShareUrl,
  };
}
