import { useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { obterVisitanteId, marcarAtribuicaoPendente } from '@/lib/admin/atribuicao';
import { apiDisponivel } from '@/lib/api';
import { registrarCliqueApi } from '@/lib/api/parceiros';

/**
 * Rota /r/:slug — destino do link exclusivo do parceiro.
 *
 * Registra o clique NO SERVIDOR e segue para o cadastro. A tela é intencional-
 * mente mínima: é uma passagem, não uma página. O visitante vê um instante de
 * carregamento e cai em /auth.
 *
 * Não existe caminho de erro visível. Slug inválido, parceiro inativo ou falha
 * de rede levam ao mesmo lugar — /auth limpo. Duas razões: quem clicou quer se
 * cadastrar, e uma mensagem diferente por caso permitiria descobrir quais slugs
 * existem testando um por um.
 */
export default function RedirectParceiro() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const jaRodou = useRef(false);

  useEffect(() => {
    // StrictMode monta o efeito duas vezes em desenvolvimento; sem esta trava
    // cada visita geraria dois cliques na métrica do parceiro.
    if (jaRodou.current) return;
    jaRodou.current = true;

    const registrar = async () => {
      const destino = slug ? `/auth?ref=${encodeURIComponent(slug)}` : '/auth';

      if (!slug) {
        navigate('/auth', { replace: true });
        return;
      }

      try {
        const visitanteId = obterVisitanteId();

        const utm = {
          utm_source: searchParams.get('utm_source') ?? undefined,
          utm_medium: searchParams.get('utm_medium') ?? undefined,
          utm_campaign: searchParams.get('utm_campaign') ?? undefined,
          utm_content: searchParams.get('utm_content') ?? undefined,
          utm_term: searchParams.get('utm_term') ?? undefined,
          gclid: searchParams.get('gclid') ?? undefined,
          fbclid: searchParams.get('fbclid') ?? undefined,
        };

        const corpo = {
          slug,
          visitante_id: visitanteId,
          utm,
          referer: document.referrer || undefined,
        };

        const data = apiDisponivel()
          ? await registrarCliqueApi(corpo)
          : (await supabase.functions.invoke('parceiro-clique', { body: corpo })).data;

        // Só marca pendente se o servidor confirmou o vínculo. Marcar sempre
        // faria o app chamar parceiro-atribuir em todo login, à toa.
        const resposta = data as { ok?: boolean; parceiro_nome?: string } | null;
        if (resposta?.ok) {
          marcarAtribuicaoPendente(resposta.parceiro_nome);
        }
      } catch {
        // Falha de rede não pode impedir o cadastro: a visita vale mais que a
        // métrica dela.
      }

      navigate(destino, { replace: true });
    };

    void registrar();
  }, [slug, searchParams, navigate]);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Redirecionando...</p>
      </div>
    </div>
  );
}
