import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { limparSuporte, salvarSuporte, type SessaoSuporte } from '@/lib/admin/suporte';
import { apiDisponivel } from '@/lib/api';
import { abrirSuporteApi } from '@/lib/api/suporte';
import { EstadoErro } from '@/components/admin/Estados';
import { Button } from '@/components/ui/button';

export default function SuporteUsuario() {
  const { id } = useParams();
  const iniciou = useRef(false);
  const [erro, setErro] = useState<Error | null>(null);
  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    limparSuporte();
    void (async () => {
      try {
        // Modo API: a sessão (com o token curto de atendimento) vem da API e fica onde
        // obterSuporte() lê; o recarregamento abaixo segue igual.
        if (apiDisponivel()) {
          salvarSuporte(await abrirSuporteApi(id ?? ''));
          window.location.replace('/');
          return;
        }
        const { data, error } = await supabase.functions.invoke<SessaoSuporte & { error?: string }>('admin-suporte', {
          body: { acao: 'abrir', corretor_id: id },
        });
        if (error instanceof FunctionsHttpError) {
          const resposta = await error.context.json().catch(() => null);
          throw new Error(resposta?.error ?? 'Não foi possível abrir o atendimento.');
        }
        if (error) throw error;
        if (!data?.id || !data.user) throw new Error(data?.error ?? 'A sessão não foi criada.');
        salvarSuporte(data);
        window.location.replace('/');
      } catch (e) { setErro(e instanceof Error ? e : new Error('Não foi possível abrir o atendimento.')); }
    })();
  }, [id]);
  return <main className="mx-auto max-w-lg px-5 py-16">
    {erro ? <><EstadoErro erro={erro} aoTentarNovamente={() => window.location.reload()} /><Button className="mt-4" asChild><a href="/admin/onboarding">Voltar ao backoffice</a></Button></> :
      <div className="flex items-center gap-3" role="status"><Loader2 className="h-5 w-5 animate-spin" />Abrindo atendimento...</div>}
  </main>;
}
