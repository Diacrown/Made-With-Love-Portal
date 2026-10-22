-- Supabase Advisor findings, 22 Oct.
-- 1. Two trigger functions had a mutable search_path: pin it (they only use built-in functions).
-- 2. public.rls_auto_enable() is created by Supabase itself (event trigger that turns RLS on for new tables).
--    It must not be callable through the API: revoke from everyone but the owner. Event triggers do not need EXECUTE.
-- Not changed on purpose:
--  * counters / counter_values have RLS and no policy: only the SECURITY DEFINER functions touch them (INFO, intended).
--  * advance_job, set_job_status, record_milestone, save_cad_version, submit_cad_version, review_cad_version,
--    set_live_pricing_model, staff_names are the portal's API: authenticated may call them, anon may not,
--    and each checks the caller's permission inside.
alter function private.touch_updated_at() set search_path = '';
alter function private.jobs_block_stage_edit() set search_path = '';

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
