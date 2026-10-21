-- Job specification from the MWL "NewJobSimple" and "NewJobAdvance" mocks: request details, design brief,
-- metal lines, stone lines, stamping / engraving, and reference files in private storage.
-- Project type uses the existing jobs.job_type: custom = Custom, catalog_edit = Edit, catalog = Existing.

alter table public.jobs
  add column request_type        text check (request_type in ('estimate', 'cad', 'render', 'order')),
  add column sub_type            text check (sub_type in ('finish', 'semi', 'mount')),
  add column ref_type            text check (ref_type in ('style', 'sku', 'job')),
  add column ref_no              text check (length(ref_no) <= 60),
  add column due_date            date,
  add column in_store_by         date,
  add column is_rush             boolean not null default false,
  add column quantity            integer not null default 1 check (quantity between 1 and 10000),
  add column budget              numeric(12, 2) check (budget >= 0),
  add column budget_currency     char(3) references public.currencies (code),
  add column customer_request    text check (length(customer_request) <= 4000),
  add column product_specs       text check (length(product_specs) <= 4000),
  add column design_brief        text check (length(design_brief) <= 4000),
  add column must_keep           text check (length(must_keep) <= 2000),
  add column avoid               text check (length(avoid) <= 2000),
  add column quick_options       text[] not null default '{}',
  add column metal_tone          text check (metal_tone in ('single', 'two', 'three')),
  add column target_metal_weight numeric(8, 3) check (target_metal_weight >= 0),
  add column stamping            text check (length(stamping) <= 200),
  add column stamping_location   text check (length(stamping_location) <= 100),
  add column engrave_text        text check (length(engrave_text) <= 200),
  add column engrave_location    text check (length(engrave_location) <= 100),
  add column engrave_font        text check (length(engrave_font) <= 60),
  add column engrave_method      text check (engrave_method in ('laser', 'hand', 'raised', 'recessed')),
  add column form_variant        text not null default 'simple' check (form_variant in ('simple', 'advanced'));

create table public.job_metal_lines (
  id       bigint generated always as identity primary key,
  job_id   bigint not null references public.jobs (id) on delete cascade,
  line_no  smallint not null check (line_no between 1 and 20),
  metal    text not null check (length(metal) between 1 and 40),
  color    text check (length(color) <= 40),
  rhodium  text check (length(rhodium) <= 40),
  finish   text check (length(finish) <= 40),
  notes    text check (length(notes) <= 500),
  unique (job_id, line_no)
);

create table public.job_stone_lines (
  id          bigint generated always as identity primary key,
  job_id      bigint not null references public.jobs (id) on delete cascade,
  line_no     smallint not null check (line_no between 1 and 100),
  position    text check (length(position) <= 30),
  in_mounting boolean,
  stone_type  text not null check (stone_type in ('DIA', 'LGD', 'GEM')),
  shape       text check (length(shape) <= 30),
  size        text check (length(size) <= 30),
  color       text check (length(color) <= 30),
  clarity     text check (length(clarity) <= 30),
  spec        text check (length(spec) <= 30),
  ct_pc       numeric(10, 4) check (ct_pc >= 0),
  pcs         integer check (pcs between 0 and 100000),
  setting     text check (length(setting) <= 40),
  source      text check (source in ('B', 'O', 'F', 'C')),
  notes       text check (length(notes) <= 500),
  unique (job_id, line_no)
);
create index job_metal_lines_job_idx on public.job_metal_lines (job_id);
create index job_stone_lines_job_idx on public.job_stone_lines (job_id);

create table public.job_files (
  id           bigint generated always as identity primary key,
  job_id       bigint not null references public.jobs (id) on delete cascade,
  kind         text not null check (kind in ('reference', 'cad', 'render', 'output', 'qc')),
  storage_path text not null unique,
  file_name    text not null check (length(file_name) <= 200),
  mime_type    text,
  size_bytes   bigint check (size_bytes >= 0),
  uploaded_by  uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index job_files_job_idx on public.job_files (job_id, kind);

-- ---------------------------------------------------------------- access helpers
create function private.can_read_job(p_job bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jobs j where j.id = p_job
    and (private.has_perm(j.front_office_id, 'job.read') or private.has_perm(j.back_office_id, 'job.read')));
$$;
create function private.can_write_job(p_job bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jobs j where j.id = p_job
    and (private.has_perm(j.front_office_id, 'job.update') or private.has_perm(j.back_office_id, 'job.update')));
$$;
-- The specification is frozen once a job reaches "Ready for production" or is cancelled (admins excepted).
create function private.spec_editable(p_job bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_perm(null::smallint, 'admin.manage') or exists (
    select 1 from public.jobs j
    join public.job_stages s on s.id = j.stage_id
    left join public.job_statuses st on st.code = j.status_code
    where j.id = p_job and s.sort_order < (select sort_order from public.job_stages where code = 'approved')
      and coalesce(st.kind, 'normal') <> 'cancel');
$$;
grant execute on function private.can_read_job(bigint), private.can_write_job(bigint), private.spec_editable(bigint) to authenticated;

-- Spec columns on jobs follow the same freeze.
create function private.jobs_spec_freeze() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (to_jsonb(new) - array['updated_at','stage_id','status_code','held_from_status'])
     is distinct from (to_jsonb(old) - array['updated_at','stage_id','status_code','held_from_status'])
     and coalesce(current_setting('app.advancing', true), '') <> 'on'
     and (select auth.uid()) is not null
     and not private.spec_editable(old.id) then
    raise exception 'The specification is frozen (job is at or past Ready for production)';
  end if;
  return new;
end $$;
create trigger jobs_spec_freeze before update on public.jobs
  for each row execute function private.jobs_spec_freeze();

-- ---------------------------------------------------------------- RLS
alter table public.job_metal_lines enable row level security;
alter table public.job_stone_lines enable row level security;
alter table public.job_files       enable row level security;

create policy job_metal_lines_read  on public.job_metal_lines for select to authenticated using (private.can_read_job(job_id));
create policy job_metal_lines_write on public.job_metal_lines for all to authenticated
  using (private.can_write_job(job_id) and private.spec_editable(job_id))
  with check (private.can_write_job(job_id) and private.spec_editable(job_id));
create policy job_stone_lines_read  on public.job_stone_lines for select to authenticated using (private.can_read_job(job_id));
create policy job_stone_lines_write on public.job_stone_lines for all to authenticated
  using (private.can_write_job(job_id) and private.spec_editable(job_id))
  with check (private.can_write_job(job_id) and private.spec_editable(job_id));

create policy job_files_read   on public.job_files for select to authenticated using (private.can_read_job(job_id));
create policy job_files_insert on public.job_files for insert to authenticated
  with check (private.can_write_job(job_id) and uploaded_by = (select auth.uid()));
create policy job_files_delete on public.job_files for delete to authenticated using (private.can_write_job(job_id));

grant select, insert, update, delete on public.job_metal_lines, public.job_stone_lines to authenticated;
grant select, insert, delete on public.job_files to authenticated;
grant select, insert, update, delete on public.job_metal_lines, public.job_stone_lines, public.job_files to service_role;

create trigger audit_job_metal_lines after insert or update or delete on public.job_metal_lines
  for each row execute function private.audit('job_id');
create trigger audit_job_stone_lines after insert or update or delete on public.job_stone_lines
  for each row execute function private.audit('job_id');
create trigger audit_job_files after insert or update or delete on public.job_files
  for each row execute function private.audit('job_id');

-- ---------------------------------------------------------------- one-call save (job + lines in one transaction)
-- SECURITY INVOKER: every insert/update below runs under the caller's RLS policies.
create function public.save_job(p_job_id bigint, p_job jsonb, p_metals jsonb, p_stones jsonb)
returns public.jobs
language plpgsql security invoker set search_path = '' as $$
declare
  j public.jobs;
  allowed text[] := array['customer_id','front_office_id','title','description','job_type','item_type','item_sub_type',
    'style_no','size_label','size_system','customer_ref_no','order_ref_no','request_type','sub_type','ref_type','ref_no',
    'due_date','in_store_by','is_rush','quantity','budget','budget_currency','customer_request','product_specs',
    'design_brief','must_keep','avoid','quick_options','metal_tone','target_metal_weight','stamping','stamping_location',
    'engrave_text','engrave_location','engrave_font','engrave_method','form_variant'];
  clean jsonb;
begin
  select coalesce(jsonb_object_agg(key, value), '{}') into clean
  from jsonb_each(coalesce(p_job, '{}')) where key = any (allowed);

  if p_job_id is null then
    insert into public.jobs (customer_id, front_office_id, title, description, job_type, item_type, item_sub_type,
       style_no, size_label, size_system, customer_ref_no, order_ref_no, request_type, sub_type, ref_type, ref_no,
       due_date, in_store_by, is_rush, quantity, budget, budget_currency, customer_request, product_specs, design_brief,
       must_keep, avoid, quick_options, metal_tone, target_metal_weight, stamping, stamping_location, engrave_text,
       engrave_location, engrave_font, engrave_method, form_variant, created_by)
    select r.customer_id, r.front_office_id, r.title, r.description, coalesce(r.job_type, 'custom'), r.item_type,
       r.item_sub_type, r.style_no, r.size_label, r.size_system, r.customer_ref_no, r.order_ref_no, r.request_type,
       r.sub_type, r.ref_type, r.ref_no, r.due_date, r.in_store_by, coalesce(r.is_rush, false), coalesce(r.quantity, 1),
       r.budget, r.budget_currency, r.customer_request, r.product_specs, r.design_brief, r.must_keep, r.avoid,
       coalesce(r.quick_options, '{}'), r.metal_tone, r.target_metal_weight, r.stamping, r.stamping_location,
       r.engrave_text, r.engrave_location, r.engrave_font, r.engrave_method, coalesce(r.form_variant, 'simple'),
       (select auth.uid())
    from jsonb_populate_record(null::public.jobs, clean) r
    returning * into j;
  else
    if exists (select 1 from jsonb_object_keys(clean) k where k in ('customer_id', 'front_office_id')) then
      raise exception 'Customer and office cannot be changed on an existing job';
    end if;
    update public.jobs t set
      (title, description, job_type, item_type, item_sub_type, style_no, size_label, size_system, customer_ref_no,
       order_ref_no, request_type, sub_type, ref_type, ref_no, due_date, in_store_by, is_rush, quantity, budget,
       budget_currency, customer_request, product_specs, design_brief, must_keep, avoid, quick_options, metal_tone,
       target_metal_weight, stamping, stamping_location, engrave_text, engrave_location, engrave_font, engrave_method,
       form_variant) =
      (select r.title, r.description, coalesce(r.job_type, t.job_type), r.item_type, r.item_sub_type, r.style_no, r.size_label, r.size_system,
       r.customer_ref_no, r.order_ref_no, r.request_type, r.sub_type, r.ref_type, r.ref_no, r.due_date, r.in_store_by,
       coalesce(r.is_rush, false), coalesce(r.quantity, 1), r.budget, r.budget_currency, r.customer_request,
       r.product_specs, r.design_brief, r.must_keep, r.avoid, coalesce(r.quick_options, '{}'), r.metal_tone,
       r.target_metal_weight, r.stamping, r.stamping_location, r.engrave_text, r.engrave_location, r.engrave_font,
       r.engrave_method, coalesce(r.form_variant, 'simple')
       from jsonb_populate_record(null::public.jobs, clean) r)
    where t.id = p_job_id
    returning * into j;
    if not found then raise exception 'Job not found'; end if;
    delete from public.job_metal_lines where job_id = j.id;
    delete from public.job_stone_lines where job_id = j.id;
  end if;

  insert into public.job_metal_lines (job_id, line_no, metal, color, rhodium, finish, notes)
  select j.id, row_number() over (), m.metal, m.color, m.rhodium, m.finish, m.notes
  from jsonb_to_recordset(coalesce(p_metals, '[]')) as m(metal text, color text, rhodium text, finish text, notes text)
  where coalesce(trim(m.metal), '') <> '';

  insert into public.job_stone_lines (job_id, line_no, position, in_mounting, stone_type, shape, size, color, clarity,
                                      spec, ct_pc, pcs, setting, source, notes)
  select j.id, row_number() over (), s.position, s.in_mounting, s.stone_type, s.shape, s.size, s.color, s.clarity,
         s.spec, s.ct_pc, s.pcs, s.setting, s.source, s.notes
  from jsonb_to_recordset(coalesce(p_stones, '[]')) as s(position text, in_mounting boolean, stone_type text, shape text,
       size text, color text, clarity text, spec text, ct_pc numeric, pcs integer, setting text, source text, notes text)
  where coalesce(trim(s.stone_type), '') <> '';

  return j;
end $$;
revoke execute on function public.save_job(bigint, jsonb, jsonb, jsonb) from public, anon;
grant  execute on function public.save_job(bigint, jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- private file storage
-- Files live at jobs/<job_id>/<random>-<name> in the private "job-files" bucket; access follows the job.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-files', 'job-files', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'video/mp4', 'video/quicktime',
              'application/json', 'text/csv', 'application/zip'])
on conflict (id) do nothing;

create function private.job_id_from_path(p_name text) returns bigint
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^jobs/[0-9]{1,18}/[^/]+$' then split_part(p_name, '/', 2)::bigint end;
$$;

grant execute on function private.job_id_from_path(text) to authenticated;

create policy job_files_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'job-files' and private.can_read_job(private.job_id_from_path(name)));
create policy job_files_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'job-files' and private.can_write_job(private.job_id_from_path(name)));
create policy job_files_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'job-files' and private.can_write_job(private.job_id_from_path(name)));
