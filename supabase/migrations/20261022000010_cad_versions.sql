-- CAD sheet maker (MWL "CadImage" mock): numbered CAD versions per job with metal weights, a stone matrix and
-- images. Designers (CAD role) draft and submit; the back office accepts or asks for a revision.
-- Accepting records the cad_accepted milestone and sets status CSO; a revision request sets status CRD.

create table public.cad_versions (
  id                  bigint generated always as identity primary key,
  job_id              bigint not null references public.jobs (id) on delete cascade,
  version_no          smallint not null check (version_no between 1 and 99),
  status              text not null default 'draft' check (status in ('draft', 'submitted', 'accepted', 'revision', 'superseded')),
  designer_name       text check (length(designer_name) <= 80),
  cad_date            date,
  render_url          text check (render_url is null or render_url ~ '^https://' and length(render_url) <= 500),
  client_instructions text check (length(client_instructions) <= 4000),
  notes               text check (length(notes) <= 2000),
  review_note         text check (length(review_note) <= 2000),
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  submitted_by        uuid,
  submitted_at        timestamptz,
  reviewed_by         uuid,
  reviewed_at         timestamptz,
  unique (job_id, version_no)
);
create index cad_versions_job_idx on public.cad_versions (job_id);

create table public.cad_version_metals (
  id             bigint generated always as identity primary key,
  cad_version_id bigint not null references public.cad_versions (id) on delete cascade,
  line_no        smallint not null check (line_no between 1 and 3),
  metal          text not null check (length(metal) between 1 and 40),
  grams          numeric(9, 3) check (grams >= 0),
  rhodium        text check (length(rhodium) <= 40),
  finish         text check (length(finish) <= 40),
  note           text check (length(note) <= 300),
  unique (cad_version_id, line_no)
);

create table public.cad_version_stones (
  id             bigint generated always as identity primary key,
  cad_version_id bigint not null references public.cad_versions (id) on delete cascade,
  line_no        smallint not null check (line_no between 1 and 500),
  position       text check (length(position) <= 30),
  stone_type     text not null check (stone_type in ('DIA', 'LGD', 'GEM')),
  is_blank       boolean not null default false,          -- seat left empty / stone supplied later
  shape          text check (length(shape) <= 30),
  size           text check (length(size) <= 30),
  ct_pc          numeric(10, 4) check (ct_pc >= 0),
  pcs            integer check (pcs between 0 and 100000),
  role           text check (length(role) <= 30),         -- center / side / accent / halo ...
  setting_style  text check (length(setting_style) <= 40),
  unique (cad_version_id, line_no)
);
create index cad_version_metals_idx on public.cad_version_metals (cad_version_id);
create index cad_version_stones_idx on public.cad_version_stones (cad_version_id);

alter table public.job_files add column cad_version_id bigint references public.cad_versions (id) on delete cascade;

create trigger cad_versions_touch before update on public.cad_versions
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------- helpers
create function private.cad_job(p_version bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select job_id from public.cad_versions where id = p_version;
$$;
-- Draft / revision versions can be edited by the job's back office (CAD team) while the job is at New or CAD.
create function private.cad_editable(p_version bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cad_versions v
    join public.jobs j on j.id = v.job_id
    join public.job_stages s on s.id = j.stage_id
    where v.id = p_version and v.status in ('draft', 'revision')
      and s.code in ('intake', 'cad_design')
      and private.has_perm(j.back_office_id, 'job.update'));
$$;
grant execute on function private.cad_job(bigint), private.cad_editable(bigint) to authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.cad_versions       enable row level security;
alter table public.cad_version_metals enable row level security;
alter table public.cad_version_stones enable row level security;

create policy cad_versions_read on public.cad_versions for select to authenticated using (private.can_read_job(job_id));
create policy cad_metals_read on public.cad_version_metals for select to authenticated using (private.can_read_job(private.cad_job(cad_version_id)));
create policy cad_stones_read on public.cad_version_stones for select to authenticated using (private.can_read_job(private.cad_job(cad_version_id)));
-- No write policies: versions and their lines change only through the functions below.
grant select on public.cad_versions, public.cad_version_metals, public.cad_version_stones to authenticated;
grant select, insert, update, delete on public.cad_versions, public.cad_version_metals, public.cad_version_stones to service_role;

-- A CAD file must belong to a version of the same job.
drop policy job_files_insert on public.job_files;
create policy job_files_insert on public.job_files for insert to authenticated
  with check (private.can_write_job(job_id) and uploaded_by = (select auth.uid())
              and (cad_version_id is null or private.cad_job(cad_version_id) = job_id));

create trigger audit_cad_versions after insert or update or delete on public.cad_versions
  for each row execute function private.audit('id');

-- ---------------------------------------------------------------- functions
-- Create (p_version_id null) or update an editable version, replacing its metal and stone lines.
create function public.save_cad_version(p_version_id bigint, p_job_id bigint, p_fields jsonb, p_metals jsonb, p_stones jsonb)
returns public.cad_versions
language plpgsql security definer set search_path = '' as $$
declare
  v public.cad_versions;
  j public.jobs;
  r public.cad_versions;
begin
  if p_version_id is null then
    select * into j from public.jobs where id = p_job_id;
    if not found or not private.can_read_job(p_job_id) then raise exception 'Job not found'; end if;
    if not private.has_perm(j.back_office_id, 'job.update') then
      raise exception 'Only the back office / CAD team of this job can create CAD versions';
    end if;
    if (select code from public.job_stages where id = j.stage_id) not in ('intake', 'cad_design') then
      raise exception 'CAD versions can only be created while the job is at New or CAD';
    end if;
    if exists (select 1 from public.cad_versions where job_id = j.id and status in ('draft', 'submitted', 'revision')) then
      raise exception 'Finish the open CAD version before starting a new one';
    end if;
    insert into public.cad_versions (job_id, version_no, created_by)
    values (j.id, coalesce((select max(version_no) from public.cad_versions where job_id = j.id), 0) + 1, (select auth.uid()))
    returning * into v;
  else
    select * into v from public.cad_versions where id = p_version_id for update;
    if not found or not private.can_read_job(v.job_id) then raise exception 'CAD version not found'; end if;
    if not private.cad_editable(v.id) then
      raise exception 'This CAD version can no longer be edited (it is %)', v.status;
    end if;
  end if;

  select * into r from jsonb_populate_record(null::public.cad_versions, coalesce(p_fields, '{}'));
  update public.cad_versions set
    designer_name = r.designer_name, cad_date = r.cad_date, render_url = nullif(trim(r.render_url), ''),
    client_instructions = r.client_instructions, notes = r.notes
  where id = v.id returning * into v;

  delete from public.cad_version_metals where cad_version_id = v.id;
  delete from public.cad_version_stones where cad_version_id = v.id;
  insert into public.cad_version_metals (cad_version_id, line_no, metal, grams, rhodium, finish, note)
  select v.id, row_number() over (), m.metal, m.grams, m.rhodium, m.finish, m.note
  from jsonb_to_recordset(coalesce(p_metals, '[]')) as m(metal text, grams numeric, rhodium text, finish text, note text)
  where coalesce(trim(m.metal), '') <> '';
  insert into public.cad_version_stones (cad_version_id, line_no, position, stone_type, is_blank, shape, size, ct_pc, pcs, role, setting_style)
  select v.id, row_number() over (), s.position, s.stone_type, coalesce(s.is_blank, false), s.shape, s.size, s.ct_pc, s.pcs, s.role, s.setting_style
  from jsonb_to_recordset(coalesce(p_stones, '[]')) as s(position text, stone_type text, is_blank boolean, shape text, size text,
       ct_pc numeric, pcs integer, role text, setting_style text)
  where coalesce(trim(s.stone_type), '') <> '';
  return v;
end $$;

-- Sets the job's detailed status as a side effect of CAD actions (only while the job is at the CAD stage).
create function private.cad_set_job_status(p_job bigint, p_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_from text;
begin
  if (select s.code from public.jobs j join public.job_stages s on s.id = j.stage_id where j.id = p_job) <> 'cad_design' then return; end if;
  if (select st.kind from public.jobs j left join public.job_statuses st on st.code = j.status_code where j.id = p_job) in ('hold', 'cancel') then return; end if;
  select status_code into v_from from public.jobs where id = p_job;
  perform set_config('app.advancing', 'on', true);
  update public.jobs set status_code = p_code where id = p_job;
  perform set_config('app.advancing', 'off', true);
  insert into public.job_stage_history (job_id, from_stage_id, to_stage_id, from_status, to_status, changed_by, note)
  select j.id, j.stage_id, j.stage_id, v_from, p_code, (select auth.uid()), 'CAD sheet'
  from public.jobs j where j.id = p_job;
end $$;

-- Designer hands the version in.
create function public.submit_cad_version(p_version_id bigint) returns public.cad_versions
language plpgsql security definer set search_path = '' as $$
declare v public.cad_versions;
begin
  select * into v from public.cad_versions where id = p_version_id for update;
  if not found or not private.can_read_job(v.job_id) then raise exception 'CAD version not found'; end if;
  if not private.cad_editable(v.id) then raise exception 'This CAD version cannot be submitted (it is %)', v.status; end if;
  if not exists (select 1 from public.cad_version_metals where cad_version_id = v.id and grams > 0) then
    raise exception 'Enter at least one metal with its weight before submitting';
  end if;
  update public.cad_versions set status = 'submitted', submitted_by = (select auth.uid()), submitted_at = now(), review_note = null
  where id = v.id returning * into v;
  perform private.cad_set_job_status(v.job_id, 'CSD');
  return v;
end $$;

-- Back office decision: 'accept' or 'revision'. Needs job.advance_stage at the job's back office
-- (the CAD role does not have it, so designers cannot accept their own work).
create function public.review_cad_version(p_version_id bigint, p_decision text, p_note text default null)
returns public.cad_versions
language plpgsql security definer set search_path = '' as $$
declare
  v public.cad_versions;
  j public.jobs;
begin
  select * into v from public.cad_versions where id = p_version_id for update;
  if not found or not private.can_read_job(v.job_id) then raise exception 'CAD version not found'; end if;
  select * into j from public.jobs where id = v.job_id;
  if not private.has_perm(j.back_office_id, 'job.advance_stage') then
    raise exception 'Only the back office can accept CAD or ask for a revision';
  end if;
  if v.status <> 'submitted' then raise exception 'Only a submitted version can be reviewed (this one is %)', v.status; end if;

  if p_decision = 'accept' then
    update public.cad_versions set status = 'superseded' where job_id = v.job_id and status = 'accepted';
    update public.cad_versions set status = 'accepted', reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = p_note
    where id = v.id returning * into v;
    if (select code from public.job_stages where id = j.stage_id) = 'cad_design' then
      insert into public.job_milestones (job_id, code, set_by) values (j.id, 'cad_accepted', (select auth.uid()))
      on conflict (job_id, code) do nothing;
    end if;
    perform private.cad_set_job_status(v.job_id, 'CSO');
  elsif p_decision = 'revision' then
    if coalesce(trim(p_note), '') = '' then raise exception 'Say what needs to change'; end if;
    update public.cad_versions set status = 'revision', reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = p_note
    where id = v.id returning * into v;
    perform private.cad_set_job_status(v.job_id, 'CRD');
  else
    raise exception 'Decision must be accept or revision';
  end if;
  return v;
end $$;

revoke execute on function public.save_cad_version(bigint, bigint, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.submit_cad_version(bigint) from public, anon;
revoke execute on function public.review_cad_version(bigint, text, text) from public, anon;
grant execute on function public.save_cad_version(bigint, bigint, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.submit_cad_version(bigint) to authenticated;
grant execute on function public.review_cad_version(bigint, text, text) to authenticated;
