// Live price data + rates for the calculator. The model is the checked MWL model published by
// scripts/sync-pricing.mjs; rates come from the "rates" Edge Function (cached 10 min server-side).
// When live rates are unavailable the engine falls back to the sheet's backup spot rate and Location FXR,
// exactly like the MWL page.
import { useCallback, useEffect, useState } from 'react';
import { supabase, q, callFunction } from './supabase';
import { createPricer } from '../pricing/pricing.js';
import { parsePmDate } from '../pricing/util.js';

let cache = null; // { id, version, model, P, published_at }

export function usePricing() {
  const [state, setState] = useState(() => (cache ? { loading: false, error: null, ...cache, live: { spot: {}, fx: null }, rateInfo: { loading: true } } : { loading: true, error: null }));

  const loadRates = useCallback(async (force = false) => {
    setState((s) => ({ ...s, rateInfo: { ...(s.rateInfo || {}), loading: true } }));
    try {
      const r = await callFunction('rates', force ? { force: true } : {});
      setState((s) => ({ ...s, live: { spot: r.spot || {}, fx: r.fx || null, at: r.at ? Date.parse(r.at) : null }, rateInfo: { loading: false, stale: !!r.stale, errors: r.errors || [], at: r.at } }));
    } catch (e) {
      setState((s) => ({ ...s, live: { spot: {}, fx: null }, rateInfo: { loading: false, failed: true, message: e.message } }));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!cache) {
          const row = await q(supabase.from('pricing_models').select('id, version, model, published_at').eq('is_live', true).maybeSingle());
          if (!row) { const e = new Error('No price data has been published yet. An administrator runs "npm run sync:pricing".'); e.code = 'NO_PRICING'; throw e; }
          cache = { id: row.id, version: row.version, model: row.model, published_at: row.published_at, P: createPricer(row.model) };
        }
        if (alive) setState((s) => ({ ...s, loading: false, error: null, ...cache, live: s.live || { spot: {}, fx: null } }));
        if (alive) loadRates();
      } catch (error) {
        if (alive) setState({ loading: false, error });
      }
    })();
    return () => { alive = false; };
  }, [loadRates]);

  return { ...state, refreshRates: () => loadRates(true) };
}

export function pmState(model) {
  const pm = model.pm || {};
  const date = pm.date || parsePmDate(pm.dateTxt);
  return { ok: !!pm.ok && !!date, dateTxt: pm.dateTxt || '', stale: !date || Date.now() - date > 2 * 864e5, err: pm.err || '' };
}

/** Clears the cached model (after an admin switches the live version). */
export const resetPricingCache = () => { cache = null; };
