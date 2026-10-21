-- Roles for the internal team structure. Business permissions only; admin.manage stays global-admin only.

insert into public.roles (code, name, description) values
  ('office_admin', 'Office administrator', 'Full business access (customers, PII, jobs) for their own office'),
  ('qc',           'Quality control',      'Production QC: job access at the back office; QC-specific permissions arrive with the QC module'),
  ('cad',          'CAD designer',         'CAD team: job access at the back office')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in
  ('customer.read','customer.write','customer_private.read','customer_private.write',
   'job.read','job.create','job.update','job.advance_stage')
where r.code = 'office_admin'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in
  ('customer.read','job.read','job.update','job.advance_stage')
where r.code in ('qc','cad')
on conflict do nothing;
