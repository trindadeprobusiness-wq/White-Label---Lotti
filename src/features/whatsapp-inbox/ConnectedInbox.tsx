import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bot, MessageCircle, Pause, UserRound } from 'lucide-react';

// Additive runtime tables have separate typed projections until schema regeneration.
const db = supabase as unknown as SupabaseClient;
type Qualification = { stage?: string; temperature?: string; priority?: string; reason?: string; profile?: Record<string, string | null> };
type Conversation = { id: string; phone: string; cliente_id: string | null; mode: 'ai' | 'human' | 'paused'; updated_at: string; qualification: Qualification; last_error: string | null };
type Message = { id: string; direction: 'in' | 'out'; sender: 'lead' | 'human' | 'ai'; content: string; created_at: string };
const stages: Record<string, string> = { pre_qualificacao: 'Pré-qualificação', qualificando: 'Em qualificação', qualificado_busca: 'Qualificado para busca', qualificado_visita: 'Qualificado para visita' };
const labels: Record<string, string> = { intent: 'Interesse', region: 'Região', budget: 'Orçamento', needs: 'Essenciais', nextStep: 'Próximo passo', timeframe: 'Prazo', payment: 'Pagamento', communication: 'Preferência de conversa' };

export default function ConnectedInbox() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const list = useQuery({
    queryKey: ['lotti-agent-conversations', user?.id], enabled: !!user, refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await db.from('lotti_agent_conversations')
        .select('id,phone,cliente_id,mode,updated_at,qualification,last_error').order('updated_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data as Conversation[];
    },
  });
  const selected = list.data?.find(c => c.id === selectedId) ?? list.data?.[0];
  const messages = useQuery({
    queryKey: ['lotti-agent-messages', user?.id, selected?.id], enabled: !!user && !!selected, refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await db.from('lotti_agent_messages').select('id,direction,sender,content,created_at')
        .eq('conversation_id', selected!.id).order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return (data as Message[]).reverse();
    },
  });
  const mode = useMutation({
    mutationFn: async (nextMode: Conversation['mode']) => {
      const { data, error } = await db.rpc('lotti_agent_set_mode', { p_id: selected!.id, p_mode: nextMode });
      if (error || data !== true) throw error ?? new Error('mode_update_failed');
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: ['lotti-agent-conversations', user?.id] }),
  });
  const q = selected?.qualification;
  return <div className="space-y-4 pb-16" data-testid="connected-inbox">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">Conversas recebidas pelo número conectado. <Link className="underline" to="/whatsapp/conexao">Ver conexão</Link></p></div>
      <Badge variant="outline">Atualiza a cada 5 segundos</Badge>
    </div>
    {list.isError && <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">Não foi possível carregar as conversas. <button className="underline" onClick={() => list.refetch()}>Tentar novamente</button></p>}
    {list.isPending && <p role="status">Carregando conversas…</p>}
    {list.isSuccess && !list.data.length && <div className="rounded-xl border bg-card p-8 text-center">
      <MessageCircle className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h2 className="font-semibold">Aguardando a primeira conversa</h2>
      <p className="mt-2 text-sm text-muted-foreground">Envie uma mensagem nova de um contato de teste ao número conectado. Conversas antigas não são importadas automaticamente.</p>
    </div>}
    {!!list.data?.length && <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_280px]">
      <nav aria-label="Conversas conectadas" className="max-h-[65vh] space-y-1 overflow-y-auto rounded-xl border bg-card p-2">
        {list.data.map(c => <button key={c.id} onClick={() => { setSelectedId(c.id); mode.reset(); }} className={`w-full rounded-lg p-3 text-left text-sm ${selected?.id === c.id ? 'bg-primary/10' : 'hover:bg-muted'}`}>
          <span className="block font-medium">+{c.phone}</span><span className="block text-xs text-muted-foreground">{stages[c.qualification.stage ?? ''] ?? 'Novo contato'} · {c.mode === 'ai' ? 'IA' : c.mode === 'human' ? 'Humano' : 'Pausado'}</span>
        </button>)}
        {list.data.length === 100 && <p className="p-2 text-xs text-muted-foreground">Exibindo as 100 conversas mais recentes.</p>}
      </nav>
      <section aria-label="Histórico conectado" className="min-w-0 rounded-xl border bg-card">
        <header className="flex flex-wrap items-center gap-2 border-b p-3">
          <span className="mr-auto font-medium">+{selected?.phone}</span>
          <Button size="sm" disabled={mode.isPending || selected?.mode === 'human'} onClick={() => mode.mutate('human')}><UserRound className="mr-1 h-4 w-4" /> Assumir</Button>
          <Button size="sm" variant="outline" disabled={mode.isPending || selected?.mode === 'paused'} onClick={() => mode.mutate('paused')}><Pause className="mr-1 h-4 w-4" /> Pausar</Button>
          <Button size="sm" variant="outline" disabled={mode.isPending || selected?.mode === 'ai'} onClick={() => mode.mutate('ai')}><Bot className="mr-1 h-4 w-4" /> Retomar IA</Button>
        </header>
        {mode.isError && <p role="alert" className="p-3 text-sm text-destructive">Não foi possível alterar o atendimento. Se houver entrega incerta, revise-a antes de retomar a IA.</p>}
        {messages.isError && <p role="alert" className="p-3 text-sm text-destructive">Não foi possível carregar o histórico.</p>}
        <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4">
          {messages.data?.map(m => <article key={m.id} className={`max-w-[90%] rounded-lg p-3 ${m.direction === 'out' ? 'ml-auto bg-primary/10' : 'bg-muted'}`}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{m.sender === 'ai' ? 'Lotti IA' : m.sender === 'human' ? 'Corretor' : 'Cliente'}</p>
            <p className="whitespace-pre-wrap break-words text-sm">{m.content}</p><time className="mt-2 block text-[10px] text-muted-foreground">{new Date(m.created_at).toLocaleString('pt-BR')}</time>
          </article>)}
          {messages.data?.length === 200 && <p className="text-xs text-muted-foreground">Exibindo as 200 mensagens mais recentes.</p>}
        </div>
        <footer className="border-t p-3 text-xs text-muted-foreground">Para responder, assuma a conversa e use o WhatsApp conectado. O envio manual por esta tela ainda não está disponível.</footer>
      </section>
      <aside className="space-y-4 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">Qualificação comercial</h2>
        <div className="flex flex-wrap gap-2"><Badge variant="outline">{stages[q?.stage ?? ''] ?? 'Novo contato'}</Badge>{q?.temperature && <Badge variant="secondary">{q.temperature}</Badge>}{q?.priority === 'alta' && <Badge>Prioridade alta</Badge>}</div>
        {q?.reason && <p className="text-sm">{q.reason}</p>}
        <dl className="space-y-3">{Object.entries(labels).map(([key, label]) => <div key={key}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words text-sm">{q?.profile?.[key] || 'Ainda não informado'}</dd></div>)}</dl>
        {selected?.last_error && <p className="rounded-lg bg-muted p-3 text-xs">Esta conversa precisa de revisão operacional. O histórico foi preservado.</p>}
        {selected?.cliente_id && <Link className="inline-block text-sm text-primary underline" to={`/clientes/${selected.cliente_id}`}>Abrir cadastro do cliente</Link>}
      </aside>
    </div>}
  </div>;
}
