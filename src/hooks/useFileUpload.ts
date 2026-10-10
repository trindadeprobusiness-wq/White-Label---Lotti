import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import { apagarArquivoApi, enviarArquivoApi, urlPublicaFoto, type GrupoUpload } from '@/lib/api/arquivos';

type BucketName = 'imoveis-fotos' | 'documentos';

// Com a API ligada, imoveis-fotos e documentos passam pela API (Garage). ai-attachments não passa por aqui.
const GRUPO_POR_BUCKET: Partial<Record<BucketName, GrupoUpload>> = {
  'imoveis-fotos': 'foto',
  documentos: 'documento',
};

interface UploadResult {
  path: string;
  url: string;
}

interface UseFileUploadReturn {
  upload: (file: File, path: string) => Promise<UploadResult>;
  remove: (path: string) => Promise<void>;
  uploading: boolean;
  error: string | null;
}

export function useFileUpload(bucket: BucketName): UseFileUploadReturn {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File, path: string): Promise<UploadResult> => {
    setUploading(true);
    setError(null);

    try {
      const grupo = GRUPO_POR_BUCKET[bucket];
      if (apiDisponivel() && grupo) {
        // Garage via API; a key (path) é preservada. imoveis-fotos é público (URL da API);
        // documentos é privado, então devolvemos a própria key como url.
        await enviarArquivoApi(grupo, path, file);
        return { path, url: grupo === 'foto' ? urlPublicaFoto(path) : path };
      }

      const { data, error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(path, file, { upsert: true });

      if (uploadError) {
        throw uploadError;
      }

      const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(data.path);

      return { path: data.path, url: urlData.publicUrl };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao fazer upload';
      setError(message);
      throw err;
    } finally {
      setUploading(false);
    }
  };

  const remove = async (path: string): Promise<void> => {
    setUploading(true);
    setError(null);

    try {
      const grupo = GRUPO_POR_BUCKET[bucket];
      if (apiDisponivel() && grupo) {
        await apagarArquivoApi(grupo, path);
        return;
      }

      const { error: removeError } = await supabase.storage
        .from(bucket)
        .remove([path]);

      if (removeError) {
        throw removeError;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao remover arquivo';
      setError(message);
      throw err;
    } finally {
      setUploading(false);
    }
  };

  return { upload, remove, uploading, error };
}
