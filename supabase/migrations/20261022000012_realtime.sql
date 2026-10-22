-- Live sync: publish changes on the working tables to Supabase Realtime, so open screens refresh when someone
-- else moves a job, reviews a CAD version or saves a quote. Realtime applies the same RLS policies as the API:
-- a subscriber only hears about rows they are allowed to read (customer_private is deliberately not published).
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'No supabase_realtime publication (not a Supabase database) - skipped';
    return;
  end if;
  foreach t in array array['jobs', 'job_stage_history', 'job_milestones', 'cad_versions', 'quotes', 'customers'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
