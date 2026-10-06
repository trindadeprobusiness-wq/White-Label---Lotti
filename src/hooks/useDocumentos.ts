import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { apiDisponivel } from '@/lib/api';
import { comoResultado } from '@/lib/api/http';
import { corretorIdDaContaApi } from '@/stores/crmStore';
import {
  alterarDocumentoApi,
  criarDocumentoApi,
  listarDocumentosApi,
  removerDocumentoApi,
} from '@/lib/api/contratos';
import { apagarArquivoApi, baixarPrivadoApi, enviarArquivoApi } from '@/lib/api/arquivos';

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
      // Fase 4 (módulo contratos): com a API ligada, lê por ela no mesmo formato.
      const { data, error } = apiDisponivel()
        ? await comoResultado(listarDocumentosApi() as unknown as Promise<DocumentoRow[]>)
        : await supabase
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
      // Com a API ligada não há sessão do Supabase: o corretor da conta vem do perfil.
      const { data: corretorData, error: corretorError } = apiDisponivel()
        ? await comoResultado(corretorIdDaContaApi())
        : await supabase.rpc('get_corretor_id');
      if (corretorError || !corretorData) {
        throw new Error('Não foi possível identificar o corretor');
      }
      const corretorId = corretorData as string;

      // Create file path
      const timestamp = Date.now();
      const fileExt = file.name.split('.').pop();
      const folder = clienteId || 'geral';
      const filePath = `${corretorId}/${folder}/${timestamp}_${file.name}`;

      // Upload. Bucket privado: com a API ligada o arquivo vai para o Garage (via API) e
      // guardamos a própria key em arquivo_url (sem URL pública); a key é a mesma.
      let arquivoUrl: string;
      if (apiDisponivel()) {
        await enviarArquivoApi('documento', filePath, file);
        arquivoUrl = filePath;
      } else {
        const { error: uploadError } = await supabase.storage
          .from('documentos')
          .upload(filePath, file);
        if (uploadError) throw uploadError;
        arquivoUrl = supabase.storage.from('documentos').getPublicUrl(filePath).data.publicUrl;
      }

      // Insert record in database
      if (apiDisponivel()) {
        // A API põe corretor_id e validado=false; o caminho tem de começar pelo corretor.
        const docApi = await criarDocumentoApi({
          nome,
          tipo,
          arquivo_path: filePath,
          arquivo_url: arquivoUrl,
          cliente_id: clienteId || null,
          imovel_id: imovelId || null,
          data_validade: dataValidade || null,
          observacoes: observacoes || null,
        });
        toast.success('Documento enviado com sucesso!');
        await fetchDocumentos();
        return docApi;
      }

      const { data: docData, error: insertError } = await supabase
        .from('documentos')
        .insert({
          nome,
          tipo,
          arquivo_path: filePath,
          arquivo_url: arquivoUrl,
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
      // Delete from storage if path exists (Garage via API quando ligada).
      if (arquivoPath) {
        if (apiDisponivel()) {
          await apagarArquivoApi('documento', arquivoPath).catch((e) =>
            console.error('Erro ao deletar arquivo do storage:', e));
        } else {
          const { error: storageError } = await supabase.storage
            .from('documentos')
            .remove([arquivoPath]);
          if (storageError) {
            console.error('Erro ao deletar arquivo do storage:', storageError);
          }
        }
      }

      // Delete from database
      if (apiDisponivel()) {
        await removerDocumentoApi(id);
      } else {
        const { error } = await supabase
          .from('documentos')
          .delete()
          .eq('id', id);

        if (error) throw error;
      }

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
      // Bucket privado: com a API ligada, baixa pela API (token no cabeçalho) e devolve
      // uma object URL. Quem exibe é responsável por revogar quando trocar/fechar.
      if (apiDisponivel()) {
        return await baixarPrivadoApi('documento', arquivoPath);
      }
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
      // Com a API ligada, baixa pela API (token no cabeçalho) como object URL.
      let url: string;
      if (apiDisponivel()) {
        url = await baixarPrivadoApi('documento', arquivoPath);
      } else {
        const { data, error } = await supabase.storage
          .from('documentos')
          .download(arquivoPath);
        if (error) throw error;
        url = URL.createObjectURL(data);
      }

      // Create download link
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
      if (apiDisponivel()) {
        // documentos não tem updated_at: a API não o envia (corrige D2).
        await alterarDocumentoApi(id, { validado });
      } else {
        const { error } = await supabase
          .from('documentos')
          .update({ validado, updated_at: new Date().toISOString() })
          .eq('id', id);

        if (error) throw error;
      }

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
      if (apiDisponivel()) {
        await alterarDocumentoApi(id, updates);
      } else {
        const { error } = await supabase
          .from('documentos')
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq('id', id);

        if (error) throw error;
      }

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
