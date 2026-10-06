import { useState } from 'react';
import { Sparkles, Loader2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import { analisarFotosImovelApi, salvarDescricaoImovelApi } from '@/lib/api/ia';
import { obterImovelApi } from '@/lib/api/imoveis';
import { urlParaBase64 } from '@/lib/imagem';
import { ordenarPorCategoria } from '@/lib/ordemFotos';
import { mensagemDeErro } from '@/lib/errors';
import type { ImovelFoto } from '@/hooks/useImovelFotos';

interface OrganizarFotosIAProps {
  imovelId: string;
  fotos: ImovelFoto[];
  disabled?: boolean;
  /** Recebe os ids já na ordem sugerida. */
  onOrdenar: (idsNaOrdem: string[]) => Promise<void> | void;
}

const MAX_FOTOS = 25;

type DadosImovel = { titulo?: string | null; tipo?: string | null; bairro?: string | null; cidade?: string | null; descricao?: string | null };

export function OrganizarFotosIA({ imovelId, fotos, disabled, onOrdenar }: OrganizarFotosIAProps) {
  const [analisando, setAnalisando] = useState(false);
  const [descricaoAtual, setDescricaoAtual] = useState('');
  const [sugestao, setSugestao] = useState<string | null>(null);
  const [salvandoDescricao, setSalvandoDescricao] = useState(false);

  const analisar = async () => {
    if (fotos.length < 2) {
      toast.info('Envie pelo menos 2 fotos para a IA organizar.');
      return;
    }
    setAnalisando(true);
    const toastId = toast.loading('A IA está olhando as fotos...');

    try {
      // Só as primeiras MAX_FOTOS: o teto existe na função e mandar mais só
      // gastaria banda para receber um erro.
      const consideradas = fotos.slice(0, MAX_FOTOS);
      const corpoDaAnalise = async (imovel: DadosImovel | null | undefined) => ({
        imagens: await Promise.all(consideradas.map((f) => urlParaBase64(f.arquivo_url))),
        descricao_atual: imovel?.descricao ?? '',
        dados_imovel: {
          titulo: imovel?.titulo, tipo: imovel?.tipo,
          bairro: imovel?.bairro, cidade: imovel?.cidade,
        },
      });

      let imovel: DadosImovel | null | undefined;
      let data: { fotos?: Array<{ indice: number; categoria: string }>; descricao_sugerida?: string | null; error?: string } | null;
      if (apiDisponivel()) {
        // Sem sessão do Supabase no modo API: imóvel e análise vêm da API Lotti.
        imovel = (await obterImovelApi(imovelId).catch(() => null)) as DadosImovel | null;
        data = await analisarFotosImovelApi(await corpoDaAnalise(imovel));
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Sua sessão expirou. Entre novamente.');

        ({ data: imovel } = await supabase
          .from('imoveis')
          .select('titulo, tipo, bairro, cidade, descricao')
          .eq('id', imovelId)
          .single());

        const resposta = await supabase.functions.invoke('analisar-fotos-imovel', {
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: await corpoDaAnalise(imovel),
        });

        if (resposta.error) {
          let msg = resposta.error.message;
          try { msg = (await (resposta.error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* ignore */ }
          throw new Error(msg);
        }
        data = resposta.data;
        if (data?.error) throw new Error(data.error);
      }

      // A IA classificou; a ordem é decidida aqui, por regra de mercado.
      const comCategoria = consideradas.map((foto, i) => ({
        ...foto,
        categoria: data?.fotos?.find((c: { indice: number }) => c.indice === i)?.categoria ?? 'OUTRO',
      }));
      const ordenadas = ordenarPorCategoria(comCategoria).map((f) => f.id);
      // As que passaram do teto ficam no fim, na ordem em que já estavam.
      const restantes = fotos.slice(MAX_FOTOS).map((f) => f.id);
      await onOrdenar([...ordenadas, ...restantes]);

      toast.success('Fotos reorganizadas! Confira e ajuste arrastando se quiser.', { id: toastId });

      if (data?.descricao_sugerida) {
        setDescricaoAtual(imovel?.descricao ?? '');
        setSugestao(data.descricao_sugerida);
      }
    } catch (err) {
      toast.error(mensagemDeErro(err, 'Não foi possível analisar as fotos.'), { id: toastId });
    } finally {
      setAnalisando(false);
    }
  };

  const aplicarDescricao = async () => {
    if (!sugestao) return;
    setSalvandoDescricao(true);
    try {
      if (apiDisponivel()) {
        await salvarDescricaoImovelApi(imovelId, sugestao);
      } else {
        const { error } = await supabase.from('imoveis').update({ descricao: sugestao }).eq('id', imovelId);
        if (error) throw error;
      }
      toast.success('Descrição atualizada.');
      setSugestao(null);
    } catch (err) {
      toast.error(mensagemDeErro(err, 'Não foi possível salvar a descrição.'));
    } finally {
      setSalvandoDescricao(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={analisar}
        disabled={disabled || analisando || fotos.length < 2}
        className="gap-1.5"
      >
        {analisando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {analisando ? 'Analisando...' : 'Organizar com IA'}
      </Button>

      {/* Descrição nunca é sobrescrita sem o corretor ver o antes e o depois. */}
      <Dialog open={!!sugestao} onOpenChange={(o) => !o && setSugestao(null)}>
        <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" /> Descrição sugerida
            </DialogTitle>
            <DialogDescription>
              A IA reescreveu a descrição a partir do que aparece nas fotos. Nada é salvo sem você aprovar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {descricaoAtual.trim() ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Descrição atual</p>
                <p className="text-sm bg-muted/50 border rounded-lg p-3 whitespace-pre-wrap">{descricaoAtual}</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Este imóvel ainda não tinha descrição.</p>
            )}

            <div>
              <p className="text-xs font-medium text-primary mb-1">Sugestão da IA</p>
              <p className="text-sm bg-primary/5 border border-primary/20 rounded-lg p-3 whitespace-pre-wrap">
                {sugestao}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSugestao(null)} disabled={salvandoDescricao}>
              <X className="h-4 w-4 mr-1.5" /> Manter a atual
            </Button>
            <Button onClick={aplicarDescricao} disabled={salvandoDescricao}>
              {salvandoDescricao
                ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Salvando...</>
                : <><Check className="h-4 w-4 mr-1.5" /> Usar a sugestão</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
