-- Read-only commercial funnel, guarded independently of the client route.
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
REVOKE ALL ON FUNCTION public.diagnostic_admin_list(text,text,text,text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.diagnostic_admin_list(text,text,text,text,text,integer,integer) TO authenticated;

CREATE INDEX diagnostic_sessions_started ON public.diagnostic_sessions(started_at DESC,id DESC);
CREATE INDEX diagnostic_sessions_temperature ON public.diagnostic_sessions(temperature);
CREATE INDEX diagnostic_leads_segment ON public.diagnostic_leads(segment);
