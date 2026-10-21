-- Core schema: mirrors the "DB Schema" Google Sheet (Company, Office, Customer,
-- CustomerPvt, Counter, JobHeader) with the clean-ups agreed in design review.

create schema if not exists private;

-- ---------------------------------------------------------------- enums
create type public.job_type      as enum ('custom', 'catalog', 'catalog_edit');
create type public.counter_type  as enum ('job', 'invoice');
create type public.counter_reset as enum ('never', 'yearly');

-- ---------------------------------------------------------------- helpers
create function private.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- currency / FX
create table public.currencies (
  code char(3) primary key,
  name text
);

-- Dated FX rates, base = USD (sheet column Office.FXR). Documents must snapshot the rate they used.
create table public.exchange_rates (
  id            bigint generated always as identity primary key,
  currency_code char(3) not null references public.currencies (code),
  rate_per_usd  numeric(14, 4) not null check (rate_per_usd > 0),
  effective_from date not null default current_date,
  unique (currency_code, effective_from)
);

-- ---------------------------------------------------------------- counters
-- Sheet "Counter": Type / CounterPrefix / LastValue
create table public.counters (
  id           smallint generated always as identity primary key,
  type         public.counter_type not null,
  prefix       text not null unique,
  reset_policy public.counter_reset not null default 'never'
);

-- One row per (counter, period). period_key = 'ALL' for never-reset counters, 'YYYY' for yearly.
create table public.counter_values (
  counter_id smallint not null references public.counters (id) on delete cascade,
  period_key text not null default 'ALL',
  last_value bigint not null default 0,
  primary key (counter_id, period_key)
);

-- Atomic, gapless-within-transaction number generator.
create function private.next_counter(p_counter_id smallint) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_prefix text;
  v_policy public.counter_reset;
  v_period text;
  v_val    bigint;
begin
  select prefix, reset_policy into v_prefix, v_policy
  from public.counters where id = p_counter_id;
  if not found then
    raise exception 'unknown counter %', p_counter_id;
  end if;

  v_period := case v_policy when 'yearly' then to_char(now(), 'YYYY') else 'ALL' end;

  insert into public.counter_values (counter_id, period_key, last_value)
  values (p_counter_id, v_period, 1)
  on conflict (counter_id, period_key)
  do update set last_value = public.counter_values.last_value + 1
  returning last_value into v_val;

  return v_prefix || '-'
      || case when v_policy = 'yearly' then v_period || '-' else '' end
      || lpad(v_val::text, 6, '0');
end $$;

-- ---------------------------------------------------------------- org structure
create table public.companies (
  id            smallint generated always as identity primary key,
  code          text not null unique,
  name          text not null,
  address_lines text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.offices (
  id                 smallint generated always as identity primary key,
  company_id         smallint not null references public.companies (id),
  back_office_id     smallint references public.offices (id),
  code               text not null unique,
  name               text not null,
  city               text,
  country            text,
  phone_raw          text,
  whatsapp           text check (whatsapp is null or whatsapp ~ '^[0-9]{8,15}$'),
  email              text,
  currency_code      char(3) references public.currencies (code),
  tax_rate           numeric(5, 2) check (tax_rate is null or tax_rate between 0 and 100),
  tax_caption        text,
  logo_url           text,
  job_counter_id     smallint references public.counters (id),
  invoice_counter_id smallint references public.counters (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index offices_company_idx on public.offices (company_id);
create index offices_back_office_idx on public.offices (back_office_id);

-- ---------------------------------------------------------------- lookups
create table public.payment_terms (
  id   smallint generated always as identity primary key,
  name text not null unique,
  days integer
);

create table public.ship_via (
  id   smallint generated always as identity primary key,
  name text not null unique
);

-- ---------------------------------------------------------------- customers
-- "Customer" tab: non-sensitive, visible to back office.
create table public.customers (
  id            bigint generated always as identity primary key,
  office_id     smallint not null references public.offices (id),
  ezj_ac_num    text,               -- legacy EZJEMS ERP account number
  alias         text not null,      -- alias code used by production teams
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (office_id, alias),
  unique (office_id, ezj_ac_num)
);

-- "CustomerPvt" tab: PII, front office only.
create table public.customer_private (
  customer_id       bigint primary key references public.customers (id) on delete cascade,
  name              text not null,
  billing_address   text,
  shipping_address  text,
  email             text,
  whatsapp          text,
  currency_code     char(3) references public.currencies (code),
  payment_terms_id  smallint references public.payment_terms (id),
  ship_via_id       smallint references public.ship_via (id),
  tax_perc          numeric(5, 2),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.customer_contacts (
  id          bigint generated always as identity primary key,
  customer_id bigint not null references public.customers (id) on delete cascade,
  name        text not null,
  email       text,
  phone       text,
  whatsapp    text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index customer_contacts_customer_idx on public.customer_contacts (customer_id);

-- ---------------------------------------------------------------- jobs
create table public.job_stages (
  id         smallint generated always as identity primary key,
  code       text not null unique,
  name       text not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true
);

-- Workflow is dynamic: allowed moves are data, not code.
-- job_type null = applies to every job type.
create table public.job_stage_transitions (
  id                  bigint generated always as identity primary key,
  from_stage_id       smallint not null references public.job_stages (id),
  to_stage_id         smallint not null references public.job_stages (id),
  job_type            public.job_type,
  required_permission text not null default 'job.advance_stage',
  check (from_stage_id <> to_stage_id)
);
-- enum::text is not immutable, so enforce uniqueness with two partial indexes instead of coalesce().
create unique index job_stage_transitions_typed_uq
  on public.job_stage_transitions (from_stage_id, to_stage_id, job_type) where job_type is not null;
create unique index job_stage_transitions_any_uq
  on public.job_stage_transitions (from_stage_id, to_stage_id) where job_type is null;

create table public.jobs (
  id                  bigint generated always as identity primary key,
  job_no              text not null unique,   -- e.g. TX-000123, set by trigger
  customer_id         bigint not null references public.customers (id),
  customer_contact_id bigint references public.customer_contacts (id),
  front_office_id     smallint not null references public.offices (id),
  back_office_id      smallint references public.offices (id),
  stage_id            smallint references public.job_stages (id),
  title               text,
  description         text,
  order_ref_no        text,
  customer_ref_no     text,
  job_type            public.job_type not null default 'custom',
  style_no            text,
  item_type           text,
  item_sub_type       text,
  size_label          text,
  size_system         text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index jobs_customer_idx on public.jobs (customer_id);
create index jobs_front_office_idx on public.jobs (front_office_id);
create index jobs_back_office_idx on public.jobs (back_office_id);
create index jobs_stage_idx on public.jobs (stage_id);

-- job_no from the front office's job counter; back office defaults from the office row.
create function private.set_job_no() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_counter smallint;
  v_back    smallint;
begin
  select job_counter_id, back_office_id into v_counter, v_back
  from public.offices where id = new.front_office_id;

  if new.job_no is null or new.job_no = '' then
    if v_counter is null then
      raise exception 'office % has no job counter', new.front_office_id;
    end if;
    new.job_no := private.next_counter(v_counter);
  end if;

  if new.back_office_id is null then
    new.back_office_id := v_back;
  end if;
  return new;
end $$;

-- NOT NULL is checked after BEFORE triggers run, so the trigger can fill job_no.
create trigger jobs_set_job_no before insert on public.jobs
  for each row execute function private.set_job_no();

-- ---------------------------------------------------------------- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['companies','offices','customers','customer_private','jobs'] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.touch_updated_at()',
      t || '_touch', t);
  end loop;
end $$;
