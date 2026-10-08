-- Diagnóstico de Crescimento (conversa pública em /diagnostico) no Railway.
--
-- Mesmo DDL das duas migrations do Supabase do commit 204e0e0 (#53), que entraram depois da virada:
--   supabase/migrations/20261007191137_diagnostic_conversational_mvp.sql
--   supabase/migrations/20261007191140_diagnostic_admin.sql
-- Tabelas, checks, índices, funções, policies e grants são os mesmos. Só muda o envelope dos grants:
-- cada papel do Supabase (anon, authenticated, service_role) é conferido antes, como nas outras
-- migrations daqui (a 0_init os cria, mas a migration não depende disso).
--
-- No Railway quem chama as funções de mutação é a conexão da API (dona do banco), no lugar do
-- service_role da Edge Function `diagnostic`; o painel lê como `authenticated` pelo TenantDb, com o
-- mesmo is_admin() das policies. Tabelas separadas dos contatos do CRM e de commercial_diagnostics.

-- O diagnóstico comercial fica separado dos contatos do CRM dos corretores.
-- O visitante anônimo só chega à rota validada da API, nunca a estas tabelas e funções.
CREATE TABLE public.diagnostic_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  phone text, email text, company text, segment text, city text,
  status text NOT NULL DEFAULT 'lead_iniciado' CHECK (status IN ('lead_iniciado','qualificado')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.diagnostic_sessions (
  id uuid PRIMARY KEY, lead_id uuid REFERENCES public.diagnostic_leads(id) ON DELETE SET NULL,
  token_hash text NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','contact_captured','in_progress','completed','abandoned')),
  source text, utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text, referrer text,
  started_at timestamptz NOT NULL DEFAULT now(), last_activity_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  consent_at timestamptz NOT NULL DEFAULT now(), consent_version text NOT NULL DEFAULT 'diagnostic-v1',
  score integer CHECK (score BETWEEN 0 AND 16), temperature text CHECK (temperature IN ('COLD','WARM','HOT')),
  version integer NOT NULL DEFAULT 0
);
CREATE INDEX diagnostic_sessions_activity ON public.diagnostic_sessions(status,last_activity_at);
CREATE INDEX diagnostic_sessions_lead ON public.diagnostic_sessions(lead_id);
CREATE TABLE public.diagnostic_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES public.diagnostic_sessions(id) ON DELETE CASCADE,
  question_id text NOT NULL, question text NOT NULL, answer jsonb NOT NULL,
  position integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id,question_id), CHECK (jsonb_typeof(answer) IN ('string','array'))
);
CREATE TABLE public.diagnostic_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES public.diagnostic_sessions(id) ON DELETE CASCADE,
  event_type text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX diagnostic_events_session ON public.diagnostic_events(session_id,created_at);
CREATE TABLE public.diagnostic_summaries (
  session_id uuid PRIMARY KEY REFERENCES public.diagnostic_sessions(id) ON DELETE CASCADE,
  summary text NOT NULL, primary_bottleneck text NOT NULL, secondary_bottleneck text,
  recommended_next_step text NOT NULL, user_message text NOT NULL, source text NOT NULL CHECK(source IN ('rules','ai')),
  ai_payload jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.diagnostic_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES public.diagnostic_sessions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('started','completed')), payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','dead')),
  attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
  lease_id uuid, lease_until timestamptz, first_attempt_at timestamptz, last_error text, sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(session_id,kind)
);
CREATE INDEX diagnostic_notifications_due ON public.diagnostic_notifications(status,available_at);
CREATE TABLE public.diagnostic_rate_limits (
  scope text NOT NULL, subject_hash text NOT NULL, hits integer NOT NULL, expires_at timestamptz NOT NULL,
  PRIMARY KEY(scope,subject_hash)
);
CREATE TABLE public.diagnostic_ai_usage (
  session_id uuid PRIMARY KEY REFERENCES public.diagnostic_sessions(id) ON DELETE CASCADE,
  reserved_at timestamptz NOT NULL DEFAULT now(), budget_day date NOT NULL
);
CREATE TABLE public.diagnostic_ai_budgets (budget_day date PRIMARY KEY, calls integer NOT NULL DEFAULT 0);

-- RLS em todas; anon não lê nem escreve; authenticated só lê, e só com is_admin() (o painel).
DO $$
DECLARE
  t text;
  tem_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  tem_authenticated boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
  tem_service_role boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role');
BEGIN
  FOREACH t IN ARRAY ARRAY['diagnostic_leads','diagnostic_sessions','diagnostic_answers','diagnostic_events','diagnostic_summaries','diagnostic_notifications','diagnostic_rate_limits','diagnostic_ai_usage','diagnostic_ai_budgets'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    IF tem_anon THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon',t); END IF;
    IF tem_authenticated THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated',t); END IF;
    IF tem_service_role THEN EXECUTE format('GRANT ALL ON public.%I TO service_role',t); END IF;
    IF tem_authenticated AND t NOT IN ('diagnostic_rate_limits','diagnostic_ai_usage','diagnostic_ai_budgets') THEN
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
      EXECUTE format('CREATE POLICY diagnostic_admin_read ON public.%I FOR SELECT TO authenticated USING (public.is_admin())',t);
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION public.diagnostic_snapshot(p_session uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'session',to_jsonb(s)-'token_hash',
    'answers',coalesce((SELECT jsonb_object_agg(a.question_id,a.answer) FROM diagnostic_answers a WHERE a.session_id=s.id),'{}'::jsonb),
    'summary',(SELECT to_jsonb(d) FROM diagnostic_summaries d WHERE d.session_id=s.id),
    'lead',(SELECT to_jsonb(l) FROM diagnostic_leads l WHERE l.id=s.lead_id),
    'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('event_type',e.event_type)),'[]'::jsonb) FROM diagnostic_events e WHERE e.session_id=s.id)
  ) FROM diagnostic_sessions s WHERE s.id=p_session;
$$;

CREATE FUNCTION public.diagnostic_mutate(p_session uuid,p_token_hash text,p_action text,p_version integer DEFAULT NULL,p_payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s diagnostic_sessions%ROWTYPE; v_lead uuid; v_contact boolean; v_new_contact boolean; v_summary jsonb; v_tracking jsonb;
BEGIN
  IF p_token_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_session'; END IF;
  IF p_action='start' THEN
    IF p_payload->>'consent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'consent_required'; END IF;
    v_tracking:=coalesce(p_payload->'tracking','{}');
    INSERT INTO diagnostic_sessions(id,token_hash,source,utm_source,utm_medium,utm_campaign,utm_content,utm_term,referrer)
    VALUES(p_session,p_token_hash,v_tracking->>'source',v_tracking->>'utm_source',v_tracking->>'utm_medium',v_tracking->>'utm_campaign',v_tracking->>'utm_content',v_tracking->>'utm_term',v_tracking->>'referrer')
    ON CONFLICT(id) DO NOTHING;
    IF FOUND THEN INSERT INTO diagnostic_events(session_id,event_type) VALUES(p_session,'diagnostic_started'); END IF;
  END IF;
  SELECT * INTO s FROM diagnostic_sessions WHERE id=p_session FOR UPDATE;
  IF NOT FOUND OR s.token_hash<>p_token_hash THEN RAISE EXCEPTION 'invalid_session'; END IF;
  IF p_action IN ('start','read') THEN RETURN diagnostic_snapshot(p_session); END IF;
  IF p_action='resume' THEN
    UPDATE diagnostic_sessions SET last_activity_at=now(),status=CASE WHEN status='abandoned' THEN CASE WHEN lead_id IS NULL THEN 'started' ELSE 'in_progress' END ELSE status END WHERE id=p_session;
    RETURN diagnostic_snapshot(p_session);
  END IF;
  IF p_action='cta' THEN
    IF s.status<>'completed' THEN RAISE EXCEPTION 'not_completed'; END IF;
    -- One conversion per session makes browser retries harmless.
    IF NOT EXISTS(SELECT 1 FROM diagnostic_events WHERE session_id=p_session AND event_type='cta_clicked') THEN
      INSERT INTO diagnostic_events(session_id,event_type,metadata) VALUES(p_session,'cta_clicked',jsonb_build_object('target','conversation'));
    END IF;
    RETURN diagnostic_snapshot(p_session);
  END IF;
  IF p_action='complete' AND s.status='completed' THEN RETURN diagnostic_snapshot(p_session); END IF;
  IF s.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'version_conflict'; END IF;
  IF s.status='completed' THEN RAISE EXCEPTION 'session_completed'; END IF;
  IF p_action='answer' THEN
    IF jsonb_typeof(p_payload->'answers')<>'array' OR jsonb_array_length(p_payload->'answers')>40 THEN RAISE EXCEPTION 'invalid_answers'; END IF;
    DELETE FROM diagnostic_answers WHERE session_id=p_session AND question_id NOT IN (SELECT value->>'question_id' FROM jsonb_array_elements(p_payload->'answers'));
    INSERT INTO diagnostic_answers(session_id,question_id,question,answer,position)
    SELECT p_session,value->>'question_id',value->>'question',value->'answer',(ordinality-1)::int
    FROM jsonb_array_elements(p_payload->'answers') WITH ORDINALITY
    ON CONFLICT(session_id,question_id) DO UPDATE SET answer=excluded.answer,question=excluded.question,position=excluded.position,updated_at=now();
    v_contact:=coalesce((p_payload->>'recoverable')::boolean,false); v_new_contact:=s.lead_id IS NULL AND v_contact;
    v_lead:=s.lead_id;
    IF v_new_contact THEN
      INSERT INTO diagnostic_leads(name,phone,email,company,segment,city)
      VALUES(p_payload->'lead'->>'name',p_payload->'lead'->>'phone',p_payload->'lead'->>'email',p_payload->'lead'->>'company',p_payload->'lead'->>'segment',p_payload->'lead'->>'city') RETURNING id INTO v_lead;
    ELSIF v_lead IS NOT NULL THEN
      UPDATE diagnostic_leads SET name=coalesce(p_payload->'lead'->>'name',name),phone=coalesce(p_payload->'lead'->>'phone',phone),email=coalesce(p_payload->'lead'->>'email',email),company=coalesce(p_payload->'lead'->>'company',company),segment=coalesce(p_payload->'lead'->>'segment',segment),city=coalesce(p_payload->'lead'->>'city',city),updated_at=now() WHERE id=v_lead;
    END IF;
    UPDATE diagnostic_sessions SET lead_id=v_lead,last_activity_at=now(),version=version+1,score=(p_payload->>'score')::int,temperature=p_payload->>'temperature',status=CASE WHEN v_new_contact THEN 'contact_captured' WHEN v_lead IS NOT NULL THEN 'in_progress' ELSE 'started' END WHERE id=p_session;
    INSERT INTO diagnostic_events(session_id,event_type,metadata) VALUES(p_session,'question_answered',jsonb_build_object('question_id',p_payload->>'question_id','edited',coalesce((p_payload->>'edited')::boolean,false)));
    IF p_payload->>'question_id'='name' THEN INSERT INTO diagnostic_events(session_id,event_type) VALUES(p_session,'name_submitted'); END IF;
    IF p_payload->>'question_id'='contact' THEN INSERT INTO diagnostic_events(session_id,event_type) VALUES(p_session,'contact_submitted'); END IF;
    IF v_new_contact THEN
      INSERT INTO diagnostic_notifications(session_id,kind,payload) VALUES(p_session,'started',diagnostic_snapshot(p_session)) ON CONFLICT DO NOTHING;
    END IF;
  ELSIF p_action='complete' THEN
    IF s.lead_id IS NULL THEN RAISE EXCEPTION 'contact_required'; END IF;
    v_summary:=p_payload->'summary';
    INSERT INTO diagnostic_summaries(session_id,summary,primary_bottleneck,secondary_bottleneck,recommended_next_step,user_message,source,ai_payload)
    VALUES(p_session,v_summary->>'summary',v_summary->>'primary_bottleneck',v_summary->>'secondary_bottleneck',v_summary->>'recommended_next_step',v_summary->>'user_message',v_summary->>'source',p_payload->'ai_payload');
    UPDATE diagnostic_sessions SET status='completed',completed_at=now(),last_activity_at=now(),version=version+1,score=(p_payload->>'score')::int,temperature=p_payload->>'temperature' WHERE id=p_session;
    UPDATE diagnostic_leads SET status='qualificado',updated_at=now() WHERE id=s.lead_id;
    INSERT INTO diagnostic_events(session_id,event_type,metadata) VALUES(p_session,'diagnostic_completed',jsonb_build_object('temperature',p_payload->>'temperature','summary_source',v_summary->>'source'));
    INSERT INTO diagnostic_notifications(session_id,kind,payload) VALUES(p_session,'completed',diagnostic_snapshot(p_session)) ON CONFLICT DO NOTHING;
  ELSE RAISE EXCEPTION 'invalid_action'; END IF;
  RETURN diagnostic_snapshot(p_session);
END;
$$;

CREATE FUNCTION public.diagnostic_consume_limit(p_ip_hash text,p_session uuid,p_start boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_hits integer; v_key text; v_scope text; v_max integer; v_allowed boolean:=true;
BEGIN
  IF p_ip_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  FOREACH v_scope IN ARRAY ARRAY['global','ip','session'] LOOP
    v_key:=CASE v_scope WHEN 'global' THEN 'all' WHEN 'ip' THEN p_ip_hash ELSE p_session::text END;
    v_max:=CASE v_scope WHEN 'global' THEN CASE WHEN p_start THEN 500 ELSE 10000 END WHEN 'ip' THEN CASE WHEN p_start THEN 20 ELSE 600 END ELSE CASE WHEN p_start THEN 5 ELSE 120 END END;
    INSERT INTO diagnostic_rate_limits(scope,subject_hash,hits,expires_at) VALUES(v_scope||CASE WHEN p_start THEN '-start' ELSE '-request' END,v_key,1,now()+interval '1 hour')
    ON CONFLICT(scope,subject_hash) DO UPDATE SET hits=CASE WHEN diagnostic_rate_limits.expires_at<=now() THEN 1 ELSE diagnostic_rate_limits.hits+1 END,expires_at=CASE WHEN diagnostic_rate_limits.expires_at<=now() THEN now()+interval '1 hour' ELSE diagnostic_rate_limits.expires_at END RETURNING hits INTO v_hits;
    IF v_hits>v_max THEN v_allowed:=false; END IF;
  END LOOP;
  RETURN v_allowed;
END;
$$;

CREATE FUNCTION public.diagnostic_reserve_ai(p_session uuid,p_daily_limit integer DEFAULT 100) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_day date:=(now() AT TIME ZONE 'UTC')::date; v_calls integer;
BEGIN
  IF p_daily_limit<1 OR p_daily_limit>1000 THEN RETURN false; END IF;
  INSERT INTO diagnostic_ai_budgets(budget_day) VALUES(v_day) ON CONFLICT DO NOTHING;
  SELECT calls INTO v_calls FROM diagnostic_ai_budgets WHERE budget_day=v_day FOR UPDATE;
  IF v_calls>=p_daily_limit OR EXISTS(SELECT 1 FROM diagnostic_ai_usage WHERE session_id=p_session) THEN RETURN false; END IF;
  INSERT INTO diagnostic_ai_usage(session_id,budget_day) VALUES(p_session,v_day) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE diagnostic_ai_budgets SET calls=calls+1 WHERE budget_day=v_day;
  RETURN true;
END;
$$;

CREATE FUNCTION public.diagnostic_claim_notifications(p_session uuid DEFAULT NULL,p_limit integer DEFAULT 10) RETURNS SETOF public.diagnostic_notifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE diagnostic_notifications SET status='dead',last_error='retry_window_expired' WHERE status IN ('failed','sending') AND first_attempt_at<now()-interval '23 hours';
  RETURN QUERY WITH candidates AS (
    SELECT id FROM diagnostic_notifications WHERE (p_session IS NULL OR session_id=p_session)
      AND attempts<8 AND available_at<=now() AND (status IN ('pending','failed') OR (status='sending' AND lease_until<now()))
    ORDER BY created_at LIMIT greatest(1,least(p_limit,20)) FOR UPDATE SKIP LOCKED
  ) UPDATE diagnostic_notifications n SET status='sending',attempts=n.attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',first_attempt_at=coalesce(n.first_attempt_at,now())
    FROM candidates c WHERE n.id=c.id RETURNING n.*;
END;
$$;
CREATE FUNCTION public.diagnostic_finish_notification(p_id uuid,p_lease uuid,p_success boolean,p_error text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE diagnostic_notifications SET status=CASE WHEN p_success THEN 'sent' WHEN attempts>=8 THEN 'dead' ELSE 'failed' END,
    sent_at=CASE WHEN p_success THEN now() ELSE NULL END,last_error=left(p_error,100),lease_until=NULL,
    available_at=now()+make_interval(secs=>least(3600,30*power(2,attempts)::int))
  WHERE id=p_id AND lease_id=p_lease AND status='sending';
  RETURN FOUND;
END;
$$;
CREATE FUNCTION public.diagnostic_maintenance() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE affected integer;
BEGIN
  WITH abandoned AS (
    UPDATE diagnostic_sessions SET status='abandoned' WHERE status IN ('started','contact_captured','in_progress') AND last_activity_at<now()-interval '24 hours' RETURNING id
  ) INSERT INTO diagnostic_events(session_id,event_type) SELECT id,'diagnostic_abandoned' FROM abandoned;
  GET DIAGNOSTICS affected=ROW_COUNT;
  DELETE FROM diagnostic_rate_limits WHERE expires_at<now()-interval '24 hours';
  RETURN affected;
END;
$$;

-- Só a credencial de servidor executa as funções (no Railway, a conexão da API, dona delas).
-- is_admin() protege a leitura do painel.
DO $$
DECLARE
  funcoes constant text := 'public.diagnostic_snapshot(uuid),public.diagnostic_mutate(uuid,text,text,integer,jsonb),public.diagnostic_consume_limit(text,uuid,boolean),public.diagnostic_reserve_ai(uuid,integer),public.diagnostic_claim_notifications(uuid,integer),public.diagnostic_finish_notification(uuid,uuid,boolean,text),public.diagnostic_maintenance()';
  papel text;
BEGIN
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', funcoes);
  FOREACH papel IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', funcoes, papel);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', funcoes);
  END IF;
END $$;

-- Funil comercial só de leitura, protegido independentemente da rota do cliente.
CREATE FUNCTION public.diagnostic_admin_list(
  _search text DEFAULT NULL, _status text DEFAULT NULL, _temperature text DEFAULT NULL,
  _segment text DEFAULT NULL, _source text DEFAULT NULL, _offset integer DEFAULT 0, _limit integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'acesso negado' USING ERRCODE='42501'; END IF;
  IF _offset < 0 OR _limit NOT BETWEEN 1 AND 100 OR char_length(coalesce(_search,'')) > 200 THEN
    RAISE EXCEPTION 'filtro inválido' USING ERRCODE='22023';
  END IF;
  WITH base AS (
    SELECT s.id,s.lead_id,
      CASE WHEN s.status <> 'completed' AND s.last_activity_at < now()-interval '24 hours' THEN 'abandoned' ELSE s.status END AS status,
      s.source,s.utm_source,s.utm_medium,s.utm_campaign,s.utm_content,s.utm_term,s.referrer,
      s.started_at,s.last_activity_at,s.completed_at,s.score,s.temperature,
      CASE WHEN l.id IS NOT NULL THEN jsonb_build_object('id',l.id,'name',l.name,'phone',l.phone,'email',l.email,'company',l.company,'segment',l.segment,'city',l.city) END AS lead,
      coalesce(nullif(s.utm_source,''),nullif(s.source,''),'direct') AS source_group,
      l.segment,concat_ws(' ',l.name,l.company,l.phone,l.email) AS searchable
    FROM diagnostic_sessions s LEFT JOIN diagnostic_leads l ON l.id=s.lead_id
  ), filtered AS (
    SELECT * FROM base WHERE
      (_search IS NULL OR position(lower(_search) IN lower(searchable)) > 0) AND
      (_status IS NULL OR status=_status) AND
      (_temperature IS NULL OR temperature=_temperature) AND
      (_segment IS NULL OR segment=_segment) AND
      (_source IS NULL OR position(lower(_source) IN lower(source_group)) > 0)
  ), page AS (
    SELECT * FROM filtered ORDER BY started_at DESC,id DESC LIMIT _limit OFFSET _offset
  ), metrics AS (
    SELECT count(*) AS started,count(*) FILTER(WHERE lead_id IS NOT NULL) AS contacts,
      count(*) FILTER(WHERE status='completed') AS completed,count(*) FILTER(WHERE status='abandoned') AS abandoned,
      count(*) FILTER(WHERE temperature='HOT') AS hot,count(*) FILTER(WHERE temperature='WARM') AS warm,
      count(*) FILTER(WHERE temperature='COLD') AS cold,
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM diagnostic_events e WHERE e.session_id=filtered.id AND e.event_type='cta_clicked')) AS cta
    FROM filtered
  ), drops AS (
    SELECT coalesce(a.question_id,'before_name') AS question_id,count(*) AS count FROM filtered f
    LEFT JOIN LATERAL (SELECT question_id FROM diagnostic_answers WHERE session_id=f.id ORDER BY position DESC LIMIT 1) a ON true
    WHERE f.status='abandoned' GROUP BY a.question_id ORDER BY count(*) DESC LIMIT 10
  ), quality AS (
    SELECT source_group AS source,count(*) AS total,count(*) FILTER(WHERE temperature='HOT') AS hot,
      count(*) FILTER(WHERE temperature='WARM') AS warm,count(*) FILTER(WHERE temperature='COLD') AS cold
    FROM filtered GROUP BY source_group ORDER BY count(*) DESC LIMIT 25
  )
  SELECT jsonb_build_object(
    'items',coalesce((SELECT jsonb_agg(to_jsonb(p)-'searchable'-'source_group'-'segment' ORDER BY started_at DESC,id DESC) FROM page p),'[]'::jsonb),
    'total',(SELECT count(*) FROM filtered),
    'metrics',(SELECT to_jsonb(m) FROM metrics m),
    'sources',coalesce((SELECT jsonb_agg(source_group) FROM (SELECT DISTINCT source_group FROM base ORDER BY source_group LIMIT 100) sources),'[]'::jsonb),
    'dropoff',coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM drops d),'[]'::jsonb),
    'source_quality',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM quality q),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;
DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.diagnostic_admin_list(text,text,text,text,text,integer,integer) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.diagnostic_admin_list(text,text,text,text,text,integer,integer) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.diagnostic_admin_list(text,text,text,text,text,integer,integer) TO authenticated;
  END IF;
END $$;

CREATE INDEX diagnostic_sessions_started ON public.diagnostic_sessions(started_at DESC,id DESC);
CREATE INDEX diagnostic_sessions_temperature ON public.diagnostic_sessions(temperature);
CREATE INDEX diagnostic_leads_segment ON public.diagnostic_leads(segment);
