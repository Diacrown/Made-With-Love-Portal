-- Job workflow: stages, allowed moves (who may make them, what must be true first), history.
-- Source: the "How jobs move" flow in the Made With Love Operations prototype.
-- Stage changes go through public.advance_job() only; direct UPDATEs of jobs.stage_id are rejected.

-- ---------------------------------------------------------------- columns
alter table public.job_stages
  add column owner text check (owner in ('front','back','factory','qc'));   -- who normally works the stage (display)

alter table public.job_stage_transitions
  add column owner_side text not null default 'either' check (owner_side in ('front','back','either')),
  add column guard_code text,                         -- a job_milestones code that must exist before the move
  add column clears_milestones text[] not null default '{}',
  add column label text;

-- Facts that unlock moves (CAD accepted, customer approved, ...). Written by the modules that own them
-- (security definer functions or service role), never directly by app users.
create table public.job_milestones (
  job_id  bigint not null references public.jobs (id) on delete cascade,
  code    text   not null,
  set_at  timestamptz not null default now(),
  set_by  uuid,
  primary key (job_id, code)
);

create table public.job_stage_history (
  id            bigint generated always as identity primary key,
  job_id        bigint not null references public.jobs (id) on delete cascade,
  from_stage_id smallint references public.job_stages (id),
  to_stage_id   smallint not null references public.job_stages (id),
  changed_by    uuid,
  changed_at    timestamptz not null default now(),
  note          text
);
create index job_stage_history_job_idx on public.job_stage_history (job_id, changed_at);

-- ---------------------------------------------------------------- stages
insert into public.job_stages (code, name, sort_order, owner) values
  ('intake',          'New',                  10, 'front'),
  ('cad_design',      'CAD',                  20, 'back'),
  ('customer_review', 'Customer approval',    30, 'front'),
  ('approved',        'Ready for production', 40, 'back'),
  ('production',      'In production',        50, 'factory'),
  ('qc_ready',        'QC',                   60, 'qc'),
  ('ready_to_ship',   'Ready to ship',        70, 'back'),
  ('dispatched',      'Dispatched',           80, 'front'),
  ('received',        'Received',             90, 'front'),
  ('local_finishing', 'Local finishing',      95, 'front'),
  ('closed',          'Closed',              100, 'front');

-- ---------------------------------------------------------------- moves
insert into public.job_stage_transitions
  (from_stage_id, to_stage_id, job_type, owner_side, guard_code, clears_milestones, label)
select f.id, t.id, m.job_type::public.job_type, m.side, m.guard, m.clears::text[], m.label
from (values
  -- forward path
  ('intake',          'cad_design',      null,      'either', null,                 '{}',                               'Send CAD request'),
  ('cad_design',      'customer_review', null,      'back',   'cad_accepted',       '{}',                               'Accept CAD for customer approval'),
  ('customer_review', 'approved',        null,      'front',  'customer_approved',  '{}',                               'Record customer approval'),
  ('approved',        'production',      null,      'back',   'production_released','{}',                               'Issue PO and release to production'),
  ('production',      'qc_ready',        null,      'back',   null,                 '{}',                               'Mark ready for QC'),
  ('qc_ready',        'ready_to_ship',   null,      'back',   'qc_passed',          '{}',                               'QC passed'),
  ('ready_to_ship',   'dispatched',      null,      'back',   'cost_approved',      '{}',                               'Dispatch'),
  ('dispatched',      'received',        null,      'front',  null,                 '{}',                               'Confirm receipt'),
  ('received',        'closed',          null,      'front',  null,                 '{}',                               'Invoice issued'),
  ('received',        'local_finishing', null,      'front',  null,                 '{}',                               'Send to local finishing'),
  ('local_finishing', 'closed',          null,      'front',  null,                 '{}',                               'Invoice issued'),
  -- shortcuts and send-backs
  ('intake',          'customer_review', 'catalog', 'back',   null,                 '{}',                               'Use catalog CAD, skip to customer approval'),
  ('customer_review', 'cad_design',      null,      'front',  null,                 '{cad_accepted,customer_approved}', 'Customer wants changes'),
  ('qc_ready',        'production',      null,      'back',   null,                 '{qc_passed}',                      'QC failed, back to production')
) as m(from_code, to_code, job_type, side, guard, clears, label)
join public.job_stages f on f.code = m.from_code
join public.job_stages t on t.code = m.to_code;

-- ---------------------------------------------------------------- defaults and guards
create function private.jobs_default_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.stage_id is null then
    select id into new.stage_id from public.job_stages where code = 'intake';
  end if;
  return new;
end $$;
create trigger jobs_default_stage before insert on public.jobs
  for each row execute function private.jobs_default_stage();

create function private.jobs_log_creation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.job_stage_history (job_id, from_stage_id, to_stage_id, changed_by)
  values (new.id, null, new.stage_id, (select auth.uid()));
  return new;
end $$;
create trigger jobs_log_creation after insert on public.jobs
  for each row execute function private.jobs_log_creation();

create function private.jobs_block_stage_edit() returns trigger
language plpgsql as $$
begin
  if new.stage_id is distinct from old.stage_id
     and coalesce(current_setting('app.advancing', true), '') <> 'on' then
    raise exception 'Stage can only be changed with advance_job()';
  end if;
  return new;
end $$;
create trigger jobs_block_stage_edit before update on public.jobs
  for each row execute function private.jobs_block_stage_edit();

-- ---------------------------------------------------------------- the move
create function public.advance_job(p_job bigint, p_to text, p_note text default null)
returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  j    public.jobs;
  t    public.job_stage_transitions;
  v_to smallint;
  ok   boolean;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found
     or not (private.has_perm(j.front_office_id, 'job.read') or private.has_perm(j.back_office_id, 'job.read')) then
    raise exception 'Job not found';
  end if;

  select id into v_to from public.job_stages where code = p_to and is_active;
  if v_to is null then raise exception 'Unknown stage %', p_to; end if;

  select * into t from public.job_stage_transitions
   where from_stage_id = j.stage_id and to_stage_id = v_to
     and (job_type is null or job_type = j.job_type)
   order by (job_type is null)          -- a job-type specific rule wins over a general one
   limit 1;
  if not found then raise exception 'This job cannot move to % from its current stage', p_to; end if;

  ok := case t.owner_side
          when 'front' then private.has_perm(j.front_office_id, t.required_permission)
          when 'back'  then private.has_perm(j.back_office_id,  t.required_permission)
          else private.has_perm(j.front_office_id, t.required_permission)
            or private.has_perm(j.back_office_id,  t.required_permission)
        end;
  if not ok then raise exception 'You are not allowed to make this move'; end if;

  if t.guard_code is not null and not exists (
       select 1 from public.job_milestones where job_id = j.id and code = t.guard_code) then
    raise exception 'Blocked: % is not recorded for this job', t.guard_code;
  end if;

  perform set_config('app.advancing', 'on', true);
  update public.jobs set stage_id = v_to where id = j.id returning * into j;
  perform set_config('app.advancing', 'off', true);

  if cardinality(t.clears_milestones) > 0 then
    delete from public.job_milestones where job_id = j.id and code = any (t.clears_milestones);
  end if;
  insert into public.job_stage_history (job_id, from_stage_id, to_stage_id, changed_by, note)
  values (j.id, t.from_stage_id, v_to, (select auth.uid()), p_note);
  return j;
end $$;

revoke execute on function public.advance_job(bigint, text, text) from public, anon;
grant  execute on function public.advance_job(bigint, text, text) to authenticated;

-- ---------------------------------------------------------------- access
alter table public.job_milestones    enable row level security;
alter table public.job_stage_history enable row level security;

create policy job_milestones_read on public.job_milestones for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id));
create policy job_stage_history_read on public.job_stage_history for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id));
-- no insert/update/delete policies: only advance_job() and the owning modules write these.

grant select on public.job_milestones, public.job_stage_history to authenticated;
grant select, insert, update, delete on public.job_milestones, public.job_stage_history to service_role;

-- CAD designers and QC specialists do their work in their own modules; they do not move jobs between stages.
delete from public.role_permissions rp
using public.roles r, public.permissions p
where rp.role_id = r.id and rp.permission_id = p.id
  and r.code in ('cad', 'qc') and p.code = 'job.advance_stage';
