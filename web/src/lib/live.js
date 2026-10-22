// Supabase Realtime: refresh open screens when someone else changes the data.
// Realtime applies RLS, so a user only hears about rows they may read.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { supabase } from './supabase';

let seq = 0;
let status = 'connecting';
const watchers = new Set();
function setStatus(s) {
  if (s === status) return;
  status = s;
  watchers.forEach((w) => w());
}
/** 'connecting' | 'live' | 'offline' - for the Live badge. */
export const useLiveStatus = () => useSyncExternalStore((w) => { watchers.add(w); return () => watchers.delete(w); }, () => status);

/**
 * Call onChange when any of the sources change.
 * sources: ['jobs', { table: 'job_stage_history', filter: 'job_id=eq.12', event: 'INSERT' }, ...]
 * Bursts are merged (debounce ms, 0 = every event).
 */
export function useLive(sources, onChange, { debounce = 400, enabled = true } = {}) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const list = sources.map((s) => (typeof s === 'string' ? { table: s } : s));
  const key = list.map((s) => `${s.table}|${s.filter || ''}|${s.event || '*'}`).join(',');
  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    const channel = supabase.channel(`live-${++seq}`);
    list.forEach((s) => channel.on('postgres_changes',
      { event: s.event || '*', schema: 'public', table: s.table, ...(s.filter ? { filter: s.filter } : {}) },
      (payload) => {
        if (!debounce) { cb.current(payload); return; }
        clearTimeout(timer);
        timer = setTimeout(() => cb.current(payload), debounce);
      }));
    channel.subscribe((s) => {
      if (s === 'SUBSCRIBED') setStatus('live');
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') setStatus('offline');
    });
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, debounce]);
}
