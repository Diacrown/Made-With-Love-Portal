import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase, q } from './supabase';

// Reference data every screen needs: stages, moves, offices, milestone types, roles.
const RefCtx = createContext(null);

export function RefDataProvider({ children }) {
  const [state, setState] = useState({ loading: true, error: null });

  const load = useCallback(async () => {
    try {
      const [stages, transitions, offices, milestoneTypes, roles, statuses] = await Promise.all([
        q(supabase.from('job_stages').select('*').order('sort_order')),
        q(supabase.from('job_stage_transitions').select('*').order('id')),
        q(supabase.from('offices').select('id, code, name, city, country, company_id, back_office_id, currency_code').order('code')),
        q(supabase.from('milestone_types').select('*')),
        q(supabase.from('roles').select('*').order('id')),
        q(supabase.from('job_statuses').select('*').order('sort_order')),
      ]);
      const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
      setState({
        loading: false, error: null,
        stages, transitions, offices, milestoneTypes, roles, statuses,
        statusByCode: Object.fromEntries(statuses.map((x) => [x.code, x])),
        stageById: byId(stages), officeById: byId(offices), roleById: byId(roles),
        stageByCode: Object.fromEntries(stages.map((s) => [s.code, s])),
      });
    } catch (error) {
      setState({ loading: false, error });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return <RefCtx.Provider value={{ ...state, reload: load }}>{children}</RefCtx.Provider>;
}

export const useRefData = () => useContext(RefCtx);

export const OWNER_LABEL = { front: 'Front office', back: 'Back office', factory: 'Factory', qc: 'QC', either: 'Front or back office' };
/** "CRD · CAD Requested to Designer" */
export const statusText = (s, withCode = true) => (!s ? '' : `${withCode ? `${s.code} · ` : ''}${s.label}${s.direction ? ` ${s.direction} ${s.party}` : ''}`);
export const JOB_TYPE_LABEL = { custom: 'Custom', catalog: 'Catalog', catalog_edit: 'Catalog edit' };
