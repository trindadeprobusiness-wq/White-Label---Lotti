-- Commercial follow-up belongs to the private admin, independently of completion.
ALTER TABLE public.diagnostic_leads
  ADD COLUMN follow_up_status text NOT NULL DEFAULT 'new' CHECK (follow_up_status IN ('new','contacted','meeting','won','lost')),
  ADD COLUMN follow_up_notes text NOT NULL DEFAULT '' CHECK (char_length(follow_up_notes)<=3000),
  ADD COLUMN last_contact_at timestamptz;

CREATE FUNCTION public.diagnostic_admin_follow_up(p_session uuid,p_status text,p_notes text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_lead uuid; v_previous diagnostic_leads%ROWTYPE; v_result jsonb;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' AND NOT public.is_admin() THEN RAISE EXCEPTION 'acesso negado' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('new','contacted','meeting','won','lost') OR p_notes IS NULL OR char_length(p_notes)>3000 THEN
    RAISE EXCEPTION 'acompanhamento inválido' USING ERRCODE='22023';
  END IF;
  SELECT lead_id INTO v_lead FROM diagnostic_sessions WHERE id=p_session;
  IF v_lead IS NULL THEN RAISE EXCEPTION 'contato não encontrado' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_previous FROM diagnostic_leads WHERE id=v_lead FOR UPDATE;
  UPDATE diagnostic_leads SET follow_up_status=p_status,follow_up_notes=btrim(p_notes),updated_at=now(),
    last_contact_at=CASE WHEN p_status IN ('contacted','meeting') AND p_status IS DISTINCT FROM v_previous.follow_up_status THEN now() ELSE last_contact_at END
    WHERE id=v_lead RETURNING to_jsonb(diagnostic_leads) INTO v_result;
  IF p_status IS DISTINCT FROM v_previous.follow_up_status OR btrim(p_notes) IS DISTINCT FROM v_previous.follow_up_notes THEN
    INSERT INTO diagnostic_events(session_id,event_type,metadata)
      VALUES(p_session,'commercial_follow_up_updated',jsonb_build_object('status',p_status,'notes_updated',btrim(p_notes) IS DISTINCT FROM v_previous.follow_up_notes));
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.diagnostic_admin_follow_up(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.diagnostic_admin_follow_up(uuid,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.diagnostic_admin_list(
  _search text DEFAULT NULL, _status text DEFAULT NULL, _temperature text DEFAULT NULL,
  _segment text DEFAULT NULL, _source text DEFAULT NULL, _offset integer DEFAULT 0, _limit integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' AND NOT public.is_admin() THEN RAISE EXCEPTION 'acesso negado' USING ERRCODE='42501'; END IF;
  IF _offset < 0 OR _limit NOT BETWEEN 1 AND 100 OR char_length(coalesce(_search,'')) > 200 THEN
    RAISE EXCEPTION 'filtro inválido' USING ERRCODE='22023';
  END IF;
  WITH base AS (
    SELECT s.id,s.lead_id,
      CASE WHEN s.status <> 'completed' AND s.last_activity_at < now()-interval '10 minutes' THEN 'abandoned' ELSE s.status END AS status,
      s.source,s.utm_source,s.utm_medium,s.utm_campaign,s.utm_content,s.utm_term,s.referrer,
      s.started_at,s.last_activity_at,s.completed_at,s.score,s.temperature,
      CASE WHEN l.id IS NOT NULL THEN jsonb_build_object('id',l.id,'name',l.name,'phone',l.phone,'email',l.email,'company',l.company,'segment',l.segment,'city',l.city,'follow_up_status',l.follow_up_status,'last_contact_at',l.last_contact_at) END AS lead,
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
REVOKE ALL ON FUNCTION public.diagnostic_admin_list(text,text,text,text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.diagnostic_admin_list(text,text,text,text,text,integer,integer) TO authenticated;

-- The Edge backend first verifies current roles against the Railway login API.
GRANT EXECUTE ON FUNCTION public.diagnostic_admin_list(text,text,text,text,text,integer,integer),public.diagnostic_admin_follow_up(uuid,text,text) TO service_role;
CREATE FUNCTION public.diagnostic_admin_detail(p_session uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'acesso negado' USING ERRCODE='42501';
  END IF;
  RETURN (SELECT jsonb_build_object(
    'session',(to_jsonb(s)-'token_hash')||jsonb_build_object('lead',(SELECT to_jsonb(l) FROM diagnostic_leads l WHERE l.id=s.lead_id)),
    'answers',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.position) FROM diagnostic_answers a WHERE a.session_id=s.id),'[]'::jsonb),
    'events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at) FROM (SELECT id,event_type,metadata,created_at FROM diagnostic_events WHERE session_id=s.id ORDER BY created_at DESC LIMIT 200) e),'[]'::jsonb),
    'summary',(SELECT to_jsonb(d)-'ai_payload' FROM diagnostic_summaries d WHERE d.session_id=s.id),
    'notifications',coalesce((SELECT jsonb_agg(jsonb_build_object('id',n.id,'kind',n.kind,'status',n.status,'attempts',n.attempts,'sent_at',n.sent_at,'last_error',n.last_error) ORDER BY n.created_at) FROM diagnostic_notifications n WHERE n.session_id=s.id),'[]'::jsonb)
  ) FROM diagnostic_sessions s WHERE s.id=p_session);
END;
$$;
REVOKE ALL ON FUNCTION public.diagnostic_admin_detail(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.diagnostic_admin_detail(uuid) TO authenticated,service_role;



