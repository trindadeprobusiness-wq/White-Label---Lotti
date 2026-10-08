-- Run after deploying both functions and configuring their secrets.
-- Provision diagnostic_worker_url and diagnostic_worker_secret in Supabase Vault.
-- The worker secret must match DIAGNOSTIC_WORKER_SECRET; never commit its value.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$ BEGIN
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name='diagnostic_worker_url') <> 1
    OR (SELECT count(*) FROM vault.decrypted_secrets WHERE name='diagnostic_worker_secret' AND length(decrypted_secret)>=32) <> 1
  THEN RAISE EXCEPTION 'Configure the diagnostic worker URL and secret in Vault first'; END IF;
END $$;

-- Scheduling the same job name updates the existing job instead of duplicating it.
SELECT cron.schedule('diagnostic-notifications-every-minute', '* * * * *', $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='diagnostic_worker_url'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='diagnostic_worker_secret')),
    body := '{"action":"maintenance"}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);
