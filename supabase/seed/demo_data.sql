-- DEMO DATA ONLY: fictitious customers and jobs that exercise every module of the portal:
--   customers (+ private details, contacts) · jobs at every stage · detailed status codes · on hold / cancelled
--   job specification (metal + stone lines, brief, engraving) · CAD versions (draft / revision / submitted /
--   accepted / superseded) · stage + status history (Activity tab) · milestones (checklists) · audit log.
-- Quotes are added afterwards by `npm run demo:quotes` (it prices the accepted CAD with the real MWL engine).
--
-- Run in Supabase Dashboard -> SQL Editor, AFTER `npm run users` so the history shows real names.
-- Re-running RESETS the demo: everything on DEMO-* customers is deleted and loaded fresh
-- (job numbers keep counting up - counters never go backwards). Remove with demo_data_remove.sql.
-- All aliases start with DEMO-, all emails use example.com.

do $$
declare
  j        record;
  v_job    public.jobs;
  v_cust   public.customers;
  v_path   text[];
  v_n      int;
  v_last   int;
  v_seq    int;
  v_stat   text;
  v_from   text;
  v_chain  text[];
  v_code   text;
  v_t      public.job_stage_transitions;
  v_ver    bigint;
  v_vno    int;
  v_front  uuid;
  v_back   uuid;
  v_cad    uuid;
  v_dname  text;
  v_created timestamptz;
  v_span   interval;
  designers text[][] := array[['garnet.cad23@gmail.com', 'Gopal'], ['amethyst.cad23@gmail.com', 'Aakash'],
                              ['sapphire.cad23@gmail.com', 'Sudip'], ['opal.cad23@gmail.com', 'Omkar']];
  i        int;
  k        int;
begin
  -- ------------------------------------------------------------ 0. reset
  delete from public.quotes where job_id in (select j2.id from public.jobs j2 join public.customers c on c.id = j2.customer_id where c.alias like 'DEMO-%');
  delete from public.jobs where customer_id in (select id from public.customers where alias like 'DEMO-%');
  delete from public.customers where alias like 'DEMO-%';

  if (select count(*) from public.offices where code in ('AS', 'AB', 'AM', 'PL', 'DM', 'GS', 'UK', 'TX', 'DC')) < 9 then
    raise exception 'Offices are missing - run the sheet sync (npm run sync) first';
  end if;

  -- ------------------------------------------------------------ 1. reference lists used by the demo customers
  insert into public.payment_terms (name, days) values ('Net 30', 30), ('Net 60', 60), ('Prepaid', 0) on conflict (name) do nothing;
  insert into public.ship_via (name) values ('FedEx Priority'), ('DHL Express'), ('Hand carry') on conflict (name) do nothing;

  -- ------------------------------------------------------------ 2. customers (alias = what the back office sees)
  create temp table _dc (office text, alias text, ezj text, name text, city text, email text, wa text, contact text, terms text, ship text, tax numeric) on commit drop;
  insert into _dc values
    ('AS', 'DEMO-AS-C0101', 'EZ70101', 'Harbour Fine Jewels',        'Sydney NSW 2000',      'buy@harbour.example.com',       '61400000101', 'Olivia Grant',    'Net 30',  'FedEx Priority', 10),
    ('AS', 'DEMO-AS-C0102', 'EZ70102', 'Paddington Bridal Studio',   'Paddington NSW 2021',  'hello@paddington.example.com',  '61400000102', 'Mia Thornton',    'Prepaid', 'Hand carry',     10),
    ('AB', 'DEMO-AB-C0201', 'EZ80201', 'Riverside Diamonds',         'Brisbane QLD 4000',    'orders@riverside.example.com',  '61400000201', 'Jack Hennessy',   'Net 30',  'FedEx Priority', 10),
    ('AB', 'DEMO-AB-C0202', 'EZ80202', 'Sunshine Coast Jewellers',   'Noosa QLD 4567',       'shop@sunshinecoast.example.com','61400000202', 'Chloe Barker',    'Net 60',  'DHL Express',    10),
    ('AM', 'DEMO-AM-C0301', 'EZ60301', 'Cove Jewelry',               'Melbourne VIC 3000',   'hello@cove.example.com',        '61400000301', 'Lachlan Reid',    'Net 30',  'FedEx Priority', 10),
    ('AM', 'DEMO-AM-C0302', 'EZ60302', 'Collins Lane Goldsmiths',    'Melbourne VIC 3000',   'studio@collinslane.example.com','61400000302', 'Ava Mitchell',    'Prepaid', 'Hand carry',     10),
    ('PL', 'DEMO-PL-C0401', 'EZ40401', 'Złotnik Warszawa',           '00-140 Warszawa',      'biuro@zlotnik.example.com',     '48500000401', 'Katarzyna Nowak', 'Net 30',  'DHL Express',    23),
    ('PL', 'DEMO-PL-C0402', 'EZ40402', 'Bursztyn & Co',              '80-001 Gdańsk',        'sklep@bursztyn.example.com',    '48500000402', 'Piotr Wiśniewski','Net 60',  'DHL Express',    23),
    ('DM', 'DEMO-DM-C0501', 'EZ11501', 'Ratna Jewellers',            'Mumbai 400051',        'ratna@example.com',             '91900000501', 'Rahul Shah',      'Net 30',  'Hand carry',      3),
    ('GS', 'DEMO-GS-C0601', 'EZ20601', 'Goldhaus Studio',            '70173 Stuttgart',      'orders@goldhaus.example.com',   '49170000601', 'Lena Vogel',      'Net 30',  'FedEx Priority', 19),
    ('UK', 'DEMO-UK-C0701', 'EZ50701', 'Marlow & Finch',             'London W1',            'studio@marlowfinch.example.com','44700000701', 'Harriet Cole',    'Net 30',  'FedEx Priority', 20),
    ('TX', 'DEMO-TX-C0801', 'EZ10801', 'Lone Star Bridal',           'Austin TX 78731',      'orders@lonestar.example.com',   '15120000801', 'Ethan Brooks',    'Prepaid', 'FedEx Priority',  0);

  insert into public.customers (office_id, alias, ezj_ac_num)
  select o.id, c.alias, c.ezj from _dc c join public.offices o on o.code = c.office;

  insert into public.customer_private (customer_id, name, billing_address, shipping_address, email, whatsapp, currency_code, payment_terms_id, ship_via_id, tax_perc)
  select cu.id, c.name, c.city || ' (demo billing address)', c.city || ' (demo shipping address)', c.email, c.wa, o.currency_code,
         (select id from public.payment_terms where name = c.terms), (select id from public.ship_via where name = c.ship), c.tax
  from _dc c join public.customers cu on cu.alias = c.alias join public.offices o on o.code = c.office;

  insert into public.customer_contacts (customer_id, name, email, phone, is_primary)
  select cu.id, c.contact, c.email, '+' || c.wa, true from _dc c join public.customers cu on cu.alias = c.alias;
  insert into public.customer_contacts (customer_id, name, email, is_primary)
  select cu.id, 'Accounts', replace(c.email, split_part(c.email, '@', 1), 'accounts'), false from _dc c join public.customers cu on cu.alias = c.alias;

  -- ------------------------------------------------------------ 3. jobs
  -- cad: none | draft | revision | submitted | accepted | reworked (V1 superseded after customer changes, V2 accepted)
  create temp table _dj (
    k text, alias text, title text, jt text, item text, style text, size text, sys text, req text, sub text,
    stage text, status text, held text, cad text, days int, due int, rush boolean, qty int, budget numeric,
    cref text, brief text, quick text[], tone text, engrave text, metals jsonb, grams numeric[], stones jsonb, revnote text
  ) on commit drop;

  insert into _dj values
  -- ---------------- Sydney (front office: sydney@)
  ('S1', 'DEMO-AS-C0101', 'Oval solitaire engagement ring', 'custom', 'Ring', null, 'N', 'AU', 'estimate', 'finish',
   'intake', 'ERB', null, 'none', 1, 35, false, 1, 9500, 'HFJ-2210',
   'Classic oval solitaire on a slim knife-edge band, hidden halo under the setting.', '{Comfort Fit,Solid Build Quality}', 'single', null,
   '[{"metal":"18KT WG","color":"White","rhodium":"Yes","finish":"Polished"}]', '{4.2}',
   '[{"pos":"Center","type":"LGD","shape":"OVL","size":"8x6","color":"F","clarity":"VS1","ct":1.10,"pcs":1,"setting":"Prong","source":"B"},
     {"pos":"Halo","type":"DIA","shape":"RND","size":"1.1","color":"G","clarity":"VS","ct":0.006,"pcs":18,"setting":"Micro Pave","source":"B"}]', null),
  ('S2', 'DEMO-AS-C0102', 'Pear halo engagement ring', 'custom', 'Ring', null, 'M', 'AU', 'cad', 'finish',
   'cad_design', 'CSD', null, 'submitted', 6, 18, true, 1, 7800, 'PBS-0419',
   'Pear centre with a tight single halo; split shank with pave on both shoulders.', '{Wed Fit Required,Light Weight}', 'single', 'M & J 14.02.27',
   '[{"metal":"18KT RG","color":"Rose","rhodium":"No","finish":"Polished"}]', '{3.6}',
   '[{"pos":"Center","type":"DIA","shape":"PSH","size":"7x5","color":"G","clarity":"VS2","ct":0.70,"pcs":1,"setting":"Prong","source":"B"},
     {"pos":"Halo","type":"DIA","shape":"RND","size":"1.1","color":"G","clarity":"VS","ct":0.006,"pcs":20,"setting":"Micro Pave","source":"B"},
     {"pos":"Shank","type":"DIA","shape":"RND","size":"1.3","color":"G","clarity":"VS","ct":0.01,"pcs":24,"setting":"Pave","source":"B"}]', null),
  ('S3', 'DEMO-AS-C0101', 'Three-stone trilogy ring', 'custom', 'Ring', null, 'L', 'AU', 'order', 'finish',
   'customer_review', 'CSC', null, 'accepted', 14, 21, false, 1, 12000, 'HFJ-2187',
   'Round centre with two pear sides, basket setting, cathedral shoulders.', '{Solid Build Quality}', 'two', null,
   '[{"metal":"PT950","color":"White","rhodium":"No","finish":"Polished"},{"metal":"18KT YG","color":"Yellow","rhodium":"No","finish":"Polished","notes":"Claws only"}]', '{5.1,0.4}',
   '[{"pos":"Center","type":"DIA","shape":"RND","size":"6.5","color":"F","clarity":"VS1","ct":1.00,"pcs":1,"setting":"Prong","source":"B"},
     {"pos":"Side","type":"DIA","shape":"PSH","size":"6x4","color":"F","clarity":"VS1","ct":0.40,"pcs":2,"setting":"Prong","source":"B"}]', null),
  ('S4', 'DEMO-AS-C0102', 'Diamond tennis bracelet', 'catalog', 'Bracelet', 'B1000', '18 cm', null, 'order', 'finish',
   'production', 'PRD', null, 'none', 25, 10, false, 2, null, 'PBS-0388',
   null, '{Finish}', 'single', null,
   '[{"metal":"14KT WG","color":"White","rhodium":"Yes","finish":"Polished"}]', null,
   '[{"pos":"Line","type":"LGD","shape":"RND","size":"2.5","color":"F","clarity":"VS","ct":0.06,"pcs":52,"setting":"Prong","source":"B"}]', null),
  ('S5', 'DEMO-AS-C0101', 'Halo drop earrings', 'catalog_edit', 'Earrings', 'E2204', null, null, 'order', 'finish',
   'dispatched', 'EXP', null, 'reworked', 45, 2, false, 1, 4200, 'HFJ-2102',
   'Catalog E2204 with a longer drop (+6 mm) and screw backs.', '{Measurements}', 'single', null,
   '[{"metal":"18KT YG","color":"Yellow","rhodium":"No","finish":"Polished"}]', '{4.8}',
   '[{"pos":"Drop","type":"DIA","shape":"OVL","size":"6x4","color":"G","clarity":"VS","ct":0.40,"pcs":2,"setting":"Prong","source":"B"},
     {"pos":"Halo","type":"DIA","shape":"RND","size":"1.1","color":"G","clarity":"VS","ct":0.006,"pcs":32,"setting":"Micro Pave","source":"B"}]',
   'Customer wants the drop 6 mm longer and screw backs instead of butterflies.'),
  -- ---------------- Brisbane (front office: brisbane@)
  ('B1', 'DEMO-AB-C0201', 'Emerald-cut solitaire', 'custom', 'Ring', null, 'O', 'AU', 'cad', 'finish',
   'cad_design', 'CRD', null, 'revision', 9, 20, false, 1, 15000, 'RD-5521',
   'Emerald cut on a four double-claw basket, low profile, plain band.', '{Comfort Fit,Profile Type}', 'single', null,
   '[{"metal":"PT950","color":"White","rhodium":"No","finish":"Polished"}]', '{5.6}',
   '[{"pos":"Center","type":"LGD","shape":"EME","size":"7x5","color":"E","clarity":"VVS2","ct":1.00,"pcs":1,"setting":"Prong","source":"B"}]',
   'Basket sits too high - drop it 0.8 mm and make the double claws thinner.'),
  ('B2', 'DEMO-AB-C0202', 'Bezel set pendant', 'catalog', 'Pendant', 'P0410', null, null, 'cad', 'finish',
   'intake', 'CRB', null, 'none', 2, 30, false, 1, null, 'SCJ-117',
   null, '{Budget Friendly}', 'single', null,
   '[{"metal":"9KT YG","color":"Yellow","rhodium":"No","finish":"Polished"}]', null,
   '[{"pos":"Center","type":"GEM","shape":"RND","size":"6.5","color":"Blue","clarity":"AA","ct":1.00,"pcs":1,"setting":"Bezel","source":"O","notes":"Sapphire supplied by the office"}]', null),
  ('B3', 'DEMO-AB-C0201', 'Matching wedding band pair', 'custom', 'Ring', null, 'P', 'AU', 'order', 'finish',
   'approved', null, null, 'accepted', 18, 24, false, 2, 3600, 'RD-5490',
   'His and hers: 5 mm court band and 2.5 mm half-eternity band.', '{Comfort Fit,Wed Fit Required}', 'single', 'Forever 21.03.27',
   '[{"metal":"18KT YG","color":"Yellow","rhodium":"No","finish":"Polished"}]', '{7.9}',
   '[{"pos":"Band","type":"DIA","shape":"RND","size":"1.5","color":"G","clarity":"VS","ct":0.015,"pcs":15,"setting":"Channel","source":"B"}]', null),
  ('B4', 'DEMO-AB-C0202', 'Sapphire cluster ring', 'custom', 'Ring', null, 'N', 'AU', 'order', 'finish',
   'qc_ready', 'QCR', null, 'accepted', 33, 5, false, 1, 5200, 'SCJ-102',
   'Vintage-style cluster: oval sapphire centre, round diamond surround.', '{Finish}', 'single', null,
   '[{"metal":"18KT WG","color":"White","rhodium":"Yes","finish":"Polished"}]', '{4.4}',
   '[{"pos":"Center","type":"GEM","shape":"OVL","size":"7x5","color":"Blue","clarity":"AAA","ct":1.10,"pcs":1,"setting":"Prong","source":"B"},
     {"pos":"Cluster","type":"DIA","shape":"RND","size":"2.0","color":"G","clarity":"VS","ct":0.03,"pcs":12,"setting":"Prong","source":"B"}]', null),
  -- ---------------- Melbourne (front office: melbourne@)
  ('M1', 'DEMO-AM-C0301', 'Celestial black diamond pendant', 'catalog', 'Pendant', 'C0008', null, null, 'order', 'finish',
   'customer_review', 'APP', null, 'none', 12, 25, false, 1, null, 'COVE-881',
   null, '{}', 'single', null,
   '[{"metal":"14KT YG","color":"Yellow","rhodium":"No","finish":"Polished"}]', null,
   '[{"pos":"Center","type":"GEM","shape":"RND","size":"5.0","color":"Black","clarity":"AA","ct":0.50,"pcs":1,"setting":"Bezel","source":"B"},
     {"pos":"Stars","type":"DIA","shape":"RND","size":"1.3","color":"G","clarity":"VS","ct":0.01,"pcs":9,"setting":"Flush","source":"B"}]', null),
  ('M2', 'DEMO-AM-C0302', 'Cushion halo ring', 'custom', 'Ring', null, 'M', 'AU', 'cad', 'finish',
   'cad_design', 'CRD', null, 'draft', 7, 28, false, 1, 8800, 'CLG-0310',
   'Cushion centre, double halo, pave band to half way.', '{Solid Build Quality}', 'single', null,
   '[{"metal":"18KT WG","color":"White","rhodium":"Yes","finish":"Polished"}]', '{4.9}',
   '[{"pos":"Center","type":"LGD","shape":"SCU","size":"6.5","color":"F","clarity":"VS1","ct":1.30,"pcs":1,"setting":"Prong","source":"B"},
     {"pos":"Halo","type":"DIA","shape":"RND","size":"1.1","color":"G","clarity":"VS","ct":0.006,"pcs":44,"setting":"Micro Pave","source":"B"},
     {"pos":"Band","type":"DIA","shape":"RND","size":"1.3","color":"G","clarity":"VS","ct":0.01,"pcs":16,"setting":"Pave","source":"B"}]', null),
  ('M3', 'DEMO-AM-C0301', 'Graduated diamond necklace', 'catalog', 'Necklace', 'N0412', '45 cm', null, 'order', 'finish',
   'ready_to_ship', null, null, 'none', 40, 3, false, 1, null, 'COVE-850',
   null, '{Measurements}', 'single', null,
   '[{"metal":"18KT WG","color":"White","rhodium":"Yes","finish":"Polished"}]', null,
   '[{"pos":"Line","type":"DIA","shape":"RND","size":"2.0","color":"G","clarity":"VS","ct":0.03,"pcs":60,"setting":"Prong","source":"B"}]', null),
  ('M4', 'DEMO-AM-C0302', 'Contour wedding band', 'catalog', 'Ring', 'R1120', 'L', 'AU', 'order', 'finish',
   'closed', null, null, 'none', 75, -30, false, 1, null, 'CLG-0244',
   null, '{Wed Fit Required}', 'single', null,
   '[{"metal":"18KT RG","color":"Rose","rhodium":"No","finish":"Matte"}]', null,
   '[]', null),
  ('M5', 'DEMO-AM-C0301', 'Marquise toi et moi ring', 'custom', 'Ring', null, 'K', 'AU', 'order', 'finish',
   'customer_review', 'ONH', 'CSC', 'accepted', 20, 30, false, 1, 9900, 'COVE-872',
   'Marquise and pear side by side on an open band.', '{}', 'single', null,
   '[{"metal":"18KT YG","color":"Yellow","rhodium":"No","finish":"Polished"}]', '{3.9}',
   '[{"pos":"Stone A","type":"LGD","shape":"MQS","size":"10x5","color":"F","clarity":"VS1","ct":1.00,"pcs":1,"setting":"Prong","source":"B"},
     {"pos":"Stone B","type":"LGD","shape":"PSH","size":"8x5","color":"F","clarity":"VS1","ct":0.90,"pcs":1,"setting":"Prong","source":"B"}]', null),
  -- ---------------- Poland (front office: polska@)
  ('P1', 'DEMO-PL-C0401', 'Amber and diamond pendant', 'custom', 'Pendant', null, null, null, 'estimate', 'semi',
   'intake', 'ESO', null, 'none', 3, 40, false, 3, 2500, 'ZW/2026/114',
   'Customer supplies Baltic amber cabochons; we make the bail and a diamond accent frame.', '{Budget Friendly,Light Weight}', 'single', null,
   '[{"metal":"Silver 925","color":"White","rhodium":"Yes","finish":"Polished"}]', null,
   '[{"pos":"Center","type":"GEM","shape":"OVL","size":"14x10","color":"Honey","clarity":"-","ct":3.50,"pcs":1,"setting":"Bezel","source":"C","notes":"Amber - customer supplied"},
     {"pos":"Frame","type":"DIA","shape":"RND","size":"1.3","color":"G","clarity":"SI","ct":0.01,"pcs":14,"setting":"Pave","source":"B"}]', null),
  ('P2', 'DEMO-PL-C0402', 'Princess-cut engagement ring', 'custom', 'Ring', null, '52', 'EU', 'cad', 'finish',
   'cad_design', 'CSO', null, 'accepted', 10, 22, false, 1, 6500, 'BC-0907',
   'Princess cut in a four V-prong head, hidden diamonds in the gallery.', '{Wed Fit Required}', 'single', null,
   '[{"metal":"14KT WG","color":"White","rhodium":"Yes","finish":"Polished"}]', '{3.3}',
   '[{"pos":"Center","type":"DIA","shape":"PRN","size":"5.5","color":"G","clarity":"VS2","ct":1.00,"pcs":1,"setting":"Prong","source":"B"},
     {"pos":"Gallery","type":"DIA","shape":"RND","size":"1.3","color":"G","clarity":"VS","ct":0.01,"pcs":8,"setting":"Pave","source":"B"}]', null),
  ('P3', 'DEMO-PL-C0401', 'Diamond eternity band', 'custom', 'Ring', null, '54', 'EU', 'order', 'finish',
   'received', 'IMP', null, 'accepted', 52, -2, false, 1, 4800, 'ZW/2026/071',
   'Full eternity, shared-prong, 2.2 mm rounds.', '{Comfort Fit}', 'single', null,
   '[{"metal":"PT950","color":"White","rhodium":"No","finish":"Polished"}]', '{4.6}',
   '[{"pos":"Band","type":"DIA","shape":"RND","size":"2.2","color":"F","clarity":"VS","ct":0.04,"pcs":24,"setting":"Prong","source":"B"}]', null),
  ('P4', 'DEMO-PL-C0402', 'Signet ring with engraving', 'catalog_edit', 'Ring', 'R3001', '58', 'EU', 'order', 'finish',
   'customer_review', 'CAN', 'CSC', 'accepted', 16, 10, false, 1, 1900, 'BC-0899',
   'Catalog R3001 with an oval face and the family crest engraved.', '{}', 'single', 'Family crest',
   '[{"metal":"9KT YG","color":"Yellow","rhodium":"No","finish":"Polished"}]', '{9.2}',
   '[]', null),
  -- ---------------- Diamore (front: DM) and Stuttgart (back office DM) - Nirav
  ('D1', 'DEMO-DM-C0501', 'Bezel solitaire set', 'catalog', 'Ring', 'R3001', '14', 'IN', 'order', 'finish',
   'production', 'PRD', null, 'none', 22, 8, false, 3, null, 'RJ-3344',
   null, '{}', 'single', null,
   '[{"metal":"18KT YG","color":"Yellow","rhodium":"No","finish":"Polished"}]', null,
   '[{"pos":"Center","type":"DIA","shape":"RND","size":"5.0","color":"H","clarity":"SI1","ct":0.50,"pcs":1,"setting":"Bezel","source":"B"}]', null),
  ('D2', 'DEMO-DM-C0501', 'Diamond mangalsutra pendant', 'custom', 'Pendant', null, null, null, 'cad', 'finish',
   'cad_design', 'CSD', null, 'submitted', 5, 20, true, 1, null, 'RJ-3360',
   'Modern mangalsutra pendant: two teardrops with a diamond line between.', '{Light Weight}', 'single', null,
   '[{"metal":"18KT YG","color":"Yellow","rhodium":"No","finish":"Polished"}]', '{3.2}',
   '[{"pos":"Line","type":"DIA","shape":"RND","size":"1.5","color":"G","clarity":"VS","ct":0.015,"pcs":22,"setting":"Pave","source":"B"}]', null),
  ('G1', 'DEMO-GS-C0601', 'Solitaire ring, catalog R2184', 'catalog', 'Ring', 'R2184', '54', 'EU', 'order', 'finish',
   'customer_review', 'CSC', null, 'none', 8, 26, false, 1, null, 'GH-7781',
   null, '{}', 'single', null,
   '[{"metal":"18KT WG","color":"White","rhodium":"Yes","finish":"Polished"}]', null,
   '[{"pos":"Center","type":"LGD","shape":"RND","size":"6.5","color":"E","clarity":"VS1","ct":1.00,"pcs":1,"setting":"Prong","source":"B"}]', null),
  -- ---------------- London and Austin (back office Diacrown)
  ('U1', 'DEMO-UK-C0701', 'Oval trilogy ring', 'custom', 'Ring', null, 'M', 'UK', 'order', 'finish',
   'local_finishing', null, null, 'reworked', 58, -5, false, 1, 6900, 'MF-1290',
   'Oval centre with tapered baguette sides.', '{Finish}', 'single', null,
   '[{"metal":"PT950","color":"White","rhodium":"No","finish":"Polished"}]', '{5.4}',
   '[{"pos":"Center","type":"DIA","shape":"OVL","size":"8x6","color":"F","clarity":"VS1","ct":1.10,"pcs":1,"setting":"Prong","source":"B"},
     {"pos":"Side","type":"DIA","shape":"TAP","size":"4x2","color":"F","clarity":"VS","ct":0.08,"pcs":2,"setting":"Channel","source":"B"}]',
   'Customer prefers tapered baguettes instead of pears on the sides.'),
  ('T1', 'DEMO-TX-C0801', 'Pear halo engagement ring', 'custom', 'Ring', null, '6', 'US', 'order', 'finish',
   'qc_ready', 'QCF', null, 'accepted', 30, 6, true, 1, 7400, 'LSB-6620',
   'Pear centre, halo, plain polished band.', '{Solid Build Quality}', 'single', null,
   '[{"metal":"14KT YG","color":"Yellow","rhodium":"No","finish":"Polished"}]', '{3.4}',
   '[{"pos":"Center","type":"LGD","shape":"PSH","size":"8x5","color":"F","clarity":"VS1","ct":0.90,"pcs":1,"setting":"Prong","source":"B"},
     {"pos":"Halo","type":"DIA","shape":"RND","size":"1.1","color":"G","clarity":"VS","ct":0.006,"pcs":22,"setting":"Micro Pave","source":"B"}]', null);

  create temp table _ev (job_id bigint, seq int, from_stage text, to_stage text, from_status text, to_status text, side text, note text) on commit drop;
  create temp table _ms (job_id bigint, code text, seq int, side text, primary key (job_id, code)) on commit drop;

  for j in select d.*, row_number() over (order by d.k) as rn from _dj d order by d.k loop
    select * into v_cust from public.customers where alias = j.alias;
    v_front := (select u.id from auth.users u where lower(u.email) = case (select code from public.offices where id = v_cust.office_id)
                 when 'AS' then 'sydney@worldshiner.com' when 'AB' then 'brisbane@worldshiner.com'
                 when 'AM' then 'melbourne@worldshiner.com' when 'PL' then 'polska@worldshiner.com'
                 when 'DM' then 'me@niravmehta.com' when 'GS' then 'me@niravmehta.com' else 'itsolutions@worldshiner.com' end);
    v_back  := (select u.id from auth.users u where lower(u.email) = case
                 when (select code from public.offices where id = (select back_office_id from public.offices where id = v_cust.office_id)) = 'DM'
                 then 'me@niravmehta.com' else 'jewellery@worldshiner.com' end);
    k := 1 + (j.rn::int % 4);
    v_dname := designers[k][2];
    v_cad := (select u.id from auth.users u where lower(u.email) = designers[k][1]);
    v_created := now() - make_interval(days => j.days) - interval '3 hours';
    v_span := make_interval(days => j.days) * 0.9;

    insert into public.jobs (customer_id, front_office_id, title, description, order_ref_no, customer_ref_no, job_type, style_no,
                             item_type, size_label, size_system, created_by, created_at,
                             request_type, sub_type, ref_type, ref_no, due_date, is_rush, quantity, budget, budget_currency,
                             customer_request, design_brief, quick_options, metal_tone, target_metal_weight,
                             stamping, stamping_location, engrave_text, engrave_location, engrave_method, form_variant)
    values (v_cust.id, v_cust.office_id, j.title, j.brief, 'PO-' || j.cref, j.cref, j.jt::public.job_type, j.style,
            j.item, j.size, j.sys, v_front, v_created,
            j.req, j.sub, case when j.style is not null then 'style' end, j.style, (now() + make_interval(days => j.due))::date, j.rush, j.qty,
            j.budget, case when j.budget is not null then (select currency_code from public.offices where id = v_cust.office_id) end,
            'Demo request from ' || j.alias || ': ' || lower(j.title) || '.', j.brief, j.quick, j.tone,
            (select sum(g) from unnest(j.grams) g), case when j.metals->0->>'metal' like '%KT%' then upper(split_part(j.metals->0->>'metal', ' ', 1)) end,
            case when j.item = 'Ring' then 'Inside shank' end, j.engrave, case when j.engrave is not null then 'Inside shank' end,
            case when j.engrave is not null then 'laser' end, case when jsonb_array_length(j.stones) > 1 or j.engrave is not null then 'advanced' else 'simple' end)
    returning * into v_job;

    insert into public.job_metal_lines (job_id, line_no, metal, color, rhodium, finish, notes)
    select v_job.id, m.ord, m.e->>'metal', m.e->>'color', m.e->>'rhodium', m.e->>'finish', m.e->>'notes'
    from jsonb_array_elements(j.metals) with ordinality as m(e, ord);
    insert into public.job_stone_lines (job_id, line_no, position, in_mounting, stone_type, shape, size, color, clarity, ct_pc, pcs, setting, source, notes)
    select v_job.id, s.ord, s.e->>'pos', true, s.e->>'type', s.e->>'shape', s.e->>'size', s.e->>'color', s.e->>'clarity',
           (s.e->>'ct')::numeric, (s.e->>'pcs')::int, s.e->>'setting', s.e->>'source', s.e->>'notes'
    from jsonb_array_elements(j.stones) with ordinality as s(e, ord);

    -- ---- the path this job took to its current stage
    v_path := case when j.jt = 'catalog'
      then array['intake', 'customer_review', 'approved', 'production', 'qc_ready', 'ready_to_ship', 'dispatched', 'received', 'closed']
      else array['intake', 'cad_design', 'customer_review', 'approved', 'production', 'qc_ready', 'ready_to_ship', 'dispatched', 'received', 'closed'] end;
    if j.cad = 'reworked' then
      v_path := array['intake', 'cad_design', 'customer_review', 'cad_design', 'customer_review', 'approved', 'production', 'qc_ready', 'ready_to_ship', 'dispatched', 'received', 'closed'];
    end if;
    if j.stage = 'local_finishing' then
      v_path := array_replace(v_path, 'closed', 'local_finishing');
    end if;
    v_last := 0;
    for i in 1 .. array_length(v_path, 1) loop
      if v_path[i] = j.stage then v_last := i; end if;
    end loop;
    if v_last = 0 then raise exception 'Demo job %: stage % not on its path', j.k, j.stage; end if;
    v_path := v_path[1:v_last];
    v_n := v_last;

    delete from public.job_stage_history where job_id = v_job.id;   -- replaced by the full timeline below
    v_seq := 0;
    v_stat := null;
    insert into _ev values (v_job.id, v_seq, null, 'intake', null, null, 'front', 'Job created');

    for i in 1 .. v_n loop
      -- status changes inside this stage
      if i < v_n then
        v_chain := case v_path[i]
          when 'intake'          then case when j.jt = 'catalog' then '{}'::text[] else '{CRB}'::text[] end
          when 'cad_design'      then '{CSD,CSO}'::text[]
          when 'customer_review' then case when v_path[i + 1] = 'cad_design' then '{CSC,REJ}'::text[] else '{CSC,APP}'::text[] end
          when 'qc_ready'        then '{QCP}'::text[]
          when 'received'        then '{DEL}'::text[]
          else '{}'::text[] end;
      else
        v_code := coalesce(j.held, j.status);
        v_chain := case v_code
          when 'ESO' then '{ERB,ESO}'::text[]
          when 'CRD' then case when j.cad = 'revision' then '{CSD,CRD}'::text[] else '{}'::text[] end
          when 'CSO' then '{CSD,CSO}'::text[]
          when 'APP' then '{CSC,APP}'::text[]
          when 'QCF' then '{QCP,QCF}'::text[]
          when 'DEL' then '{DEL}'::text[]
          else case when v_code is null or v_code = (select default_status_code from public.job_stages where code = v_path[i]) then '{}'::text[] else array[v_code] end
        end;
        if j.held is not null then v_chain := v_chain || array[j.status]; end if;
      end if;
      foreach v_code in array v_chain loop
        v_seq := v_seq + 1;
        insert into _ev values (v_job.id, v_seq, v_path[i], v_path[i], v_stat, v_code,
          (select owner_side from public.job_statuses where code = v_code),
          case when v_code = 'CRD' and i = v_n then 'CAD sheet: ' || j.revnote
               when v_code = 'REJ' then j.revnote
               when v_code = 'QCF' then 'Prong on the centre stone is loose; one halo stone chipped. Back to production.'
               when v_code = 'ONH' then 'Customer travelling - asked us to pause until next month.'
               when v_code = 'CAN' then 'Customer cancelled: chose a ring from stock instead.'
               when v_code in ('CSD', 'CSO') then 'CAD sheet' end);
        if v_code in ('CSO', 'APP', 'QCP') then
          insert into _ms values (v_job.id, case v_code when 'CSO' then 'cad_accepted' when 'APP' then 'customer_approved' else 'qc_passed' end, v_seq,
                                  case v_code when 'APP' then 'front' else 'back' end)
          on conflict (job_id, code) do update set seq = excluded.seq;
        elsif v_code = 'REJ' then delete from _ms where job_id = v_job.id and code = 'customer_approved';
        elsif v_code = 'QCF' then delete from _ms where job_id = v_job.id and code = 'qc_passed';
        end if;
        v_stat := v_code;
      end loop;
      -- move to the next stage
      if i < v_n then
        select t.* into v_t from public.job_stage_transitions t
          join public.job_stages f on f.id = t.from_stage_id join public.job_stages s on s.id = t.to_stage_id
          where f.code = v_path[i] and s.code = v_path[i + 1] and (t.job_type is null or t.job_type::text = j.jt)
          order by t.job_type nulls last limit 1;
        if v_t.id is null then raise exception 'Demo job %: no transition % -> %', j.k, v_path[i], v_path[i + 1]; end if;
        if v_t.guard_code is not null then
          v_seq := v_seq + 1;
          insert into _ms values (v_job.id, v_t.guard_code, v_seq, (select owner_side from public.milestone_types where code = v_t.guard_code))
          on conflict (job_id, code) do update set seq = excluded.seq;
        end if;
        if cardinality(v_t.clears_milestones) > 0 then
          delete from _ms where job_id = v_job.id and code = any (v_t.clears_milestones);
        end if;
        v_from := v_stat;
        v_stat := (select default_status_code from public.job_stages where code = v_path[i + 1]);
        v_seq := v_seq + 1;
        insert into _ev values (v_job.id, v_seq, v_path[i], v_path[i + 1], v_from, v_stat,
                                case v_t.owner_side when 'front' then 'front' else 'back' end,
                                case when v_path[i] = 'customer_review' and v_path[i + 1] = 'cad_design' then j.revnote end);
      end if;
    end loop;

    -- ---- write the timeline, milestones and the job's final position
    insert into public.job_stage_history (job_id, from_stage_id, to_stage_id, from_status, to_status, changed_by, changed_at, note)
    select e.job_id, fs.id, ts.id, e.from_status, e.to_status,
           case e.side when 'front' then v_front when 'back' then v_back else coalesce(v_front, v_back) end,
           v_created + v_span * (e.seq::numeric / greatest(v_seq, 1)), e.note
    from _ev e left join public.job_stages fs on fs.code = e.from_stage join public.job_stages ts on ts.code = e.to_stage
    where e.job_id = v_job.id;

    insert into public.job_milestones (job_id, code, set_at, set_by)
    select m.job_id, m.code, v_created + v_span * (m.seq::numeric / greatest(v_seq, 1)),
           case m.side when 'front' then v_front else v_back end
    from _ms m where m.job_id = v_job.id;

    perform set_config('app.advancing', 'on', true);
    update public.jobs set stage_id = (select id from public.job_stages where code = j.stage), status_code = j.status,
           held_from_status = case when j.status = 'ONH' then j.held end
    where id = v_job.id;
    perform set_config('app.advancing', 'off', true);

    -- ---- CAD versions (what the CAD tab and the quote calculator start from)
    if j.cad <> 'none' then
      v_vno := 0;
      foreach v_code in array case j.cad when 'reworked' then '{superseded,accepted}'::text[] else array[j.cad] end loop
        v_vno := v_vno + 1;
        insert into public.cad_versions (job_id, version_no, status, designer_name, cad_date, client_instructions, notes, review_note,
                                         created_by, created_at, submitted_by, submitted_at, reviewed_by, reviewed_at)
        values (v_job.id, v_vno, v_code, v_dname, (v_created + v_span * (0.15 + 0.35 * (v_vno - 1)))::date,
                coalesce(j.brief, 'Follow catalog ' || j.style || '.'),
                case when v_vno > 1 then 'V' || v_vno || ': ' || j.revnote end,
                case when v_code = 'revision' then j.revnote when v_code = 'superseded' then 'Approved internally; customer later asked for changes.'
                     when v_code = 'accepted' then 'Looks good - send to customer.' end,
                v_cad, v_created + v_span * (0.10 + 0.35 * (v_vno - 1)),
                case when v_code <> 'draft' then v_cad end,
                case when v_code <> 'draft' then v_created + v_span * (0.20 + 0.35 * (v_vno - 1)) end,
                case when v_code in ('revision', 'accepted', 'superseded') then v_back end,
                case when v_code in ('revision', 'accepted', 'superseded') then v_created + v_span * (0.25 + 0.35 * (v_vno - 1)) end)
        returning id into v_ver;

        insert into public.cad_version_metals (cad_version_id, line_no, metal, grams, rhodium, finish)
        select v_ver, m.ord, m.e->>'metal',
               case when v_code = 'draft' and m.ord = 1 then null else j.grams[m.ord] + (v_vno - 1) * 0.3 end,
               m.e->>'rhodium', m.e->>'finish'
        from jsonb_array_elements(j.metals) with ordinality as m(e, ord) where m.ord <= 3;
        insert into public.cad_version_stones (cad_version_id, line_no, position, stone_type, shape, size, ct_pc, pcs, role, setting_style)
        select v_ver, s.ord, s.e->>'pos', s.e->>'type', s.e->>'shape', s.e->>'size', (s.e->>'ct')::numeric, (s.e->>'pcs')::int,
               lower(s.e->>'pos'), s.e->>'setting'
        from jsonb_array_elements(j.stones) with ordinality as s(e, ord);
      end loop;
    end if;
  end loop;

  raise notice 'Demo data loaded: % customers, % jobs', (select count(*) from _dc), (select count(*) from _dj);
end $$;
