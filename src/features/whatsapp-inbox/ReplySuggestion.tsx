import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function ReplySuggestion({ question, onUse }: { question: string; onUse: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [properties, setProperties] = useState<{ id: string; titulo: string }[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const { supabase } = await import('@/integrations/supabase/client');
        const { data: owner, error: ownerError } = await supabase.rpc('get_corretor_id');
        if (ownerError || !owner) throw new Error();
        const { data, error: queryError } = await supabase.from('imoveis').select('id,titulo').eq('corretor_id', owner).eq('ativo', true).order('titulo').limit(200);
        if (queryError) throw queryError;
        if (!cancelled) { setProperties(data ?? []); setError(''); }
      } catch { if (!cancelled) setError('Não foi possível carregar seus imóveis. Feche e tente novamente.'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open]);
  const generate = async () => {
    setBusy(true); setError(''); setSuggestion('');
    try {
      const { supabase } = await import('@/integrations/supabase/client');
      const { data, error: requestError } = await supabase.functions.invoke('inbox-suggest', { body: { propertyId, question } });
      if (requestError) throw new Error('Sugestões indisponíveis. A função de IA precisa estar publicada e a conta ter cota disponível.');
      if (!data?.suggestion || data.propertyId !== propertyId) throw new Error('Não foi possível gerar a sugestão.');
      setSuggestion(data.suggestion);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Falha ao gerar sugestão.'); }
    finally { setBusy(false); }
  };
  return <div className="mt-2 text-xs">
    <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" aria-expanded={open} onClick={() => setOpen(!open)}><Sparkles className="h-3 w-3" />Sugerir resposta</Button>
    {open && <div className="mt-2 space-y-2 rounded-lg border bg-muted/30 p-3">
      <p className="text-muted-foreground">Selecione o imóvel citado pelo cliente. A IA consulta o cadastro autorizado; revise antes de usar.</p>
      <select aria-label="Imóvel para a sugestão" disabled={loading || busy} value={propertyId} onChange={event => { setPropertyId(event.target.value); setSuggestion(''); }} className="h-8 w-full rounded-md border bg-background px-2 text-foreground"><option value="">{loading ? 'Carregando imóveis…' : 'Selecione o imóvel'}</option>{properties.map(property => <option key={property.id} value={property.id}>{property.titulo}</option>)}</select>
      {!loading && !properties.length && !error && <p>Nenhum imóvel ativo encontrado nesta conta.</p>}
      <p className="break-words text-muted-foreground">Pergunta: {question || 'Aguardando uma mensagem do cliente.'}</p>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <Button type="button" size="sm" disabled={busy || !propertyId || !question || loading} onClick={() => void generate()}>{busy ? 'Consultando cadastro…' : 'Gerar sugestão'}</Button>
      {suggestion && <><Textarea aria-label="Sugestão editável" value={suggestion} onChange={event => setSuggestion(event.target.value)} className="min-h-24 text-xs" /><Button type="button" variant="outline" size="sm" onClick={() => { onUse(suggestion); setOpen(false); }}>Usar no rascunho</Button><p className="text-muted-foreground">Nada é enviado automaticamente.</p></>}
    </div>}
  </div>;
}
