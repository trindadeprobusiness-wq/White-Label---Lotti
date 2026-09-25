-- Lotti Site — pedidos do checkout SaaS e idempotência do Webhook Asaas.
-- A tabela é exclusivamente server-side: anon/authenticated não recebem acesso.

CREATE TABLE IF NOT EXISTS public.checkout_orders (
  id UUID PRIMARY KEY,
  access_token_hash TEXT NOT NULL UNIQUE,
  payer_name TEXT NOT NULL,
  payer_email TEXT NOT NULL,
  payer_document TEXT NOT NULL,
  payer_phone TEXT NOT NULL,
  plan_code TEXT NOT NULL CHECK (plan_code IN ('essencial', 'profissional', 'imobiliaria')),
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('PIX', 'CREDIT_CARD')),
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'creating' CHECK (
    status IN ('creating', 'awaiting_payment', 'processing', 'active', 'failed', 'overdue', 'refunded')
  ),
  asaas_customer_id TEXT,
  asaas_subscription_id TEXT UNIQUE,
  asaas_payment_id TEXT,
  provisioned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  access_email_sent_at TIMESTAMPTZ,
  provisioning_started_at TIMESTAMPTZ,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.checkout_orders
  ADD COLUMN IF NOT EXISTS provisioning_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS checkout_orders_email_idx
  ON public.checkout_orders (LOWER(payer_email), created_at DESC);
CREATE INDEX IF NOT EXISTS checkout_orders_payment_idx
  ON public.checkout_orders (asaas_payment_id)
  WHERE asaas_payment_id IS NOT NULL;

ALTER TABLE public.checkout_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkout_orders FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.checkout_orders TO service_role;

CREATE TABLE IF NOT EXISTS public.asaas_checkout_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (
    status IN ('received', 'processing', 'processed', 'ignored', 'failed')
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error_code TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.asaas_checkout_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.asaas_checkout_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.asaas_checkout_events TO service_role;

CREATE OR REPLACE FUNCTION public.checkout_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checkout_orders_updated_at ON public.checkout_orders;
CREATE TRIGGER checkout_orders_updated_at
BEFORE UPDATE ON public.checkout_orders
FOR EACH ROW EXECUTE FUNCTION public.checkout_set_updated_at();

DROP TRIGGER IF EXISTS asaas_checkout_events_updated_at ON public.asaas_checkout_events;
CREATE TRIGGER asaas_checkout_events_updated_at
BEFORE UPDATE ON public.asaas_checkout_events
FOR EACH ROW EXECUTE FUNCTION public.checkout_set_updated_at();

CREATE OR REPLACE FUNCTION public.claim_asaas_checkout_event(
  p_event_id TEXT,
  p_event_type TEXT,
  p_payment_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed BOOLEAN := FALSE;
BEGIN
  INSERT INTO public.asaas_checkout_events (id, event_type, payment_id)
  VALUES (p_event_id, p_event_type, p_payment_id)
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.asaas_checkout_events
     SET status = 'processing',
         attempts = attempts + 1,
         error_code = NULL
   WHERE id = p_event_id
     AND (
       status IN ('received', 'failed')
       OR (status = 'processing' AND updated_at < NOW() - INTERVAL '5 minutes')
     )
  RETURNING TRUE INTO claimed;

  RETURN COALESCE(claimed, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_checkout_order_provisioning(p_order_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed BOOLEAN := FALSE;
BEGIN
  UPDATE public.checkout_orders
     SET status = 'processing',
         provisioning_started_at = NOW(),
         failure_code = NULL
   WHERE id = p_order_id
     AND access_email_sent_at IS NULL
     AND status <> 'refunded'
     AND (
       provisioning_started_at IS NULL
       OR provisioning_started_at < NOW() - INTERVAL '5 minutes'
     )
  RETURNING TRUE INTO claimed;

  RETURN COALESCE(claimed, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_asaas_checkout_event(
  p_event_id TEXT,
  p_status TEXT,
  p_error_code TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('processed', 'ignored', 'failed') THEN
    RAISE EXCEPTION 'invalid event status';
  END IF;

  UPDATE public.asaas_checkout_events
     SET status = p_status,
         error_code = p_error_code,
         processed_at = CASE WHEN p_status IN ('processed', 'ignored') THEN NOW() ELSE NULL END
   WHERE id = p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.checkout_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_asaas_checkout_event(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_asaas_checkout_event(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_checkout_order_provisioning(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_asaas_checkout_event(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_asaas_checkout_event(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_checkout_order_provisioning(UUID) TO service_role;

COMMENT ON TABLE public.checkout_orders IS
  'Pedidos do checkout SaaS da Lotti. Nunca armazena número do cartão ou CVV.';
COMMENT ON TABLE public.asaas_checkout_events IS
  'Controle durável e sem payload bruto para idempotência do Webhook Asaas.';
