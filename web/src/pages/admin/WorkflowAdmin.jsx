import { useState } from 'react';
import { supabase, q } from '../../lib/supabase';
import { useRefData, OWNER_LABEL, JOB_TYPE_LABEL } from '../../lib/refdata';
import { Card, Field, Modal, StagePill, useAction } from '../../components/ui';

export default function WorkflowAdmin() {
  const ref = useRefData();
  const [run, busy] = useAction();
  const [adding, setAdding] = useState(false);

  const updateT = (t, patch) => run(async () => {
    await q(supabase.from('job_stage_transitions').update(patch).eq('id', t.id));
    await ref.reload();
  }, 'Move updated');
  const deleteT = (t) => {
    if (!window.confirm(`Delete the move "${t.label}"? Jobs will no longer be able to make it.`)) return;
    run(async () => { await q(supabase.from('job_stage_transitions').delete().eq('id', t.id)); await ref.reload(); }, 'Move deleted');
  };
  const updateS = (s, patch) => run(async () => {
    await q(supabase.from('job_stages').update(patch).eq('id', s.id));
    await ref.reload();
  }, 'Stage updated');

  return (
    <>
      <Card title="Stages" actions={<small className="muted">Rename a stage or hide it. Codes are fixed because moves and steps refer to them.</small>}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Code</th><th>Shown as</th><th>Order</th><th>Active</th></tr></thead>
            <tbody>
              {ref.stages.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.code}</td>
                  <td><input defaultValue={s.name} maxLength={40} onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && updateS(s, { name: e.target.value.trim() })} aria-label={`Name for ${s.code}`} /></td>
                  <td className="muted">{s.sort_order}</td>
                  <td><input type="checkbox" checked={s.is_active} disabled={busy} onChange={() => updateS(s, { is_active: !s.is_active })} aria-label={`${s.code} active`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Allowed moves" actions={<button className="btn primary" onClick={() => setAdding(true)}>Add move</button>}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>From</th><th>To</th><th>Label</th><th>Who</th><th>Needs first</th><th>Job type</th><th /></tr></thead>
            <tbody>
              {ref.transitions.map((t) => (
                <tr key={t.id}>
                  <td><StagePill stage={ref.stageById[t.from_stage_id]} /></td>
                  <td><StagePill stage={ref.stageById[t.to_stage_id]} /></td>
                  <td><input defaultValue={t.label || ''} maxLength={80} onBlur={(e) => e.target.value !== (t.label || '') && updateT(t, { label: e.target.value || null })} aria-label="Label" /></td>
                  <td>
                    <select value={t.owner_side} disabled={busy} onChange={(e) => updateT(t, { owner_side: e.target.value })} aria-label="Who">
                      {['front', 'back', 'either'].map((s) => <option key={s} value={s}>{OWNER_LABEL[s]}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={t.guard_code || ''} disabled={busy} onChange={(e) => updateT(t, { guard_code: e.target.value || null })} aria-label="Needs first">
                      <option value="">Nothing</option>
                      {ref.milestoneTypes.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
                    </select>
                  </td>
                  <td>{t.job_type ? JOB_TYPE_LABEL[t.job_type] : 'All'}</td>
                  <td><button className="btn sm danger" disabled={busy} onClick={() => deleteT(t)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {adding && <AddMove onClose={() => setAdding(false)} />}
    </>
  );
}

function AddMove({ onClose }) {
  const ref = useRefData();
  const [run, busy] = useAction();
  const [f, setF] = useState({ from: '', to: '', side: 'back', guard: '', job_type: '', label: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const valid = f.from && f.to && f.from !== f.to && f.label.trim();
  async function save() {
    const ok = await run(async () => {
      await q(supabase.from('job_stage_transitions').insert({
        from_stage_id: Number(f.from), to_stage_id: Number(f.to), owner_side: f.side,
        guard_code: f.guard || null, job_type: f.job_type || null, label: f.label.trim(),
      }));
      await ref.reload();
      return true;
    }, 'Move added');
    if (ok) onClose();
  }
  return (
    <Modal title="Add a move" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!valid || busy} onClick={save}>Add</button></>}>
      <div className="form-grid">
        <Field label="From stage"><select value={f.from} onChange={set('from')}><option value="">Choose…</option>{ref.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="To stage"><select value={f.to} onChange={set('to')}><option value="">Choose…</option>{ref.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Button label"><input value={f.label} onChange={set('label')} maxLength={80} /></Field>
        <Field label="Who may do it"><select value={f.side} onChange={set('side')}>{['front', 'back', 'either'].map((s) => <option key={s} value={s}>{OWNER_LABEL[s]}</option>)}</select></Field>
        <Field label="Needs first"><select value={f.guard} onChange={set('guard')}><option value="">Nothing</option>{ref.milestoneTypes.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}</select></Field>
        <Field label="Only for job type"><select value={f.job_type} onChange={set('job_type')}><option value="">All job types</option>{Object.entries(JOB_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </div>
    </Modal>
  );
}
