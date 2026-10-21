import { useCallback, useEffect, useRef, useState } from 'react';
import { logError } from './errors';

/** Run an async loader, track loading/error, and re-run when deps change. */
export function useLoad(loader, deps) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const seq = useRef(0);
  const run = useCallback(async () => {
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await loader();
      if (my === seq.current) setState({ loading: false, error: null, data });
    } catch (error) {
      logError(error);
      if (my === seq.current) setState({ loading: false, error, data: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
