import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { FachadaComImovel, FachadaLead } from '@/types/fachada';

/**
 * Hook usado na landing page pública (/p/:fachadaId).
 * Todas as operações usam a anon key (sem autenticação obrigatória).
 */
export function useFachadaPublica() {
  const [fachada, setFachada] = useState<FachadaComImovel | null>(null);
  const [fotos, setFotos] = useState<{ id: string; arquivo_url: string; principal: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [leadCapturado, setLeadCapturado] = useState(false);

  const fetchFachadaPublica = useCallback(async (fachadaId: string) => {
    setLoading(true);
    try {
      // Busca via Edge Function (service_role): o RLS esconde do anônimo os imóveis
      // não-anunciados e a tabela corretores inteira, o que deixava a landing VAZIA.
      // A função devolve só campos seguros (sem PII de proprietário).
      const { data, error } = await supabase.functions.invoke('fachada-publica', {
        body: { fachadaId },
      });

      if (error) throw error;
      if (!data?.fachada) throw new Error(data?.error || 'Fachada não encontrada');

      const f = data.fachada;
      setFachada({
        ...f,
        imovel: f.imovel ?? undefined,
        corretor: f.corretor ?? undefined,
      } as FachadaComImovel);

      setFotos(Array.isArray(data.fotos) ? data.fotos : []);
    } catch (err) {
      console.error('Erro ao buscar fachada pública:', err);
      setFachada(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const registrarEscaneamento = useCallback(async (fachadaId: string) => {
    try {
      await supabase.from('fachada_escaneamentos').insert({
        fachada_id: fachadaId,
        user_agent: navigator.userAgent,
      } as any);
    } catch (err) {
      // Falha silenciosa — não bloqueia a experiência do visitante
      console.warn('Falha ao registrar escaneamento:', err);
    }
  }, []);

  const enviarLead = useCallback(
    async (
      fachadaId: string,
      dados: { nome: string; telefone: string; email?: string },
    ): Promise<boolean> => {
      try {
        const { error } = await supabase.from('fachada_leads').insert({
          fachada_id: fachadaId,
          ...dados,
        } as any);

        if (error) throw error;

        setLeadCapturado(true);
        return true;
      } catch (err) {
        console.error('Erro ao enviar lead:', err);
        return false;
      }
    },
    [],
  );

  return {
    fachada,
    fotos,
    loading,
    leadCapturado,
    fetchFachadaPublica,
    registrarEscaneamento,
    enviarLead,
  };
}
