-- Requer 20260826090000_asaas_saas_checkout.sql do site.
BEGIN;
CREATE TABLE public.checkout_payments (
 payment_id text PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES public.checkout_orders(id),
 status text NOT NULL,
 due_date date NOT NULL,
 amount numeric(10,2) NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.checkout_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.checkout_payments FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.checkout_payments TO service_role;

CREATE FUNCTION public.apply_checkout_payment(p_order uuid,p_payment text,p_customer text,p_subscription text,p_status text,p_due date,p_amount numeric,p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.checkout_orders; owner_id uuid; plan_uuid uuid; current_sub public.subscriptions; latest public.checkout_payments; starts timestamptz; ends timestamptz;
BEGIN
 SELECT * INTO o FROM public.checkout_orders WHERE id=p_order FOR UPDATE;
 IF o.id IS NULL OR o.asaas_customer_id IS DISTINCT FROM p_customer
    OR o.asaas_subscription_id IS DISTINCT FROM p_subscription
    OR p_subscription IS NULL OR o.amount IS DISTINCT FROM p_amount OR p_due IS NULL
    OR p_status NOT IN ('CONFIRMED','RECEIVED','OVERDUE','REFUNDED','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','PENDING','DELETED') THEN
  RAISE EXCEPTION 'PAYMENT_MISMATCH';
 END IF;
 IF EXISTS(SELECT 1 FROM public.checkout_payments WHERE payment_id=p_payment AND order_id<>p_order) THEN RAISE EXCEPTION 'PAYMENT_MISMATCH'; END IF;
 SELECT id INTO owner_id FROM public.corretores WHERE user_id=p_user;
 IF owner_id IS NULL THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text||':billing',0));
 SELECT id INTO plan_uuid FROM public.plans WHERE code=o.plan_code AND active;
 IF plan_uuid IS NULL THEN RAISE EXCEPTION 'PLAN_NOT_FOUND'; END IF;
 SELECT * INTO current_sub FROM public.subscriptions WHERE corretor_id=owner_id
 ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF current_sub.external_subscription_id IS NOT NULL AND current_sub.external_subscription_id<>p_subscription
    AND current_sub.status IN ('active','trialing','past_due','read_only') THEN RAISE EXCEPTION 'ANOTHER_SUBSCRIPTION_EXISTS'; END IF;

 -- Estorno integral e exclusão são terminais para o mesmo pagamento.
 IF p_status IN ('CONFIRMED','RECEIVED') AND EXISTS(
   SELECT 1 FROM public.checkout_payments WHERE payment_id=p_payment AND status IN ('REFUNDED','DELETED')
 ) THEN RETURN; END IF;
 INSERT INTO public.checkout_payments(payment_id,order_id,status,due_date,amount)
 VALUES(p_payment,p_order,p_status,p_due,p_amount)
 ON CONFLICT(payment_id) DO UPDATE SET status=excluded.status,due_date=excluded.due_date,amount=excluded.amount,updated_at=now();

 -- Um estorno/atraso antigo não revoga um período posterior já pago.
 SELECT * INTO latest FROM public.checkout_payments WHERE order_id=p_order
 AND status IN ('CONFIRMED','RECEIVED') ORDER BY due_date DESC LIMIT 1;
 starts:=latest.due_date::timestamp AT TIME ZONE 'America/Sao_Paulo';
 ends:=(latest.due_date::timestamp+CASE WHEN o.billing_cycle='annual' THEN interval '1 year' ELSE interval '1 month' END) AT TIME ZONE 'America/Sao_Paulo';
 IF latest.payment_id IS NOT NULL THEN
  IF current_sub.id IS NULL THEN
   INSERT INTO public.subscriptions(corretor_id,plan_id,billing_cycle,status,current_period_start,current_period_end,external_subscription_id)
   VALUES(owner_id,plan_uuid,o.billing_cycle::public.billing_cycle,'active',starts,ends,p_subscription);
  ELSE
   UPDATE public.subscriptions SET plan_id=plan_uuid,billing_cycle=o.billing_cycle::public.billing_cycle,
    status=CASE WHEN ends>now() THEN 'active'::public.subscription_status ELSE 'past_due'::public.subscription_status END,
    current_period_start=starts,current_period_end=ends,trial_started_at=NULL,trial_ends_at=NULL,
    external_subscription_id=p_subscription WHERE id=current_sub.id;
  END IF;
 ELSE
  UPDATE public.subscriptions SET status='read_only' WHERE id=current_sub.id AND external_subscription_id=p_subscription;
 END IF;
 UPDATE public.checkout_orders SET provisioned_user_id=p_user,
  status=CASE WHEN ends>now() THEN 'active' WHEN p_status='OVERDUE' THEN 'overdue' ELSE 'refunded' END,
  failure_code=NULL WHERE id=p_order;
END $$;
REVOKE ALL ON FUNCTION public.apply_checkout_payment(uuid,text,text,text,text,date,numeric,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_checkout_payment(uuid,text,text,text,text,date,numeric,uuid) TO service_role;
COMMIT;
