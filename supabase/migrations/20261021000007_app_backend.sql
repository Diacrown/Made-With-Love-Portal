-- Backend support for the web app: audit trail, client error log, access lookup, recordable milestones.
-- Every table here gets explicit grants (the project has "expose new tables" switched off).

-- ================================================================ audit trail
create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  table_name text not null,
  row_id     text,
  action     text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  changed    jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_table_idx on public.audit_log (table_name, row_id);

-- TG_ARGV[0] = primary-key column, TG_ARGV[1] = 'mask' to record column names only (personal data).
create function private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_pk    text := tg_argv[0];
  v_mask  boolean := coalesce(tg_argv[1], '') = 'mask';
  v_old   jsonb;
  v_new   jsonb;
  v_diff  jsonb := '{}';
  k       text;
  v_row   jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
    insert into public.audit_log (actor, table_name, row_id, action, changed)
    values ((select auth.uid()), tg_table_name, v_row ->> v_pk, 'DELETE',
            case when v_mask then (select jsonb_object_agg(key, '***') from jsonb_each(v_row)) else v_row end);
    return old;
  elsif tg_op = 'INSERT' then
    v_row := to_jsonb(new);
    insert into public.audit_log (actor, table_name, row_id, action, changed)
    values ((select auth.uid()), tg_table_name, v_row ->> v_pk, 'INSERT',
            case when v_mask then (select jsonb_object_agg(key, '***') from jsonb_each(v_row)) else v_row end);
    return new;
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    for k in select jsonb_object_keys(v_new) loop
      if k <> 'updated_at' and v_new -> k is distinct from v_old -> k then
        v_diff := v_diff || jsonb_build_object(k,
          case when v_mask then jsonb_build_object('changed', true)
               else jsonb_build_object('old', v_old -> k, 'new', v_new -> k) end);
      end if;
    end loop;
    if v_diff <> '{}' then
      insert into public.audit_log (actor, table_name, row_id, action, changed)
      values ((select auth.uid()), tg_table_name, v_new ->> v_pk, 'UPDATE', v_diff);
    end if;
    return new;
  end if;
end $$;

create trigger audit_customers          after insert or update or delete on public.customers
  for each row execute function private.audit('id');
create trigger audit_customer_private   after insert or update or delete on public.customer_private
  for each row execute function private.audit('customer_id', 'mask');
create trigger audit_customer_contacts  after insert or update or delete on public.customer_contacts
  for each row execute function private.audit('id', 'mask');
create trigger audit_jobs               after insert or update or delete on public.jobs
  for each row execute function private.audit('id');
create trigger audit_job_milestones     after insert or update or delete on public.job_milestones
  for each row execute function private.audit('job_id');
create trigger audit_user_office_roles  after insert or update or delete on public.user_office_roles
  for each row execute function private.audit('id');
create trigger audit_profiles           after insert or update or delete on public.profiles
  for each row execute function private.audit('id');
create trigger audit_offices            after insert or update or delete on public.offices
  for each row execute function private.audit('id');
create trigger audit_job_stages         after insert or update or delete on public.job_stages
  for each row execute function private.audit('id');
create trigger audit_job_transitions    after insert or update or delete on public.job_stage_transitions
  for each row execute function private.audit('id');

alter table public.audit_log enable row level security;
create policy audit_log_admin_read on public.audit_log for select to authenticated
  using (private.has_perm(null::smallint, 'admin.manage'));
grant select on public.audit_log to authenticated;
grant select, insert, update, delete on public.audit_log to service_role;

-- ================================================================ client error log
create table public.error_log (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  user_id uuid default auth.uid(),
  route   text,
  code    text,
  message text check (message is null or length(message) <= 1000),
  detail  jsonb
);
create index error_log_at_idx on public.error_log (at desc);

alter table public.error_log enable row level security;
create policy error_log_insert on public.error_log for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy error_log_admin_read on public.error_log for select to authenticated
  using (private.has_perm(null::smallint, 'admin.manage'));
grant select, insert on public.error_log to authenticated;
grant select, insert, update, delete on public.error_log to service_role;

-- ================================================================ who am I / what may I do
-- One row per (role, office, permission) for the signed-in user. UI only: RLS is the real enforcement.
create function public.my_access()
returns table (role_code text, office_id smallint, office_code text, permission_code text)
language sql stable security invoker set search_path = '' as $$
  select r.code, uor.office_id, o.code, p.code
  from public.user_office_roles uor
  join public.profiles pr on pr.id = uor.user_id and pr.is_active
  join public.roles r on r.id = uor.role_id
  left join public.offices o on o.id = uor.office_id
  left join public.role_permissions rp on rp.role_id = r.id
  left join public.permissions p on p.id = rp.permission_id
  where uor.user_id = (select auth.uid());
$$;
revoke execute on function public.my_access() from public, anon;
grant  execute on function public.my_access() to authenticated;

-- ================================================================ milestones people can record
-- These unlock guarded stage moves. When the CAD / quote / PO / QC modules exist they call the same function.
create table public.milestone_types (
  code       text primary key,
  label      text not null,
  stage_code text not null,                                   -- job must be at this stage
  owner_side text not null check (owner_side in ('front', 'back'))
);
insert into public.milestone_types (code, label, stage_code, owner_side) values
  ('cad_accepted',        'Accept the CAD version for customer approval', 'cad_design',      'back'),
  ('customer_approved',   'Record customer approval',                      'customer_review', 'front'),
  ('production_released', 'Issue the PO and release to production',        'approved',        'back'),
  ('qc_passed',           'Record a QC pass',                              'qc_ready',        'back'),
  ('cost_approved',       'Approve the cost against the factory bill',     'ready_to_ship',   'back');

alter table public.milestone_types enable row level security;
create policy milestone_types_read on public.milestone_types for select to authenticated using (true);
create policy milestone_types_admin on public.milestone_types for all to authenticated
  using (private.has_perm(null::smallint, 'admin.manage'))
  with check (private.has_perm(null::smallint, 'admin.manage'));
grant select, insert, update, delete on public.milestone_types to authenticated;
grant select, insert, update, delete on public.milestone_types to service_role;

create function public.record_milestone(p_job bigint, p_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  m public.milestone_types;
  v_stage text;
  ok boolean;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found
     or not (private.has_perm(j.front_office_id, 'job.read') or private.has_perm(j.back_office_id, 'job.read')) then
    raise exception 'Job not found';
  end if;
  select * into m from public.milestone_types where code = p_code;
  if not found then raise exception 'Unknown milestone %', p_code; end if;

  select code into v_stage from public.job_stages where id = j.stage_id;
  if v_stage <> m.stage_code then
    raise exception 'This can only be recorded while the job is at stage %', m.stage_code;
  end if;

  ok := case m.owner_side
          when 'front' then private.has_perm(j.front_office_id, 'job.update')
          else private.has_perm(j.back_office_id, 'job.update')
        end;
  if not ok then raise exception 'You are not allowed to record this'; end if;

  insert into public.job_milestones (job_id, code, set_by)
  values (j.id, p_code, (select auth.uid()))
  on conflict (job_id, code) do nothing;
end $$;
revoke execute on function public.record_milestone(bigint, text) from public, anon;
grant  execute on function public.record_milestone(bigint, text) to authenticated;

-- ================================================================ names for activity screens
-- profiles (with emails) are private; this exposes only id + name to signed-in staff.
create function public.staff_names(p_ids uuid[])
returns table (id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name from public.profiles p
  where p.id = any (p_ids) and (select auth.uid()) is not null;
$$;
revoke execute on function public.staff_names(uuid[]) from public, anon;
grant  execute on function public.staff_names(uuid[]) to authenticated;
