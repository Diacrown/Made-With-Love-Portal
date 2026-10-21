# Web app (round 1) - setup and demo guide

React + Vite app in `web/`, hosted on Netlify, talking straight to Supabase with the signed-in user's
token. All access rules live in the database (RLS + functions), so the browser cannot bypass them.

## What it does
- Sign in (email + password), password reset, change password, sign-out after 30 minutes idle.
- Screens follow the user's role and office: Overview ("your turn"), Jobs, Job detail (stage track,
  checklist steps, allowed moves, history), Customers, How jobs move, My account.
- Admin (global admins only): users and their office roles, add / deactivate users, role-permission
  matrix, workflow editor (stages, moves, who, what is needed first), audit log, error log.
- Error screens: 401 session ended, 403 not allowed, 404 not found, offline, 500 crash (logged).

## One-time setup

1. **Database**: the new migration (`..._app_backend.sql`) deploys through the GitHub integration on push.
2. **Supabase Auth settings** (Dashboard -> Authentication):
   - Turn OFF "Allow new users to sign up". Only admins create accounts.
   - URL configuration: set Site URL to your Netlify address and add `https://<your-site>.netlify.app/**`
     to Redirect URLs (needed for password-reset links).
3. **Edge Function** `admin-users` (Add user / Deactivate): deploys from `supabase/functions` through the
   GitHub integration. Set the secret `ALLOWED_ORIGIN` to your Netlify address
   (Dashboard -> Edge Functions -> Secrets). If it does not deploy automatically:
   `npx supabase functions deploy admin-users`.
4. **Netlify**: Add new site -> Import from GitHub -> this repo. `netlify.toml` already sets base `web`.
   Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   (the publishable / anon key - the app refuses to start with a secret key).
5. **First admin**: create your own user (Dashboard -> Authentication -> Add user), then in the SQL editor:
   ```sql
   insert into public.user_office_roles (user_id, office_id, role_id)
   select u.id, null, r.id from auth.users u, public.roles r
   where u.email = 'you@company.com' and r.code = 'admin';
   ```
   After that, create everyone else from Admin -> Users & access.
6. **Demo data (optional)**: run `supabase/seed/demo_data.sql` in the SQL editor. Remove it later with
   `supabase/seed/demo_data_remove.sql`.

## Stakeholder demo script
1. Sign in as a Stuttgart front-office user: open a job, see full customer details, send a CAD request.
2. Sign in as a Mumbai back-office user: the same job shows the customer as "Restricted"; record
   "Accept the CAD version" and move the job to Customer approval.
3. Try a move that is not yours: the button is disabled with the reason, and the database refuses it anyway.
4. Sign in as admin: show the audit log entries those two users just created, change who owns a move in
   Workflow, deactivate a user.

## Local development
```bash
cd web
cp .env.example .env    # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

## Coming next
- Round 2: generated outputs (job card / CAD request PDFs) saved to Supabase Storage with a record per file.
- Round 3: LLM + RAG (Claude through an Edge Function, document search with Supabase embeddings).
