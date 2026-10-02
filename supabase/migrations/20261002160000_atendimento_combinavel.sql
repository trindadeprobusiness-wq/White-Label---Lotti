begin;

-- Os dois motivos para a IA entrar deixam de ser excludentes.
--
-- Era `behavior.attendMode`, um escolha-um-só: ou fora do expediente, ou
-- quando a equipe demora. Na prática o corretor quer os dois — a IA cobre a
-- noite E cobre quando ninguém respondeu em quinze minutos. Ter de abrir mão
-- de um deles não vinha de nenhuma limitação real, só do formato do campo.
--
-- Agora é `behavior.attend`, com dois sinalizadores que SOMAM. Nenhum marcado
-- significa atender sempre, que é como toda conta começa.
--
-- O campo antigo continua aceito e continua sendo lido: conta salva antes
-- desta mudança não pode perder a escolha que já tinha.

create or replace function public.lotti_agent_validate_settings(p jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare v_len int;
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text) > 32768 then raise exception 'invalid_settings'; end if;
  if p->'version' is distinct from '2'::jsonb or jsonb_typeof(p->'active') is distinct from 'boolean' then raise exception 'invalid_settings'; end if;
  if coalesce(p->>'model','') !~ '^[a-z][a-z0-9.-]{2,60}$' then raise exception 'invalid_model'; end if;
  if jsonb_typeof(p->'identity') is distinct from 'object' or jsonb_typeof(p->'behavior') is distinct from 'object' then raise exception 'invalid_settings'; end if;
  v_len := char_length(btrim(coalesce(p#>>'{identity,name}','')));
  if v_len < 1 or v_len > 40 then raise exception 'invalid_identity'; end if;
  if char_length(coalesce(p#>>'{identity,company}','')) > 80 or char_length(coalesce(p#>>'{identity,intro}','')) > 400 then raise exception 'invalid_identity'; end if;
  if char_length(coalesce(p->>'prompt','')) > 3000 then raise exception 'invalid_prompt'; end if;

  -- Aceita o formato novo (dois booleanos) ou o antigo (um modo). Exigir os
  -- dois quebraria quem ainda não salvou depois desta versão; exigir só o
  -- antigo quebraria a tela nova.
  if jsonb_typeof(p#>'{behavior,attend}') = 'object' then
    if jsonb_typeof(p#>'{behavior,attend,outsideHours}') is distinct from 'boolean'
       or jsonb_typeof(p#>'{behavior,attend,afterDelay}') is distinct from 'boolean' then raise exception 'invalid_behavior'; end if;
  elsif coalesce(p#>>'{behavior,attendMode}','') not in ('always','outside_hours','after_delay') then
    raise exception 'invalid_behavior';
  end if;

  if coalesce(p#>>'{behavior,handoff,mode}','') not in ('message','silent') then raise exception 'invalid_behavior'; end if;
  if char_length(coalesce(p#>>'{behavior,handoff,messageInHours}','')) > 500
     or char_length(coalesce(p#>>'{behavior,handoff,messageOutOfHours}','')) > 500 then raise exception 'invalid_behavior'; end if;
  if jsonb_typeof(p#>'{behavior,guards,aggregationSeconds}') is distinct from 'number'
     or (p#>>'{behavior,guards,aggregationSeconds}')::numeric not between 0 and 60 then raise exception 'invalid_behavior'; end if;
  if jsonb_typeof(p#>'{behavior,attendDelayMinutes}') is distinct from 'number'
     or (p#>>'{behavior,attendDelayMinutes}')::numeric not between 1 and 1440 then raise exception 'invalid_behavior'; end if;
end $$;

-- A fila passa a somar os motivos: basta um valer para a IA entrar.
create or replace function public.lotti_agent_pode_atender(p_conversa uuid, p_agora timestamptz default now())
returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  v_owner uuid; v_cfg jsonb; v_minutos int; v_houve_humano boolean;
  v_fora_do_horario boolean; v_espera_equipe boolean;
  v_tz text; v_local timestamp; v_dia jsonb; v_hora time;
  v_dias constant text[] := array['sun','mon','tue','wed','thu','fri','sat'];
begin
  select corretor_id into v_owner from public.lotti_agent_conversations where id = p_conversa;
  if v_owner is null then return false; end if;

  select settings into v_cfg from public.lotti_agent_settings where corretor_id = v_owner;

  -- Formato novo quando existe; senão, converte o antigo.
  if jsonb_typeof(v_cfg #> '{behavior,attend}') = 'object' then
    v_fora_do_horario := coalesce((v_cfg #>> '{behavior,attend,outsideHours}')::boolean, false);
    v_espera_equipe   := coalesce((v_cfg #>> '{behavior,attend,afterDelay}')::boolean, false);
  else
    v_fora_do_horario := coalesce(v_cfg #>> '{behavior,attendMode}', 'always') = 'outside_hours';
    v_espera_equipe   := coalesce(v_cfg #>> '{behavior,attendMode}', 'always') = 'after_delay';
  end if;

  -- Sem restrição marcada, a IA atende tudo.
  if not v_fora_do_horario and not v_espera_equipe then return true; end if;

  -- Fora do expediente da aba Agendamento: um horário por dia, no fuso dali.
  if v_fora_do_horario then
    v_tz    := coalesce(nullif(v_cfg #>> '{schedule,timezone}', ''), 'America/Sao_Paulo');
    v_local := p_agora at time zone v_tz;
    v_dia   := v_cfg #> array['schedule', 'week', v_dias[extract(dow from v_local)::int + 1]];
    if v_dia is null or coalesce((v_dia->>'enabled')::boolean, false) is not true then
      return true; -- dia sem expediente é turno inteiro da IA
    end if;
    v_hora := v_local::time;
    if v_hora < coalesce(nullif(v_dia->>'start', ''), '09:00')::time
       or v_hora >= coalesce(nullif(v_dia->>'end', ''), '18:00')::time then
      return true;
    end if;
  end if;

  -- Equipe calada pelo tempo configurado. Se alguém falou há pouco, a conversa
  -- é dessa pessoa: entrar por cima seria falar junto.
  if v_espera_equipe then
    v_minutos := coalesce((v_cfg #>> '{behavior,attendDelayMinutes}')::int, 5);
    select exists(
      select 1 from public.lotti_agent_messages m
       where m.conversation_id = p_conversa
         and m.sender = 'human'
         and m.created_at >= p_agora - make_interval(mins => v_minutos)
    ) into v_houve_humano;
    if not v_houve_humano then return true; end if;
  end if;

  return false;
end $$;

revoke all on function public.lotti_agent_pode_atender(uuid, timestamptz) from public, anon, authenticated;

notify pgrst,'reload schema';
commit;
