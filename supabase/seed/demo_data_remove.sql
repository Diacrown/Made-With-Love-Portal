-- Removes everything created by demo_data.sql / npm run demo:quotes: quotes on demo jobs, the jobs
-- (their spec, CAD versions, history and milestones go with them) and the DEMO-* customers.
delete from public.quotes where job_id in (select j.id from public.jobs j join public.customers c on c.id = j.customer_id where c.alias like 'DEMO-%');
delete from public.jobs where customer_id in (select id from public.customers where alias like 'DEMO-%');
delete from public.customers where alias like 'DEMO-%';
