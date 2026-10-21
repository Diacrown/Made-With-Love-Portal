# Jewelry Portal - database

Supabase (Postgres + RLS) schema for the organisation-wide jewellery portal, with a sync that loads the
"DB Schema" Google Sheet into it.

```
web/                   React + Vite portal (login, role-based screens, admin) - see docs/web-app.md
supabase/migrations/   core schema -> RBAC -> RLS -> API grants -> roles -> workflow -> app backend (in order)
supabase/functions/    admin-users Edge Function (create / deactivate users)
supabase/seed/         demo data (fictitious) and the staff roster template
scripts/sync-gsheet.mjs  Google Sheet (or CSV folder) -> Supabase
.github/workflows/     manual sync workflow
docs/                  sheet-to-table mapping + access matrix
```

## One-time setup

1. Create the GitHub repo and push this folder.
2. Create a Supabase project (note the project ref and database password).
3. Link and apply the schema:
   ```bash
   npm i -g supabase            # or: npx supabase ...
   supabase init                # creates supabase/config.toml (keeps existing migrations)
   supabase login
   supabase link --project-ref <ref>
   supabase db push
   ```
   Optional: in Supabase Dashboard -> Project Settings -> Integrations -> GitHub, connect this repo so
   migrations deploy from the repo.
4. Load the sheet:
   ```bash
   npm install
   cp .env.example .env         # fill SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
   npm run sync:dry             # check what would be written
   npm run sync
   ```
   Share the sheet as "Anyone with the link: Viewer", or export tabs as CSV into `./data` and set `SHEET_CSV_DIR`.
5. For the GitHub workflow, add repo secrets `SHEET_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Notes

- The sync is idempotent (upserts on natural keys) and never resets live job/invoice counters.
- The sheet is a seed/migration source. After go-live, counters and customers are owned by the database.
- The service-role key bypasses RLS: keep it in `.env` / GitHub secrets only.
- Job numbers: `PREFIX-000001` (never reset). Invoice numbers: `PREFIX-YYYY-000001` (reset yearly, calendar year).
- The Supabase project has "Automatically expose new tables" turned off. Every migration that adds a table must also
  grant it explicitly (see `supabase/migrations/20261021000004_grants.sql`), otherwise the API returns "permission denied".
