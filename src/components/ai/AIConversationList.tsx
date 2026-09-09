import { useEffect, useMemo, useState } from 'react';
import { Plus, MessageSquare, MoreVertical, Pin, PinOff, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import type { AIConversation } from '@/types/ai';

interface AIConversationListProps {
  conversations: AIConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onLoad: () => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
}

/**
 * Formata a data da conversa de forma amigável — hoje/ontem/dia da semana/DD/MM,
 * seguindo o padrão do ChatGPT/Claude que agrupa por proximidade temporal.
 */
function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((startOfToday.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000);

  if (diffDays === 0) {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return date.toLocaleDateString('pt-BR', { weekday: 'short' });
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function AIConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
  onLoad,
  onTogglePin,
  onDelete,
}: AIConversationListProps) {
  const [toDelete, setToDelete] = useState<AIConversation | null>(null);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    onLoad();
  }, [onLoad]);

  // Filtra por busca e separa em Fixadas / Recentes para um layout mais legível.
  const { fixadas, recentes } = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const filtrada = conversations.filter((c) =>
      q ? c.title.toLowerCase().includes(q) : true,
    );
    return {
      fixadas: filtrada.filter((c) => c.pinned),
      recentes: filtrada.filter((c) => !c.pinned),
    };
  }, [conversations, busca]);

  return (
    <div className="flex flex-col h-full bg-sidebar">
      {/* Header — título + botão de nova conversa alinhados */}
      <div className="px-4 pt-5 pb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Conversas</h2>
        <Button
          onClick={onNew}
          size="icon"
          className="h-8 w-8 rounded-full"
          title="Nova conversa"
          aria-label="Nova conversa"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Busca */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar conversas…"
            className="h-9 pl-8 text-sm bg-background"
          />
        </div>
      </div>

      {/* overflow-x-hidden + overflow-y-auto nativos — o ScrollArea da Radix
          usava um viewport que ignorava o max-width do container, fazendo os
          títulos das conversas transbordarem para fora da sidebar. */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="px-2 pb-4 space-y-4 min-w-0">
          {fixadas.length > 0 && (
            <ConversationGroup title="Fixadas">
              {fixadas.map((conv) => (
                <ConversationRow
                  key={conv.id}
                  conv={conv}
                  active={activeId === conv.id}
                  onSelect={onSelect}
                  onTogglePin={onTogglePin}
                  onAskDelete={setToDelete}
                />
              ))}
            </ConversationGroup>
          )}

          {recentes.length > 0 && (
            <ConversationGroup title="Recentes">
              {recentes.map((conv) => (
                <ConversationRow
                  key={conv.id}
                  conv={conv}
                  active={activeId === conv.id}
                  onSelect={onSelect}
                  onTogglePin={onTogglePin}
                  onAskDelete={setToDelete}
                />
              ))}
            </ConversationGroup>
          )}

          {conversations.length === 0 && (
            <div className="px-4 py-12 text-center">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">
                Nenhuma conversa ainda
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Clique no + para começar
              </p>
            </div>
          )}

          {conversations.length > 0 && fixadas.length === 0 && recentes.length === 0 && (
            <p className="px-4 py-8 text-xs text-muted-foreground text-center">
              Nada encontrado para "{busca}"
            </p>
          )}
        </div>
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              A conversa{toDelete?.title ? ` "${toDelete.title}"` : ''} e todas as suas
              mensagens serão removidas permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (toDelete) onDelete(toDelete.id);
                setToDelete(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Cabeçalho de grupo — mesmo tratamento CAPS/muted do painel de filtros do funil. */
function ConversationGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

/** Uma linha de conversa — a data fica à direita, o menu "⋮" aparece no hover. */
function ConversationRow({
  conv,
  active,
  onSelect,
  onTogglePin,
  onAskDelete,
}: {
  conv: AIConversation;
  active: boolean;
  onSelect: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onAskDelete: (c: AIConversation) => void;
}) {
  return (
    <div
      className={cn(
        'group relative flex items-center rounded-lg transition-colors min-w-0 w-full',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
      )}
    >
      <button
        onClick={() => onSelect(conv.id)}
        className="grid grid-cols-[0.875rem_minmax(0,1fr)_auto] items-center gap-2 w-full min-w-0 text-left px-2.5 py-2 text-sm overflow-hidden"
      >
        {conv.pinned ? (
          <Pin className="h-3.5 w-3.5 shrink-0 fill-current" />
        ) : (
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1 min-w-0 truncate font-medium">
          {conv.title || 'Sem título'}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {formatRelativeDate(conv.updated_at)}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Opções da conversa"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100 bg-sidebar/95"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => onTogglePin(conv.id, !conv.pinned)}>
            {conv.pinned ? (
              <>
                <PinOff className="h-4 w-4 mr-2" /> Desafixar
              </>
            ) : (
              <>
                <Pin className="h-4 w-4 mr-2" /> Fixar
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onAskDelete(conv)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" /> Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
