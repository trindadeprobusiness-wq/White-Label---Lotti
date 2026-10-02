begin;

-- Registro de envio inutilizável é apagado, e falha certa tem freio próprio.
--
-- ===================== Por que apagar, e não cancelar =====================
--
-- `lotti_agent_prepare` grava a resposta com
-- `on conflict(conversation_id,revision) do update ... where status='prepared'`.
-- Registro em 'cancelled' não casa com esse `where`: o `returning` volta vazio,
-- o runtime lê `if(!prepared.outbox_id) return {cancelled:true}` e desiste SEM
-- chamar `fail`. O lease expira em 2 minutos, `claim` pega de novo, gasta outra
-- chamada de IA, e repete.
--
-- No caminho manual isso tem saída: `lotti_agent_set_mode('ai')` apaga os
-- 'cancelled' da revisão corrente, então religar a IA destrava. No caminho
-- AUTOMÁTICO não tem ninguém para religar — e é lá que o laço é mudo.
-- `lotti_agent_reconciliar_envio` passa a apagar de qualquer forma: depender de
-- um efeito colateral de outra função para não travar é frágil demais para uma
-- função que o corretor aciona por botão.
--
-- ===================== O freio da falha certa =====================
--
-- `p_uncertain=false` apaga o registro e deixa a conversa na IA, para a próxima
-- tentativa acontecer. O limite NÃO pode ser `attempts`: `lotti_agent_ingest`
-- faz `attempts=0` a cada mensagem recebida. Lead sem resposta escreve de novo,
-- zera o contador, e a IA bate na Evolution para sempre, sem nunca escalar e
-- sem nenhum alerta — pior do que o problema que esta migration conserta.
--
-- Por isso `falhas_de_envio`, um contador que só o envio mexe: sobe a cada
-- falha certa, zera quando um envio dá certo (`finish`) e quando uma pessoa
-- religa a IA (`set_mode`). Nenhuma mensagem do lead o reinicia.

alter table public.lotti_agent_conversations
  add column if not exists falhas_de_envio integer not null default 0;

comment on column public.lotti_agent_conversations.falhas_de_envio is
  'Falhas de envio seguidas com causa conhecida. Não é zerado por mensagem '
  'recebida, ao contrário de attempts: serve de freio para a retentativa '
  'automática quando o lead continua escrevendo.';

create or replace function public.lotti_agent_reconciliar_envio(p_id uuid, p_chegou boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cv public.lotti_agent_conversations; ob public.lotti_agent_outbox;
  v_mid uuid; v_total int := 0; v_revisao bigint := 0;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null then raise exception 'not_found'; end if;
  if not exists (select 1 from public.corretores where id = cv.corretor_id and user_id = auth.uid()) then
    raise exception 'forbidden';
  end if;

  for ob in
    select * from public.lotti_agent_outbox
     where conversation_id = p_id and status = 'uncertain'
     order by revision for update
  loop
    v_total := v_total + 1;
    v_revisao := greatest(v_revisao, ob.revision);

    if p_chegou then
      update public.lotti_agent_outbox set status = 'sent' where id = ob.id;

      -- Se o eco do provedor já entrou, veio rotulado como humano: o
      -- `external_id` do nosso registro estava vazio quando a mensagem voltou,
      -- e `ingest` só reconhece o próprio envio por esse campo. Corrigir o
      -- rótulo é melhor do que gravar a mesma frase duas vezes na conversa.
      update public.lotti_agent_messages set sender = 'ai'
       where conversation_id = p_id and direction = 'out' and sender = 'human'
         and content = ob.content and created_at >= ob.created_at;

      if not found then
        insert into public.lotti_agent_messages(conversation_id, external_id, direction, sender, content)
        values (p_id, 'reconciliado:' || ob.id, 'out', 'ai', ob.content)
        on conflict (conversation_id, external_id) do nothing
        returning id into v_mid;

        if v_mid is not null and cv.cliente_id is not null then
          insert into public.historico_contatos(cliente_id, tipo, direcao, conteudo, metadata)
          values (cv.cliente_id, 'WHATSAPP', 'OUT', ob.content,
                  jsonb_build_object('source', 'lotti_agent', 'message_id', v_mid, 'reconciliado', true));
        end if;
      end if;
    else
      -- APAGA. Ver o cabeçalho: marcar 'cancelled' aqui travava a conversa num
      -- laço silencioso, que é pior do que o problema que o botão resolve.
      delete from public.lotti_agent_outbox where id = ob.id;
    end if;
  end loop;

  if v_total = 0 then return jsonb_build_object('reconciliados', 0); end if;

  update public.lotti_agent_conversations set
    last_error = null, lease_token = null, lease_until = null,
    attempts = 0, next_attempt_at = now(),
    -- `greatest` e não `cv.revision`: mensagem que o lead mandou depois do
    -- envio travado continua sem resposta, e não pode ser engolida aqui.
    processed_revision = case when p_chegou then greatest(processed_revision, v_revisao) else processed_revision end
  where id = p_id;

  return jsonb_build_object('reconciliados', v_total, 'chegou', p_chegou);
end $$;

revoke all on function public.lotti_agent_reconciliar_envio(uuid, boolean) from public, anon;
grant execute on function public.lotti_agent_reconciliar_envio(uuid, boolean) to authenticated;

-- Assinatura nova e antiga não podem coexistir: chamada de três argumentos
-- ficaria ambígua entre as duas.
drop function if exists public.lotti_agent_fail(uuid, uuid, text);

create or replace function public.lotti_agent_fail(
  p_id uuid, p_token uuid, p_error text, p_uncertain boolean default true
) returns boolean language plpgsql set search_path='' as $$
declare cv public.lotti_agent_conversations; uncertain_send boolean; v_falhas int; v_motivo text;
begin
  select * into cv from public.lotti_agent_conversations where id=p_id for update;
  if cv.lease_token is distinct from p_token then return false; end if;

  if coalesce(p_uncertain, true) then
    update public.lotti_agent_outbox set status='uncertain'
     where conversation_id=p_id and status='sending';
    uncertain_send := found;
    v_falhas := 0;
    v_motivo := left(p_error,100);
  else
    delete from public.lotti_agent_outbox
     where conversation_id=p_id and status='sending';
    uncertain_send := false;
    v_falhas := cv.falhas_de_envio + 1;
    -- Falha certa não pode deixar na tela um motivo que oferece "A mensagem
    -- chegou / Não chegou": não sobrou registro para reconciliar, e os dois
    -- botões seriam silêncio. A função decide, como a irmã `auto_fail` já faz.
    v_motivo := case when left(p_error,100) in
        ('delivery_uncertain','delivery_failed_or_uncertain','delivery_upstream_error','delivery_commit_failed')
      then 'delivery_rejected' else left(p_error,100) end;
  end if;

  update public.lotti_agent_conversations set
    last_error=v_motivo, lease_until=null, lease_token=null,
    falhas_de_envio=v_falhas,
    next_attempt_at=now()+interval '30 seconds',
    mode=case when uncertain_send or attempts>=3 or v_falhas>=3 then 'human' else mode end
  where id=p_id;

  if (uncertain_send or cv.attempts>=3 or v_falhas>=3)
     and not (select sandbox from public.lotti_agent_channels where id=cv.channel_id) then
    insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem)
    values(cv.corretor_id,cv.cliente_id,'GERAL','Conversa precisa de revisão humana após falha no atendimento',
           jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','alta'),'ia');
  end if;

  return true;
end $$;

revoke all on function public.lotti_agent_fail(uuid,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.lotti_agent_fail(uuid,uuid,text,boolean) to service_role;

-- `finish` e `set_mode` zeram o contador novo: envio que deu certo e pessoa que
-- religa a IA começam de zero.
create or replace function public.lotti_agent_finish(p_id uuid, p_token uuid, p_revision bigint, p_external_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations; ob public.lotti_agent_outbox; mid uuid;
begin
 select * into cv from public.lotti_agent_conversations where id=p_id for update;
 if cv.lease_token is distinct from p_token then return false; end if;
 select * into ob from public.lotti_agent_outbox where conversation_id=p_id and revision=p_revision and status='sending' for update;
 if ob.id is null or nullif(p_external_id,'') is null then return false; end if;
 update public.lotti_agent_outbox set status='sent',external_id=p_external_id where id=ob.id;
 insert into public.lotti_agent_messages(conversation_id,external_id,direction,sender,content) values(p_id,p_external_id,'out','ai',ob.content)
 on conflict(conversation_id,external_id) do update set sender='ai' returning id into mid;
 if cv.cliente_id is not null then
   insert into public.historico_contatos(cliente_id,tipo,direcao,conteudo,metadata) values(cv.cliente_id,'WHATSAPP','OUT',ob.content,jsonb_build_object('source','lotti_agent','message_id',mid));
 end if;
 update public.lotti_agent_conversations set processed_revision=p_revision,lease_token=null,lease_until=null,attempts=0,falhas_de_envio=0,last_error=null,
 mode=case when exists(select 1 from public.lotti_agent_messages where conversation_id=p_id and sender='human' and created_at>=ob.created_at and external_id<>p_external_id) then 'human' else mode end where id=p_id;
 return true;
end $function$;

create or replace function public.lotti_agent_set_mode(p_id uuid, p_mode text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations;
begin
 if p_mode not in ('ai','human','paused') then raise exception 'invalid mode'; end if;
 select * into cv from public.lotti_agent_conversations where id=p_id for update;
 if not exists(select 1 from public.corretores where id=cv.corretor_id and user_id=auth.uid()) then raise exception 'forbidden'; end if;
 if p_mode='ai' and exists(select 1 from public.lotti_agent_outbox where conversation_id=p_id and status in ('sending','uncertain')) then raise exception 'reconcile uncertain delivery first'; end if;
 update public.lotti_agent_conversations set mode=p_mode,
 lease_token=case when exists(select 1 from public.lotti_agent_outbox where conversation_id=p_id and status='sending') then lease_token else null end,
 lease_until=case when exists(select 1 from public.lotti_agent_outbox where conversation_id=p_id and status='sending') then lease_until else null end,
 pausa_ia_ate=case when p_mode='ai' then null else pausa_ia_ate end,
 updated_at=now() where id=p_id;
 update public.lotti_agent_outbox set status='cancelled' where conversation_id=p_id and status='prepared';
 if p_mode='ai' then
   delete from public.lotti_agent_outbox where conversation_id=p_id and status='cancelled' and revision=cv.revision;
   update public.lotti_agent_conversations set attempts=0,falhas_de_envio=0,next_attempt_at=now() where id=p_id;
 end if;
 return true;
end $function$;

-- Registros que já ficaram presos em 'cancelled' pelo botão antigo. Nenhum é
-- utilizável: ou a revisão já foi respondida, ou está esperando resposta e o
-- registro é justamente o que impede.
delete from public.lotti_agent_outbox where status='cancelled';

notify pgrst,'reload schema';
commit;
