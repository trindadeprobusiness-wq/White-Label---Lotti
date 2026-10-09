-- A visão da última mensagem de cada conversa ficou de fora do 0_init (o dump do Supabase não trouxe
-- as visões): GET /api/whatsapp/ultimas-mensagens falhava com 42P01 a cada 3 s desde a virada, e o Inbox
-- ficava sem a prévia da última mensagem e sem os contadores de "atrasando"/"urgente".
-- Igual à do Supabase (supabase/migrations/20260920000100_lotti_history_import.sql:51-55): security_invoker,
-- para valer a RLS de lotti_agent_messages de quem consulta.
create or replace view public.lotti_agent_latest_messages with (security_invoker = true) as
select distinct on (conversation_id) conversation_id, direction, created_at, content
from public.lotti_agent_messages
order by conversation_id, created_at desc, id desc;

revoke all on public.lotti_agent_latest_messages from public, anon;
grant select on public.lotti_agent_latest_messages to authenticated, service_role;
