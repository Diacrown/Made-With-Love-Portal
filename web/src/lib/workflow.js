// Mirrors the rules in public.advance_job() / public.record_milestone() so the UI can show
// which buttons apply. The database re-checks everything; this only decides what to display.
import { OWNER_LABEL } from './refdata';

function sideAllows(side, perm, job, can) {
  if (side === 'front') return can(perm, job.front_office_id);
  if (side === 'back') return can(perm, job.back_office_id);
  return can(perm, job.front_office_id) || can(perm, job.back_office_id);
}

/** Moves out of the job's current stage, each with allowed + reason. */
export function movesFor(job, ref, can, milestones) {
  const have = new Set(milestones || []);
  const candidates = ref.transitions.filter((t) =>
    t.from_stage_id === job.stage_id && (t.job_type === null || t.job_type === job.job_type));
  // A job-type specific rule wins over a general one for the same destination.
  const byTo = new Map();
  candidates.forEach((t) => {
    const prev = byTo.get(t.to_stage_id);
    if (!prev || (prev.job_type === null && t.job_type !== null)) byTo.set(t.to_stage_id, t);
  });
  return [...byTo.values()].map((t) => {
    const to = ref.stageById[t.to_stage_id];
    const sideOk = sideAllows(t.owner_side, t.required_permission, job, can);
    const guardOk = !t.guard_code || have.has(t.guard_code);
    const guard = t.guard_code && ref.milestoneTypes.find((m) => m.code === t.guard_code);
    let reason = null;
    if (!sideOk) reason = `Only the ${OWNER_LABEL[t.owner_side].toLowerCase()} of this job can do this.`;
    else if (!guardOk) reason = `First: ${guard ? guard.label.toLowerCase() : t.guard_code}.`;
    return { t, to, label: t.label || `Move to ${to?.name}`, allowed: sideOk && guardOk, sideOk, guardOk, reason };
  }).sort((a, b) => (a.to?.sort_order ?? 0) - (b.to?.sort_order ?? 0));
}

/** Milestones that can be recorded at the job's current stage. */
export function checklistFor(job, ref, can, milestones) {
  const have = new Set(milestones || []);
  const stage = ref.stageById[job.stage_id];
  return ref.milestoneTypes
    .filter((m) => m.stage_code === stage?.code)
    .map((m) => ({
      m,
      done: have.has(m.code),
      canRecord: sideAllows(m.owner_side, 'job.update', job, can),
    }));
}

/** Things this user can do on this job right now (for "Your turn"). */
export function myTurn(job, ref, can, milestones) {
  const items = [];
  checklistFor(job, ref, can, milestones).forEach((c) => { if (!c.done && c.canRecord) items.push(c.m.label); });
  movesFor(job, ref, can, milestones).forEach((mv) => { if (mv.allowed) items.push(mv.label); });
  return items;
}
