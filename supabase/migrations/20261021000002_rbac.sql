-- RBAC: roles are granted per office. office_id NULL = all offices (global).

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  email      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.roles (
  id          smallint generated always as identity primary key,
  code        text not null unique,
  name        text not null,
  description text
);

create table public.permissions (
  id          smallint generated always as identity primary key,
  code        text not null unique,
  description text
);

create table public.role_permissions (
  role_id       smallint not null references public.roles (id) on delete cascade,
  permission_id smallint not null references public.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.user_office_roles (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  office_id smallint references public.offices (id) on delete cascade,
  role_id   smallint not null references public.roles (id) on delete cascade
);
create unique index user_office_roles_uq
  on public.user_office_roles (user_id, coalesce(office_id, 0), role_id);
create index user_office_roles_user_idx on public.user_office_roles (user_id);

-- Auto-create a profile for every new auth user.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------- permission checks
-- Does the current user hold p_perm at office p_office (or globally)?
-- p_office NULL checks for a global grant only.
create function private.has_perm(p_office smallint, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.user_office_roles uor
    join public.profiles pr on pr.id = uor.user_id and pr.is_active
    join public.role_permissions rp on rp.role_id = uor.role_id
    join public.permissions p on p.id = rp.permission_id
    where uor.user_id = (select auth.uid())
      and p.code = p_perm
      and (uor.office_id is null or uor.office_id = p_office)
  );
$$;

-- Same, but also true when the user holds p_perm at the BACK office that serves p_office.
-- This is how Mumbai production staff see customers of the offices they serve.
create function private.has_perm_served(p_office smallint, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_perm(p_office, p_perm)
      or exists (
        select 1 from public.offices o
        where o.id = p_office
          and o.back_office_id is not null
          and private.has_perm(o.back_office_id, p_perm)
      );
$$;

create function private.customer_office(p_customer bigint) returns smallint
language sql stable security definer set search_path = '' as $$
  select office_id from public.customers where id = p_customer;
$$;

grant usage on schema private to authenticated;
grant execute on function private.has_perm(smallint, text) to authenticated;
grant execute on function private.has_perm_served(smallint, text) to authenticated;
grant execute on function private.customer_office(bigint) to authenticated;

-- ---------------------------------------------------------------- reference data
insert into public.permissions (code, description) values
  ('admin.manage',          'Manage reference data, users and role assignments (global)'),
  ('customer.read',         'Read non-sensitive customer rows (alias, account number)'),
  ('customer.write',        'Create/update customers'),
  ('customer_private.read', 'Read customer PII: name, addresses, contacts, terms'),
  ('customer_private.write','Create/update customer PII and contacts'),
  ('job.read',              'Read jobs'),
  ('job.create',            'Create jobs'),
  ('job.update',            'Update jobs'),
  ('job.advance_stage',     'Move a job between stages');

insert into public.roles (code, name, description) values
  ('admin',        'Administrator', 'Full access, all offices'),
  ('front_office', 'Front office',  'Customer-facing: full customer details and jobs'),
  ('back_office',  'Back office',   'Production: customer alias only, jobs they produce');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p where r.code = 'admin';

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in
  ('customer.read','customer.write','customer_private.read','customer_private.write',
   'job.read','job.create','job.update','job.advance_stage')
where r.code = 'front_office';

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in
  ('customer.read','job.read','job.update','job.advance_stage')
where r.code = 'back_office';
