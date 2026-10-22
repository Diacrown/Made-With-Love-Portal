# Stakeholder demo: data flowing between the front end and the Supabase back end

Everything below runs on the real Supabase project. The screens are a mock-up; sign-in, data, security rules,
workflow and live sync are the real back end.

## 1. Load the demo (once, about 5 minutes)

| Step | Where | What |
|---|---|---|
| 1 | Command Prompt, project folder | `npm run users` (creates the 12 logins; passwords land in `data\users-credentials.csv`) |
| 2 | Supabase -> SQL Editor | Paste and run `supabase/seed/demo_data.sql` |
| 3 | Command Prompt | `npm run sync:pricing` (publishes the price sheet, if not done yet) |
| 4 | Command Prompt | `npm run demo:quotes` (prices every demo job with an accepted CAD using the MWL engine) |

Re-run step 2 (then step 4) any time to **reset** the demo after people have clicked around.
`supabase/seed/demo_data_remove.sql` removes it completely. Demo customers all start with `DEMO-`.

## 2. What the demo contains

12 fictitious customers and 23 jobs spread across the offices that have logins, at every stage of the workflow:

| Office (login) | Jobs | Highlights |
|---|---|---|
| Sydney `sydney@` | 5 | estimate requested · CAD submitted (rush) · waiting customer approval · in production · dispatched (CAD reworked V1 -> V2) |
| Brisbane `brisbane@` | 4 | CAD revision requested · CAD requested · ready for production · in QC |
| Melbourne `melbourne@` | 5 | customer approved · CAD draft · ready to ship · closed · **on hold** |
| Poland `polska@` | 4 | estimate submitted · CAD accepted · received · **cancelled** |
| Diamore / Stuttgart `me@niravmehta.com` | 3 | in production · CAD submitted · catalog job at customer approval |
| London, Austin (admin view) | 2 | local finishing · **QC failed** |

Each job has a specification (metal and stone lines, brief, engraving), a full timeline in **Activity** with the real
people's names, milestones on its checklist, and CAD versions where it has reached CAD. The back office
(`jewellery@`) and the CAD team see 20 of these jobs, with customer **aliases only**.

## 3. The walkthrough (two browsers side by side)

Use two browser windows, or one normal and one private window, so two people are signed in at once.
Left: **Sydney front office**. Right: **Diacrown back office** (`jewellery@`). Watch the **Live** badge (top right).

1. **Who sees what (RBAC + RLS)**
   - Left, Sydney: *Jobs* shows 5 jobs. *Customers* shows the names, emails and addresses.
   - Right, back office: *Jobs* shows 20 jobs from every office it serves. *Customers* shows aliases only, with no names.
   - Open *Back end (live)* on both: the row counts differ for the same tables, and the security probes are refused.
2. **CAD review flows to the front office**
   - Right: open the Sydney job *Pear halo engagement ring* (status CSD, rush) -> **CAD** tab -> **Accept V1**.
   - Left: a toast appears ("SY-… CAD Submitted to Office · by Diacrown Back Office"). The row flashes in *Jobs*.
   - Right: **Overview** -> move it to *Customer approval*. Left: it moves on the list without a refresh.
3. **Customer approval flows back**
   - Left: open it -> record **customer approval** -> move to *Ready for production*.
   - Right: the toast appears, and it now waits on the back office ("Issue PO and release to production").
4. **The workflow enforces the rules**
   - Left: try to move a job that is owned by the back office. The button is disabled and gives the reason.
   - Melbourne's *Marquise toi et moi ring* is **on hold** and cannot move until it is resumed.
   - Poland's *Signet ring* is **cancelled**: its specification is frozen.
5. **CAD team** (sign in as a designer, e.g. `garnet.cad23@`)
   - Brisbane's *Emerald-cut solitaire* has a revision request. Edit the weights -> **Submit**.
   - The back office sees it arrive live. The designer has no Accept button: only the back office can accept.
6. **Quotes from the accepted CAD**
   - *Quotes* lists the demo quotes. Open one: the MWL engine prices it with live metal and FX rates.
   - On any job with an accepted CAD: *Quotes* tab -> **New quote from this job**. Metal weights and stones are prefilled from the CAD.
   - Two people editing the same quote: the second save is refused ("someone else saved this quote").
7. **Audit and admin** (sign in as `itsolutions@`)
   - *Admin -> Audit log*: every click above is recorded with who, when and what changed. Customer personal data is masked.
   - *Admin -> Users & access*: roles per office. *Admin -> Workflow*: stages and transitions are data, not code.

## 4. How the live sync works

- Changes to `jobs`, `job_stage_history`, `job_milestones`, `cad_versions`, `quotes` and `customers` are published
  through **Supabase Realtime** (migration `20261022000012_realtime.sql`).
- Realtime applies the same RLS policies as the API, so a browser only hears about rows its user may read.
  `customer_private` is not published.
- Lists and the job page refresh themselves. On the Specification and CAD tabs, a notice with a Refresh button
  appears instead, so nobody loses what they are typing.

## 5. Notes

- Large centre stones are not in the MWL melee price list. The quote flags them, exactly like the MWL calculator.
- Job numbers keep counting up after a reset, because counters never go backwards. This is by design.
