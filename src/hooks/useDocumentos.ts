import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface DocumentoRow {
  id: string;
  nome: string;
  tipo: string;
  arquivo_path: string | null;
  arquivo_url: string | null;
  cliente_id: string | null;
  imovel_id: string | null;
  corretor_id: string;
  validado: boolean | null;
  data_validade: string | null;
  observacoes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export function useDocumentos() {
  const [documentos, setDocumentos] = useState<DocumentoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const fetchDocumentos = useCallback(async (silent = false) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('documentos')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDocumentos(data || []);
    } catch (error: any) {
      console.error('Erro ao buscar documentos:', error);
      if (!silent) {
        toast.error('Erro ao carregar documentos');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocumentos(true);
  }, [fetchDocumentos]);

  const uploadDocumento = async (
    file: File,
    nome: string,
    tipo: string,
    clienteId?: string,
    imovelId?: string,
    dataValidade?: string,
    observacoes?: string
  ) => {
    try {
      setUploading(true);

      // Get corretor_id
      const { data: corretorData, error: corretorError } = await supabase.rpc('get_corretor_id');
      if (corretorError || !corretorData) {
        throw new Error('Não foi possível identificar o corretor');
      }
      const corretorId = corretorData as string;

      // Create file path
      const timestamp = Date.now();
      const fileExt = file.name.split('.').pop();
      const folder = clienteId || 'geral';
      const filePath = `${corretorId}/${folder}/${timestamp}_${file.name}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('documentos')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Get public URL (for private bucket we'll use signed URLs)
      const { data: urlData } = supabase.storage
        .from('documentos')
        .getPublicUrl(filePath);

      // Insert record in database
      const { data: docData, error: insertError } = await supabase
        .from('documentos')
        .insert({
          nome,
          tipo,
          arquivo_path: filePath,
          arquivo_url: urlData.publicUrl,
          cliente_id: clienteId || null,
          imovel_id: imovelId || null,
          corretor_id: corretorId,
          validado: false,
          data_validade: dataValidade || null,
          observacoes: observacoes || null,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      toast.success('Documento enviado com sucesso!');
      await fetchDocumentos();
      return docData;
    } catch (error: any) {
      console.error('Erro ao enviar documento:', error);
      toast.error(error.message || 'Erro ao enviar documento');
      throw error;
    } finally {
      setUploading(false);
    }
  };

  const deleteDocumento = async (id: string, arquivoPath?: string | null) => {
    try {
      // Delete from storage if path exists
      if (arquivoPath) {
        const { error: storageError } = await supabase.storage
          .from('documentos')
          .remove([arquivoPath]);

        if (storageError) {
          console.error('Erro ao deletar arquivo do storage:', storageError);
        }
      }

      // Delete from database
      const { error } = await supabase
        .from('documentos')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Documento removido com sucesso!');
      await fetchDocumentos();
    } catch (error: any) {
      console.error('Erro ao deletar documento:', error);
      toast.error('Erro ao remover documento');
      throw error;
    }
  };

  const getSignedUrl = async (arquivoPath: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase.storage
        .from('documentos')
        .createSignedUrl(arquivoPath, 3600); // 1 hour

      if (error) throw error;
      return data.signedUrl;
    } catch (error: any) {
      console.error('Erro ao gerar URL assinada:', error);
      toast.error('Erro ao acessar documento');
      return null;
    }
  };

  const downloadDocumento = async (arquivoPath: string, nomeArquivo: string) => {
    try {
      const { data, error } = await supabase.storage
        .from('documentos')
        .download(arquivoPath);

      if (error) throw error;

      // Create download link
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = nomeArquivo;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Download iniciado!');
    } catch (error: any) {
      console.error('Erro ao baixar documento:', error);
      toast.error('Erro ao baixar documento');
    }
  };

  const toggleValidacao = async (id: string, validado: boolean) => {
    try {
      const { error } = await supabase
        .from('documentos')
        .update({ validado, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      setDocumentos(prev =>
        prev.map(doc =>
          doc.id === id ? { ...doc, validado } : doc
        )
      );

      toast.success(validado ? 'Documento validado!' : 'Validação removida');
    } catch (error: any) {
      console.error('Erro ao atualizar validação:', error);
      toast.error('Erro ao atualizar validação');
    }
  };

  const updateDocumento = async (id: string, updates: Partial<Pick<DocumentoRow, 'nome' | 'tipo' | 'cliente_id' | 'imovel_id' | 'data_validade' | 'observacoes'>>) => {
    try {
      const { error } = await supabase
        .from('documentos')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      toast.success('Documento atualizado com sucesso!');
      await fetchDocumentos();
    } catch (error: any) {
      console.error('Erro ao atualizar documento:', error);
      toast.error('Erro ao atualizar documento');
      throw error;
    }
  };

  return {
    documentos,
    loading,
    uploading,
    fetchDocumentos,
    uploadDocumento,
    deleteDocumento,
    getSignedUrl,
    downloadDocumento,
    toggleValidacao,
    updateDocumento,
  };
}
