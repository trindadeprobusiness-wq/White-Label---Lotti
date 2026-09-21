import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Bot, Filter, MessageCircle, Pause, Search, Timer, UserRound } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { filterLiveConversations, latestByConversation, liveUrgency, type LatestMessage, type QuickFilter } from './liveInboxFilters';
import { MessageComposer } from './MessageComposer';

// Additive runtime tables have separate typed projections until schema regeneration.
const db = supabase as unknown as SupabaseClient;
type Qualification = { stage?: string; temperature?: string; priority?: string; reason?: string; profile?: Record<string, string | null> };
type Conversation = { id: string; phone: string; cliente_id: string | null; mode: 'ai' | 'human' | 'paused'; updated_at: string; qualification: Qualification; last_error: string | null };
type Message = { id: string; direction: 'in' | 'out'; sender: 'lead' | 'human' | 'ai'; content: string; created_at: string };
const stages: Record<string, string> = { pre_qualificacao: 'Pré-qualificação', qualificando: 'Em qualificação', qualificado_busca: 'Qualificado para busca', qualificado_visita: 'Qualificado para visita' };
const labels: Record<string, string> = { intent: 'Interesse', region: 'Região', budget: 'Orçamento', needs: 'Essenciais', nextStep: 'Próximo passo', timeframe: 'Prazo', payment: 'Pagamento', communication: 'Preferência de conversa' };

export default function ConnectedInbox({ connected = true }: { connected?: boolean }) {
  const { user } = useAuth();
  const cache = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState('');
  const [quick, setQuick] = useState<QuickFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [modeFilter, setModeFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const list = useQuery({
    queryKey: ['lotti-agent-conversations', user?.id], enabled: !!user, refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await db.from('lotti_agent_conversations')
        .select('id,phone,cliente_id,mode,updated_at,qualification,last_error').order('updated_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data as Conversation[];
    },
  });
  const previews = useQuery({
    queryKey: ['lotti-agent-message-previews', user?.id], enabled: !!user, refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await db.from('lotti_agent_latest_messages')
        .select('conversation_id,direction,created_at,content');
      if (error) throw error;
      return data as LatestMessage[];
    },
  });
  const latest = latestByConversation(previews.data ?? []);
  const now = Date.now();
  const filtered = filterLiveConversations(list.data ?? [], latest, { query, quick, mode: modeFilter, stage: stageFilter, period: periodFilter, now });
  const selected = filtered.find(c => c.id === selectedId) ?? filtered[0];
  const count = (kind: QuickFilter) => (list.data ?? []).filter(c => liveUrgency(c, latest.get(c.id), now) === kind).length;
  const messages = useQuery({
    queryKey: ['lotti-agent-messages', user?.id, selected?.id], enabled: !!user && !!selected, refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await db.from('lotti_agent_messages').select('id,direction,sender,content,created_at')
        .eq('conversation_id', selected!.id).order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return (data as Message[]).reverse();
    },
  });
  const client = useQuery({
    queryKey: ['lotti-inbox-client', user?.id, selected?.cliente_id], enabled: !!user && !!selected?.cliente_id,
    queryFn: async () => {
      const { data, error } = await db.from('clientes').select('nome,email,telefone,created_at,status_funil,tipo_interesse')
        .eq('id', selected!.cliente_id!).single();
      if (error) throw error;
      return data as { nome: string; email: string | null; telefone: string; created_at: string | null; status_funil: string; tipo_interesse: string };
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
  return <div className="flex min-h-[calc(100vh-7rem)] flex-col gap-2" data-testid="connected-inbox">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h1 className="text-xl font-semibold">Inbox</h1>
        <p className="text-xs text-muted-foreground">Conversas recebidas pelo número da empresa. <Link className="underline" to="/whatsapp/conexao">Ver conexão</Link>{!connected && <span role="status" className="ml-2 text-amber-700">· Desconectado</span>}</p></div>
      <Badge variant="outline" className="text-[10px]">Atualiza a cada 5 segundos</Badge>
    </div>
    {list.isError && <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">Não foi possível carregar as conversas. <button className="underline" onClick={() => list.refetch()}>Tentar novamente</button></p>}
    {list.isPending && <p role="status">Carregando conversas…</p>}
    {list.isSuccess && !list.data.length && <div className="rounded-xl border bg-card p-8 text-center">
      <MessageCircle className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h2 className="font-semibold">Aguardando a primeira conversa</h2>
      <p className="mt-2 text-sm text-muted-foreground">Envie uma mensagem nova de um contato de teste depois de conectar. Conversas antigas do celular não são importadas automaticamente.</p>
    </div>}
    {!!list.data?.length && <div className="grid min-h-[65vh] flex-1 gap-2 lg:grid-cols-[minmax(260px,24%)_minmax(0,1fr)_minmax(260px,24%)]">
      <nav aria-label="Conversas conectadas" className="flex min-h-0 flex-col rounded-xl border bg-card">
        <div className="space-y-2 border-b p-2.5">
          <h2 className="text-sm font-semibold">Conversas <span className="font-normal text-muted-foreground">· {list.data.length}</span></h2>
          <label className="relative block"><Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" /><Input aria-label="Buscar conversas" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar telefone ou mensagem" className="h-8 pl-8 text-xs" /></label>
          <div className="flex items-center gap-2"><Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setFiltersOpen(true)}><Filter className="mr-1 h-3 w-3" />Filtros</Button><span className="flex-1 text-[11px] text-muted-foreground">{filtered.length} de {list.data.length}</span><button className="text-[11px] text-destructive" onClick={() => { setQuery(''); setQuick('all'); setModeFilter(''); setStageFilter(''); setPeriodFilter(''); }}>Limpar</button></div>
          <div className="grid grid-cols-3 gap-1"><Button size="sm" className="h-7 px-1 text-[11px]" variant={quick === 'all' ? 'default' : 'outline'} onClick={() => setQuick('all')}>Todas</Button><Button size="sm" className="h-7 gap-1 px-1 text-[11px] text-amber-700" variant={quick === 'late' ? 'secondary' : 'outline'} onClick={() => setQuick('late')} aria-label={`Atrasando: ${count('late')} conversas`}><Timer className="h-3 w-3" />{count('late')}</Button><Button size="sm" className="h-7 gap-1 px-1 text-[11px] text-red-600" variant={quick === 'urgent' ? 'secondary' : 'outline'} onClick={() => setQuick('urgent')} aria-label={`Urgente: ${count('urgent')} conversas`}><AlertTriangle className="h-3 w-3" />{count('urgent')}</Button></div>
        </div>
        <div className="max-h-[65vh] min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
        {filtered.map(c => <button key={c.id} onClick={() => { setSelectedId(c.id); mode.reset(); }} className={`flex min-h-[60px] w-full items-center gap-2 rounded-lg border p-2 text-left text-xs ${selected?.id === c.id ? 'border-primary/30 bg-primary/5' : 'border-transparent hover:bg-muted'}`}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">{c.phone.slice(-2)}</span><span className="min-w-0 flex-1"><span className="block truncate font-semibold">+{c.phone}</span><span className="block truncate text-[11px] text-muted-foreground">{latest.get(c.id)?.content || stages[c.qualification.stage ?? ''] || 'Novo contato'}</span><span className="block text-[10px] text-muted-foreground">{c.mode === 'ai' ? 'Lotti IA' : c.mode === 'human' ? 'Humano' : 'Pausado'} · {new Date(c.updated_at).toLocaleDateString('pt-BR')}</span></span>
        </button>)}
        {!filtered.length && <p className="p-4 text-center text-xs text-muted-foreground">Nenhuma conversa encontrada.</p>}
        {list.data.length === 100 && <p className="p-2 text-xs text-muted-foreground">Exibindo as 100 conversas mais recentes.</p>}
        </div>
      </nav>
      {selected ? <section aria-label="Histórico conectado" className="flex min-w-0 flex-col rounded-xl border bg-card">
        <header className="flex flex-wrap items-center gap-2 border-b p-3">
          <span className="mr-auto font-medium">+{selected?.phone}</span>
          <Button size="sm" disabled={mode.isPending || selected?.mode === 'human'} onClick={() => mode.mutate('human')}><UserRound className="mr-1 h-4 w-4" /> Assumir</Button>
          <Button size="sm" variant="outline" disabled={mode.isPending || selected?.mode === 'paused'} onClick={() => mode.mutate('paused')}><Pause className="mr-1 h-4 w-4" /> Pausar</Button>
          <Button size="sm" variant="outline" disabled={mode.isPending || selected?.mode === 'ai'} onClick={() => mode.mutate('ai')}><Bot className="mr-1 h-4 w-4" /> Retomar IA</Button>
        </header>
        {mode.isError && <p role="alert" className="p-3 text-sm text-destructive">Não foi possível alterar o atendimento. Se houver entrega incerta, revise-a antes de retomar a IA.</p>}
        {messages.isError && <p role="alert" className="p-3 text-sm text-destructive">Não foi possível carregar o histórico.</p>}
        <div className="max-h-[65vh] min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {messages.data?.map(m => <article key={m.id} className={`max-w-[85%] rounded-lg border p-2.5 ${m.direction === 'out' ? 'ml-auto border-primary/10 bg-primary text-primary-foreground' : 'border-border bg-background'}`}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{m.sender === 'ai' ? 'Lotti IA' : m.sender === 'human' ? 'Corretor' : 'Cliente'}</p>
            <p className="whitespace-pre-wrap break-words text-sm">{m.content}</p><time className="mt-2 block text-[10px] text-muted-foreground">{new Date(m.created_at).toLocaleString('pt-BR')}</time>
          </article>)}
          {messages.data?.length === 200 && <p className="text-xs text-muted-foreground">Exibindo as 200 mensagens mais recentes.</p>}
        </div>
        {connected
          ? <MessageComposer conversationId={selected.id} onSent={() => { void cache.invalidateQueries({ queryKey: ['lotti-agent-messages', user?.id, selected.id] }); void cache.invalidateQueries({ queryKey: ['lotti-agent-conversations', user?.id] }); }} />
          : <footer className="border-t p-3 text-xs text-muted-foreground">Conecte o WhatsApp na página de <Link className="underline" to="/whatsapp/conexao">Conexão</Link> para responder por aqui.</footer>}
      </section> : <div className="grid place-items-center rounded-xl border bg-card text-sm text-muted-foreground">Selecione uma conversa</div>}
      {selected && <aside className="max-h-[75vh] space-y-4 overflow-y-auto rounded-xl border bg-card p-3">
        <h2 className="border-b pb-2 text-xs font-semibold uppercase">Perfil do contato</h2>
        <div className="rounded-xl border p-3"><p className="text-sm font-semibold">{client.data?.nome && client.data.nome !== 'Contato WhatsApp' ? client.data.nome : `+${selected.phone}`}</p><p className="text-xs text-muted-foreground">+{selected.phone}</p>{client.data?.email && <p className="break-words text-xs text-muted-foreground">{client.data.email}</p>}</div>
        <div className="space-y-2 border-t pt-3"><h3 className="text-xs font-semibold uppercase">Linha do tempo</h3><p className="text-xs">Conversa no WhatsApp <span className="block text-muted-foreground">Última atividade: {new Date(selected.updated_at).toLocaleString('pt-BR')}</span></p>{client.data?.created_at && <p className="text-xs">Lead criado <span className="block text-muted-foreground">{new Date(client.data.created_at).toLocaleString('pt-BR')}</span></p>}</div>
        <h3 className="text-xs font-semibold uppercase">Qualificação comercial</h3>
        <div className="flex flex-wrap gap-2"><Badge variant="outline">{stages[q?.stage ?? ''] ?? 'Novo contato'}</Badge>{q?.temperature && <Badge variant="secondary">{q.temperature}</Badge>}{q?.priority === 'alta' && <Badge>Prioridade alta</Badge>}</div>
        {q?.reason && <p className="text-sm">{q.reason}</p>}
        <dl className="space-y-3">{Object.entries(labels).map(([key, label]) => <div key={key}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words text-sm">{q?.profile?.[key] || 'Ainda não informado'}</dd></div>)}</dl>
        {selected?.last_error && <p className="rounded-lg bg-muted p-3 text-xs">Esta conversa precisa de revisão operacional. O histórico foi preservado.</p>}
        {selected?.cliente_id && <Link className="inline-block text-sm text-primary underline" to={`/clientes/${selected.cliente_id}`}>Abrir cadastro do cliente</Link>}
      </aside>}
    </div>}
    <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}><SheetContent side="left" className="space-y-5"><SheetTitle>Filtros</SheetTitle><SheetDescription>Filtre as conversas já recebidas.</SheetDescription>
      <label className="block text-sm">Atendimento<select className="mt-1 w-full rounded-md border bg-background p-2" value={modeFilter} onChange={e => setModeFilter(e.target.value)}><option value="">Todos</option><option value="human">Humano</option><option value="ai">IA</option><option value="paused">Pausado</option></select></label>
      <label className="block text-sm">Etapa<select className="mt-1 w-full rounded-md border bg-background p-2" value={stageFilter} onChange={e => setStageFilter(e.target.value)}><option value="">Todas</option>{Object.entries(stages).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="block text-sm">Última atividade<select className="mt-1 w-full rounded-md border bg-background p-2" value={periodFilter} onChange={e => setPeriodFilter(e.target.value)}><option value="">Qualquer período</option><option value="1">Últimas 24 horas</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option></select></label>
      <Button onClick={() => setFiltersOpen(false)}>Ver {filtered.length} conversas</Button>
    </SheetContent></Sheet>
  </div>;
}
