// Live metal spot + FX rates for the quote calculator, cached for 10 minutes in rate_snapshots (shared by everyone).
// Port of the Unified Quote Calculator's rates.mjs: spot from api.gold-api.com (or MetalMaster > SpotRateSource),
// FX from several free sources tried in turn. When every source fails, the last snapshot is returned (stale: true);
// the calculator then falls back to the sheet's backup spot rate and Location > FXR, exactly as the MWL page did.
// POST {} or { force: true }   -> { spot, fx, at, stale?, errors }
import { createClient } from "npm:@supabase/supabase-js@2";

const TTL_MS = 10 * 60e3;
const SPOT_SYM: Record<string, string> = { AU: "XAU", AG: "XAG", PT: "XPT", PD: "XPD" };
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function getJson(url: string, ms = 8000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { accept: "application/json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function fetchRates(model: any) {
  const errors: string[] = [];
  const spot: Record<string, { price: number; at: string }> = {};
  await Promise.all(Object.entries(model.metals || {}).map(async ([k, m]: [string, any]) => {
    const url = /^https:\/\/api\.gold-api\.com\//.test(m.spotSrc || "") ? m.spotSrc : SPOT_SYM[k] && "https://api.gold-api.com/price/" + SPOT_SYM[k];
    if (!url) return;
    try {
      const j = await getJson(url);
      const p = Number(j && j.price);
      if (p > 0) spot[k] = { price: p, at: j.updatedAt || new Date().toISOString() };
      else errors.push(`${k} spot: no price`);
    } catch (e) { errors.push(`${k} spot: ${(e as Error).name === "AbortError" ? "timed out" : (e as Error).message}`); }
  }));
  const curs = [...new Set((model.locations || []).map((l: any) => l.currency).filter((c: string) => c && c !== "USD"))] as string[];
  const pick = (rates: any, upper: boolean) => Object.fromEntries(curs.map((c) => [c, Number(rates[upper ? c : c.toLowerCase()])]).filter(([, v]) => (v as number) > 0));
  const SOURCES: [string, string, (j: any) => any][] = [
    ["ECB (frankfurter)", `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${curs}`, (j) => j.rates && { date: j.date, rates: pick(j.rates, true) }],
    ["ECB (frankfurter)", `https://api.frankfurter.app/latest?from=USD&to=${curs}`, (j) => j.rates && { date: j.date, rates: pick(j.rates, true) }],
    ["open.er-api.com", "https://open.er-api.com/v6/latest/USD", (j) => j.rates && { date: String(j.time_last_update_utc || "").slice(5, 16), rates: pick(j.rates, true) }],
    ["currency-api", "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json", (j) => j.usd && { date: j.date, rates: pick(j.usd, false) }],
  ];
  let fx: any = null;
  if (curs.length) {
    for (const [name, url, read] of SOURCES) {
      try {
        const r = read(await getJson(url));
        if (r && Object.keys(r.rates).length) { fx = { ...r, src: name }; break; }
        errors.push(`${name}: no rates`);
      } catch (e) { errors.push(`${name}: ${(e as Error).name === "AbortError" ? "timed out" : (e as Error).message}`); }
    }
  } else fx = { date: "", rates: {}, src: "none needed" };
  return { spot, fx, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const auth = req.headers.get("Authorization");
  if (!auth) return json(401, { error: "Not signed in" });
  const url = Deno.env.get("SUPABASE_URL")!;
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: access, error: accErr } = await caller.rpc("my_access");
  if (accErr) return json(401, { error: "Session expired. Sign in again." });
  if (!(access ?? []).some((r: any) => r.permission_code === "quote.read")) return json(403, { error: "Your role cannot see prices" });

  let force = false;
  try { force = !!(await req.json())?.force; } catch { /* empty body */ }

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: last } = await admin.from("rate_snapshots").select("*").order("at", { ascending: false }).limit(1).maybeSingle();
  if (!force && last && Date.now() - new Date(last.at).getTime() < TTL_MS) {
    return json(200, { spot: last.spot, fx: last.fx, at: last.at, errors: last.errors, cached: true });
  }
  const { data: live } = await admin.from("pricing_models").select("model").eq("is_live", true).maybeSingle();
  if (!live) return json(200, { spot: {}, fx: null, at: null, errors: ["No live price data published yet"], stale: true });

  const fresh = await fetchRates(live.model);
  if (!Object.keys(fresh.spot).length && !fresh.fx) {
    return last ? json(200, { spot: last.spot, fx: last.fx, at: last.at, errors: fresh.errors, stale: true })
                : json(200, { spot: {}, fx: null, at: null, errors: fresh.errors, stale: true });
  }
  const merged = { spot: { ...(last?.spot || {}), ...fresh.spot }, fx: fresh.fx || last?.fx || null, errors: fresh.errors };
  const { data: saved } = await admin.from("rate_snapshots").insert(merged).select("at").single();
  return json(200, { ...merged, at: saved?.at || new Date().toISOString() });
});
