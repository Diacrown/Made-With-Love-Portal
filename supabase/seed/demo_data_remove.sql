-- Removes everything created by demo_data.sql (customers with alias DEMO-* and their jobs).
delete from public.jobs where customer_id in (select id from public.customers where alias like 'DEMO-%');
delete from public.customers where alias like 'DEMO-%';
