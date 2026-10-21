-- Quote calculator (MWL "Calculator" mock) on the MWL pricing engine.
--   pricing_models  published, checked price data built from the master price sheet (one live version)
--   rate_snapshots  live metal spot + FX rates, cached (written by the rates Edge Function)
--   quotes          saved quotes (MWL quote state + totals), optionally linked to a job, with revision checks
-- Prices are commercially sensitive: everything here needs the new quote.read / quote.write permissions.

insert into public.permissions (code, description) values
  ('quote.read',  'See price data, live rates and quotes'),
  ('quote.write', 'Create and edit quotes')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.code in ('quote.read', 'quote.write')
where r.code in ('admin', 'office_admin', 'front_office', 'back_office')
on conflict do nothing;

-- ---------------------------------------------------------------- price data
create table public.pricing_models (
  id           bigint generated always as identity primary key,
  version      text not null,
  model        jsonb not null,
  warnings     jsonb not null default '[]',
  source       jsonb not null default '{}',
  note         text check (length(note) <= 500),
  is_live      boolean not null default false,
  published_by uuid default auth.uid(),
  published_at timestamptz not null default now()
);
create unique index pricing_models_one_live on public.pricing_models (is_live) where is_live;
create index pricing_models_published_idx on public.pricing_models (published_at desc);

-- Make one version live (admins; the sync script uses the service role and does the same).
create function public.set_live_pricing_model(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_perm(null::smallint, 'admin.manage') then raise exception 'Only administrators can change the live price data'; end if;
  if not exists (select 1 from public.pricing_models where id = p_id) then raise exception 'Price data version not found'; end if;
  update public.pricing_models set is_live = false where is_live and id <> p_id;
  update public.pricing_models set is_live = true where id = p_id;
end $$;
revoke execute on function public.set_live_pricing_model(bigint) from public, anon;
grant execute on function public.set_live_pricing_model(bigint) to authenticated;

-- ---------------------------------------------------------------- live rates
create table public.rate_snapshots (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  spot    jsonb not null default '{}',   -- { AU: { price, at }, ... } USD per troy oz
  fx      jsonb,                          -- { date, src, rates: { EUR: 0.88, ... } } per 1 USD
  errors  jsonb not null default '[]'
);
create index rate_snapshots_at_idx on public.rate_snapshots (at desc);

-- ---------------------------------------------------------------- quotes
create table public.quotes (
  id              uuid primary key default gen_random_uuid(),
  job_id          bigint references public.jobs (id) on delete set null,
  name            text not null default 'Untitled quote' check (length(name) <= 120),
  state           jsonb not null check (pg_column_size(state) < 1000000),
  totals          jsonb not null default '{}',
  location        text check (length(location) <= 10),
  currency        char(3),
  total_usd       numeric(14, 2),
  total_local     numeric(14, 2),
  pricing_version text,
  rates           jsonb,
  revision        integer not null default 1,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now()
);
create index quotes_job_idx on public.quotes (job_id);
create index quotes_updated_idx on public.quotes (updated_at desc);
create index quotes_owner_idx on public.quotes (created_by);

create function private.can_quote(p_job bigint, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_job is null then private.has_perm(null::smallint, p_perm) or exists (
                select 1 from public.user_office_roles uor
                join public.role_permissions rp on rp.role_id = uor.role_id
                join public.permissions p on p.id = rp.permission_id
                where uor.user_id = (select auth.uid()) and p.code = p_perm)
         else exists (select 1 from public.jobs j where j.id = p_job
                and (private.has_perm(j.front_office_id, p_perm) or private.has_perm(j.back_office_id, p_perm)))
  end;
$$;
grant execute on function private.can_quote(bigint, text) to authenticated;

-- Save with an optimistic revision check, so two people cannot silently overwrite each other.
create function public.save_quote(p_id uuid, p_expected_revision integer, p_job_id bigint, p_name text, p_state jsonb,
                                  p_totals jsonb, p_location text, p_currency text, p_total_usd numeric,
                                  p_total_local numeric, p_pricing_version text, p_rates jsonb)
returns public.quotes
language plpgsql security invoker set search_path = '' as $$
declare r public.quotes;
begin
  if p_id is null then
    insert into public.quotes (job_id, name, state, totals, location, currency, total_usd, total_local, pricing_version, rates)
    values (p_job_id, coalesce(nullif(trim(p_name), ''), 'Untitled quote'), p_state, coalesce(p_totals, '{}'), p_location,
            p_currency, p_total_usd, p_total_local, p_pricing_version, p_rates)
    returning * into r;
    return r;
  end if;
  update public.quotes set
    job_id = p_job_id, name = coalesce(nullif(trim(p_name), ''), 'Untitled quote'), state = p_state,
    totals = coalesce(p_totals, '{}'), location = p_location, currency = p_currency, total_usd = p_total_usd,
    total_local = p_total_local, pricing_version = p_pricing_version, rates = p_rates,
    revision = revision + 1, updated_by = (select auth.uid()), updated_at = now()
  where id = p_id and revision = p_expected_revision
  returning * into r;
  if not found then
    if exists (select 1 from public.quotes where id = p_id) then
      raise exception 'Someone else saved this quote since you opened it. Reload it to see their changes.' using errcode = '40001';
    end if;
    raise exception 'Quote not found';
  end if;
  return r;
end $$;
revoke execute on function public.save_quote(uuid, integer, bigint, text, jsonb, jsonb, text, text, numeric, numeric, text, jsonb) from public, anon;
grant execute on function public.save_quote(uuid, integer, bigint, text, jsonb, jsonb, text, text, numeric, numeric, text, jsonb) to authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.pricing_models enable row level security;
alter table public.rate_snapshots enable row level security;
alter table public.quotes         enable row level security;

create policy pricing_models_read on public.pricing_models for select to authenticated using (private.can_quote(null, 'quote.read'));
create policy rate_snapshots_read on public.rate_snapshots for select to authenticated using (private.can_quote(null, 'quote.read'));

-- A quote on a job follows the job's offices; a quote without a job belongs to its author (and admins).
create policy quotes_read on public.quotes for select to authenticated using (
  case when job_id is not null then private.can_quote(job_id, 'quote.read')
       else created_by = (select auth.uid()) or private.has_perm(null::smallint, 'admin.manage') end);
create policy quotes_insert on public.quotes for insert to authenticated with check (
  created_by = (select auth.uid()) and private.can_quote(job_id, 'quote.write'));
create policy quotes_update on public.quotes for update to authenticated
  using (case when job_id is not null then private.can_quote(job_id, 'quote.write')
              else created_by = (select auth.uid()) end)
  with check (private.can_quote(job_id, 'quote.write'));
create policy quotes_delete on public.quotes for delete to authenticated using (
  created_by = (select auth.uid()) or private.has_perm(null::smallint, 'admin.manage'));

grant select on public.pricing_models, public.rate_snapshots to authenticated;
grant select, insert, update, delete on public.quotes to authenticated;
grant select, insert, update, delete on public.pricing_models, public.rate_snapshots, public.quotes to service_role;

create trigger audit_quotes after insert or update or delete on public.quotes
  for each row execute function private.audit('id');
create trigger audit_pricing_models after insert or update or delete on public.pricing_models
  for each row execute function private.audit('id', 'mask');   -- the model itself is large; record that it changed
