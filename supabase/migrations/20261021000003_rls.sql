-- Row Level Security. Default deny: every table has RLS on; no policy = no access.
-- The sync script uses the service-role key, which bypasses RLS.

do $$
declare t text;
begin
  foreach t in array array[
    'currencies','exchange_rates','counters','counter_values','companies','offices',
    'payment_terms','ship_via','customers','customer_private','customer_contacts',
    'job_stages','job_stage_transitions','jobs',
    'profiles','roles','permissions','role_permissions','user_office_roles'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- counters / counter_values: no policies on purpose. Only private.next_counter() (security definer) touches them.

-- ------------------------------------------------ reference data: read = any signed-in user, write = admin
do $$
declare t text;
begin
  foreach t in array array[
    'currencies','exchange_rates','companies','offices','payment_terms','ship_via',
    'job_stages','job_stage_transitions','roles','permissions','role_permissions'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (private.has_perm(null::smallint, ''admin.manage''))
         with check (private.has_perm(null::smallint, ''admin.manage''))',
      t || '_admin', t);
  end loop;
end $$;

-- ------------------------------------------------ users
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.has_perm(null::smallint, 'admin.manage'));
create policy profiles_admin on public.profiles for all to authenticated
  using (private.has_perm(null::smallint, 'admin.manage'))
  with check (private.has_perm(null::smallint, 'admin.manage'));

create policy uor_read on public.user_office_roles for select to authenticated
  using (user_id = (select auth.uid()) or private.has_perm(null::smallint, 'admin.manage'));
create policy uor_admin on public.user_office_roles for all to authenticated
  using (private.has_perm(null::smallint, 'admin.manage'))
  with check (private.has_perm(null::smallint, 'admin.manage'));

-- ------------------------------------------------ customers
-- Back office (Mumbai) sees the non-sensitive rows of offices it serves; front office sees its own.
create policy customers_read on public.customers for select to authenticated
  using (private.has_perm_served(office_id, 'customer.read'));
create policy customers_insert on public.customers for insert to authenticated
  with check (private.has_perm(office_id, 'customer.write'));
create policy customers_update on public.customers for update to authenticated
  using (private.has_perm(office_id, 'customer.write'))
  with check (private.has_perm(office_id, 'customer.write'));
create policy customers_delete on public.customers for delete to authenticated
  using (private.has_perm(null::smallint, 'admin.manage'));

-- PII: owning office only. NOT visible to the serving back office.
create policy cust_private_read on public.customer_private for select to authenticated
  using (private.has_perm(private.customer_office(customer_id), 'customer_private.read'));
create policy cust_private_write on public.customer_private for all to authenticated
  using (private.has_perm(private.customer_office(customer_id), 'customer_private.write'))
  with check (private.has_perm(private.customer_office(customer_id), 'customer_private.write'));

create policy cust_contacts_read on public.customer_contacts for select to authenticated
  using (private.has_perm(private.customer_office(customer_id), 'customer_private.read'));
create policy cust_contacts_write on public.customer_contacts for all to authenticated
  using (private.has_perm(private.customer_office(customer_id), 'customer_private.write'))
  with check (private.has_perm(private.customer_office(customer_id), 'customer_private.write'));

-- ------------------------------------------------ jobs: visible to selling office AND producing office
create policy jobs_read on public.jobs for select to authenticated
  using (private.has_perm(front_office_id, 'job.read')
      or private.has_perm(back_office_id, 'job.read'));
create policy jobs_insert on public.jobs for insert to authenticated
  with check (private.has_perm(front_office_id, 'job.create'));
create policy jobs_update on public.jobs for update to authenticated
  using (private.has_perm(front_office_id, 'job.update')
      or private.has_perm(back_office_id, 'job.update'))
  with check (private.has_perm(front_office_id, 'job.update')
      or private.has_perm(back_office_id, 'job.update'));
create policy jobs_delete on public.jobs for delete to authenticated
  using (private.has_perm(null::smallint, 'admin.manage'));
