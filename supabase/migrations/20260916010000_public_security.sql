-- Aplicar ANTES de publicar lead-capture. Sem dados pessoais nos contadores.
BEGIN;
CREATE TABLE IF NOT EXISTS public.public_request_limits (
  scope text NOT NULL,
  subject_hash text NOT NULL,
  hits integer NOT NULL CHECK (hits > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, subject_hash)
);
CREATE INDEX IF NOT EXISTS public_request_limits_expiry ON public.public_request_limits(expires_at);
ALTER TABLE public.public_request_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_request_limits FROM PUBLIC, anon, authenticated;

-- UPDATE condicional sob lock da linha: requisições concorrentes não leem o
-- mesmo contador para depois sobrescrevê-lo. Janela deslizante desde 1º uso.
CREATE OR REPLACE FUNCTION public.consume_public_request_limit(
  _scope text, _subject_hash text, _limit integer, _seconds integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE accepted boolean := false;
BEGIN
  IF _limit < 1 OR _limit > 10000 OR _seconds < 1 OR _seconds > 3600
     OR _scope IS NULL OR length(_scope) > 80 OR _subject_hash IS NULL
     OR length(_subject_hash) > 128 THEN
    RAISE EXCEPTION 'Configuração de limite inválida';
  END IF;
  DELETE FROM public.public_request_limits WHERE expires_at <= clock_timestamp();
  INSERT INTO public.public_request_limits AS limits(scope,subject_hash,hits,expires_at)
    VALUES (_scope,_subject_hash,1,clock_timestamp()+make_interval(secs => _seconds))
  ON CONFLICT(scope,subject_hash) DO UPDATE
    SET hits=limits.hits+1
    WHERE limits.hits < _limit
  RETURNING true INTO accepted;
  RETURN coalesce(accepted,false);
END $$;
REVOKE ALL ON FUNCTION public.consume_public_request_limit(text,text,integer,integer) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.consume_public_lead_limit(_subject_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _subject_hash IS NULL OR _subject_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Identificador inválido'; END IF;
  IF NOT public.consume_public_request_limit('lead-global','global',300,60) THEN RETURN false; END IF;
  RETURN public.consume_public_request_limit('lead-phone',_subject_hash,5,600);
END $$;
REVOKE ALL ON FUNCTION public.consume_public_lead_limit(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_public_lead_limit(text) TO service_role;

-- A landing escreve direto via Data API. O guard protege também chamadas
-- fora do React. O lookup definer permite verificar atividade sem abrir SELECT
-- anônimo da tabela fachadas, que contém dados internos.
CREATE OR REPLACE FUNCTION public.public_fachada_active(_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(SELECT 1 FROM public.fachadas WHERE id=_id AND ativo=true);
$$;
REVOKE ALL ON FUNCTION public.public_fachada_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_fachada_active(uuid) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.guard_public_fachada_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE phone text;
BEGIN
  IF NOT public.public_fachada_active(NEW.fachada_id) THEN RAISE EXCEPTION 'Fachada indisponível'; END IF;
  IF TG_TABLE_NAME = 'fachada_leads' THEN
    IF NEW.nome IS NULL OR length(trim(NEW.nome)) NOT BETWEEN 2 AND 120
       OR NEW.telefone IS NULL OR length(NEW.telefone)>32
       OR (NEW.email IS NOT NULL AND NEW.email <> '' AND (length(NEW.email)>254 OR NEW.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')) THEN
      RAISE EXCEPTION 'Dados de contato inválidos';
    END IF;
    phone := regexp_replace(NEW.telefone,'[^0-9]','','g');
    IF length(phone) IN (12,13) AND left(phone,2)='55' THEN phone := substr(phone,3); END IF;
    IF phone !~ '^[1-9][0-9]{9,10}$' THEN RAISE EXCEPTION 'Telefone inválido'; END IF;
    IF NOT public.consume_public_request_limit('qr-lead-global','global',300,60)
       OR NOT public.consume_public_request_limit('qr-lead-phone',encode(sha256(convert_to(phone,'UTF8')),'hex'),5,600) THEN
      RAISE EXCEPTION 'Muitas tentativas. Aguarde alguns minutos.';
    END IF;
    -- Visitante não pode forjar conversão, vínculo com cliente ou data.
    IF current_setting('role',true) IN ('anon','authenticated') THEN
      NEW.convertido := false;
      NEW.cliente_id := NULL;
      NEW.created_at := clock_timestamp();
    END IF;
    NEW.nome := trim(NEW.nome);
  ELSE
    -- Não aceitar IP/hash declarado pelo visitante como dado confiável.
    NEW.ip_hash := NULL;
    IF length(NEW.user_agent)>500 THEN NEW.user_agent := left(NEW.user_agent,500); END IF;
    NEW.created_at := clock_timestamp();
    IF NOT public.consume_public_request_limit('qr-scan-global','global',1200,60)
       OR NOT public.consume_public_request_limit('qr-scan-fachada',NEW.fachada_id::text,120,60) THEN
      RAISE EXCEPTION 'Muitas tentativas. Aguarde alguns minutos.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_public_fachada_insert() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS guard_public_insert ON public.fachada_leads;
CREATE TRIGGER guard_public_insert BEFORE INSERT ON public.fachada_leads FOR EACH ROW EXECUTE FUNCTION public.guard_public_fachada_insert();
DROP TRIGGER IF EXISTS guard_public_insert ON public.fachada_escaneamentos;
CREATE TRIGGER guard_public_insert BEFORE INSERT ON public.fachada_escaneamentos FOR EACH ROW EXECUTE FUNCTION public.guard_public_fachada_insert();
DROP POLICY IF EXISTS "Publico cria lead" ON public.fachada_leads;
DROP POLICY IF EXISTS "Publico cria lead em fachada ativa" ON public.fachada_leads;
CREATE POLICY "Publico cria lead em fachada ativa" ON public.fachada_leads FOR INSERT TO anon,authenticated WITH CHECK (public.public_fachada_active(fachada_id));
DROP POLICY IF EXISTS "Publico registra escaneamento" ON public.fachada_escaneamentos;
DROP POLICY IF EXISTS "Publico registra escaneamento em fachada ativa" ON public.fachada_escaneamentos;
CREATE POLICY "Publico registra escaneamento em fachada ativa" ON public.fachada_escaneamentos FOR INSERT TO anon,authenticated WITH CHECK (public.public_fachada_active(fachada_id));

-- Mesmo allowlist/teto da Edge Function ai-process-file, inclusive para upload
-- direto na Storage API. Mantém anexos privados e policies por pasta existentes.
UPDATE storage.buckets SET public=false, file_size_limit=52428800,
  allowed_mime_types=ARRAY['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','text/plain','image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm']
WHERE id='ai-attachments';
COMMIT;
