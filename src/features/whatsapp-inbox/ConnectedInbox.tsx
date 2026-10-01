import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, FileText, Filter, Menu, MessageCircle, Pencil, Plus, Search, Sparkles, Timer, UserRound } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { conversationTitle, formatContactPhone, filterLiveConversations, latestByConversation, liveUrgency, type LatestMessage, type QuickFilter } from './liveInboxFilters';
import { MessageComposer } from './MessageComposer';
import { ConversationStatusDialog, NewConversationDialog, RenameContactDialog } from './InboxActionDialogs';
import { optOutState, type OptOutState } from './optOut';
import { useCRMStore } from '@/stores/crmStore';
import { crmKeys } from '@/hooks/crm/useCrm';
import { codigoDoErro, registroDoErro } from '@/lib/crm/duplicidade';
import { functionErrorCode, mergeErrorText, renameErrorText, startErrorText } from './inboxRequests';
import { mesmoTelefone } from './deepLink';

// Additive runtime tables have separate typed projections until schema regeneration.
const db = supabase as unknown as SupabaseClient;
type Qualification = { stage?: string; temperature?: string; priority?: string; reason?: string; profile?: Record<string, string | null> };
type Conversation = { id: string; phone: string | null; contact_name?: string | null; clientes?: { nome: string } | null; cliente_id: string | null; mode: 'ai' | 'human' | 'paused'; status: 'open' | 'closed'; updated_at: string; qualification: Qualification; last_error: string | null; opted_out_at?: string | null };
const CONVERSATION_FIELDS = 'id,phone,cliente_id,mode,status,updated_at,qualification,last_error,clientes(nome)';
// Archived conversations belong to a WhatsApp number that is no longer connected.
async function fetchConversations() {
  const recent = (fields: string, scoped: boolean) => {
    let query = db.from('lotti_agent_conversations').select(fields);
    if (scoped) query = query.is('archived_at', null);
    return query.order('updated_at', { ascending: false }).limit(100);
  };
  let { data, error } = await recent(`${CONVERSATION_FIELDS},contact_name,opted_out_at`, true);
  // Each migration adds columns; older databases fall back one step at a time.
  if (error?.code === '42703') ({ data, error } = await recent(`${CONVERSATION_FIELDS},contact_name`, true));
  if (error?.code === '42703') ({ data, error } = await recent(CONVERSATION_FIELDS, false));
  if (error) throw error;
  return data as unknown as Conversation[];
}
type Message = { id: string; direction: 'in' | 'out'; sender: 'lead' | 'human' | 'ai'; content: string; media_path: string | null; created_at: string; preview_kind?: 'file' | 'audio' };
type InboxEvent = { id: string; kind: 'mode' | 'stage' | 'status' | 'consent'; from_label: string | null; to_label: string; subject_label: string | null; actor_label: string; created_at: string };
function eventText(event: InboxEvent) {
  if (event.kind === 'consent') return event.to_label === 'Contato liberado' ? `Contato liberado por ${event.actor_label}` : 'Contato pediu para não receber mensagens';
  if (event.kind === 'status') return `Conversa ${event.to_label === 'Fechada' ? 'fechada' : 'reaberta'} por ${event.actor_label}`;
  if (event.kind === 'mode') return `${event.to_label === 'IA' ? 'IA ligada' : event.to_label === 'Pausada' ? 'IA pausada' : 'IA desligada'} por ${event.actor_label}`;
  return `${event.subject_label ? `Negócio ${event.subject_label} movido` : 'Movido'} de ${event.from_label || 'sem etapa'} para ${event.to_label} por ${event.actor_label}`;
}
function OptOutNotice({ state, since, pending, failed, onRelease }: { state: Exclude<OptOutState, 'none'>; since: string; pending: boolean; failed: boolean; onRelease: () => void }) {
  return <div role="status" className="shrink-0 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
    <p><strong>Contato pediu para não receber mensagens</strong> em {new Date(since).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: inboxTimeZone })}. {state === 'blocked' ? 'Você pode responder quando ele escrever de novo.' : 'Ele voltou a escrever, então você pode responder. A IA continua desligada.'}</p>
    <p className="mt-1"><button type="button" disabled={pending} onClick={onRelease} className="font-semibold underline disabled:opacity-50">Liberar contato</button> <span className="text-amber-800/80">— use se foi engano ou se ele pediu para voltar a receber.</span></p>
    {failed && <p role="alert" className="mt-1 text-destructive">Não foi possível liberar o contato. Tente novamente.</p>}
  </div>;
}
function ContactAvatar({ name, className }: { name: string; className: string }) {
  const initial = name.trim().match(/^\p{L}/u)?.[0].toLocaleUpperCase('pt-BR');
  return <span aria-label={initial ? `Inicial de ${name}` : 'Contato sem nome'} className={className}>{initial || <UserRound className="h-4 w-4" />}</span>;
}
const contactPhoneLabel = (value: string | null) => (value ? formatContactPhone(value) : 'Número oculto pelo WhatsApp');
function MessageBody({ message }: { message: Message }) {
  const [url, setUrl] = useState('');
  const isFile = message.preview_kind === 'file' || (!!message.media_path && message.media_path.split('/').length >= 3);
  useEffect(() => {
    if (!isFile || !message.media_path || message.preview_kind) return;
    let live = true;
    const refresh = () => {
      void supabase.storage.from('lotti-inbox-files').createSignedUrl(message.media_path!, 3600)
        .then(({ data }) => { if (live) setUrl(data?.signedUrl || ''); })
        .catch(() => { if (live) setUrl(''); });
    };
    refresh();
    const timer = window.setInterval(refresh, 50 * 60 * 1000);
    return () => { live = false; window.clearInterval(timer); };
  }, [isFile, message.media_path, message.preview_kind]);
  if (message.preview_kind === 'audio') return <p className="text-sm">🎤 {message.content}</p>;
  if (!isFile) return <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.4]">{message.content}</p>;
  const extension = message.content.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toUpperCase();
  return <div className="flex min-w-[180px] max-w-full items-center gap-2.5 rounded-lg border border-current/20 bg-white/10 px-3 py-2.5 text-sm">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/15"><FileText className="h-5 w-5" /></span>
    <span className="min-w-0 flex-1"><span className="block text-[10px] font-medium opacity-75">Arquivo{extension ? ` ${extension}` : ''}</span>
      {url ? <a className="block break-all font-medium underline-offset-2 hover:underline" href={url} target="_blank" rel="noopener noreferrer" download>{message.content}</a> : <span className="block break-all font-medium">{message.content}</span>}
    </span>
  </div>;
}
function MessageBubble({ message }: { message: Message }) {
  const outbound = message.direction === 'out';
  return <article className={`w-fit max-w-[78%] rounded-[15px] px-3 py-1.5 text-[14px] leading-[1.4] shadow-[0_5px_16px_rgba(16,19,31,0.08)] ${outbound ? 'ml-auto rounded-tr-[4px] bg-primary text-primary-foreground' : 'rounded-tl-[4px] border border-[#e9ebf3] bg-white text-[#10131f]'}`}>
    <p className={`mb-1 text-[11px] font-medium ${outbound ? 'text-primary-foreground/75' : 'text-[#929aae]'}`}>{message.sender === 'ai' ? 'Lotti IA' : message.sender === 'human' ? 'Corretor' : 'Cliente'}</p>
    <MessageBody message={message} />
    <time dateTime={message.created_at} title={new Date(message.created_at).toLocaleString('pt-BR', { timeZone: inboxTimeZone })} className={`mt-1 block text-right text-[10px] ${outbound ? 'text-primary-foreground/75' : 'text-[#929aae]'}`}>
      {new Date(message.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: inboxTimeZone })}
    </time>
  </article>;
}
const stages: Record<string, string> = { pre_qualificacao: 'Pré-qualificação', qualificando: 'Em qualificação', qualificado_busca: 'Qualificado para busca', qualificado_visita: 'Qualificado para visita' };
const labels: Record<string, string> = { intent: 'Interesse', region: 'Região', budget: 'Orçamento', needs: 'Essenciais', nextStep: 'Próximo passo', timeframe: 'Prazo', payment: 'Pagamento', communication: 'Preferência de conversa' };
const inboxTimeZone = 'America/Sao_Paulo';
function listTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: inboxTimeZone });
  if (day(date) === day(new Date())) return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: inboxTimeZone });
  return date.toLocaleDateString('pt-BR', { timeZone: inboxTimeZone });
}

export default function ConnectedInbox({ connected = true, preview = false }: { connected?: boolean | 'unknown'; preview?: boolean }) {
  const { user } = useAuth();
  const demoTime = new Date().toISOString();
  const demoConversation: Conversation = { id: 'preview-conversation', phone: '5511999990000', contact_name: 'Rafael', cliente_id: null, mode: 'ai', status: 'open', updated_at: demoTime, qualification: { stage: 'qualificando', reason: 'Cliente procura um imóvel para comprar.' }, last_error: null };
  const cache = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  // No celular a lista vira gaveta, como no Clix: a conversa ocupa a tela e a
  // lista desliza por cima. Empilhada, era preciso rolar dezenas de conversas
  // para alcançar a mensagem.
  const [listaAberta, setListaAberta] = useState(false);
  const limparFiltros = () => { setQuery(''); setQuick('all'); setModeFilter(''); setStageFilter(''); setPeriodFilter(''); };
  // /whatsapp?telefone=... abre direto no chat de quem veio da tela inicial.
  // Só vale enquanto ninguém escolheu outra conversa na lista.
  const telefoneAlvo = new URLSearchParams(useLocation().search).get('telefone');
  const [query, setQuery] = useState('');
  const [quick, setQuick] = useState<QuickFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [modeFilter, setModeFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [infoVisible, setInfoVisible] = useState(() => typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 1536px)').matches);
  const [newOpen,setNewOpen]=useState(false),[renameOpen,setRenameOpen]=useState(false),[statusOpen,setStatusOpen]=useState(false);
  // Last "Nova conversa" outcome per request_id (the dialog keeps the id while it is unknown)
  // and a one-line notice for the open conversation (unconfirmed send, relinked client).
  const [startOutcome,setStartOutcome]=useState<{requestId:string;status:string}>();
  const [notice,setNotice]=useState<{id:string;text:string}>();
  const list = useQuery({
    queryKey: ['lotti-agent-conversations', user?.id, preview], enabled: !!user && !preview, refetchInterval: preview ? false : 3000,
    queryFn: fetchConversations,
    initialData: preview ? [demoConversation] : undefined,
  });
  const previews = useQuery({
    queryKey: ['lotti-agent-message-previews', user?.id, preview], enabled: !!user && !preview, refetchInterval: preview ? false : 3000,
    initialData: preview ? [{ conversation_id: demoConversation.id, direction: 'in' as const, content: 'Olá, gostaria de conhecer o imóvel.', created_at: demoTime }] : undefined,
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
  const selected = filtered.find(c => c.id === selectedId)
    ?? (telefoneAlvo ? filtered.find(c => mesmoTelefone(c.phone, telefoneAlvo)) : undefined)
    ?? filtered[0];
  const count = (kind: QuickFilter) => (list.data ?? []).filter(c => liveUrgency(c, latest.get(c.id), now) === kind).length;
  const messages = useQuery({
    queryKey: ['lotti-agent-messages', user?.id, selected?.id, preview], enabled: !!user && !!selected && !preview, refetchInterval: preview ? false : 1500,
    initialData: preview ? [{ id: 'demo-message-1', direction: 'in' as const, sender: 'lead' as const, content: 'Olá, gostaria de conhecer o imóvel.', media_path: null, created_at: demoTime }, { id: 'demo-message-2', direction: 'out' as const, sender: 'human' as const, content: 'Olá, Rafael! Posso te ajudar com os detalhes.', media_path: null, created_at: demoTime }] : undefined,
    queryFn: async () => {
      const { data, error } = await db.from('lotti_agent_messages').select('id,direction,sender,content,media_path,created_at')
        .eq('conversation_id', selected!.id).order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return (data as Message[]).reverse();
    },
  });
  const events = useQuery({
    queryKey: ['lotti-inbox-events', user?.id, selected?.id, preview], enabled: !!user && !!selected && !preview, refetchInterval: preview ? false : 3000,
    initialData: preview ? [{ id: 'demo-event', kind: 'mode' as const, from_label: 'Equipe', to_label: 'IA', subject_label: null, actor_label: 'Corretor', created_at: demoTime }] : undefined,
    queryFn: async () => {
      const { data, error } = await db.from('lotti_inbox_events').select('id,kind,from_label,to_label,subject_label,actor_label,created_at')
        .eq('conversation_id', selected!.id).order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return (data as InboxEvent[]).reverse();
    },
  });
  const client = useQuery({
    queryKey: ['lotti-inbox-client', user?.id, selected?.cliente_id], enabled: !!user && !!selected?.cliente_id && !preview,
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
  const clearOptOut=useMutation({mutationFn:async()=>{const {error}=await db.rpc('lotti_inbox_clear_opt_out',{p_conversation:selected!.id});if(error)throw error},onSuccess:async()=>{await Promise.all([cache.invalidateQueries({queryKey:['lotti-agent-conversations',user?.id]}),cache.invalidateQueries({queryKey:['lotti-inbox-events',user?.id]})])}});
  const refreshConversation=async(id?:string)=>{if(id)setSelectedId(id);await Promise.all([cache.invalidateQueries({queryKey:['lotti-agent-conversations',user?.id]}),cache.invalidateQueries({queryKey:['lotti-agent-message-previews',user?.id]}),cache.invalidateQueries({queryKey:['lotti-inbox-client',user?.id]})])};
  // The conversation already exists when the send is unconfirmed (bridge timeout): it opens with a
  // notice instead of an error, because trying again with a new id could deliver the message twice.
  const startConversation=useMutation({mutationFn:async(data:{phone:string;name?:string;text:string;request_id:string})=>{const {data:result,error}=await supabase.functions.invoke('lotti-whatsapp',{body:{action:'start',...data}});if(error)throw new Error(await functionErrorCode(error));if(!result?.conversationId)throw new Error('start_failed');if(result.sendStatus==='busy'||result.sendStatus==='failed')throw new Error(result.sendStatus);return {conversationId:result.conversationId as string,sendStatus:String(result.sendStatus)}},
    onSettled:(result,error,data)=>setStartOutcome({requestId:data.request_id,status:result?.sendStatus??(error instanceof Error?error.message:'start_failed')}),
    onSuccess:async({conversationId,sendStatus})=>{setNewOpen(false);if(sendStatus!=='sent')setNotice({id:conversationId,text:'Envio sem confirmação. Confira no WhatsApp antes de mandar de novo.'});await refreshConversation(conversationId)}});
  // A phone that is already another client of the CRM links the conversation to that client (relinked).
  const renameContact=useMutation({mutationFn:async(contact:{id:string;name:string;phone:string})=>{const {data,error}=await db.rpc('lotti_inbox_update_contact',{p_conversation:contact.id,p_name:contact.name,p_phone:contact.phone});if(error)throw error;return data as {relinked?:boolean}|null},onSuccess:async(result,contact)=>{setRenameOpen(false);if(result?.relinked)setNotice({id:contact.id,text:'Este telefone já era de outro cliente do CRM. A conversa foi vinculada a esse cadastro.'});await Promise.all([refreshConversation(),useCRMStore.getState().fetchClientes(),cache.invalidateQueries({queryKey:crmKeys.todos})])}});
  // "Unir conversas": the typed phone is the line of another conversation. The server keeps the one
  // WhatsApp identifies (LID or received messages), whatever the order. The name typed in the dialog
  // is then saved on the kept conversation (the typed phone has its key, so the number stays); the merge itself stands even if that save fails.
  const mergeConversations=useMutation({mutationFn:async(pair:{keep:string;drop:string;name?:string;phone?:string})=>{const {data,error}=await db.rpc('lotti_inbox_merge_conversations',{p_keep:pair.keep,p_drop:pair.drop});if(error)throw error;const merged=data as {conversation_id:string;merged_id:string};if(pair.name){const {error:nameError}=await db.rpc('lotti_inbox_update_contact',{p_conversation:merged.conversation_id,p_name:pair.name,p_phone:pair.phone??''});if(nameError)setNotice({id:merged.conversation_id,text:'As conversas foram unidas, mas o nome não foi salvo. Edite o contato de novo.'})}return merged},onSuccess:async result=>{setRenameOpen(false);renameContact.reset();await Promise.all([refreshConversation(result.conversation_id),cache.invalidateQueries({queryKey:['lotti-agent-messages',user?.id]}),cache.invalidateQueries({queryKey:['lotti-inbox-events',user?.id]})])}});
  const otherConversation=registroDoErro(renameContact.error,'phone_in_other_conversation');
  // History conversations are not CRM clients until the broker adds them. The
  // CRM screens read clients from their own store, refreshed after adding.
  const changeStatus=useMutation({mutationFn:async(status:'open'|'closed')=>{const {data,error}=await db.rpc('lotti_inbox_set_status',{p_conversation:selected!.id,p_status:status});if(error)throw error;return data},onSuccess:async()=>{setStatusOpen(false);await refreshConversation()}});
  const demoListKey=['lotti-agent-conversations',user?.id,true];
  const updateDemoConversation=(id:string,change:Partial<Conversation>)=>cache.setQueryData<Conversation[]>(demoListKey,current=>(current??[]).map(item=>item.id===id?{...item,...change}:item));
  const appendDemoMessage=(id:string,kind:'text'|'file'|'audio',content:string)=>{
    const created_at=new Date().toISOString();
    const message:Message={id:crypto.randomUUID(),direction:'out',sender:'human',content,media_path:null,created_at,...(kind==='text'?{}:{preview_kind:kind})};
    cache.setQueryData<Message[]>(['lotti-agent-messages',user?.id,id,true],current=>[...(current??[]),message]);
    cache.setQueryData<LatestMessage[]>(['lotti-agent-message-previews',user?.id,true],current=>[{conversation_id:id,direction:'out',content,created_at},...(current??[]).filter(item=>item.conversation_id!==id)]);
    updateDemoConversation(id,{updated_at:created_at});
  };
  const appendDemoEvent=(id:string,to_label:string,from_label:string)=>cache.setQueryData<InboxEvent[]>(['lotti-inbox-events',user?.id,id,true],current=>[...(current??[]),{id:crypto.randomUUID(),kind:'mode',from_label,to_label,subject_label:null,actor_label:'Corretor',created_at:new Date().toISOString()}]);
  const appendDemoStatusEvent=(id:string,status:'open'|'closed')=>cache.setQueryData<InboxEvent[]>(['lotti-inbox-events',user?.id,id,true],current=>[...(current??[]),{id:crypto.randomUUID(),kind:'status',from_label:status==='closed'?'Aberta':'Fechada',to_label:status==='closed'?'Fechada':'Aberta',subject_label:null,actor_label:'Corretor',created_at:new Date().toISOString()}]);
  const demoStart=(data:{phone:string;name?:string;text:string})=>{
    const id=crypto.randomUUID(),created_at=new Date().toISOString();
    const conversation:Conversation={id,phone:data.phone,contact_name:data.name||null,cliente_id:null,mode:'human',status:'open',updated_at:created_at,qualification:{},last_error:null};
    cache.setQueryData<Conversation[]>(demoListKey,current=>[conversation,...(current??[])]);
    cache.setQueryData<Message[]>(['lotti-agent-messages',user?.id,id,true],[{id:crypto.randomUUID(),direction:'out',sender:'human',content:data.text,media_path:null,created_at}]);
    cache.setQueryData<InboxEvent[]>(['lotti-inbox-events',user?.id,id,true],[]);
    cache.setQueryData<LatestMessage[]>(['lotti-agent-message-previews',user?.id,true],current=>[{conversation_id:id,direction:'out',content:data.text,created_at},...(current??[])]);
    setSelectedId(id);setNewOpen(false);
  };
  const q = selected?.qualification;
  const optOut = preview ? 'none' : optOutState(selected?.opted_out_at, messages.data ?? []);
  const timeline = [...(messages.data ?? []).map(message => ({ type: 'message' as const, value: message })),
    ...(events.data ?? []).map(event => ({ type: 'event' as const, value: event }))]
    .sort((a, b) => new Date(a.value.created_at).getTime() - new Date(b.value.created_at).getTime());
  const connectionKnown = connected !== 'unknown';
  // Open each conversation at the latest message and follow new ones while the
  // reader is at the bottom; scrolling up to read history is not interrupted.
  const timelineRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  useEffect(() => { followLatest.current = true; }, [selected?.id]);
  useLayoutEffect(() => {
    const el = timelineRef.current;
    if (el && followLatest.current) el.scrollTop = el.scrollHeight;
  }, [selected?.id, timeline.length]);
  return <div className="flex min-h-[calc(100dvh-4rem)] flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden" data-testid="connected-inbox">
    <h1 className="sr-only">Inbox</h1>
    {preview && <p className="bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">Prévia interativa com dados fictícios. Nada é enviado ou salvo; recarregar desfaz as mudanças.</p>}
    {list.isError && <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">Não foi possível carregar as conversas. <button className="underline" onClick={() => list.refetch()}>Tentar novamente</button></p>}
    {list.isPending && <p role="status">Carregando conversas…</p>}
    {list.isSuccess && !list.data.length && <div className="rounded-xl border bg-card p-8 text-center">
      <MessageCircle className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h2 className="font-semibold">Aguardando a primeira conversa</h2>
      <p className="mt-2 text-sm text-muted-foreground">Envie uma mensagem nova de um contato de teste depois de conectar. Conversas antigas do celular não são importadas automaticamente.</p>
    </div>}
    {!!list.data?.length && <div data-testid="clix-inbox-shell" className={`grid min-h-0 min-w-0 flex-1 gap-[10px] bg-[#f4f8f5] p-[10px] lg:grid-cols-[230px_minmax(0,1fr)] max-lg:grid-cols-1 ${infoVisible ? '2xl:grid-cols-[306px_minmax(0,1fr)_330px]' : '2xl:grid-cols-[306px_minmax(0,1fr)]'}`}>
      {/* Sobreposição só existe com a gaveta aberta; fechar tocando fora é o
          gesto esperado de quem abriu. */}
      {listaAberta && (
        <button
          type="button"
          aria-label="Fechar lista de conversas"
          onClick={() => setListaAberta(false)}
          className="fixed inset-0 z-40 bg-foreground/40 lg:hidden"
        />
      )}
      <nav
        aria-label="Conversas conectadas"
        className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] border border-[#e9ebf3] bg-white shadow-sm max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:w-[86vw] max-lg:max-w-[310px] max-lg:rounded-none max-lg:transition-transform max-lg:duration-200 ${listaAberta ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-[104%]'}`}
      >
        <div className="space-y-2 border-b border-[#e9ebf3] bg-gradient-to-b from-white to-[#fbfcfe] px-[14px] pb-[13px] pt-[15px]">
          <div className="flex items-center gap-2"><h2 className="text-sm font-semibold">Conversas <span className="font-normal text-muted-foreground">· {list.data.length}</span></h2><Button size="sm" className="ml-auto h-7 bg-primary px-2.5 text-[11px] text-primary-foreground hover:bg-primary/90" onClick={()=>{startConversation.reset();setNewOpen(true)}}><Plus className="mr-1 h-3 w-3" />Nova</Button></div>
          <label className="relative block"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input aria-label="Buscar conversas" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar conversa (nome, telefone, texto)..." className="h-8 rounded-lg pl-8 text-xs" /></label>
          <div className="flex items-center gap-2"><Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setFiltersOpen(true)}><Filter className="mr-1 h-3 w-3" />Filtros</Button><span className="flex-1 text-[11px] text-muted-foreground">{filtered.length} de {list.data.length}</span><button className="text-[11px] text-destructive" onClick={limparFiltros}>Limpar</button></div>
          {/* Sem contagem os atalhos continuam clicáveis: desabilitar em zero
              faz o corretor ler defeito onde só há fila vazia. Clicar mostra o
              estado vazio, que já traz o caminho de volta para "Todas". */}
          <div className="grid grid-cols-3 gap-1"><Button size="sm" className={`h-7 px-1 text-[11px] ${quick === 'all' ? 'border border-primary bg-primary/10 text-primary hover:bg-primary/15' : 'bg-white text-[#565e76]'}`} variant="outline" onClick={() => setQuick('all')}>Todas</Button><Button size="sm" className="h-7 gap-1 px-1 text-[11px] text-amber-700" variant={quick === 'late' ? 'secondary' : 'outline'} onClick={() => setQuick('late')} aria-label={`Atrasando: ${count('late')} conversas`}><Timer className="h-3 w-3" />{count('late')}</Button><Button size="sm" className="h-7 gap-1 px-1 text-[11px] text-red-600" variant={quick === 'urgent' ? 'secondary' : 'outline'} onClick={() => setQuick('urgent')} aria-label={`Urgente: ${count('urgent')} conversas`}><AlertTriangle className="h-3 w-3" />{count('urgent')}</Button></div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-[5px]">
        {filtered.map(c => <button key={c.id} onClick={() => { setSelectedId(c.id); mode.reset(); clearOptOut.reset(); setListaAberta(false); if (notice?.id !== c.id) setNotice(undefined); }} className={`mx-[6px] my-[2px] flex min-h-[64px] w-[calc(100%-12px)] items-center gap-[10px] rounded-[10px] border px-[10px] py-3 text-left text-xs transition-colors ${selected?.id === c.id ? 'border-primary/30 border-l-[3px] border-l-primary bg-primary/10 shadow-sm' : 'border-transparent hover:bg-primary/5'}`}>
          <ContactAvatar name={conversationTitle(c, c.clientes?.nome)} className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-[#e9ebf3] bg-[#f1f3f9] text-xs font-semibold text-[#565e76]" /><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="block truncate text-[13px] font-semibold text-[#10131f]">{conversationTitle(c, c.clientes?.nome)}</span><time dateTime={c.updated_at} className="ml-auto text-[10px] text-[#929aae]">{listTimestamp(c.updated_at)}</time></span><span className="mt-1 block truncate text-xs text-[#565e76]">{latest.get(c.id)?.content || stages[c.qualification.stage ?? ''] || 'Novo contato'}</span><span className="mt-1 block text-[10px] text-[#929aae]">{c.opted_out_at ? 'Não quer receber' : c.mode === 'ai' ? 'IA' : c.mode === 'human' ? 'Equipe' : 'Pausado'}</span></span>
        </button>)}
        {!filtered.length && (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {list.data.length
              ? <>
                  <p>Nenhuma conversa neste filtro.</p>
                  <Button size="sm" variant="outline" className="mt-2 h-7 text-[11px]" onClick={limparFiltros}>Ver todas as conversas</Button>
                </>
              : <p>Nenhuma conversa ainda.</p>}
          </div>
        )}
        {list.data.length === 100 && <p className="p-2 text-xs text-muted-foreground">Exibindo as 100 conversas mais recentes.</p>}
        </div>
      </nav>
      {selected ? <section aria-label="Histórico conectado" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] border border-[#e9ebf3] bg-white shadow-sm">
        <header data-testid="conversation-header" className="flex min-h-[68px] flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2">
          {/* Só no celular: é o único caminho de volta para a lista quando ela
              vira gaveta. Alvo de 44px, que é o mínimo confortável no toque. */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0 lg:hidden"
            aria-label="Ver conversas"
            onClick={() => setListaAberta(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex min-w-[210px] flex-1 items-center gap-2">
            <ContactAvatar name={conversationTitle(selected, client.data?.nome || selected.clientes?.nome)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-secondary text-xs font-semibold" />
            <div className="min-w-0"><div className="flex items-center gap-1"><strong className="block truncate text-sm">{conversationTitle(selected, client.data?.nome || selected.clientes?.nome)}</strong><button type="button" aria-label="Editar nome" onClick={()=>{renameContact.reset();mergeConversations.reset();setRenameOpen(true)}} className="rounded p-1 text-muted-foreground hover:bg-muted"><Pencil className="h-3 w-3" /></button></div><p className="whitespace-nowrap text-[11px] text-muted-foreground">{contactPhoneLabel(selected.phone)}</p></div>
          </div>
          <div data-testid="conversation-header-actions" className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">
            <span data-testid="conversation-stage-pill" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2 text-[10px] font-medium"><span className="font-semibold uppercase text-muted-foreground">Etapa</span><span className="h-2 w-2 rounded-full bg-primary" /><span>{stages[q?.stage ?? ''] ?? (selected.cliente_id ? 'Em atendimento humano' : 'Sem cliente vinculado')}</span></span>
            <button type="button" onClick={()=>{changeStatus.reset();setStatusOpen(true)}} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium hover:bg-primary/10"><span className={`h-2 w-2 rounded-full ${selected.status==='closed'?'bg-muted-foreground':'bg-emerald-600'}`} />{selected.status==='closed'?'Fechada':'Aberta'}</button>
            <button type="button" role="switch" aria-label="IA" aria-checked={selected.mode === 'ai'} disabled={mode.isPending || optOut !== 'none'} title={optOut !== 'none' ? 'O contato pediu para não receber mensagens' : undefined} onClick={() => {if(preview){const next=selected.mode==='ai'?'human':'ai';updateDemoConversation(selected.id,{mode:next});appendDemoEvent(selected.id,next==='ai'?'IA':'Equipe',selected.mode==='ai'?'IA':'Equipe');}else mode.mutate(selected.mode === 'ai' ? 'human' : 'ai')}} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium hover:bg-primary/10 disabled:opacity-50"><Sparkles className="h-3 w-3 text-primary" /><span>{optOut!=='none'?'IA bloqueada':selected.mode==='ai'?'IA ligada':selected.mode==='paused'?'IA pausada':'IA desligada'}</span><span className={`ml-0.5 h-2 w-2 rounded-full ${selected.mode==='ai'?'bg-primary':'bg-muted-foreground'}`} /></button>
            <Button size="sm" className="h-8 shrink-0 border-primary px-2 text-[11px] text-primary hover:bg-primary/10" variant="outline" onClick={() => setInfoVisible(v => !v)}>{infoVisible ? 'Ocultar info' : 'Mostrar info'}</Button>
          </div>
        </header>
        {notice?.id === selected.id && <p role="status" className="border-b border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{notice.text}</p>}
        {mode.isError && <p role="alert" className="p-3 text-sm text-destructive">{String((mode.error as { message?: string } | null)?.message ?? '').includes('contact_opted_out') ? 'Este contato pediu para não receber mensagens. Libere o contato antes de religar a IA.' : 'Não foi possível alterar o atendimento. Se houver entrega incerta, revise-a antes de retomar a IA.'}</p>}
        {messages.isError && <p role="alert" className="p-3 text-sm text-destructive">Não foi possível carregar o histórico.</p>}
        <div ref={timelineRef} onScroll={event => { const el = event.currentTarget; followLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} data-testid="message-timeline" className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-[#f4f8f5] bg-[radial-gradient(circle_at_1px_1px,rgba(119,153,130,0.14)_1px,transparent_0)] bg-[length:24px_24px] px-[clamp(10px,1.5vw,18px)] py-3">
          {timeline.map(item => item.type === 'event' ? <div key={`event-${item.value.id}`} className="flex justify-center py-0.5"><span className="rounded-full border bg-card px-3 py-1 text-[11px] text-muted-foreground shadow-sm">{eventText(item.value)} · {new Date(item.value.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></div> : <MessageBubble key={item.value.id} message={item.value} />)}
          {messages.data?.length === 200 && <p className="text-xs text-muted-foreground">Exibindo as 200 mensagens mais recentes.</p>}
        </div>
        {connected === true || preview
          ? <>{optOut !== 'none' && selected.opted_out_at && <OptOutNotice state={optOut} since={selected.opted_out_at} pending={clearOptOut.isPending} failed={clearOptOut.isError} onRelease={() => clearOptOut.mutate()} />}
            {optOut !== 'blocked' && <MessageComposer key={selected.id} conversationId={selected.id} preview={preview} onPreviewSend={message=>appendDemoMessage(selected.id,message.kind,message.content)} onSent={() => { void cache.invalidateQueries({ queryKey: ['lotti-agent-messages', user?.id, selected.id] }); void cache.invalidateQueries({ queryKey: ['lotti-agent-conversations', user?.id] }); }} />}</>
          : <footer className="shrink-0 border-t p-3 text-xs text-muted-foreground">{connectionKnown ? <>Conecte o WhatsApp na página de <Link className="underline" to="/whatsapp/conexao">Conexão</Link> para responder por aqui.</> : <>Não foi possível confirmar a conexão. <Link className="underline" to="/whatsapp/conexao">Verificar conexão</Link> antes de responder.</>}</footer>}
      </section> : <div className="grid place-items-center rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
        {filtered.length
          ? <p>Selecione uma conversa</p>
          : list.data.length
            ? <div>
                <p>Nenhuma conversa neste filtro.</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={limparFiltros}>Ver todas as conversas</Button>
              </div>
            : <p>Nenhuma conversa ainda.</p>}
      </div>}
      {selected && infoVisible && <aside aria-label="Perfil do contato" className="fixed bottom-3 right-3 top-16 z-30 min-h-0 w-[min(330px,calc(100vw-24px))] overflow-y-auto rounded-[14px] border border-[#e9ebf3] bg-white p-[14px] shadow-xl 2xl:static 2xl:w-auto 2xl:shadow-sm">
        <button type="button" onClick={() => setInfoVisible(false)} className="float-right rounded px-2 py-1 text-xs text-primary 2xl:hidden">Fechar perfil</button>
        <h2 className="border-b pb-2.5 text-[11px] font-bold uppercase">Perfil do contato</h2>
        <div className="mt-2.5 rounded-xl border bg-secondary/30 p-3"><p className="text-xs font-semibold">{conversationTitle(selected, client.data?.nome)}</p><p className="text-[11px] text-muted-foreground">{contactPhoneLabel(selected.phone)}</p>{client.data?.email && <p className="break-words text-[11px] text-muted-foreground">{client.data.email}</p>}<h3 className="mt-4 flex items-center text-[10px] font-semibold uppercase text-muted-foreground">Resumo do caso <Badge variant="secondary" className="ml-auto gap-1 text-[9px]"><Sparkles className="h-2.5 w-2.5" />IA</Badge></h3><p className="mt-2 rounded-lg border border-dashed bg-card p-2.5 text-[11px] leading-4 text-muted-foreground">{q?.reason || 'Ainda sem qualificação. A IA preenche conforme conversa com o cliente.'}</p></div>
        <div className="mt-4 space-y-3"><h3 className="text-xs font-semibold uppercase text-muted-foreground">Linha do tempo</h3><p className="text-xs text-primary">Conversou no WhatsApp <span className="block text-muted-foreground">Última atividade: {new Date(selected.updated_at).toLocaleString('pt-BR')}</span></p>{client.data?.created_at && <p className="text-xs text-primary">Lead criado <span className="block text-muted-foreground">{new Date(client.data.created_at).toLocaleString('pt-BR')}</span></p>}</div>
        <h3 className="mt-5 text-xs font-semibold uppercase text-muted-foreground">Qualificação comercial</h3>
        <div className="flex flex-wrap gap-2"><Badge variant="outline">{stages[q?.stage ?? ''] ?? 'Novo contato'}</Badge>{q?.temperature && <Badge variant="secondary">{q.temperature}</Badge>}{q?.priority === 'alta' && <Badge>Prioridade alta</Badge>}</div>
        <dl className="space-y-3">{Object.entries(labels).filter(([key]) => q?.profile?.[key]).map(([key, label]) => <div key={key}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words text-sm">{q?.profile?.[key]}</dd></div>)}</dl>
        {selected?.last_error && <p className="rounded-lg bg-muted p-3 text-xs">Esta conversa precisa de revisão operacional. O histórico foi preservado.</p>}
        {selected?.cliente_id && !preview && <Link className="inline-block text-sm text-primary underline" to={`/clientes/${selected.cliente_id}`}>Abrir cadastro do cliente</Link>}
      </aside>}
    </div>}
    <NewConversationDialog open={newOpen} onOpenChange={setNewOpen} onSubmit={data=>preview?demoStart(data):startConversation.mutate(data)} pending={!preview&&startConversation.isPending} outcome={startOutcome} error={!preview&&startConversation.isError?startErrorText(startConversation.error instanceof Error?startConversation.error.message:''):undefined} />
      {selected&&<><RenameContactDialog open={renameOpen} initialName={client.data?.nome??selected.contact_name??''} initialPhone={selected.phone ?? ''} phoneHidden={!selected.phone} onOpenChange={setRenameOpen} onSubmit={contact=>{if(preview){updateDemoConversation(selected.id,{contact_name:contact.name,phone:contact.phone});setRenameOpen(false)}else{mergeConversations.reset();renameContact.mutate({id:selected.id,...contact})}}} pending={!preview&&renameContact.isPending} error={preview?undefined:mergeConversations.isError?mergeErrorText(codigoDoErro(mergeConversations.error)):renameContact.isError?renameErrorText(codigoDoErro(renameContact.error)):undefined} action={!preview&&otherConversation&&!mergeConversations.isError?{label:'Unir conversas',pending:mergeConversations.isPending,onClick:()=>mergeConversations.mutate({keep:selected.id,drop:otherConversation,name:renameContact.variables?.name,phone:renameContact.variables?.phone})}:undefined} /><ConversationStatusDialog open={statusOpen} status={selected.status??'open'} onOpenChange={setStatusOpen} onConfirm={status=>{if(preview){updateDemoConversation(selected.id,{status});appendDemoStatusEvent(selected.id,status);setStatusOpen(false)}else changeStatus.mutate(status)}} pending={!preview&&changeStatus.isPending} error={!preview&&changeStatus.isError?'Não foi possível alterar o estado da conversa.':undefined} /></>}
    <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}><SheetContent side="left" className="space-y-5"><SheetTitle>Filtros</SheetTitle><SheetDescription>Filtre as conversas já recebidas.</SheetDescription>
      <label className="block text-sm">Atendimento<select className="mt-1 w-full rounded-md border bg-background p-2" value={modeFilter} onChange={e => setModeFilter(e.target.value)}><option value="">Todos</option><option value="human">Humano</option><option value="ai">IA</option><option value="paused">Pausado</option></select></label>
      <label className="block text-sm">Etapa<select className="mt-1 w-full rounded-md border bg-background p-2" value={stageFilter} onChange={e => setStageFilter(e.target.value)}><option value="">Todas</option>{Object.entries(stages).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="block text-sm">Última atividade<select className="mt-1 w-full rounded-md border bg-background p-2" value={periodFilter} onChange={e => setPeriodFilter(e.target.value)}><option value="">Qualquer período</option><option value="1">Últimas 24 horas</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option></select></label>
      <Button onClick={() => setFiltersOpen(false)}>Ver {filtered.length} conversas</Button>
    </SheetContent></Sheet>
  </div>;
}
