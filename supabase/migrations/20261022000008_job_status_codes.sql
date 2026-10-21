-- Two-level workflow: the 11 stages stay the big steps; the 26 status codes from the MWL mock (JobStatus sheet)
-- are the detailed status inside a stage. On hold / Cancelled can be set from any stage.
-- A few codes also record the milestone that unlocks the next stage move (APP, QCP, CSO), or clear one (QCF, REJ).

create table public.job_statuses (
  code              text primary key check (code ~ '^[A-Z]{3}$'),
  label             text not null,
  direction         text check (direction in ('to', 'by')),
  party             text,                              -- Backoffice / Office / Customer / Designer / Factory
  stage_code        text references public.job_stages (code),   -- null = any stage
  owner_side        text not null default 'either' check (owner_side in ('front', 'back', 'either')),
  kind              text not null default 'normal' check (kind in ('normal', 'hold', 'cancel')),
  records_milestone text references public.milestone_types (code),
  clears_milestones text[] not null default '{}',
  sort_order        integer not null default 0
);

insert into public.job_statuses (code, label, direction, party, stage_code, owner_side, kind, records_milestone, clears_milestones, sort_order) values
  ('ERB', 'Estimate Requested', 'to', 'Backoffice', 'intake',          'front',  'normal', null,                '{}',                  10),
  ('ESO', 'Estimate Submitted', 'to', 'Office',     'intake',          'back',   'normal', null,                '{}',                  20),
  ('ESC', 'Estimate Submitted', 'to', 'Customer',   'intake',          'front',  'normal', null,                '{}',                  30),
  ('CRB', 'CAD Requested',      'to', 'Backoffice', 'intake',          'front',  'normal', null,                '{}',                  40),
  ('CRD', 'CAD Requested',      'to', 'Designer',   'cad_design',      'back',   'normal', null,                '{}',                  50),
  ('CSD', 'CAD Submitted',      'by', 'Designer',   'cad_design',      'back',   'normal', null,                '{}',                  60),
  ('CSO', 'CAD Submitted',      'to', 'Office',     'cad_design',      'back',   'normal', 'cad_accepted',      '{}',                  70),
  ('RRB', 'Render Requested',   'to', 'Backoffice', 'cad_design',      'front',  'normal', null,                '{}',                  80),
  ('RRD', 'Render Requested',   'to', 'Designer',   'cad_design',      'back',   'normal', null,                '{}',                  90),
  ('RSD', 'Render Submitted',   'by', 'Designer',   'cad_design',      'back',   'normal', null,                '{}',                 100),
  ('RSO', 'Render Submitted',   'to', 'Office',     'cad_design',      'back',   'normal', null,                '{}',                 110),
  ('CSC', 'CAD Submitted',      'to', 'Customer',   'customer_review', 'front',  'normal', null,                '{}',                 120),
  ('RSC', 'Render Submitted',   'to', 'Customer',   'customer_review', 'front',  'normal', null,                '{}',                 130),
  ('APP', 'Order Approved',     'by', 'Customer',   'customer_review', 'front',  'normal', 'customer_approved', '{}',                 140),
  ('REJ', 'Rejected',           'by', 'Customer',   'customer_review', 'front',  'normal', null,                '{customer_approved}', 150),
  ('PRD', 'Production',         'to', 'Factory',    'production',      'back',   'normal', null,                '{}',                 160),
  ('QCR', 'QC Ready',           null, null,         'qc_ready',        'back',   'normal', null,                '{}',                 170),
  ('QCP', 'QC Pass',            null, null,         'qc_ready',        'back',   'normal', 'qc_passed',         '{}',                 180),
  ('QCF', 'QC Fail',            null, null,         'qc_ready',        'back',   'normal', null,                '{qc_passed}',         190),
  ('EXP', 'Exported',           'to', 'Office',     'dispatched',      'back',   'normal', null,                '{}',                 200),
  ('IMP', 'Imported',           'by', 'Office',     'received',        'front',  'normal', null,                '{}',                 210),
  ('DEL', 'Delivered',          'to', 'Customer',   'received',        'front',  'normal', null,                '{}',                 220),
  ('REP', 'Repair',             null, null,         'received',        'front',  'normal', null,                '{}',                 230),
  ('RET', 'Returned',           'to', 'Factory',    'received',        'front',  'normal', null,                '{}',                 240),
  ('ONH', 'On Hold',            null, null,         null,              'either', 'hold',   null,                '{}',                 900),
  ('CAN', 'Cancelled',          null, null,         null,              'front',  'cancel', null,                '{}',                 910);

-- Status a job gets when it arrives in a stage (null = none until someone sets one).
alter table public.job_stages add column default_status_code text references public.job_statuses (code);
update public.job_stages s set default_status_code = d.code
from (values ('cad_design', 'CRD'), ('production', 'PRD'), ('qc_ready', 'QCR'), ('dispatched', 'EXP'), ('received', 'IMP')) as d(stage, code)
where s.code = d.stage;

alter table public.jobs
  add column status_code       text references public.job_statuses (code),
  add column held_from_status  text references public.job_statuses (code);
create index jobs_status_idx on public.jobs (status_code);

alter table public.job_stage_history
  add column from_status text,
  add column to_status   text;

-- ---------------------------------------------------------------- helpers
create function private.side_allows(j public.jobs, p_side text, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_side
    when 'front' then private.has_perm(j.front_office_id, p_perm)
    when 'back'  then private.has_perm(j.back_office_id,  p_perm)
    else private.has_perm(j.front_office_id, p_perm) or private.has_perm(j.back_office_id, p_perm)
  end;
$$;

-- Protect stage AND status: both change only through advance_job() / set_job_status().
create or replace function private.jobs_block_stage_edit() returns trigger
language plpgsql as $$
begin
  if (new.stage_id is distinct from old.stage_id
      or new.status_code is distinct from old.status_code
      or new.held_from_status is distinct from old.held_from_status)
     and coalesce(current_setting('app.advancing', true), '') <> 'on' then
    raise exception 'Stage and status can only be changed with advance_job() / set_job_status()';
  end if;
  return new;
end $$;

-- New jobs start with their stage's default status.
create or replace function private.jobs_default_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.stage_id is null then
    select id into new.stage_id from public.job_stages where code = 'intake';
  end if;
  if new.status_code is null then
    select default_status_code into new.status_code from public.job_stages where id = new.stage_id;
  end if;
  return new;
end $$;

create or replace function private.jobs_log_creation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.job_stage_history (job_id, from_stage_id, to_stage_id, to_status, changed_by)
  values (new.id, null, new.stage_id, new.status_code, (select auth.uid()));
  return new;
end $$;

-- ---------------------------------------------------------------- stage moves (now hold/cancel aware)
create or replace function public.advance_job(p_job bigint, p_to text, p_note text default null)
returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  j        public.jobs;
  t        public.job_stage_transitions;
  v_to     public.job_stages;
  v_kind   text;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found
     or not (private.has_perm(j.front_office_id, 'job.read') or private.has_perm(j.back_office_id, 'job.read')) then
    raise exception 'Job not found';
  end if;

  select kind into v_kind from public.job_statuses where code = j.status_code;
  if v_kind = 'hold'   then raise exception 'This job is on hold. Resume it before moving it.'; end if;
  if v_kind = 'cancel' then raise exception 'This job is cancelled.'; end if;

  select * into v_to from public.job_stages where code = p_to and is_active;
  if not found then raise exception 'Unknown stage %', p_to; end if;

  select * into t from public.job_stage_transitions
   where from_stage_id = j.stage_id and to_stage_id = v_to.id
     and (job_type is null or job_type = j.job_type)
   order by (job_type is null)
   limit 1;
  if not found then raise exception 'This job cannot move to % from its current stage', p_to; end if;

  if not private.side_allows(j, t.owner_side, t.required_permission) then
    raise exception 'You are not allowed to make this move';
  end if;

  if t.guard_code is not null and not exists (
       select 1 from public.job_milestones where job_id = j.id and code = t.guard_code) then
    raise exception 'Blocked: % is not recorded for this job', t.guard_code;
  end if;

  perform set_config('app.advancing', 'on', true);
  update public.jobs
     set stage_id = v_to.id, status_code = v_to.default_status_code, held_from_status = null
   where id = j.id;
  perform set_config('app.advancing', 'off', true);

  if cardinality(t.clears_milestones) > 0 then
    delete from public.job_milestones where job_id = j.id and code = any (t.clears_milestones);
  end if;
  insert into public.job_stage_history (job_id, from_stage_id, to_stage_id, from_status, to_status, changed_by, note)
  values (j.id, t.from_stage_id, v_to.id, j.status_code, v_to.default_status_code, (select auth.uid()), p_note);

  select * into j from public.jobs where id = p_job;
  return j;
end $$;

-- ---------------------------------------------------------------- detailed status
-- Rules: a normal status must belong to the job's current stage; On hold / Cancelled work from any stage.
-- Resuming from hold: set any status of the current stage (or p_code = 'RESUME' to restore the previous one).
-- Cancelled is final except for global administrators.
create function public.set_job_status(p_job bigint, p_code text, p_note text default null)
returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  j       public.jobs;
  s       public.job_statuses;
  cur     public.job_statuses;
  v_stage text;
  v_new   text;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found
     or not (private.has_perm(j.front_office_id, 'job.read') or private.has_perm(j.back_office_id, 'job.read')) then
    raise exception 'Job not found';
  end if;
  select * into cur from public.job_statuses where code = j.status_code;
  select code into v_stage from public.job_stages where id = j.stage_id;

  if cur.kind = 'cancel' and not private.has_perm(null::smallint, 'admin.manage') then
    raise exception 'This job is cancelled. Only an administrator can reopen it.';
  end if;

  if p_code = 'RESUME' then
    if cur.kind is distinct from 'hold' then raise exception 'This job is not on hold'; end if;
    v_new := j.held_from_status;
    if not private.side_allows(j, 'either', 'job.update') then raise exception 'You are not allowed to change this status'; end if;
  else
    select * into s from public.job_statuses where code = p_code;
    if not found then raise exception 'Unknown status %', p_code; end if;
    if s.stage_code is not null and s.stage_code <> v_stage then
      raise exception 'Status % belongs to stage %, but the job is at %', p_code, s.stage_code, v_stage;
    end if;
    if not private.side_allows(j, s.owner_side, 'job.update') then
      raise exception 'You are not allowed to set this status';
    end if;
    if s.kind = 'hold' and cur.kind = 'hold' then raise exception 'This job is already on hold'; end if;
    v_new := p_code;
  end if;

  perform set_config('app.advancing', 'on', true);
  update public.jobs
     set status_code = v_new,
         held_from_status = case when s.kind = 'hold' then j.status_code else null end
   where id = j.id;
  perform set_config('app.advancing', 'off', true);

  if s.records_milestone is not null then
    insert into public.job_milestones (job_id, code, set_by)
    values (j.id, s.records_milestone, (select auth.uid()))
    on conflict (job_id, code) do nothing;
  end if;
  if cardinality(coalesce(s.clears_milestones, '{}')) > 0 then
    delete from public.job_milestones where job_id = j.id and code = any (s.clears_milestones);
  end if;

  insert into public.job_stage_history (job_id, from_stage_id, to_stage_id, from_status, to_status, changed_by, note)
  values (j.id, j.stage_id, j.stage_id, j.status_code, v_new, (select auth.uid()), p_note);

  select * into j from public.jobs where id = p_job;
  return j;
end $$;

revoke execute on function public.set_job_status(bigint, text, text) from public, anon;
grant  execute on function public.set_job_status(bigint, text, text) to authenticated;
revoke execute on function private.side_allows(public.jobs, text, text) from public, anon;
grant  execute on function private.side_allows(public.jobs, text, text) to authenticated;

-- ---------------------------------------------------------------- access
alter table public.job_statuses enable row level security;
create policy job_statuses_read on public.job_statuses for select to authenticated using (true);
create policy job_statuses_admin on public.job_statuses for all to authenticated
  using (private.has_perm(null::smallint, 'admin.manage'))
  with check (private.has_perm(null::smallint, 'admin.manage'));
grant select, insert, update, delete on public.job_statuses to authenticated;
grant select, insert, update, delete on public.job_statuses to service_role;

create trigger audit_job_statuses after insert or update or delete on public.job_statuses
  for each row execute function private.audit('code');

-- Existing jobs: give them their stage's default status (direct update allowed while app.advancing is on).
do $$
begin
  perform set_config('app.advancing', 'on', true);
  update public.jobs j set status_code = s.default_status_code
  from public.job_stages s where s.id = j.stage_id and j.status_code is null;
  perform set_config('app.advancing', 'off', true);
end $$;
