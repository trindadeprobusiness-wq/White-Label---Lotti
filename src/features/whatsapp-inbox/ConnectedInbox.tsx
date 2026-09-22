import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ChevronRight, Filter, MessageCircle, Pencil, Plus, Search, Sparkles, Timer, UsersRound } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { filterLiveConversations, latestByConversation, liveUrgency, type LatestMessage, type QuickFilter } from './liveInboxFilters';
import { MessageComposer } from './MessageComposer';
import { ConversationStatusDialog, NewConversationDialog, RenameContactDialog } from './InboxActionDialogs';

// Additive runtime tables have separate typed projections until schema regeneration.
const db = supabase as unknown as SupabaseClient;
type Qualification = { stage?: string; temperature?: string; priority?: string; reason?: string; profile?: Record<string, string | null> };
type Conversation = { id: string; phone: string; cliente_id: string | null; mode: 'ai' | 'human' | 'paused'; status: 'open' | 'closed'; updated_at: string; qualification: Qualification; last_error: string | null };
type Message = { id: string; direction: 'in' | 'out'; sender: 'lead' | 'human' | 'ai'; content: string; created_at: string };
const stages: Record<string, string> = { pre_qualificacao: 'Pré-qualificação', qualificando: 'Em qualificação', qualificado_busca: 'Qualificado para busca', qualificado_visita: 'Qualificado para visita' };
const labels: Record<string, string> = { intent: 'Interesse', region: 'Região', budget: 'Orçamento', needs: 'Essenciais', nextStep: 'Próximo passo', timeframe: 'Prazo', payment: 'Pagamento', communication: 'Preferência de conversa' };

export default function ConnectedInbox({ connected = true }: { connected?: boolean | 'unknown' }) {
  const { user } = useAuth();
  const cache = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState('');
  const [quick, setQuick] = useState<QuickFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [modeFilter, setModeFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [infoVisible, setInfoVisible] = useState(true);
  const [newOpen,setNewOpen]=useState(false),[renameOpen,setRenameOpen]=useState(false),[statusOpen,setStatusOpen]=useState(false);
  const list = useQuery({
    queryKey: ['lotti-agent-conversations', user?.id], enabled: !!user, refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await db.from('lotti_agent_conversations')
        .select('id,phone,cliente_id,mode,status,updated_at,qualification,last_error').order('updated_at', { ascending: false }).limit(100);
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
  const refreshConversation=async(id?:string)=>{if(id)setSelectedId(id);await Promise.all([cache.invalidateQueries({queryKey:['lotti-agent-conversations',user?.id]}),cache.invalidateQueries({queryKey:['lotti-agent-message-previews',user?.id]}),cache.invalidateQueries({queryKey:['lotti-inbox-client',user?.id]})])};
  const startConversation=useMutation({mutationFn:async(data:{phone:string;name?:string;text:string})=>{const {data:result,error}=await supabase.functions.invoke('lotti-whatsapp',{body:{action:'start',...data,request_id:crypto.randomUUID()}});if(error||!result?.conversationId)throw error??new Error('start_failed');if(result.sendStatus!=='sent')throw new Error(result.sendStatus==='uncertain'?'uncertain':'send_failed');return result.conversationId as string},onSuccess:async id=>{setNewOpen(false);await refreshConversation(id)}});
  const renameContact=useMutation({mutationFn:async(name:string)=>{const {data,error}=await db.rpc('lotti_inbox_rename_client',{p_conversation:selected!.id,p_name:name});if(error)throw error;return data},onSuccess:async()=>{setRenameOpen(false);await refreshConversation()}});
  const changeStatus=useMutation({mutationFn:async(status:'open'|'closed')=>{const {data,error}=await db.rpc('lotti_inbox_set_status',{p_conversation:selected!.id,p_status:status});if(error)throw error;return data},onSuccess:async()=>{setStatusOpen(false);await refreshConversation()}});
  const q = selected?.qualification;
  const connectionKnown = connected !== 'unknown';
  return <div className="flex min-h-[calc(100dvh-4rem)] flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden" data-testid="connected-inbox">
    <h1 className="sr-only">Inbox</h1>
    {list.isError && <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">Não foi possível carregar as conversas. <button className="underline" onClick={() => list.refetch()}>Tentar novamente</button></p>}
    {list.isPending && <p role="status">Carregando conversas…</p>}
    {list.isSuccess && !list.data.length && <div className="rounded-xl border bg-card p-8 text-center">
      <MessageCircle className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h2 className="font-semibold">Aguardando a primeira conversa</h2>
      <p className="mt-2 text-sm text-muted-foreground">Envie uma mensagem nova de um contato de teste depois de conectar. Conversas antigas do celular não são importadas automaticamente.</p>
    </div>}
    {!!list.data?.length && <div data-testid="clix-inbox-shell" className={`grid min-h-0 flex-1 gap-[10px] bg-secondary p-[10px] ${infoVisible ? 'lg:grid-cols-[306px_minmax(0,1fr)_330px]' : 'lg:grid-cols-[306px_minmax(0,1fr)]'}`}>
      <nav aria-label="Conversas conectadas" className="flex min-h-0 flex-col overflow-hidden rounded-[14px] border bg-card shadow-sm">
        <div className="space-y-2 border-b px-[14px] pb-[13px] pt-[15px]">
          <div className="flex items-center gap-2"><h2 className="text-sm font-semibold">Conversas <span className="font-normal text-muted-foreground">· {list.data.length}</span></h2><Button size="sm" className="ml-auto h-7 px-2.5 text-[11px]" onClick={()=>{startConversation.reset();setNewOpen(true)}}><Plus className="mr-1 h-3 w-3" />Nova</Button></div>
          <label className="relative block"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input aria-label="Buscar conversas" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar conversa (nome, telefone, texto)..." className="h-8 rounded-lg pl-8 text-xs" /></label>
          <div className="flex items-center gap-2"><Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setFiltersOpen(true)}><Filter className="mr-1 h-3 w-3" />Filtros</Button><span className="flex-1 text-[11px] text-muted-foreground">{filtered.length} de {list.data.length}</span><button className="text-[11px] text-destructive" onClick={() => { setQuery(''); setQuick('all'); setModeFilter(''); setStageFilter(''); setPeriodFilter(''); }}>Limpar</button></div>
          <div className="grid grid-cols-3 gap-1"><Button size="sm" className="h-7 px-1 text-[11px]" variant={quick === 'all' ? 'default' : 'outline'} onClick={() => setQuick('all')}>Todas</Button><Button size="sm" className="h-7 gap-1 px-1 text-[11px] text-amber-700" variant={quick === 'late' ? 'secondary' : 'outline'} onClick={() => setQuick('late')} aria-label={`Atrasando: ${count('late')} conversas`}><Timer className="h-3 w-3" />{count('late')}</Button><Button size="sm" className="h-7 gap-1 px-1 text-[11px] text-red-600" variant={quick === 'urgent' ? 'secondary' : 'outline'} onClick={() => setQuick('urgent')} aria-label={`Urgente: ${count('urgent')} conversas`}><AlertTriangle className="h-3 w-3" />{count('urgent')}</Button></div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-[5px]">
        {filtered.map(c => <button key={c.id} onClick={() => { setSelectedId(c.id); mode.reset(); }} className={`mx-[6px] my-[2px] flex min-h-[64px] w-[calc(100%-12px)] items-center gap-[10px] rounded-[10px] border px-[10px] py-3 text-left text-xs transition-colors ${selected?.id === c.id ? 'border-primary/40 bg-primary/10 shadow-sm ring-1 ring-primary/20' : 'border-transparent hover:bg-primary/5'}`}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-primary">{c.phone.slice(-2)}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="block truncate text-xs font-semibold">+{c.phone}</span><time className="ml-auto text-[9px] text-muted-foreground">{new Date(c.updated_at).toLocaleDateString('pt-BR')}</time></span><span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{latest.get(c.id)?.content || stages[c.qualification.stage ?? ''] || 'Novo contato'}</span><span className="mt-0.5 block text-[9px] text-muted-foreground">{c.mode === 'ai' ? 'IA' : c.mode === 'human' ? 'Equipe' : 'Pausado'}</span></span>
        </button>)}
        {!filtered.length && <p className="p-4 text-center text-xs text-muted-foreground">Nenhuma conversa encontrada.</p>}
        {list.data.length === 100 && <p className="p-2 text-xs text-muted-foreground">Exibindo as 100 conversas mais recentes.</p>}
        </div>
      </nav>
      {selected ? <section aria-label="Histórico conectado" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] border bg-card shadow-sm">
        <header data-testid="conversation-header" className="flex min-h-[68px] flex-nowrap items-center gap-2 border-b px-[15px] py-[11px]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-secondary text-xs font-semibold">{selected.phone.slice(-2)}</span><div className="mr-auto min-w-0"><div className="flex items-center gap-1.5"><strong className="truncate text-sm">{client.data?.nome && client.data.nome !== 'Contato WhatsApp' ? client.data.nome : `+${selected.phone}`}</strong><button type="button" aria-label="Editar nome" onClick={()=>{renameContact.reset();setRenameOpen(true)}} className="rounded p-1 text-muted-foreground hover:bg-muted"><Pencil className="h-3 w-3 shrink-0" /></button></div><p className="truncate text-[11px] text-muted-foreground">+{selected.phone}</p></div><Badge variant="outline" className="shrink-0 gap-1 px-2 text-[10px]"><UsersRound className="h-3 w-3" />Equipe</Badge>
          <button type="button" role="switch" aria-label="IA" aria-checked={selected.mode === 'ai'} disabled={mode.isPending} onClick={() => mode.mutate(selected.mode === 'ai' ? 'human' : 'ai')} className="ml-2 flex h-8 shrink-0 items-center gap-2 rounded-lg px-1 text-xs font-semibold disabled:opacity-50"><span>IA</span><span className={`flex h-6 w-11 items-center rounded-full border p-0.5 transition-colors ${selected.mode === 'ai' ? 'border-primary bg-primary' : 'border-border bg-secondary'}`}><span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${selected.mode === 'ai' ? 'translate-x-[18px]' : 'translate-x-0'}`} /></span></button>
          <Button size="sm" className="h-9 shrink-0 px-3 text-xs" variant="outline" onClick={() => setInfoVisible(v => !v)}>{infoVisible ? 'Ocultar info' : 'Mostrar info'}</Button>
        </header><div data-testid="conversation-stage-bar" className="flex min-h-[42px] shrink-0 items-center border-b bg-secondary/40 px-[14px] text-[11px]"><span className="font-semibold uppercase text-muted-foreground">Etapa</span><span className="ml-2 h-2 w-2 rounded-full bg-primary" /><strong className="ml-1.5">{stages[q?.stage ?? ''] ?? 'Em atendimento humano'}</strong><ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" /><button type="button" onClick={()=>{changeStatus.reset();setStatusOpen(true)}} className="ml-4 flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold hover:bg-muted"><span className={`h-2 w-2 rounded-full ${selected.status==='closed'?'bg-muted-foreground':'bg-success'}`} />{selected.status==='closed'?'Fechada':'Aberta'}</button></div>
        {mode.isError && <p role="alert" className="p-3 text-sm text-destructive">Não foi possível alterar o atendimento. Se houver entrega incerta, revise-a antes de retomar a IA.</p>}
        {messages.isError && <p role="alert" className="p-3 text-sm text-destructive">Não foi possível carregar o histórico.</p>}
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-secondary/60 p-2.5">
          {messages.data?.map(m => <article key={m.id} className={`w-fit max-w-[82%] rounded-lg px-2.5 py-1.5 shadow-sm ${m.direction === 'out' ? 'ml-auto rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm border border-border bg-card'}`}>
            <p className={`mb-1 text-[11px] font-medium ${m.direction === 'out' ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{m.sender === 'ai' ? 'Lotti IA' : m.sender === 'human' ? 'Corretor' : 'Cliente'}</p>
            <p className="whitespace-pre-wrap break-words text-xs">{m.content}</p><time className={`mt-1 block text-[9px] ${m.direction === 'out' ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{new Date(m.created_at).toLocaleString('pt-BR')}</time>
          </article>)}
          {messages.data?.length === 200 && <p className="text-xs text-muted-foreground">Exibindo as 200 mensagens mais recentes.</p>}
        </div>
        {connected === true
          ? <MessageComposer conversationId={selected.id} onSent={() => { void cache.invalidateQueries({ queryKey: ['lotti-agent-messages', user?.id, selected.id] }); void cache.invalidateQueries({ queryKey: ['lotti-agent-conversations', user?.id] }); }} />
          : <footer className="shrink-0 border-t p-3 text-xs text-muted-foreground">{connectionKnown ? <>Conecte o WhatsApp na página de <Link className="underline" to="/whatsapp/conexao">Conexão</Link> para responder por aqui.</> : <>Não foi possível confirmar a conexão. <Link className="underline" to="/whatsapp/conexao">Verificar conexão</Link> antes de responder.</>}</footer>}
      </section> : <div className="grid place-items-center rounded-xl border bg-card text-sm text-muted-foreground">Selecione uma conversa</div>}
      {selected && infoVisible && <aside aria-label="Perfil do contato" className="min-h-0 overflow-y-auto rounded-[14px] border bg-card p-[14px] shadow-sm">
        <h2 className="border-b pb-2.5 text-[11px] font-bold uppercase">Perfil do contato</h2>
        <div className="mt-2.5 rounded-xl border bg-secondary/30 p-3"><p className="text-xs font-semibold">{client.data?.nome && client.data.nome !== 'Contato WhatsApp' ? client.data.nome : `+${selected.phone}`}</p><p className="text-[11px] text-muted-foreground">+{selected.phone}</p>{client.data?.email && <p className="break-words text-[11px] text-muted-foreground">{client.data.email}</p>}<h3 className="mt-4 flex items-center text-[10px] font-semibold uppercase text-muted-foreground">Resumo do caso <Badge variant="secondary" className="ml-auto gap-1 text-[9px]"><Sparkles className="h-2.5 w-2.5" />IA</Badge></h3><p className="mt-2 rounded-lg border border-dashed bg-card p-2.5 text-[11px] leading-4 text-muted-foreground">{q?.reason || 'Ainda sem qualificação. A IA preenche conforme conversa com o cliente.'}</p></div>
        <div className="mt-4 space-y-3"><h3 className="text-xs font-semibold uppercase text-muted-foreground">Linha do tempo</h3><p className="text-xs text-primary">Conversou no WhatsApp <span className="block text-muted-foreground">Última atividade: {new Date(selected.updated_at).toLocaleString('pt-BR')}</span></p>{client.data?.created_at && <p className="text-xs text-primary">Lead criado <span className="block text-muted-foreground">{new Date(client.data.created_at).toLocaleString('pt-BR')}</span></p>}</div>
        <h3 className="mt-5 text-xs font-semibold uppercase text-muted-foreground">Qualificação comercial</h3>
        <div className="flex flex-wrap gap-2"><Badge variant="outline">{stages[q?.stage ?? ''] ?? 'Novo contato'}</Badge>{q?.temperature && <Badge variant="secondary">{q.temperature}</Badge>}{q?.priority === 'alta' && <Badge>Prioridade alta</Badge>}</div>
        <dl className="space-y-3">{Object.entries(labels).filter(([key]) => q?.profile?.[key]).map(([key, label]) => <div key={key}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words text-sm">{q?.profile?.[key]}</dd></div>)}</dl>
        <h3 className="mt-5 text-xs font-semibold uppercase text-muted-foreground">Atribuição</h3><select aria-label="Atribuição" className="mt-2 h-10 w-full rounded-lg border bg-background px-3 text-sm"><option>— Sem atribuição —</option><option>Equipe</option></select>
        <h3 className="mt-5 text-xs font-semibold uppercase text-muted-foreground">Tags</h3><div className="mt-2 flex gap-2"><Input aria-label="Adicionar tag" placeholder="+ tag" className="h-9" /><Button size="icon" variant="secondary" className="h-9 w-9"><Plus className="h-4 w-4" /></Button></div>
        <h3 className="mt-5 text-xs font-semibold uppercase text-muted-foreground">Notas internas</h3><textarea aria-label="Nota interna" placeholder="Anota algo (só pro time)..." className="mt-2 min-h-20 w-full resize-none rounded-lg border bg-background p-3 text-sm" /><Button disabled className="mt-2 w-full">Adicionar nota</Button>
        {selected?.last_error && <p className="rounded-lg bg-muted p-3 text-xs">Esta conversa precisa de revisão operacional. O histórico foi preservado.</p>}
        {selected?.cliente_id && <Link className="inline-block text-sm text-primary underline" to={`/clientes/${selected.cliente_id}`}>Abrir cadastro do cliente</Link>}
      </aside>}
    </div>}
    <NewConversationDialog open={newOpen} onOpenChange={setNewOpen} onSubmit={data=>startConversation.mutate(data)} pending={startConversation.isPending} error={startConversation.isError?(startConversation.error instanceof Error&&startConversation.error.message==='uncertain'?'Envio sem confirmação. Verifique no WhatsApp antes de tentar novamente.':'Não foi possível iniciar a conversa.'):undefined} />
    {selected&&<><RenameContactDialog open={renameOpen} initialName={client.data?.nome??''} onOpenChange={setRenameOpen} onSubmit={name=>renameContact.mutate(name)} pending={renameContact.isPending} error={renameContact.isError?'Não foi possível salvar o nome.':undefined} /><ConversationStatusDialog open={statusOpen} status={selected.status??'open'} onOpenChange={setStatusOpen} onConfirm={status=>changeStatus.mutate(status)} pending={changeStatus.isPending} error={changeStatus.isError?'Não foi possível alterar o estado da conversa.':undefined} /></>}
    <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}><SheetContent side="left" className="space-y-5"><SheetTitle>Filtros</SheetTitle><SheetDescription>Filtre as conversas já recebidas.</SheetDescription>
      <label className="block text-sm">Atendimento<select className="mt-1 w-full rounded-md border bg-background p-2" value={modeFilter} onChange={e => setModeFilter(e.target.value)}><option value="">Todos</option><option value="human">Humano</option><option value="ai">IA</option><option value="paused">Pausado</option></select></label>
      <label className="block text-sm">Etapa<select className="mt-1 w-full rounded-md border bg-background p-2" value={stageFilter} onChange={e => setStageFilter(e.target.value)}><option value="">Todas</option>{Object.entries(stages).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="block text-sm">Última atividade<select className="mt-1 w-full rounded-md border bg-background p-2" value={periodFilter} onChange={e => setPeriodFilter(e.target.value)}><option value="">Qualquer período</option><option value="1">Últimas 24 horas</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option></select></label>
      <Button onClick={() => setFiltersOpen(false)}>Ver {filtered.length} conversas</Button>
    </SheetContent></Sheet>
  </div>;
}
