# Job workflow

Source: "How jobs move" in the Made With Love Operations prototype. Stages and moves are data
(`job_stages`, `job_stage_transitions`), so the flow can change without code changes.
Jobs move only through `select public.advance_job(job_id, 'stage_code', 'optional note')`.

| # | Code | Shown as | Normally worked by |
|---|---|---|---|
| 1 | intake | New | Front office |
| 2 | cad_design | CAD | Back office / designer |
| 3 | customer_review | Customer approval | Front office |
| 4 | approved | Ready for production | Back office |
| 5 | production | In production | Factory |
| 6 | qc_ready | QC | QC specialist |
| 7 | ready_to_ship | Ready to ship | Back office |
| 8 | dispatched | Dispatched | Front office |
| 9 | received | Received | Front office |
| 10 | local_finishing | Local finishing (optional) | Front office |
| 11 | closed | Closed | |

## Allowed moves

| From -> To | Who may move it | Needs first (milestone) |
|---|---|---|
| New -> CAD | front or back | |
| New -> Customer approval (catalog jobs only) | back | |
| CAD -> Customer approval | back | `cad_accepted` |
| Customer approval -> Ready for production | front | `customer_approved` |
| Customer approval -> CAD (customer wants changes) | front | clears `cad_accepted`, `customer_approved` |
| Ready for production -> In production | back | `production_released` |
| In production -> QC | back | |
| QC -> Ready to ship | back | `qc_passed` |
| QC -> In production (QC failed) | back | clears `qc_passed` |
| Ready to ship -> Dispatched | back | `cost_approved` |
| Dispatched -> Received | front | |
| Received -> Closed / Local finishing | front | |
| Local finishing -> Closed | front | |

"Front" and "back" mean the job's own front office and back office. A global admin counts as both.
Milestones are rows in `job_milestones`, written by the module that owns the fact (CAD review, quote
approval, PO issue, QC, finance). Those modules are not built yet, so nothing sets them today.

Not enforced yet: "an unresolved change request blocks approval" (needs the change-request table).
