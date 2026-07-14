import { useEffect } from 'react';
import { Plus, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { AIConversation } from '@/types/ai';

interface AIConversationListProps {
  conversations: AIConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onLoad: () => void;
}

export function AIConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
  onLoad,
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
            <button
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={cn(
                'flex items-start gap-2 w-full text-left p-2.5 rounded-lg text-sm transition-colors',
                activeId === conv.id
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-muted text-foreground'
              )}
            >
              <MessageSquare className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium truncate">{conv.title}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(conv.updated_at).toLocaleDateString('pt-BR')}
                </p>
              </div>
            </button>
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
