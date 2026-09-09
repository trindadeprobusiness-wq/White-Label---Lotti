import { FormEvent, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Bot, CheckCheck, ChevronRight, Clock3, Eye, EyeOff,
  Filter, Info, MessageCircle, MoreHorizontal, Paperclip, Plus, Search, Send,
  Sparkles, Timer, Trash2, UserRound, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
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

function Avatar({ initials, active = false }: { initials: string; active?: boolean }) {
  return (
    <span data-avatar-size="compact" className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
      {initials}
      {active && <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-card bg-success" />}
    </span>
  );
}

export function WhatsAppInbox() {
  const [conversations, setConversations] = useState(demoConversations);
  const [messages, setMessages] = useState(demoMessagesByConversation);
  const [selectedId, setSelectedId] = useState(demoConversations[0].id);
  const [query, setQuery] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('list');
  const [profileVisible, setProfileVisible] = useState(true);

  const filtered = useMemo(() => {
    const result = filterConversations(conversations, query);
    return onlyUnread ? result.filter(({ unreadCount }) => unreadCount > 0) : result;
  }, [conversations, onlyUnread, query]);
  const selected = conversations.find(({ id }) => id === selectedId) ?? conversations[0];
  const profile = demoProfilesByContact[selected.contactId];
  const selectedMessages = messages[selected.id] ?? [];

  const selectConversation = (id: string) => {
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
    if (!content) return;
    const outgoing: WhatsAppMessage = {
      id: `demo-${Date.now()}`, direction: 'outgoing', content, sentAt: 'Agora', sender: 'Você', status: 'sent',
    };
    setMessages((current) => ({ ...current, [selected.id]: [...(current[selected.id] ?? []), outgoing] }));
    setConversations((current) => current.map((item) => item.id === selected.id ? { ...item, lastMessage: content, lastMessageAt: 'Agora' } : item));
    setDraft('');
  };

  const listPanel = (
    <section data-panel="conversations" data-density="compact" className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card" aria-label="Lista de conversas">
      <div className="border-b border-border p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Conversas <span className="font-normal text-muted-foreground">· {conversations.length}</span></h2>
          <div className="flex gap-1.5"><Button size="sm" className="h-[30px] gap-1 px-2 text-[11px]"><Plus className="h-3 w-3" /> Nova</Button><Button size="icon" variant="outline" className="h-[30px] w-[30px] text-destructive" aria-label="Excluir conversa"><Trash2 className="h-3 w-3" /></Button></div>
        </div>
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nome, telefone ou mensagem" className="h-8 pl-8 text-[11px]" />
        </label>
        <div className="mt-2 flex items-center gap-2 text-xs">
          <Button size="sm" variant="outline" className="h-[30px] gap-1 px-2 text-[11px]"><Filter className="h-3 w-3" />Filtros <Badge className="ml-0.5 h-4 min-w-4 px-1 text-[9px]">1</Badge></Button>
          <span className="flex-1 text-muted-foreground">{filtered.length} de {conversations.length}</span>
          <button type="button" onClick={() => { setQuery(''); setOnlyUnread(false); }} className="text-destructive hover:underline">Limpar</button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <Button size="sm" className="h-[30px] text-[11px]" variant={!onlyUnread ? 'default' : 'outline'} onClick={() => setOnlyUnread(false)}>Todas</Button>
          <Button size="sm" className="h-[30px]" variant={onlyUnread ? 'default' : 'outline'} onClick={() => setOnlyUnread(true)} aria-label="Aguardando resposta"><Timer className="h-3 w-3" /><span className="sr-only">Aguardando resposta</span></Button>
          <Button size="sm" variant="outline" aria-label="Conversas prioritárias" className="h-[30px] gap-1 text-[11px] text-destructive"><AlertTriangle className="h-3 w-3" /><span>{conversations.filter(({ unreadCount }) => unreadCount > 0).reduce((total, item) => total + item.unreadCount, 0)}</span><span className="sr-only">Conversas prioritárias</span></Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {filtered.map((conversation) => (
          <button key={conversation.id} type="button" onClick={() => selectConversation(conversation.id)}
            className={cn('mb-1 flex min-h-[60px] w-full gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors', selected.id === conversation.id ? 'border-primary/30 bg-primary/5' : 'border-transparent hover:bg-muted/70')}>
            <Avatar initials={conversation.avatar} active={conversation.status === 'open'} />
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
        <Avatar initials={selected.avatar} active />
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{selected.contactName}</h2><p className="truncate text-[11px] text-muted-foreground">{selected.phone} · {selected.assignee}</p></div>
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
      <div className="flex items-center justify-between border-b border-border bg-card/70 px-3 py-1.5 text-[11px]">
        <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-success" />Aberta · {profile.stage}</span>
        <Badge variant="outline" className="font-normal"><Sparkles className="mr-1 h-3 w-3" />Conexão demonstrativa</Badge>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-secondary/60 p-3">
        <div className="mx-auto w-fit rounded-full bg-card px-3 py-1 text-[11px] text-muted-foreground shadow-card">Hoje</div>
        {selectedMessages.map((message) => (
          <div key={message.id} className={cn('flex', message.direction === 'outgoing' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[82%] rounded-xl px-2.5 py-1.5 text-xs shadow-card sm:max-w-[72%]', message.direction === 'outgoing' ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm border border-border bg-card')}>
              <p>{message.content}</p>
              <span className={cn('mt-1 flex items-center justify-end gap-1 text-[10px]', message.direction === 'outgoing' ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{message.sender} · {message.sentAt}{message.direction === 'outgoing' && <CheckCheck className="h-3 w-3" />}</span>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={sendMessage} className="border-t border-border bg-card p-2.5">
        <div className="flex items-end gap-1.5 rounded-xl border border-input bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring/30">
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Anexar"><Paperclip className="h-4 w-4" /></Button>
          <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Digite uma mensagem" rows={1} className="min-h-8 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-[13px] shadow-none focus-visible:ring-0" />
          <Button type="submit" size="icon" className="h-8 w-8" disabled={!draft.trim()} aria-label="Enviar mensagem"><Send className="h-3.5 w-3.5" /></Button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-muted-foreground">Modo demonstração: nenhuma mensagem será enviada ao WhatsApp.</p>
      </form>
    </section>
  );

  const profilePanel = (
    <aside id="whatsapp-contact-profile" data-panel="contact-profile" className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card" aria-label="Perfil do contato">
      <header className="flex min-h-9 items-center justify-between border-b border-border px-2.5"><h2 className="text-[11px] font-bold uppercase tracking-wide">Perfil do contato</h2><Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobilePanel('chat')} aria-label="Fechar perfil"><X className="h-5 w-5" /></Button><MoreHorizontal className="hidden h-3.5 w-3.5 text-muted-foreground lg:block" /></header>
      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-2.5">
        <div className="flex items-center gap-2.5"><Avatar initials={selected.avatar} /><div><h3 className="text-sm font-semibold">{profile.name}</h3><p className="text-[11px] text-muted-foreground">{profile.phone}</p><p className="text-[11px] text-muted-foreground">{profile.email}</p></div></div>
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 text-xs"><div><span className="text-muted-foreground">Etapa</span><strong className="mt-1 block">{profile.stage}</strong></div><div><span className="text-muted-foreground">Orçamento</span><strong className="mt-1 block">{profile.budget}</strong></div><div className="col-span-2 border-t border-border pt-2"><span className="text-muted-foreground">Interesse</span><strong className="mt-1 block">{profile.interest}</strong></div></div>
        <div><label className="text-[10px] font-semibold uppercase tracking-wide text-muted-strong">Linha do tempo</label><div className="mt-2 space-y-2.5">{profile.timeline.map((event) => <div key={event.id} className="flex gap-2 text-[11px]"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">{event.title.includes('WhatsApp') ? <MessageCircle className="h-2.5 w-2.5" /> : <Clock3 className="h-2.5 w-2.5" />}</span><div><strong className="block">{event.title}</strong><p className="text-muted-foreground">{event.detail} · {event.occurredAt}</p></div></div>)}</div></div>
        <div><label className="text-[10px] font-semibold uppercase tracking-wide text-muted-strong">Responsável</label><button className="mt-1.5 flex h-8 w-full items-center justify-between rounded-lg border border-input px-3 text-xs"><span>{profile.assignee}</span><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></button></div>
        <div><label className="text-group uppercase text-muted-strong">Tags</label><div className="mt-2 flex flex-wrap gap-2">{profile.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}<Button variant="outline" size="sm" className="h-6 px-2"><Plus className="h-3 w-3" /></Button></div></div>
        <div><label className="text-[10px] font-semibold uppercase tracking-wide text-muted-strong">Notas internas</label><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Anote algo para a equipe..." className="mt-1.5 min-h-[72px] text-xs" /><Button size="sm" className="mt-1.5 h-8 w-full text-xs" disabled={!note.trim()}>Adicionar nota</Button>{profile.notes.map((item) => <div key={item} className="mt-2 rounded-lg bg-warning-surface p-2.5 text-[11px] text-warning-foreground">{item}</div>)}</div>
      </div>
    </aside>
  );

  return (
    <div className="bg-secondary">
      <div className={cn(
        'hidden h-screen min-h-[570px] gap-2 p-2 lg:grid',
        profileVisible
          ? 'grid-cols-[250px_minmax(0,1fr)_250px] xl:grid-cols-[275px_minmax(0,1fr)_290px] 2xl:grid-cols-[290px_minmax(0,1fr)_310px]'
          : 'grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[275px_minmax(0,1fr)] 2xl:grid-cols-[290px_minmax(0,1fr)]',
      )}>{listPanel}{chatPanel}{profileVisible && profilePanel}</div>
      <div className="h-[calc(100dvh-3.5rem)] min-h-[520px] bg-card pt-14 lg:hidden">
        <div className={cn('h-full', mobilePanel !== 'list' && 'hidden')}>{listPanel}</div>
        <div className={cn('h-full', mobilePanel !== 'chat' && 'hidden')}>{chatPanel}</div>
        <div className={cn('h-full', mobilePanel !== 'profile' && 'hidden')}>{profilePanel}</div>
      </div>
    </div>
  );
}
