-- Back end health check. Read-only: it changes nothing. Paste the whole file into Supabase -> SQL Editor and run.
-- Every row has a status: OK, WARN (look at it) or FAIL (fix before the demo). Rows are sorted worst first.
with
tables as (
  select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
funcs as (
  select p.oid, p.proname, n.nspname, p.prosecdef, p.proconfig, pg_get_function_identity_arguments(p.oid) args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prokind = 'f'
),
checks as (
  -- 1. row level security
  select 'security' grp, 'RLS enabled on every public table' what,
         case when count(*) = 0 then 'OK' else 'FAIL' end status,
         coalesce(string_agg(t.relname, ', '), 'all ' || (select count(*) from tables) || ' tables') detail
  from tables t join pg_class c on c.oid = t.oid where not c.relrowsecurity
  union all
  select 'security', 'No table is open to the anon (signed-out) role',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         coalesce(string_agg(distinct table_name, ', '), 'none')
  from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'PUBLIC')
  union all
  select 'security', 'Every RLS table has at least one policy',
         case when count(*) = 0 then 'OK' else 'WARN' end,
         coalesce(string_agg(t.relname, ', '), 'all have policies')
  from tables t join pg_class c on c.oid = t.oid
  where c.relrowsecurity and t.relname not in ('counters', 'counter_values')   -- those two are deliberately policy-free: only next_counter() touches them
        and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname)
  union all
  select 'security', 'Policies are not wide open (using true) for signed-in users on private tables',
         case when count(*) = 0 then 'OK' else 'WARN' end,
         coalesce(string_agg(tablename || '.' || policyname, ', '), 'none')
  from pg_policies where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
        and (qual = 'true' or with_check = 'true')
  union all
  select 'security', 'customer_private is not readable without a role (policy exists and is not "true")',
         case when exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_private' and qual is not null and qual <> 'true') then 'OK' else 'FAIL' end,
         'front office sees details, back office does not'
  union all
  select 'security', 'SECURITY DEFINER functions pin search_path',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         coalesce(string_agg(nspname || '.' || proname, ', '), 'all pinned')
  from funcs where prosecdef and not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')
  union all
  select 'security', 'Functions in public cannot be run by signed-out users (anon)',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         coalesce(string_agg(proname, ', '), 'none')
  from funcs where nspname = 'public' and has_function_privilege('anon', oid, 'execute')
  union all
  select 'security', 'Secret key not exposed: service_role is not granted to anon/authenticated',
         case when pg_has_role('anon', 'service_role', 'member') or pg_has_role('authenticated', 'service_role', 'member') then 'FAIL' else 'OK' end, ''
  union all
  select 'security', 'Storage bucket job-files exists and is private',
         case when exists (select 1 from storage.buckets where id = 'job-files' and not public) then 'OK'
              when exists (select 1 from storage.buckets where id = 'job-files') then 'FAIL' else 'FAIL' end,
         coalesce((select 'public=' || public || ', limit=' || coalesce(file_size_limit::text, 'none') from storage.buckets where id = 'job-files'), 'bucket missing - migration 9 not applied')
  union all
  select 'security', 'Audit triggers exist on the key tables',
         case when count(distinct event_object_table) >= 12 then 'OK' else 'WARN' end,
         count(distinct event_object_table) || ' tables audited'
  from information_schema.triggers where trigger_schema = 'public' and trigger_name like 'audit\_%'

  -- 2. structure
  union all
  select 'structure', 'Every migration is applied (expect 12)',
         case when (select count(*) from supabase_migrations.schema_migrations) >= 12 then 'OK' else 'FAIL' end,
         (select count(*) || ' applied, latest ' || coalesce(max(version), '-') from supabase_migrations.schema_migrations)
  union all
  select 'structure', 'Foreign keys have an index (speed)',
         case when count(*) = 0 then 'OK' else 'WARN' end,
         coalesce(string_agg(conrelid::regclass || '(' || a.attname || ')', ', '), 'all indexed')
  from pg_constraint con join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
  where con.contype = 'f' and con.connamespace = 'public'::regnamespace and cardinality(con.conkey) = 1
    and not exists (select 1 from pg_index i where i.indrelid = con.conrelid and i.indkey[0] = con.conkey[1])
  union all
  select 'structure', 'Realtime publishes the working tables',
         case when count(*) >= 6 then 'OK' else 'FAIL' end,
         coalesce(string_agg(tablename, ', '), 'none - migration 12 not applied')
  from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename in ('jobs', 'job_stage_history', 'job_milestones', 'cad_versions', 'quotes', 'customers')
  union all
  select 'structure', 'Workflow data present (11 stages, 14+ transitions, 26 status codes)',
         case when (select count(*) from public.job_stages) >= 11 and (select count(*) from public.job_stage_transitions) >= 14 and (select count(*) from public.job_statuses) >= 26 then 'OK' else 'FAIL' end,
         (select count(*) from public.job_stages) || ' stages, ' || (select count(*) from public.job_stage_transitions) || ' transitions, ' || (select count(*) from public.job_statuses) || ' statuses'
  union all
  select 'structure', 'Job counters exist for every office',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         coalesce(string_agg(code, ', '), 'all offices have a job counter')
  from public.offices where job_counter_id is null

  -- 3. data
  union all
  select 'data', 'Sheet sync loaded companies and offices (expect 11 / 12)',
         case when (select count(*) from public.companies) >= 11 and (select count(*) from public.offices) >= 12 then 'OK' else 'FAIL' end,
         (select count(*) from public.companies) || ' companies, ' || (select count(*) from public.offices) || ' offices'
  union all
  select 'data', 'Every office has a currency and a back office (except Diacrown/Diamore, which are back offices)',
         case when count(*) = 0 then 'OK' else 'WARN' end,
         coalesce(string_agg(code, ', '), 'ok')
  from public.offices where currency_code is null or (back_office_id is null and code not in ('DC', 'DM'))
  union all
  select 'data', 'Staff logins created (expect 12)',
         case when (select count(*) from public.profiles) >= 12 then 'OK' else 'WARN' end,
         (select count(*) from public.profiles) || ' profiles'
  union all
  select 'data', 'Every login has a role',
         case when count(*) = 0 then 'OK' else 'WARN' end,
         coalesce(string_agg(p.email, ', '), 'all have a role')
  from public.profiles p where not exists (select 1 from public.user_office_roles u where u.user_id = p.id)
  union all
  select 'data', 'At least one global admin exists',
         case when exists (select 1 from public.user_office_roles u join public.roles r on r.id = u.role_id where r.code = 'admin' and u.office_id is null) then 'OK' else 'FAIL' end, ''
  union all
  select 'data', 'Price data is live',
         case when exists (select 1 from public.pricing_models where is_live) then 'OK' else 'FAIL' end,
         coalesce((select version || ' published ' || published_at::date from public.pricing_models where is_live), 'run npm run sync:pricing')
  union all
  select 'data', 'Demo data loaded (12 customers / 23 jobs) - ignore if you want a clean database',
         case when (select count(*) from public.customers where alias like 'DEMO-%') = 12 then 'OK' else 'WARN' end,
         (select count(*) from public.customers where alias like 'DEMO-%') || ' demo customers'
  union all
  select 'data', 'Demo quotes saved',
         case when (select count(*) from public.quotes where job_id is not null) > 0 then 'OK' else 'WARN' end,
         (select count(*) from public.quotes) || ' quotes'
  union all
  select 'data', 'Customers without private details (orphans)',
         case when count(*) = 0 then 'OK' else 'WARN' end, count(*) || ' customers'
  from public.customers c where not exists (select 1 from public.customer_private p where p.customer_id = c.id)
  union all
  select 'data', 'Jobs whose back office is missing',
         case when count(*) = 0 then 'OK' else 'WARN' end, count(*) || ' jobs'
  from public.jobs where back_office_id is null
  union all
  select 'data', 'No application errors logged in the last 24 hours',
         case when count(*) = 0 then 'OK' else 'WARN' end, count(*) || ' errors (see Admin -> Error log)'
  from public.error_log where at > now() - interval '24 hours'
)
select grp as "group", status, what as "check", detail
from checks
order by case status when 'FAIL' then 0 when 'WARN' then 1 else 2 end, grp, what;
