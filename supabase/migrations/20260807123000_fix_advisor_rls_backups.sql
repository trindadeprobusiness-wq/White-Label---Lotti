-- =====================================================================
-- Migration: Enable RLS on legacy backup/backfill tables
-- 
-- Fixes Supabase Advisor lint "RLS Disabled in Public" for:
-- - public._backup_lancamentos_dup_20260727
-- - public._backfill_comissoes_20260727
-- 
-- Enabling RLS without defining policies results in a default-deny,
-- blocking all access from the PostgREST API. This is the correct
-- security posture for backup/temporary tables.
-- =====================================================================

DO $$ 
BEGIN 
  -- Attempt to enable RLS on _backup_lancamentos_dup_20260727 if it exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_backup_lancamentos_dup_20260727') THEN
    ALTER TABLE public._backup_lancamentos_dup_20260727 ENABLE ROW LEVEL SECURITY;
  END IF;

  -- Attempt to enable RLS on _backfill_comissoes_20260727 if it exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_backfill_comissoes_20260727') THEN
    ALTER TABLE public._backfill_comissoes_20260727 ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
