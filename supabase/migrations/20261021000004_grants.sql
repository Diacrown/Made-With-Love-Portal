-- Explicit API grants.
-- The Supabase project is created with "Automatically expose new tables" OFF, so nothing is reachable
-- through the Data API until it is granted here. RLS (migration 3) still decides which ROWS are visible.
-- Every future migration that adds a table must add its own grants.

grant usage on schema public to authenticated, service_role;

-- Signed-in app users: only the tables the portal needs. No access for anon (internal portal).
grant select, insert, update, delete on
  public.currencies, public.exchange_rates, public.companies, public.offices,
  public.payment_terms, public.ship_via,
  public.customers, public.customer_private, public.customer_contacts,
  public.job_stages, public.job_stage_transitions, public.jobs,
  public.profiles, public.roles, public.permissions, public.role_permissions, public.user_office_roles
to authenticated;

-- counters / counter_values are deliberately NOT granted to authenticated:
-- only private.next_counter() (security definer) touches them.

-- Sync script and server-side jobs (service-role key).
grant select, insert, update, delete on all tables in schema public to service_role;
