-- Tighten two things found in the back end review.
--
-- 1. CAD designers no longer edit job specifications directly. They had job.update only because the CAD
--    functions checked it. Now a dedicated permission, cad.write, covers the CAD sheet (versions, weights,
--    stones, CAD images) and nothing else; the CAD role loses job.update.
-- 2. Customer personal details and contacts can be created and changed by the owning front office, but only
--    an administrator can delete them.

-- ---------------------------------------------------------------- 1. cad.write
insert into public.permissions (code, description) values
  ('cad.write', 'Create, edit and submit CAD versions (CAD sheet) and attach CAD images')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code = 'cad.write'
where r.code in ('admin', 'office_admin', 'back_office', 'cad')
on conflict do nothing;

delete from public.role_permissions rp
using public.roles r, public.permissions p
where rp.role_id = r.id and rp.permission_id = p.id and r.code = 'cad' and p.code = 'job.update';

-- A version is editable (draft / revision, job at New or CAD) by whoever holds cad.write at the job's back office.
create or replace function private.cad_editable(p_version bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cad_versions v
    join public.jobs j on j.id = v.job_id
    join public.job_stages s on s.id = j.stage_id
    where v.id = p_version and v.status in ('draft', 'revision')
      and s.code in ('intake', 'cad_design')
      and private.has_perm(j.back_office_id, 'cad.write'));
$$;

-- Create or update a version: same function as before, now authorised by cad.write.
create or replace function public.save_cad_version(p_version_id bigint, p_job_id bigint, p_fields jsonb, p_metals jsonb, p_stones jsonb)
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
    if not private.has_perm(j.back_office_id, 'cad.write') then
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

-- CAD images and files: attached to a version that the user may edit, or by anyone who may write the job.
create function private.can_upload_cad(p_job bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.jobs j join public.job_stages s on s.id = j.stage_id
    where j.id = p_job and s.code in ('intake', 'cad_design') and private.has_perm(j.back_office_id, 'cad.write'));
$$;
grant execute on function private.can_upload_cad(bigint) to authenticated;

drop policy job_files_insert on public.job_files;
create policy job_files_insert on public.job_files for insert to authenticated
  with check (uploaded_by = (select auth.uid())
              and (cad_version_id is null or private.cad_job(cad_version_id) = job_id)
              and (private.can_write_job(job_id)
                   or (cad_version_id is not null and kind in ('cad', 'render') and private.cad_editable(cad_version_id))));
drop policy job_files_delete on public.job_files;
create policy job_files_delete on public.job_files for delete to authenticated
  using (private.can_write_job(job_id)
         or (cad_version_id is not null and kind in ('cad', 'render') and private.cad_editable(cad_version_id)));

drop policy job_files_storage_insert on storage.objects;
create policy job_files_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'job-files'
              and (private.can_write_job(private.job_id_from_path(name)) or private.can_upload_cad(private.job_id_from_path(name))));
drop policy job_files_storage_delete on storage.objects;
create policy job_files_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'job-files'
         and (private.can_write_job(private.job_id_from_path(name)) or private.can_upload_cad(private.job_id_from_path(name))));

-- ---------------------------------------------------------------- 2. delete only by administrators
drop policy cust_private_write on public.customer_private;
create policy cust_private_insert on public.customer_private for insert to authenticated
  with check (private.has_perm(private.customer_office(customer_id), 'customer_private.write'));
create policy cust_private_update on public.customer_private for update to authenticated
  using (private.has_perm(private.customer_office(customer_id), 'customer_private.write'))
  with check (private.has_perm(private.customer_office(customer_id), 'customer_private.write'));
create policy cust_private_delete on public.customer_private for delete to authenticated
  using (private.has_perm(null::smallint, 'admin.manage'));

drop policy cust_contacts_write on public.customer_contacts;
create policy cust_contacts_insert on public.customer_contacts for insert to authenticated
  with check (private.has_perm(private.customer_office(customer_id), 'customer_private.write'));
create policy cust_contacts_update on public.customer_contacts for update to authenticated
  using (private.has_perm(private.customer_office(customer_id), 'customer_private.write'))
  with check (private.has_perm(private.customer_office(customer_id), 'customer_private.write'));
create policy cust_contacts_delete on public.customer_contacts for delete to authenticated
  using (private.has_perm(null::smallint, 'admin.manage'));
