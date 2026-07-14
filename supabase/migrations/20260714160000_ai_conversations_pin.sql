-- Fixar conversas do assistente IA (estilo ChatGPT/Claude)
-- Coluna aditiva e retrocompatível: NOT NULL DEFAULT false é operação de metadados
-- no Postgres (não reescreve a tabela). RLS existente (FOR ALL por corretor_id) já
-- cobre UPDATE do pin e DELETE da conversa.

ALTER TABLE public.ai_conversations
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

-- Ordenação eficiente: fixadas primeiro, depois mais recentes, por corretor.
CREATE INDEX IF NOT EXISTS idx_ai_conversations_pinned
  ON public.ai_conversations (corretor_id, pinned DESC, updated_at DESC);
