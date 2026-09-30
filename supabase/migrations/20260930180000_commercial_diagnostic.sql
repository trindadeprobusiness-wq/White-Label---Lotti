BEGIN;

GRANT EXECUTE ON FUNCTION public.consume_public_request_limit(text,text,integer,integer) TO service_role;

CREATE TABLE public.commercial_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  phone text NOT NULL CHECK (phone ~ '^55[1-9][0-9]{9,10}$'),
  email text CHECK (email IS NULL OR length(email) <= 254),
  city text CHECK (city IS NULL OR length(city) <= 120),
  company text CHECK (company IS NULL OR length(company) <= 120),
  consent_at timestamptz NOT NULL,
  answers jsonb NOT NULL,
  attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  scores jsonb NOT NULL,
  dominant_problem text NOT NULL,
  secondary_problems text[] NOT NULL DEFAULT '{}',
  urgency_label text NOT NULL,
  profile_label text NOT NULL,
  recommended_next_step text NOT NULL,
  status text NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'em_contato', 'concluido')),
  cta_clicked_at timestamptz
);
CREATE INDEX commercial_diagnostics_created_idx ON public.commercial_diagnostics (created_at DESC);
CREATE INDEX commercial_diagnostics_status_idx ON public.commercial_diagnostics (status, created_at DESC);
ALTER TABLE public.commercial_diagnostics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commercial_diagnostics FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.commercial_diagnostics TO authenticated;
CREATE POLICY commercial_diagnostics_admin_select ON public.commercial_diagnostics FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY commercial_diagnostics_admin_update ON public.commercial_diagnostics FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE public.commercial_diagnostic_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL CHECK (event IN ('diagnostic_started','profile_selected','diagnostic_step_completed','diagnostic_abandoned','diagnostic_completed','qualified_lead','cta_clicked')),
  step text CHECK (step IS NULL OR length(step) <= 40)
);
CREATE INDEX commercial_diagnostic_events_session_idx ON public.commercial_diagnostic_events (session_id, created_at);
CREATE INDEX commercial_diagnostic_events_funnel_idx ON public.commercial_diagnostic_events (event, step, created_at DESC);
ALTER TABLE public.commercial_diagnostic_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commercial_diagnostic_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.commercial_diagnostic_events TO authenticated;
CREATE POLICY commercial_diagnostic_events_admin_select ON public.commercial_diagnostic_events FOR SELECT TO authenticated USING (public.is_admin());

COMMIT;
