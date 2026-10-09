-- Conversa nova chega no Inbox com a IA DESLIGADA: a equipe liga a IA conversa por conversa quando quiser.
-- (Pedido do Rafael em 2026-10-09.) A conversa que nasce de mensagem do cliente usa o default da coluna
-- (lotti_agent_resolve_conversation sem p_mode); as que já existem não mudam.
alter table public.lotti_agent_conversations alter column mode set default 'human';
