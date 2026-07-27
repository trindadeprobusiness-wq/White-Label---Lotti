import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import type {
  Fachada,
  FachadaComImovel,
  FachadaLead,
  FachadaMetricas,
  CTAPrincipal,
  TipoNegocio,
} from '@/types/fachada';

export function useFachadas() {
  const [fachadas, setFachadas] = useState<FachadaComImovel[]>([]);
  const [leads, setLeads] = useState<FachadaLead[]>([]);
  const [metricas, setMetricas] = useState<FachadaMetricas | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchFachadas = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('fachadas')
        .select(`
          *,
          imovel:imoveis(titulo, tipo, valor, area_m2, dormitorios, garagem, endereco, bairro, cidade, descricao),
          corretor:corretores(nome, telefone, email, creci, foto_url, razao_social)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Map the Supabase response to our expected shape
      const mapped = (data || []).map((row: any) => ({
        ...row,
        imovel: row.imovel ?? undefined,
        corretor: row.corretor ?? undefined,
      }));

      setFachadas(mapped as FachadaComImovel[]);
    } catch (err) {
      console.error('Erro ao buscar fachadas:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const createFachada = useCallback(
    async (data: {
      imovel_id: string;
      tipo_negocio: TipoNegocio;
      template_id: string;
      cta_principal: CTAPrincipal;
      modo_conversao: boolean;
      mensagem_whatsapp?: string;
      logo_url?: string;
      foto_principal_url?: string;
    }): Promise<string | null> => {
      try {
        const { data: corretorId } = await supabase.rpc('get_corretor_id');
        if (!corretorId) throw new Error('Corretor não encontrado');

        // Buscar foto principal do imóvel automaticamente
        let fotoPrincipalUrl = data.foto_principal_url;
        if (!fotoPrincipalUrl) {
          const { data: fotoData } = await supabase
            .from('imovel_fotos')
            .select('arquivo_url')
            .eq('imovel_id', data.imovel_id)
            .eq('principal', true)
            .limit(1)
            .maybeSingle();

          if (fotoData?.arquivo_url) {
            fotoPrincipalUrl = fotoData.arquivo_url;
          } else {
            // Se não tem foto principal, pega a primeira foto disponível
            const { data: primeiraFoto } = await supabase
              .from('imovel_fotos')
              .select('arquivo_url')
              .eq('imovel_id', data.imovel_id)
              .order('ordem', { ascending: true })
              .limit(1)
              .maybeSingle();

            if (primeiraFoto?.arquivo_url) {
              fotoPrincipalUrl = primeiraFoto.arquivo_url;
            }
          }
        }

        const { data: row, error } = await supabase
          .from('fachadas')
          .insert({
            ...data,
            corretor_id: corretorId,
            foto_principal_url: fotoPrincipalUrl || null,
          } as any)
          .select()
          .single();

        if (error) throw error;

        toast({ title: 'Fachada criada com sucesso!' });
        await fetchFachadas();
        return row.id;
      } catch (err: any) {
        console.error('Erro ao criar fachada:', err);
        toast({
          variant: 'destructive',
          title: 'Erro ao criar fachada',
          description: err?.message || 'Verifique sua conexão e tente novamente.',
        });
        return null;
      }
    },
    [fetchFachadas],
  );

  const updateFachada = useCallback(
    async (id: string, data: Partial<Fachada>): Promise<boolean> => {
      try {
        const { error } = await supabase
          .from('fachadas')
          .update(data as any)
          .eq('id', id);

        if (error) throw error;

        toast({ title: 'Fachada atualizada!' });
        await fetchFachadas();
        return true;
      } catch (err) {
        console.error('Erro ao atualizar fachada:', err);
        toast({
          variant: 'destructive',
          title: 'Erro ao atualizar fachada',
        });
        return false;
      }
    },
    [fetchFachadas],
  );

  const deleteFachada = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const { error } = await supabase
          .from('fachadas')
          .delete()
          .eq('id', id);

        if (error) throw error;

        toast({ title: 'Fachada excluída com sucesso' });
        await fetchFachadas();
        return true;
      } catch (err) {
        console.error('Erro ao excluir fachada:', err);
        return false;
      }
    },
    [fetchFachadas],
  );

  const fetchLeads = useCallback(async (fachadaId?: string) => {
    try {
      let query = supabase
        .from('fachada_leads')
        .select('*')
        .order('created_at', { ascending: false });

      if (fachadaId) {
        query = query.eq('fachada_id', fachadaId);
      }

      const { data, error } = await query;
      if (error) throw error;
      setLeads((data || []) as unknown as FachadaLead[]);
    } catch (err) {
      console.error('Erro ao buscar leads:', err);
    }
  }, []);

  const deleteLead = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const { error } = await supabase
          .from('fachada_leads')
          .delete()
          .eq('id', id);

        if (error) throw error;

        setLeads((prev) => prev.filter((l) => l.id !== id));
        toast({ title: 'Lead excluído com sucesso' });
        return true;
      } catch (err) {
        console.error('Erro ao excluir lead:', err);
        toast({
          variant: 'destructive',
          title: 'Erro ao excluir lead',
        });
        return false;
      }
    },
    [],
  );

  const fetchMetricas = useCallback(async (periodoDias = 30) => {
    try {
      // Fachadas ativas (contagem não depende de período)
      const { data: fachadasData } = await supabase
        .from('fachadas')
        .select('id')
        .eq('ativo', true);
      const fachadasList = fachadasData || [];

      // Janela de tempo escolhida (leads/scans por evento, com created_at)
      const inicio = new Date();
      inicio.setDate(inicio.getDate() - periodoDias);

      const { data: leadsRecent } = await supabase
        .from('fachada_leads')
        .select('created_at')
        .gte('created_at', inicio.toISOString());

      const { data: scansRecent } = await supabase
        .from('fachada_escaneamentos')
        .select('created_at')
        .gte('created_at', inicio.toISOString());

      const leadsArr = leadsRecent || [];
      const scansArr = scansRecent || [];

      // KPIs derivados do período (coerentes com o gráfico)
      const totalLeads = leadsArr.length;
      const totalEscaneamentos = scansArr.length;

      // Agrupar por dia
      const porDia: Record<string, { leads: number; escaneamentos: number }> = {};
      leadsArr.forEach((l: any) => {
        const dia = l.created_at.slice(0, 10);
        if (!porDia[dia]) porDia[dia] = { leads: 0, escaneamentos: 0 };
        porDia[dia].leads++;
      });
      scansArr.forEach((s: any) => {
        const dia = s.created_at.slice(0, 10);
        if (!porDia[dia]) porDia[dia] = { leads: 0, escaneamentos: 0 };
        porDia[dia].escaneamentos++;
      });

      const leadsPorDia = Object.entries(porDia)
        .map(([data, vals]) => ({ data, ...vals }))
        .sort((a, b) => a.data.localeCompare(b.data));

      setMetricas({
        totalFachadas: fachadasList.length,
        totalEscaneamentos,
        totalLeads,
        taxaConversao:
          totalEscaneamentos > 0
            ? Math.round((totalLeads / totalEscaneamentos) * 100)
            : 0,
        fachadasMaisAcessadas: [],
        leadsPorDia,
      });
    } catch (err) {
      console.error('Erro ao buscar métricas:', err);
    }
  }, []);

  return {
    fachadas,
    leads,
    metricas,
    loading,
    fetchFachadas,
    createFachada,
    updateFachada,
    deleteFachada,
    fetchLeads,
    fetchMetricas,
    deleteLead,
  };
}
