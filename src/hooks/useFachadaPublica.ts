import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import {
  enviarLeadPublicoApi,
  obterFachadaPublicaApi,
  registrarEscaneamentoApi,
} from '@/lib/api/fachadas';
import type { FachadaComImovel } from '@/types/fachada';

/**
 * Hook usado na landing page pública (/p/:fachadaId).
 * Todas as operações são sem autenticação: com a API Lotti ligada vão pelas
 * rotas /api/publico/fachadas (role anon no banco, mesmas policies, mesmos
 * gatilhos e o mesmo limite de uso); sem ela, seguem pela anon key do Supabase.
 */
export function useFachadaPublica() {
  const [fachada, setFachada] = useState<FachadaComImovel | null>(null);
  const [fotos, setFotos] = useState<{ id: string; arquivo_url: string; principal: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [leadCapturado, setLeadCapturado] = useState(false);

  const fetchFachadaPublica = useCallback(async (fachadaId: string) => {
    setLoading(true);
    try {
      let data: { fachada?: unknown; fotos?: unknown; error?: string } | null;

      if (apiDisponivel()) {
        data = await obterFachadaPublicaApi(fachadaId);
      } else {
        // Busca via Edge Function (service_role): o RLS esconde do anônimo os imóveis
        // não-anunciados e a tabela corretores inteira, o que deixava a landing VAZIA.
        // A função devolve só campos seguros (sem PII de proprietário).
        const res = await supabase.functions.invoke('fachada-publica', {
          body: { fachadaId },
        });

        if (res.error) throw res.error;
        data = res.data;
      }

      if (!data?.fachada) throw new Error(data?.error || 'Fachada não encontrada');

      const f = data.fachada as Record<string, unknown>;
      setFachada({
        ...f,
        imovel: f.imovel ?? undefined,
        corretor: f.corretor ?? undefined,
      } as unknown as FachadaComImovel);

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
      if (apiDisponivel()) {
        // O user_agent vai no cabeçalho da própria requisição, não no corpo.
        await registrarEscaneamentoApi(fachadaId);
      } else {
        await supabase.from('fachada_escaneamentos').insert({
          fachada_id: fachadaId,
          user_agent: navigator.userAgent,
        } as any);
      }
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
        if (apiDisponivel()) {
          // `email` vazio não é enviado: o DTO público recusa string vazia.
          await enviarLeadPublicoApi(fachadaId, {
            nome: dados.nome,
            telefone: dados.telefone,
            email: dados.email || undefined,
          });
        } else {
          const { error } = await supabase.from('fachada_leads').insert({
            fachada_id: fachadaId,
            ...dados,
          } as any);

          if (error) throw error;
        }

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
