import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AIConversationList } from './AIConversationList';
import type { AIConversation } from '@/types/ai';

const conversation: AIConversation = {
  id: 'conversation-1',
  title: 'Conversa de contraste',
  pinned: false,
  updated_at: '2026-09-08T12:00:00.000Z',
  created_at: '2026-09-08T12:00:00.000Z',
};

describe('AIConversationList', () => {
  it('usa cores semânticas no hover para manter o título legível no modo escuro', () => {
    const html = renderToStaticMarkup(
      <AIConversationList
        conversations={[conversation]}
        activeId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onLoad={vi.fn()}
        onTogglePin={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(html).toContain('hover:bg-sidebar-accent');
    expect(html).toContain('hover:text-sidebar-accent-foreground');
    expect(html).not.toContain('hover:bg-[#F3F4F3]');
  });
});
