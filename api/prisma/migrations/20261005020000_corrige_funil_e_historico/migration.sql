-- Dois defeitos de produção achados na fase 4 (contrato do módulo 2, §7.2.1 e §7.2.2).

-- 1) Trocar o status do funil de um cliente falhava sempre com 22P02: o gatilho
--    fazia coalesce do enum status_funil com o texto 'Sem etapa', que não é valor
--    do enum. Os rótulos do evento são texto: converte antes do coalesce.
CREATE OR REPLACE FUNCTION public.lotti_inbox_record_legacy_stage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status_funil is not distinct from old.status_funil then return new; end if;
  insert into public.lotti_inbox_events(conversation_id, kind, from_label, to_label, actor_label)
  select cv.id, 'stage', coalesce(old.status_funil::text, 'Sem etapa'), coalesce(new.status_funil::text, 'Sem etapa'), public.lotti_inbox_event_actor()
  from public.lotti_agent_conversations cv
  where cv.cliente_id = new.id and cv.corretor_id = new.corretor_id and cv.archived_at is null;
  return new;
end;
$function$;

-- 2) "Registrar contato" falhava sempre: historico_contatos só tinha leitura para o
--    dono e escrita para service_role. Gravar passa a valer com o MESMO critério da
--    leitura (dono da conta do cliente), para quem grava conseguir ver o que gravou.
CREATE POLICY historico_corretor_insert ON public.historico_contatos
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public.clientes c
    JOIN public.corretores co ON co.id = c.corretor_id
    WHERE c.id = historico_contatos.cliente_id AND co.user_id = (SELECT auth.uid())
  ));
