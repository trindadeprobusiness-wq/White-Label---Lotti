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
      const { data, error } = await supabase
        .from('fachadas')
        .select(`
          *,
          imovel:imoveis(titulo, tipo, valor, area_m2, dormitorios, garagem, endereco, bairro, cidade, descricao),
          corretor:corretores(nome, telefone, email, creci, foto_url, razao_social)
        `)
        .eq('id', fachadaId)
        .eq('ativo', true)
        .single();

      if (error) throw error;

      const mapped = {
        ...data,
        imovel: data.imovel ?? undefined,
        corretor: data.corretor ?? undefined,
      } as FachadaComImovel;

      setFachada(mapped);

      // Buscar fotos do imóvel
      if (data.imovel_id) {
        const { data: fotosData } = await supabase
          .from('imovel_fotos')
          .select('id, arquivo_url, principal')
          .eq('imovel_id', data.imovel_id)
          .order('ordem', { ascending: true });

        setFotos(
          (fotosData || []).map((f: any) => ({
            id: f.id,
            arquivo_url: f.arquivo_url,
            principal: !!f.principal,
          })),
        );
      }
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
