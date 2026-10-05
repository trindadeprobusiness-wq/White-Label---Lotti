import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { novaOrdemPara } from '@/lib/ordemFotos';
import { apiDisponivel } from '@/lib/api';
import { apagarArquivoApi, enviarArquivoApi, urlPublicaFoto } from '@/lib/api/arquivos';

export interface ImovelFoto {
  id: string;
  imovel_id: string;
  arquivo_url: string;
  arquivo_path: string;
  principal: boolean | null;
  ordem: number | null;
  created_at: string | null;
}

export function useImovelFotos(imovelId?: string) {
  const [fotos, setFotos] = useState<ImovelFoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fetchFotos = useCallback(async (id?: string) => {
    const targetId = id || imovelId;
    if (!targetId) return;

    try {
      setLoading(true);
      // Desempate por created_at: as fotos antigas ficaram todas com o default
      // ordem = 0 e, sem critério secundário, o Postgres devolvia em ordem
      // imprevisível — a galeria mudava sozinha a cada carregamento.
      const { data, error } = await supabase
        .from('imovel_fotos')
        .select('*')
        .eq('imovel_id', targetId)
        .order('ordem', { ascending: true })
        .order('created_at', { ascending: true });

      if (error) throw error;
      setFotos(data || []);
    } catch (error: any) {
      console.error('Erro ao buscar fotos:', error);
    } finally {
      setLoading(false);
    }
  }, [imovelId]);

  const uploadFoto = async (targetImovelId: string, file: File, isPrincipal = false) => {
    try {
      setUploading(true);

      // Validate file type
      const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        throw new Error('Tipo de arquivo inválido. Use JPEG, PNG ou WebP.');
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Arquivo muito grande. Máximo 5MB.');
      }

      // Create file path
      const timestamp = Date.now();
      const fileExt = file.name.split('.').pop();
      const filePath = `${targetImovelId}/${timestamp}_${file.name}`;

      // Upload + URL pública. Com a API ligada, o arquivo vai para o Garage (via API)
      // e a URL é a rota pública da API; a key (filePath) é a mesma dos dois lados.
      let arquivoUrl: string;
      if (apiDisponivel()) {
        await enviarArquivoApi('foto', filePath, file);
        arquivoUrl = urlPublicaFoto(filePath);
      } else {
        const { error: uploadError } = await supabase.storage
          .from('imoveis-fotos')
          .upload(filePath, file);
        if (uploadError) throw uploadError;
        arquivoUrl = supabase.storage.from('imoveis-fotos').getPublicUrl(filePath).data.publicUrl;
      }

      // Get current max order
      const { data: existingFotos } = await supabase
        .from('imovel_fotos')
        .select('ordem')
        .eq('imovel_id', targetImovelId)
        .order('ordem', { ascending: false })
        .limit(1);

      const nextOrder = existingFotos && existingFotos.length > 0 
        ? (existingFotos[0].ordem || 0) + 1 
        : 0;

      // If setting as principal, unset others first
      if (isPrincipal) {
        await supabase
          .from('imovel_fotos')
          .update({ principal: false })
          .eq('imovel_id', targetImovelId);
      }

      // Insert record
      const { data: fotoData, error: insertError } = await supabase
        .from('imovel_fotos')
        .insert({
          imovel_id: targetImovelId,
          arquivo_url: arquivoUrl,
          arquivo_path: filePath,
          principal: isPrincipal || nextOrder === 0, // First photo is principal by default
          ordem: nextOrder,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      return fotoData;
    } catch (error: any) {
      console.error('Erro ao enviar foto:', error);
      toast.error(error.message || 'Erro ao enviar foto');
      throw error;
    } finally {
      setUploading(false);
    }
  };

  const uploadMultipleFotos = async (targetImovelId: string, files: File[]) => {
    const results: ImovelFoto[] = [];
    
    for (let i = 0; i < files.length; i++) {
      try {
        const foto = await uploadFoto(targetImovelId, files[i], i === 0 && fotos.length === 0);
        if (foto) results.push(foto);
      } catch (error) {
        // Continue with other files
      }
    }

    if (results.length > 0) {
      toast.success(`${results.length} foto(s) enviada(s) com sucesso!`);
      await fetchFotos(targetImovelId);
    }

    return results;
  };

  const deleteFoto = async (id: string, arquivoPath: string) => {
    try {
      // Delete from storage (Garage via API quando ligada; a key é a mesma).
      if (apiDisponivel()) {
        await apagarArquivoApi('foto', arquivoPath).catch((e) =>
          console.error('Erro ao deletar do storage:', e));
      } else {
        const { error: storageError } = await supabase.storage
          .from('imoveis-fotos')
          .remove([arquivoPath]);
        if (storageError) {
          console.error('Erro ao deletar do storage:', storageError);
        }
      }

      // Delete from database
      const { error } = await supabase
        .from('imovel_fotos')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Foto removida com sucesso!');
      setFotos(prev => prev.filter(f => f.id !== id));
    } catch (error: any) {
      console.error('Erro ao deletar foto:', error);
      toast.error('Erro ao remover foto');
      throw error;
    }
  };

  /**
   * Grava a coluna `ordem` conforme a posição na lista recebida.
   * A coluna existe desde a criação da tabela, mas nada no app escrevia nela
   * depois do insert — a ordem era só a de upload, e não dava para mudar.
   */
  const reordenarFotos = async (targetImovelId: string, idsNaOrdem: string[]) => {
    const anterior = fotos;
    // Otimista: arrastar tem que parecer instantâneo.
    const porId = new Map(fotos.map((f) => [f.id, f]));
    setFotos(idsNaOrdem.map((id, i) => ({ ...porId.get(id)!, ordem: i })).filter(Boolean));

    try {
      const resultados = await Promise.all(
        novaOrdemPara(idsNaOrdem).map(({ id, ordem }) =>
          supabase.from('imovel_fotos').update({ ordem }).eq('id', id),
        ),
      );
      const falhou = resultados.find((r) => r.error);
      if (falhou?.error) throw falhou.error;
    } catch (error: any) {
      console.error('Erro ao reordenar fotos:', error);
      setFotos(anterior); // desfaz o otimismo
      toast.error('Não foi possível salvar a nova ordem das fotos');
      await fetchFotos(targetImovelId);
    }
  };

  const setFotoPrincipal = async (id: string, targetImovelId: string) => {
    try {
      // Unset all as principal
      await supabase
        .from('imovel_fotos')
        .update({ principal: false })
        .eq('imovel_id', targetImovelId);

      // Set selected as principal
      const { error } = await supabase
        .from('imovel_fotos')
        .update({ principal: true })
        .eq('id', id);

      if (error) throw error;

      // A principal também vai para o início. Sem isto a fachada pública mostrava
      // a principal ao fundo e começava o carrossel noutra foto — o visitante via
      // primeiro uma imagem que o corretor não escolheu.
      const demais = fotos.filter((f) => f.id !== id).map((f) => f.id);
      await reordenarFotos(targetImovelId, [id, ...demais]);

      toast.success('Foto principal definida!');
      await fetchFotos(targetImovelId);
    } catch (error: any) {
      console.error('Erro ao definir foto principal:', error);
      toast.error('Erro ao definir foto principal');
    }
  };

  const getFotoPrincipal = async (targetImovelId: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase
        .from('imovel_fotos')
        .select('arquivo_url')
        .eq('imovel_id', targetImovelId)
        .eq('principal', true)
        .single();

      if (error || !data) {
        // Try to get first photo as fallback
        const { data: firstFoto } = await supabase
          .from('imovel_fotos')
          .select('arquivo_url')
          .eq('imovel_id', targetImovelId)
          .order('ordem', { ascending: true })
          .limit(1)
          .single();

        return firstFoto?.arquivo_url || null;
      }

      return data.arquivo_url;
    } catch {
      return null;
    }
  };

  return {
    fotos,
    loading,
    uploading,
    fetchFotos,
    uploadFoto,
    uploadMultipleFotos,
    deleteFoto,
    reordenarFotos,
    setFotoPrincipal,
    getFotoPrincipal,
  };
}
