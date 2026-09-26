BEGIN;
CREATE TABLE public.contract_quota_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 corretor_id uuid NOT NULL REFERENCES public.corretores(id),
 period_start date NOT NULL,
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','succeeded','released')),
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz
);
ALTER TABLE public.contract_quota_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_quota_reservations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.contract_quota_reservations TO service_role;

CREATE FUNCTION public.reserve_contract_quota(p_corretor uuid)
RETURNS TABLE(allowed boolean,reservation_id uuid,used integer,quota integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE q record; reservation uuid; pstart date:=date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_corretor::text||':ai_contracts_monthly',0));
 SELECT * INTO q FROM public.checar_cota(p_corretor,'ai_contracts_monthly');
 IF NOT coalesce(q.permitido,false) THEN
  RETURN QUERY SELECT false,NULL::uuid,q.usado,q.limite; RETURN;
 END IF;
 INSERT INTO public.contract_quota_reservations(corretor_id,period_start) VALUES(p_corretor,pstart) RETURNING id INTO reservation;
 INSERT INTO public.usage_counters(corretor_id,feature_key,used_quantity,period_start,period_end)
 VALUES(p_corretor,'ai_contracts_monthly',1,pstart,(pstart+interval '1 month - 1 day')::date)
 ON CONFLICT(corretor_id,feature_key,period_start) DO UPDATE
 SET used_quantity=public.usage_counters.used_quantity+1,updated_at=now();
 RETURN QUERY SELECT true,reservation,q.usado+1,q.limite;
END $$;

CREATE FUNCTION public.finish_contract_quota(p_id uuid,p_success boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.contract_quota_reservations;
BEGIN
 SELECT * INTO r FROM public.contract_quota_reservations WHERE id=p_id FOR UPDATE;
 IF r.id IS NULL OR r.status<>'reserved' THEN RETURN; END IF;
 IF NOT p_success THEN
  UPDATE public.usage_counters SET used_quantity=greatest(0,used_quantity-1),updated_at=now()
  WHERE corretor_id=r.corretor_id AND feature_key='ai_contracts_monthly' AND period_start=r.period_start;
 END IF;
 UPDATE public.contract_quota_reservations SET status=CASE WHEN p_success THEN 'succeeded' ELSE 'released' END,finished_at=now() WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.reserve_contract_quota(uuid),public.finish_contract_quota(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_contract_quota(uuid),public.finish_contract_quota(uuid,boolean) TO service_role;
COMMIT;
