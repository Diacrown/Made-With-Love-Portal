-- DEMO DATA ONLY: fictitious customers and jobs so every screen has something to show.
-- Run once in Supabase Dashboard -> SQL Editor. Safe to re-run (skips if already loaded).
-- Remove with supabase/seed/demo_data_remove.sql. All aliases start with DEMO-, emails use example.com.

do $$
begin
  if exists (select 1 from public.customers where alias like 'DEMO-%') then
    raise notice 'Demo data already loaded - nothing done';
    return;
  end if;

  with c(office_code, alias, ezj, name, email, city) as (values
    ('GS', 'DEMO-DE-C0026', 'EZ10026', 'Goldhaus Studio',     'orders@goldhaus.example.com',   'Stuttgart'),
    ('GS', 'DEMO-DE-C0042', 'EZ10042', 'Atelier Linden',      'atelier@linden.example.com',    'Stuttgart'),
    ('AS', 'DEMO-AU-C0018', 'EZ20018', 'Harbour Fine Jewels', 'buy@harbour.example.com',       'Sydney'),
    ('AM', 'DEMO-AU-C0032', 'EZ20032', 'Cove Jewelry',        'hello@cove.example.com',        'Melbourne'),
    ('UK', 'DEMO-UK-C0007', 'EZ30007', 'Marlow & Finch',      'studio@marlowfinch.example.com','London'),
    ('TX', 'DEMO-US-C0011', 'EZ40011', 'Lone Star Bridal',    'orders@lonestar.example.com',   'Austin'),
    ('DM', 'DEMO-IN-C0003', 'EZ50003', 'Ratna Jewellers',     'ratna@example.com',             'Mumbai')
  ), ins as (
    insert into public.customers (office_id, alias, ezj_ac_num)
    select o.id, c.alias, c.ezj from c join public.offices o on o.code = c.office_code
    returning id, alias
  )
  insert into public.customer_private (customer_id, name, billing_address, email, currency_code)
  select ins.id, c.name, c.city || ' (demo address)', c.email, o.currency_code
  from ins join c on c.alias = ins.alias join public.offices o on o.code = c.office_code;

  with j(alias, title, job_type, item_type, style_no, size_label, size_system, stage_code, ms) as (values
    ('DEMO-DE-C0026', 'Solitaire ring, catalog R2184',     'catalog',      'Ring',     'R2184', '54',    'EU', 'intake',          '{}'),
    ('DEMO-AU-C0018', 'Oval trilogy engagement ring',      'custom',       'Ring',     null,    'N',     'AU', 'cad_design',      '{}'),
    ('DEMO-DE-C0042', 'Classic four prong bracelet',       'catalog',      'Bracelet', 'B1000', '18 cm', null, 'customer_review', '{cad_accepted}'),
    ('DEMO-US-C0011', 'Pear halo engagement ring',         'custom',       'Ring',     null,    '6',     'US', 'approved',        '{cad_accepted,customer_approved}'),
    ('DEMO-AU-C0032', 'Celestial black diamond pendant',   'catalog',      'Pendant',  'C0008', null,    null, 'production',      '{cad_accepted,customer_approved,production_released}'),
    ('DEMO-DE-C0026', 'Diamond halo pendant',              'catalog_edit', 'Pendant',  'C0004', null,    null, 'qc_ready',        '{cad_accepted,customer_approved,production_released}'),
    ('DEMO-UK-C0007', 'Eternity band',                     'custom',       'Ring',     null,    'M',     'UK', 'ready_to_ship',   '{cad_accepted,customer_approved,production_released,qc_passed}'),
    ('DEMO-US-C0011', 'Graduated diamond necklace',        'catalog',      'Necklace', 'N0412', '45 cm', null, 'dispatched',      '{cad_accepted,customer_approved,production_released,qc_passed,cost_approved}'),
    ('DEMO-IN-C0003', 'Bezel solitaire set',               'catalog',      'Ring',     'R3001', '14',    'IN', 'received',        '{cad_accepted,customer_approved,production_released,qc_passed,cost_approved}'),
    ('DEMO-UK-C0007', 'Contour wedding band',              'catalog',      'Ring',     'R1120', 'L',     'UK', 'closed',          '{cad_accepted,customer_approved,production_released,qc_passed,cost_approved}')
  ), ins as (
    insert into public.jobs (customer_id, front_office_id, title, job_type, item_type, style_no, size_label, size_system, stage_id)
    select cu.id, cu.office_id, j.title, j.job_type::public.job_type, j.item_type, j.style_no, j.size_label, j.size_system, s.id
    from j
    join public.customers cu on cu.alias = j.alias
    join public.job_stages s on s.code = j.stage_code
    returning id, title
  )
  insert into public.job_milestones (job_id, code)
  select ins.id, unnest(j.ms::text[]) from ins join j on j.title = ins.title;

  -- detailed status codes (status changes are normally only possible through set_job_status)
  perform set_config('app.advancing', 'on', true);
  update public.jobs set status_code = 'CRB' where title = 'Solitaire ring, catalog R2184'
    and customer_id in (select id from public.customers where alias like 'DEMO-%');
  update public.jobs set status_code = 'CSC' where title = 'Classic four prong bracelet'
    and customer_id in (select id from public.customers where alias like 'DEMO-%');
  update public.jobs set status_code = 'DEL' where title = 'Bezel solitaire set'
    and customer_id in (select id from public.customers where alias like 'DEMO-%');
  perform set_config('app.advancing', 'off', true);

  raise notice 'Demo data loaded';
end $$;
