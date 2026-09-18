-- Fix: admins could not approve scenarios.
--
-- SYMPTOM: clicking 核准 in /admin returned
--   「劇本需要通過審核才能發佈（status=pending 後由管理員核准）。」
-- even for an admin.
--
-- ROOT CAUSE: /api/admin/scenarios/[id]/review verifies the admin with the
-- user's session, then performs the UPDATE with the SERVICE-ROLE client (the
-- hardening rule: sensitive writes go through service role). Under the
-- service role there is no user JWT, so auth.uid() is NULL, public.is_admin()
-- is false, and the publish gate trigger (add_scenario_review.sql) raised —
-- for the one caller that is supposed to publish.
--
-- FIX: the gate treats a service-role write as trusted. That is what the
-- service role means: only server code holding SUPABASE_SERVICE_ROLE_KEY can
-- produce it, and that code verifies the admin itself. A browser can never
-- present the service role, so the original guarantee ("no creator can
-- publish themselves from devtools") is unchanged.
--
-- Run in the Supabase SQL editor. Idempotent.

CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  -- PostgREST exposes the request's JWT claims as a transaction-local GUC;
  -- the service key carries role=service_role. Missing/blank GUC → false.
  SELECT coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.enforce_scenario_publish_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published')
     AND NOT public.is_admin()
     AND NOT public.is_service_role()
  THEN
    RAISE EXCEPTION '劇本需要通過審核才能發佈（status=pending 後由管理員核准）。';
  END IF;
  RETURN NEW;
END $$;

-- The trigger itself is unchanged (BEFORE INSERT OR UPDATE, add_scenario_review.sql);
-- replacing the function body is enough.
