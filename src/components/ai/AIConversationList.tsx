import { useEffect } from 'react';
import { Plus, MessageSquare, MoreVertical, Pin, PinOff, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AIConversation } from '@/types/ai';

interface AIConversationListProps {
  conversations: AIConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onLoad: () => void;
  onPin: (id: string, isPinned: boolean) => void;
  onDelete: (id: string) => void;
}

export function AIConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
  onLoad,
  onPin,
  onDelete,
}: AIConversationListProps) {
  useEffect(() => {
    onLoad();
  }, [onLoad]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <Button onClick={onNew} className="w-full" size="sm">
          <Plus className="h-4 w-4 mr-2" /> Nova conversa
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {conversations.map((conv) => (
            <div key={conv.id} className="relative group">
              <button
                onClick={() => onSelect(conv.id)}
                className={cn(
                  'flex items-start gap-2 w-full text-left p-2.5 pr-8 rounded-lg text-sm transition-colors',
                  activeId === conv.id
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-muted text-foreground'
                )}
              >
                <div className="mt-0.5 shrink-0 relative">
                  <MessageSquare className="h-4 w-4" />
                  {conv.is_pinned && (
                    <Pin className="h-3 w-3 absolute -bottom-1 -right-1 text-primary fill-primary" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate">{conv.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(conv.updated_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
              </button>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className={cn(
                      "absolute top-2 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity",
                      activeId === conv.id && "opacity-100"
                    )}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => onPin(conv.id, !conv.is_pinned)}>
                    {conv.is_pinned ? (
                      <><PinOff className="mr-2 h-4 w-4" /> Desafixar</>
                    ) : (
                      <><Pin className="mr-2 h-4 w-4" /> Fixar</>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => onDelete(conv.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Excluir
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
          {conversations.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              Nenhuma conversa ainda
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
