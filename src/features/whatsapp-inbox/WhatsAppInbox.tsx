import { FormEvent, useEffect, useRef, useState } from 'react';
import { InboxFiltersPanel } from './InboxFiltersPanel';
import { ReplySuggestion } from './ReplySuggestion';
import { contactDisplay } from './contactDisplay';
import { updateDraft } from './localActions';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { emptyFilters, matchesFilters, urgency, type FilterRecord } from './inboxFilters';
import {
  AlertTriangle, ArrowLeft, Bot, CheckCheck, ChevronRight, Clock3, Eye, EyeOff,
  Filter, Info, MessageCircle, Paperclip, Pencil, Plus, Search, Send,
  Timer, Trash2, UserRound, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { ETAPAS_LEGADO, useEtapas, useMoverOportunidade, useOportunidades } from '@/hooks/crm/useCrm';
import { cn } from '@/lib/utils';
import { receiveChatMessage } from './chatEvents';
import { demoConversations, demoMessagesByConversation, demoProfilesByContact } from './demoData';
import type { WhatsAppConversation, WhatsAppMessage, WhatsAppServiceMode } from './types';

type MobilePanel = 'list' | 'chat' | 'profile';

export function filterConversations(conversations: WhatsAppConversation[], query: string) {
  const normalized = query.trim().toLocaleLowerCase('pt-BR');
  if (!normalized) return conversations;
  return conversations.filter((conversation) =>
    [conversation.contactName, conversation.phone, conversation.lastMessage]
      .some((value) => value.toLocaleLowerCase('pt-BR').includes(normalized)),
  );
}

export function toggleProfileVisibility(visible: boolean): boolean {
  return !visible;
}

type FunnelOpportunityLink = {
  id: string;
  cliente_id: string | null;
  etapa_id: string;
  ordem?: number;
  updated_at?: string;
  clientes?: { telefone?: string | null } | null;
};

const phoneDigits = (value?: string | null) => value?.replace(/\D/g, '') ?? '';

export function findFunnelOpportunityForConversation(
  conversation: WhatsAppConversation,
  opportunities: FunnelOpportunityLink[],
) {
  const byClient = opportunities.find(({ cliente_id }) => cliente_id === conversation.contactId);
  if (byClient) return byClient;

  const phone = phoneDigits(conversation.phone);
  return phone
    ? opportunities.find(({ clientes }) => phoneDigits(clientes?.telefone) === phone)
    : undefined;
}

function Avatar({ initials }: { initials: string }) {
  return (
    <span data-avatar-size="compact" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
      {initials}
    </span>
  );
}

export function WhatsAppInbox() {
  const [conversations, setConversations] = useState(demoConversations);
  const [messages, setMessages] = useState(demoMessagesByConversation);
  const [selectedId, setSelectedId] = useState(demoConversations[0].id);
  const [query, setQuery] = useState('');
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [quickFilter, setQuickFilter] = useState('all');
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = drafts[selectedId] ?? '';
  const setDraft = (value: string) => setDrafts(current => updateDraft(current, selectedId, value));
  const [profiles, setProfiles] = useState(demoProfilesByContact);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [formError, setFormError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [attachments, setAttachments] = useState<Record<string, WhatsAppMessage['attachment']>>({});
  const [attachmentError, setAttachmentError] = useState('');
  const objectUrls = useRef<string[]>([]);
  useEffect(() => () => { objectUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  const [note, setNote] = useState('');
  const [addedNotes, setAddedNotes] = useState<Record<string, string[]>>({});
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('list');
  const [profileVisible, setProfileVisible] = useState(true);
  const [closingConversationId, setClosingConversationId] = useState<string | null>(null);
  const [demoStageByContact, setDemoStageByContact] = useState<Record<string, string>>({});
  const { data: funnelStages } = useEtapas();
  const { data: funnelOpportunities } = useOportunidades();
  const moveOpportunity = useMoverOportunidade();

  const selected = conversations.find(({ id }) => id === selectedId) ?? conversations[0] ?? demoConversations[0];
  const profile = profiles[selected.contactId];
  const selectedMessages = messages[selected.id] ?? [];
  const availableStages = funnelStages?.length ? funnelStages : ETAPAS_LEGADO;
  const filterRecords: FilterRecord[] = conversations.map(conversation => {
    const contact = profiles[conversation.contactId];
    const latest = [...(messages[conversation.id] ?? [])].reverse().find(message => !message.systemEvent);
    return { id: conversation.id, stage: findFunnelOpportunityForConversation(conversation, (funnelOpportunities ?? []) as FunnelOpportunityLink[])?.etapa_id ?? demoStageByContact[conversation.contactId] ?? contact.stageId,
      interaction: latest?.direction === 'incoming' ? 'unanswered' : latest?.sender === 'Lotti IA' ? 'ai' : 'human',
      status: conversation.status === 'closed' ? 'closed' : 'open', assignee: conversation.assignee, tags: contact.tags,
      closedBy: conversation.status === 'closed' ? conversation.closedBy ?? '' : '', unread: conversation.unreadCount > 0,
      firstAt: conversation.firstInteractionAt, lastAt: conversation.lastInteractionAt, waitingSince: conversation.waitingSince };
  });
  const searchedIds = new Set(filterConversations(conversations, query).map(item => item.id));
  const matchingRecords = filterRecords.filter(record => searchedIds.has(record.id) && matchesFilters(record, filters, now));
  const quickCount = (kind: string) => matchingRecords.filter(record => urgency(record, filters, now) === kind).length;
  const filteredIds = new Set(matchingRecords.filter(record => quickFilter === 'all' || urgency(record, filters, now) === quickFilter).map(record => record.id));
  const filtered = conversations.filter(item => filteredIds.has(item.id));
  const filterCount = ['stage', 'interaction', 'status', 'assignee', 'tags', 'closedBy'].reduce((total, key) => total + filters[key as 'stage'].length, 0) + Number(filters.unread) + Number(filters.first.period !== 'any') + Number(filters.last.period !== 'any');
  const filterStages = [...availableStages, ...ETAPAS_LEGADO.filter(stage => !availableStages.some(item => item.id === stage.id) && filterRecords.some(record => record.stage === stage.id))];
  const linkedOpportunity = findFunnelOpportunityForConversation(
    selected,
    (funnelOpportunities ?? []) as FunnelOpportunityLink[],
  );
  const activeStageId = linkedOpportunity?.etapa_id
    ?? demoStageByContact[selected.contactId]
    ?? profile.stageId;
  const activeStage = availableStages.find(({ id }) => id === activeStageId)
    ?? ETAPAS_LEGADO.find(({ id }) => id === activeStageId)
    ?? ETAPAS_LEGADO[0];

  const selectConversation = (id: string) => {
    setAttachmentError('');
    setTagDraft('');
    setNote('');
    setSelectedId(id);
    setConversations((current) => current.map((item) => item.id === id ? { ...item, unreadCount: 0 } : item));
    setMobilePanel('chat');
  };

  const setServiceMode = (serviceMode: WhatsAppServiceMode) => {
    setConversations((current) => current.map((item) => item.id === selected.id ? { ...item, serviceMode } : item));
  };

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content && !attachments[selectedId]) return;
    const outgoing: WhatsAppMessage = {
      id: crypto.randomUUID(), direction: 'outgoing', content, attachment: attachments[selectedId], sentAt: 'Agora', sender: 'Você', status: 'sent',
    };
    acceptHumanMessage(outgoing, 'inbox');
    setDraft('');
    setAttachments(current => ({ ...current, [selectedId]: undefined }));
  };

  const acceptHumanMessage = (message: WhatsAppMessage, source: 'whatsapp' | 'inbox') => {
    const result = receiveChatMessage(selectedMessages, selected.serviceMode, message, 'human', source);
    setMessages(current => ({ ...current, [selected.id]: result.messages }));
    setConversations(current => current.map(item => item.id === selected.id
      ? { ...item, serviceMode: result.mode, lastMessage: message.content || message.attachment?.name || '', lastMessageAt: message.sentAt, lastInteractionAt: new Date().toISOString(), waitingSince: undefined } : item));
  };

  const previewWhatsAppReply = () => acceptHumanMessage({
    id: crypto.randomUUID(), direction: 'outgoing', content: 'Olá! Vou continuar seu atendimento por aqui.',
    sender: 'Equipe (demonstração)', sentAt: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    status: 'sent',
  }, 'whatsapp');

  const changeFunnelStage = (stageId: string) => {
    const destination = availableStages.find(stage => stage.id === stageId);
    if (!destination || stageId === activeStage.id) return;
    const conversationId = selected.id;
    const notice: WhatsAppMessage = {
      id: crypto.randomUUID(), direction: 'outgoing', content: '', sender: 'Você',
      sentAt: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      systemEvent: { type: 'stage', from: activeStage.nome, to: destination.nome },
    };
    const recordMove = () => setMessages(current => ({ ...current,
      [conversationId]: [...(current[conversationId] ?? []), notice] }));
    if (!linkedOpportunity) {
      setDemoStageByContact((current) => ({ ...current, [selected.contactId]: stageId }));
      recordMove();
      return;
    }

    const destinationOrder = (funnelOpportunities ?? [])
      .filter(({ etapa_id }) => etapa_id === stageId).length;
    moveOpportunity.mutate({
      id: linkedOpportunity.id,
      etapaId: stageId,
      ordem: destinationOrder,
      updatedAt: linkedOpportunity.updated_at ?? '',
    }, { onSuccess: recordMove });
  };

  const listPanel = (
    <section data-panel="conversations" data-density="compact" className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card" aria-label="Lista de conversas">
      <div className="border-b border-border p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Conversas <span className="font-normal text-muted-foreground">· {conversations.length}</span></h2>
          <div className="flex gap-1.5"><Button size="sm" onClick={() => { setNewName(''); setNewPhone(''); setFormError(''); setNewOpen(true); }} className="h-[30px] gap-1 px-2 text-[11px]"><Plus className="h-3 w-3" /> Nova</Button><Button size="icon" variant="outline" onClick={() => { if (conversations.length) setDeleteId(selected.id); }} className="h-[30px] w-[30px] text-destructive" aria-label="Excluir conversa"><Trash2 className="h-3 w-3" /></Button></div>
        </div>
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nome, telefone ou mensagem" className="h-8 pl-8 text-[11px]" />
        </label>
        <div className="mt-2 flex items-center gap-2 text-xs">
          <Button size="sm" variant="outline" onClick={() => setFiltersOpen(true)} className="h-[30px] gap-1 px-2 text-[11px]"><Filter className="h-3 w-3" />Filtros {filterCount > 0 && <Badge className="ml-0.5 h-4 min-w-4 px-1 text-[9px]">{filterCount}</Badge>}</Button>
          <span className="flex-1 text-muted-foreground">{filtered.length} de {conversations.length}</span>
          <button type="button" onClick={() => { setQuery(''); setFilters(emptyFilters()); setQuickFilter('all'); }} className="text-destructive hover:underline">Limpar</button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <Button size="sm" className="h-[30px] text-[11px]" aria-pressed={quickFilter === 'all'} variant={quickFilter === 'all' ? 'default' : 'outline'} onClick={() => setQuickFilter('all')}>Todas</Button>
          <Button size="sm" variant="outline" className={cn('h-[30px] gap-1 text-[11px]', quickFilter === 'late' && 'border-amber-500 bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300')} aria-pressed={quickFilter === 'late'} onClick={() => setQuickFilter('late')} title={`Atrasando: ${quickCount('late')} conversas`} aria-label={`Atrasando: ${quickCount('late')} conversas`}><Timer className="h-3 w-3" /><span>{quickCount('late')}</span></Button>
          <Button size="sm" variant="outline" aria-pressed={quickFilter === 'urgent'} onClick={() => setQuickFilter('urgent')} title={`Urgente: ${quickCount('urgent')} conversas`} aria-label={`Urgente: ${quickCount('urgent')} conversas`} className={cn('h-[30px] gap-1 text-[11px] text-destructive', quickFilter === 'urgent' && 'border-red-500 bg-red-50 text-red-600 hover:bg-red-50 dark:bg-red-950 dark:text-red-300')}><AlertTriangle className="h-3 w-3" /><span>{quickCount('urgent')}</span></Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {filtered.map((conversation) => (
          <button key={conversation.id} type="button" onClick={() => selectConversation(conversation.id)}
            className={cn('mb-1 flex min-h-[60px] w-full gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors', selected.id === conversation.id ? 'border-primary/30 bg-primary/5' : 'border-transparent hover:bg-muted/70')}>
            <Avatar initials={conversation.avatar} />
            <span className="min-w-0 flex-1">
              <span className="flex justify-between gap-2"><strong className="truncate text-xs">{conversation.contactName}</strong><span className="shrink-0 text-[9px] text-muted-foreground">{conversation.lastMessageAt}</span></span>
              <span className="mt-0.5 flex items-center gap-2"><span className="line-clamp-1 flex-1 text-[11px] text-muted-foreground">{conversation.lastMessage}</span>{conversation.unreadCount > 0 && <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">{conversation.unreadCount}</span>}</span>
              <span className="mt-0.5 inline-flex items-center gap-1 text-[9px] font-medium text-muted-foreground">{conversation.serviceMode === 'ai' ? <Bot className="h-2.5 w-2.5" /> : <UserRound className="h-2.5 w-2.5" />}{conversation.serviceMode === 'ai' ? 'Lotti IA' : conversation.serviceMode === 'human' ? 'Humano' : 'Pausada'}</span>
            </span>
          </button>
        ))}
        {!filtered.length && <p className="px-4 py-12 text-center text-sm text-muted-foreground">Nenhuma conversa encontrada.</p>}
      </div>
    </section>
  );

  const chatPanel = (
    <section data-panel="chat" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-card" aria-label="Atendimento">
      <header className="flex min-h-[60px] items-center gap-2 border-b border-border bg-card px-3">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobilePanel('list')} aria-label="Voltar para conversas"><ArrowLeft className="h-5 w-5" /></Button>
        <Avatar initials={selected.avatar} />
        <div className="min-w-0 flex-1"><div className="flex items-center gap-1"><h2 className="truncate text-sm font-semibold">{selected.contactName}</h2><Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground" aria-label="Editar cliente" onClick={() => { setDisplayName(selected.contactName); setEditingContact(selected.contactId); }}><Pencil className="h-3 w-3" /></Button></div><p className="truncate text-[11px] text-muted-foreground">{selected.phone} · {selected.assignee}</p></div>
        <div className="hidden items-center gap-2 sm:flex">
          <span className="text-xs font-medium">IA</span>
          <Switch checked={selected.serviceMode === 'ai'} onCheckedChange={(checked) => setServiceMode(checked ? 'ai' : 'human')} aria-label="Ativar IA" />
        </div>
        <Button variant="outline" size="sm" className="hidden h-8 px-2.5 text-xs md:flex" onClick={() => setServiceMode('human')}><UserRound className="mr-1 h-3.5 w-3.5" />Atendimento humano</Button>
        <Button
          variant="outline"
          size="sm"
          className="hidden h-[30px] px-2 text-[11px] lg:flex"
          onClick={() => setProfileVisible(toggleProfileVisibility)}
          aria-expanded={profileVisible}
          aria-controls="whatsapp-contact-profile"
        >
          {profileVisible ? <EyeOff className="mr-1.5 h-4 w-4" /> : <Eye className="mr-1.5 h-4 w-4" />}
          {profileVisible ? 'Ocultar info' : 'Mostrar info'}
        </Button>
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobilePanel('profile')} aria-label="Abrir perfil"><Info className="h-5 w-5" /></Button>
      </header>
      <div className="flex items-stretch justify-between border-b border-border bg-card/70 text-[11px]">
        <label className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2">
          <span className="font-semibold uppercase text-muted-foreground">Etapa</span>
          <span className="h-2 w-2 shrink-0 rounded-full bg-success" />
          <select
            aria-label="Alterar etapa do funil"
            value={activeStage.id}
            disabled={moveOpportunity.isPending}
            onChange={(event) => changeFunnelStage(event.target.value)}
            className="min-w-0 max-w-[13rem] cursor-pointer rounded bg-card text-foreground font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
          >
            {availableStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.nome}</option>)}
          </select>
        </label>
        <button type="button" aria-label={selected.status === 'closed' ? 'Reabrir conversa' : 'Fechar conversa'}
          onClick={() => selected.status === 'closed'
            ? setConversations(current => current.map(item => item.id === selected.id ? { ...item, status: 'open' } : item))
            : setClosingConversationId(selected.id)}
          className="flex shrink-0 items-center gap-2 border-l border-border px-3 py-2 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className={cn('h-2 w-2 rounded-full', selected.status === 'closed' ? 'bg-muted-foreground' : 'bg-success')} />
          {selected.status === 'closed' ? 'Fechada' : selected.status === 'waiting' ? 'Aguardando' : 'Aberta'}
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-secondary/60 p-3">
        <div className="mx-auto w-fit rounded-full bg-card px-3 py-1 text-[11px] text-muted-foreground shadow-card">Hoje</div>
        {selectedMessages.map((message) => message.systemEvent ? (
          <div key={message.id} className="mx-auto flex w-fit max-w-[94%] items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-center text-[11px] text-muted-foreground shadow-sm">
            <span aria-hidden="true">{message.systemEvent.type === 'stage' ? '↻' : 'Ⅱ'}</span>
            <span>{message.systemEvent.type === 'stage' ? <>
              Movido de <strong className="text-foreground">{message.systemEvent.from}</strong> para <strong className="text-foreground">{message.systemEvent.to}</strong> por {message.sender}
            </> : <><strong className="text-foreground">IA desligada</strong> porque a equipe respondeu pelo {message.systemEvent.source === 'whatsapp' ? 'WhatsApp' : 'Inbox'}</>}
              <span className="ml-1 opacity-75">· {message.sentAt}</span>
            </span>
          </div>
        ) : (
          <div key={message.id} className={cn('flex', message.direction === 'outgoing' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[82%] rounded-xl px-2.5 py-1.5 text-xs shadow-card sm:max-w-[72%]', message.direction === 'outgoing' ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm border border-border bg-card')}>
              {message.attachment && <a href={message.attachment.url} download={message.attachment.name} className="mb-1 block max-w-full break-all rounded-md border border-current/20 p-2 underline">{message.attachment.name} · {(message.attachment.size / 1024).toFixed(0)} KB (local)</a>}
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
              <span className={cn('mt-1 flex items-center justify-end gap-1 text-[10px]', message.direction === 'outgoing' ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{message.sender} · {message.sentAt}{message.direction === 'outgoing' && <CheckCheck className="h-3 w-3" />}</span>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={sendMessage} className="border-t border-border bg-card p-2.5">
        <div className="flex items-end gap-1.5 rounded-xl border border-input bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring/30">
          <label className="relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-muted focus-within:ring-2 focus-within:ring-ring" title="Anexar arquivo (demonstração local, até 20 MB)"><Paperclip className="h-4 w-4" /><input type="file" aria-label="Anexar arquivo" className="absolute inset-0 cursor-pointer opacity-0" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (file.size > 20 * 1024 * 1024) { setAttachmentError('Escolha um arquivo de até 20 MB.'); return; } const url = URL.createObjectURL(file); objectUrls.current.push(url); setAttachments(current => ({ ...current, [selectedId]: { name: file.name, url, type: file.type, size: file.size } })); setAttachmentError(''); }} /></label>
          <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Digite uma mensagem" rows={1} className="min-h-8 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-[13px] shadow-none focus-visible:ring-0" />
          <Button type="submit" size="icon" className="h-8 w-8" disabled={!draft.trim() && !attachments[selectedId]} aria-label="Enviar mensagem"><Send className="h-3.5 w-3.5" /></Button>
        </div>
        {attachments[selectedId] && <div className="mt-1 flex items-center gap-2 text-xs"><span className="truncate">{attachments[selectedId]?.name}</span><button type="button" aria-label="Remover anexo" onClick={() => setAttachments(current => ({ ...current, [selectedId]: undefined }))}><X className="h-3 w-3" /></button></div>}
        {attachmentError && <p role="alert" className="text-xs text-destructive">{attachmentError}</p>}
        <ReplySuggestion key={`${selected.id}-${selectedMessages.filter(message => message.direction === 'incoming').at(-1)?.id ?? ''}`} question={selectedMessages.filter(message => message.direction === 'incoming').at(-1)?.content ?? ''} onUse={setDraft} />
        <p className="mt-1.5 text-center text-[10px] text-muted-foreground">Modo demonstração: nenhuma mensagem será enviada ao WhatsApp.</p>
        {import.meta.env.DEV && <details className="mt-1 text-[10px] text-muted-foreground"><summary className="cursor-pointer">Ferramentas de demonstração</summary><button type="button" onClick={previewWhatsAppReply} className="py-1 underline">Simular resposta da equipe pelo WhatsApp</button></details>}
      </form>
    </section>
  );

  const profilePanel = (
    <aside id="whatsapp-contact-profile" data-panel="contact-profile" className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card" aria-label="Perfil do contato">
      <header className="flex min-h-9 shrink-0 items-center justify-between border-b border-border px-2.5"><h2 className="text-[11px] font-bold uppercase tracking-wide">Perfil do contato</h2><Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobilePanel('chat')} aria-label="Fechar perfil"><X className="h-5 w-5" /></Button></header>
      <div key={selected.id} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3">
          <div className="min-w-0"><h3 className="break-words text-sm font-semibold leading-snug">{selected.contactName}</h3><p className="mt-1 text-xs text-muted-foreground">{selected.phone}</p><p className="break-words text-[11px] text-muted-foreground">{profile.email}</p></div>
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/60 bg-card p-2.5 text-xs"><div><span className="text-[10px] uppercase tracking-wide text-muted-foreground">Etapa</span><strong className="mt-1 block font-medium">{activeStage.nome}</strong></div><div className="border-l border-border/60 pl-3"><span className="text-[10px] uppercase tracking-wide text-muted-foreground">Orçamento</span><strong className="mt-1 block font-medium">{profile.budget}</strong></div><div className="col-span-2 border-t border-border/60 pt-2"><span className="text-[10px] uppercase tracking-wide text-muted-foreground">Interesse</span><strong className="mt-1 block font-medium">{profile.interest}</strong></div></div>
        </div>
        <section aria-label="Linha do tempo"><h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Linha do tempo <span className="rounded-md bg-primary/10 px-1.5 text-primary">{profile.timeline.length}</span></h3><div className="mt-3">{profile.timeline.map((event, index) => <div key={event.id} className="relative flex gap-2.5 pb-4 text-[11px] last:pb-0">{index < profile.timeline.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-2.5 top-6 w-px bg-border" />}<span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">{event.title.includes('WhatsApp') ? <MessageCircle className="h-2.5 w-2.5" /> : <Clock3 className="h-2.5 w-2.5" />}</span><div className="min-w-0"><strong className="block font-medium text-primary">{event.title}</strong><p className="mt-0.5 leading-relaxed text-muted-foreground">{event.detail}</p><time className="mt-1 block text-[10px] text-muted-foreground">{event.occurredAt}</time></div></div>)}</div></section>
        <div><label htmlFor={`assignee-${mobilePanel}`} className="text-[10px] font-semibold uppercase tracking-wide text-muted-strong">Responsável</label><select aria-label="Responsável pela conversa" value={selected.assignee} onChange={event => { const assignee = event.target.value; setConversations(current => current.map(item => item.id === selected.id ? { ...item, assignee } : item)); }} className="mt-1.5 h-8 w-full rounded-lg border border-input bg-card px-2 text-xs">{[...new Set(['Sem responsável', ...demoConversations.map(item => item.assignee)])].map(name => <option key={name}>{name}</option>)}</select></div>
        <div><label className="text-[10px] font-semibold uppercase tracking-wide text-muted-strong">Tags</label><div className="mt-1.5 flex flex-wrap gap-1.5">{profile.tags.map(tag => <Badge key={tag} variant="secondary" className="gap-1 text-[11px]">{tag}<button type="button" aria-label={`Remover tag ${tag}`} onClick={() => setProfiles(current => ({ ...current, [selected.contactId]: { ...profile, tags: profile.tags.filter(value => value !== tag) } }))}><X className="h-3 w-3" /></button></Badge>)}</div><form className="mt-2 flex gap-1" onSubmit={event => { event.preventDefault(); const tag = tagDraft.trim(); if (!tag) return; if (!profile.tags.some(value => value.toLocaleLowerCase() === tag.toLocaleLowerCase())) setProfiles(current => ({ ...current, [selected.contactId]: { ...profile, tags: [...profile.tags, tag] } })); setTagDraft(''); }}><Input aria-label="Nova tag" placeholder="Adicionar tag" maxLength={40} value={tagDraft} onChange={event => setTagDraft(event.target.value)} className="h-7 text-xs" /><Button type="submit" variant="outline" className="h-7 px-2" aria-label="Adicionar tag"><Plus className="h-3 w-3" /></Button></form></div>
        <div><label className="text-[10px] font-semibold uppercase tracking-wide text-muted-strong">Notas internas</label><Textarea aria-label="Nota interna" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Anote algo para a equipe..." className="mt-1.5 min-h-[72px] text-xs" /><Button size="sm" className="mt-1.5 h-8 w-full text-xs" disabled={!note.trim()} onClick={() => {
          if (!note.trim()) return;
          setAddedNotes(current => ({ ...current, [selected.contactId]: [...(current[selected.contactId] ?? []), note.trim()] }));
          setNote('');
        }}>Adicionar nota</Button>{[...profile.notes, ...(addedNotes[selected.contactId] ?? [])].map((item, index) => <div key={index} className="mt-2 break-words whitespace-pre-wrap rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">{item}</div>)}</div>
      </div>
    </aside>
  );

  return (
    <div className="bg-secondary">
      <Dialog open={newOpen} onOpenChange={setNewOpen}><DialogContent><DialogTitle>Nova conversa</DialogTitle><DialogDescription>Crie um contato para testar o atendimento. Nenhuma mensagem será enviada ao WhatsApp.</DialogDescription><form className="space-y-3" onSubmit={event => {
        event.preventDefault(); const phone = newPhone.replace(/\D/g, '');
        if (phone.length < 10 || phone.length > 15) { setFormError('Informe um telefone com DDD (10 a 15 dígitos).'); return; }
        const existing = conversations.find(item => item.phone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '') === phone.replace(/^55(?=\d{10,11}$)/, ''));
        if (existing) { selectConversation(existing.id); setNewOpen(false); return; }
        const id = crypto.randomUUID(); const display = contactDisplay(newName); const stage = availableStages[0];
        setProfiles(current => ({ ...current, [id]: { id, name: display.contactName, phone: newPhone, email: '', stageId: stage.id, stage: stage.nome, interest: 'Não informado', budget: 'Não informado', assignee: 'Sem responsável', tags: [], notes: [], timeline: [{ id: crypto.randomUUID(), title: 'Contato criado', detail: 'Criado no Inbox (demonstração)', occurredAt: 'Agora' }] } }));
        setConversations(current => [{ id, contactId: id, ...display, phone: newPhone, lastMessage: 'Conversa iniciada', lastMessageAt: 'Agora', unreadCount: 0, serviceMode: 'human', status: 'open', assignee: 'Sem responsável' }, ...current]);
        setMessages(current => ({ ...current, [id]: [] })); setSelectedId(id); setQuery(''); setFilters(emptyFilters()); setQuickFilter('all'); setMobilePanel('chat'); setNewOpen(false);
      }}><label className="block text-sm">Nome<Input required maxLength={120} value={newName} onChange={event => setNewName(event.target.value)} /></label><label className="block text-sm">Telefone com DDD<Input required type="tel" value={newPhone} onChange={event => setNewPhone(event.target.value)} /></label>{formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}<Button type="submit" disabled={!newName.trim()}>Criar conversa</Button></form></DialogContent></Dialog>
      <AlertDialog open={deleteId !== null} onOpenChange={open => { if (!open) setDeleteId(null); }}><AlertDialogContent><AlertDialogTitle>Excluir conversa desta demonstração?</AlertDialogTitle><AlertDialogDescription>Isso remove as mensagens desta sessão local. Não exclui nada no WhatsApp nem no cadastro real.</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => { const remaining = conversations.filter(item => item.id !== deleteId); setConversations(remaining); setMessages(current => { const next = { ...current }; delete next[deleteId!]; return next; }); setDrafts(current => { const next = { ...current }; delete next[deleteId!]; return next; }); setSelectedId(remaining[0]?.id ?? ''); setMobilePanel('list'); setDeleteId(null); }}>Excluir</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <Dialog open={editingContact !== null} onOpenChange={open => { if (!open) setEditingContact(null); }}>
        <DialogContent className="max-w-[550px] overflow-hidden rounded-2xl p-0 sm:rounded-2xl">
          <div className="flex items-start gap-3 border-b px-5 py-5"><span className="rounded-xl bg-primary/10 p-3 text-primary"><Pencil className="h-5 w-5" /></span><div><DialogTitle>Editar cliente</DialogTitle><DialogDescription className="mt-1">Atualize como este contato aparece no Inbox.</DialogDescription></div></div>
          <form onSubmit={event => { event.preventDefault(); if (!displayName.trim()) return; const updated = contactDisplay(displayName); setConversations(current => current.map(item => item.contactId === editingContact ? { ...item, ...updated } : item)); setEditingContact(null); }}>
            <div className="grid gap-4 px-5 py-5 sm:grid-cols-2"><label className="text-xs font-semibold">Nome de exibição<Input autoFocus required maxLength={120} value={displayName} onChange={event => setDisplayName(event.target.value)} className="mt-2" /><span className="mt-2 block text-[11px] font-normal leading-relaxed text-muted-foreground">Nome usado pela equipe neste Inbox. No modo demonstração, a alteração dura até recarregar a página.</span></label><label className="text-xs font-semibold">Telefone<Input readOnly value={conversations.find(item => item.contactId === editingContact)?.phone ?? ''} className="mt-2 bg-muted/30" /><span className="mt-2 block text-[11px] font-normal leading-relaxed text-muted-foreground">O número identifica a conversa no WhatsApp e não é alterado aqui.</span></label></div>
            <div className="flex justify-end gap-2 border-t px-5 py-4"><Button type="button" variant="ghost" onClick={() => setEditingContact(null)}>Cancelar</Button><Button type="submit" disabled={!displayName.trim()}>Salvar alterações</Button></div>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={closingConversationId !== null} onOpenChange={open => { if (!open) setClosingConversationId(null); }}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-[450px] rounded-2xl sm:rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Fechar conversa?</AlertDialogTitle>
            <AlertDialogDescription>A conversa fica marcada como Fechada.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setConversations(current => current.map(item => item.id === closingConversationId ? { ...item, status: 'closed', closedBy: 'corretor' } : item));
              setClosingConversationId(null);
            }}>Fechar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <InboxFiltersPanel open={filtersOpen} onOpenChange={setFiltersOpen} value={filters} onChange={setFilters} records={filterRecords} stages={filterStages} count={filtered.length} />
      <div className={cn(
        'hidden h-screen min-h-[570px] gap-2 p-2 lg:grid',
        profileVisible
          ? 'grid-cols-[250px_minmax(0,1fr)_250px] xl:grid-cols-[275px_minmax(0,1fr)_290px] 2xl:grid-cols-[290px_minmax(0,1fr)_310px]'
          : 'grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[275px_minmax(0,1fr)] 2xl:grid-cols-[290px_minmax(0,1fr)]',
      )}>{listPanel}{conversations.length ? chatPanel : <div className="col-span-2 flex items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">Nenhuma conversa. Clique em Nova para começar.</div>}{conversations.length > 0 && profileVisible && profilePanel}</div>
      <div className="h-[calc(100dvh-3.5rem)] min-h-[520px] bg-card pt-14 lg:hidden">
        <div className={cn('h-full [&>section]:h-full', mobilePanel !== 'list' && 'hidden')}>{listPanel}</div>
        <div className={cn('h-full [&>section]:h-full', mobilePanel !== 'chat' && 'hidden')}>{chatPanel}</div>
        <div className={cn('h-full [&>aside]:h-full', mobilePanel !== 'profile' && 'hidden')}>{profilePanel}</div>
      </div>
    </div>
  );
}
