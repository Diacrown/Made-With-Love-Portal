// The quote calculator (MWL "Calculator" mock). All prices come from the MWL engine (web/src/pricing),
// unchanged, so a quote here equals the same quote in the MWL page and the Unified Quote Calculator.
import { useMemo, useState } from 'react';
import { usd, money, num, priceCode } from '../pricing/util.js';
import { BLANK, CUSTOM_SIZE, ALT_MAX, ALT_L, TEXT_WHEN_CUSTOM } from '../pricing/pricing.js';
import { ITEM_TYPES, MODES, conformQuote, applyLocation, blankRow, altId } from '../pricing/quote.js';
import { pmState } from '../lib/pricingData';

const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
const BL = (v) => (v === BLANK ? '— blank —' : v);

export default function Calculator({ P, model, live, rateInfo, onRefreshRates, S, setS, readOnly }) {
  const pm = pmState(model);
  const t = useMemo(() => P.totals(S, live), [P, S, live]);
  const lm = P.LM(S.metal.laborMode);
  const loc = P.locOf(S.price.location);

  /** Apply a change to a copy of the quote, then keep it consistent with the price data (MWL conformState). */
  const update = (fn) => {
    if (readOnly) return;
    const next = clone(S);
    fn(next);
    conformQuote(next, P, { pmOk: pm.ok });
    setS(next);
  };
  const setField = (part, key) => (e) => { const v = e.target.value; update((q) => { q[part][key] = v; }); };
  const setTop = (key) => (e) => { const v = e.target.value; update((q) => { q[key] = v; }); };

  const alloyOpts = [...model.alloys.filter((a) => a.star), ...model.alloys.filter((a) => !a.star)];
  const dis = readOnly;

  return (
    <div className="calc-grid">
      {!S.price.location && !readOnly && <div className="note warn span2">Pick a <b>location</b> first: it sets the duty, currency and stone price list.</div>}

      <section className="card">
        <header className="card-hd"><h2>Job details</h2></header>
        <div className="card-bd form-grid">
          <Lbl t="Job #"><input value={S.job.jobNo} onChange={setField('job', 'jobNo')} disabled={dis} /></Lbl>
          <Lbl t="Item #"><input value={S.job.itemNo} onChange={setField('job', 'itemNo')} disabled={dis} /></Lbl>
          <Lbl t="Designer"><input value={S.job.designer} onChange={setField('job', 'designer')} disabled={dis} /></Lbl>
          <Lbl t="Date"><input type="date" value={S.job.date} onChange={setField('job', 'date')} disabled={dis} /></Lbl>
          <Lbl t="Item type"><select value={S.job.itemType} onChange={setField('job', 'itemType')} disabled={dis}><option value="">—</option>{[...new Set([...ITEM_TYPES, S.job.itemType].filter(Boolean))].map((x) => <option key={x}>{x}</option>)}</select></Lbl>
          <Lbl t="Size"><input value={S.job.size} onChange={setField('job', 'size')} disabled={dis} /></Lbl>
          <Lbl t="Render URL"><input value={S.job.renderUrl} onChange={setField('job', 'renderUrl')} disabled={dis} placeholder="https://…" /></Lbl>
        </div>
      </section>

      <section className="card">
        <header className="card-hd"><h2>Price settings</h2></header>
        <div className="card-bd form-grid">
          <Lbl t="Location">
            <select value={S.price.location} onChange={(e) => { const v = e.target.value; update((q) => applyLocation(q, P, v)); }} disabled={dis} aria-invalid={!S.price.location} aria-label="Location">
              <option value="">Select location…</option>
              {model.locations.map((l) => <option key={l.code} value={l.code}>{l.alias || l.code} ({l.code})</option>)}
            </select>
          </Lbl>
          <Lbl t="CAD type" hint={!lm.cad ? 'Locked by labour policy' : ''}>
            <select value={S.price.cadType} onChange={setField('price', 'cadType')} disabled={dis || !lm.cad} aria-label="CAD type">
              {P.CAD.map(([name, fee]) => <option key={name} value={name}>{name} · ${fee}</option>)}
            </select>
          </Lbl>
          <Lbl t="Stone price list">
            <select value={S.price.priceList} onChange={setField('price', 'priceList')} disabled={dis} aria-label="Stone price list">
              <option value="">—</option>
              {model.priceLists.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.code})</option>)}
            </select>
          </Lbl>
          <Lbl t="Duty %"><input inputMode="decimal" value={S.price.duty} onChange={setField('price', 'duty')} disabled={dis} aria-label="Duty percent" /></Lbl>
          <Lbl t="Currency">
            <select value={S.price.currency} onChange={setField('price', 'currency')} disabled={dis} aria-label="Currency">
              <option value="">—</option>
              {[...new Set(['USD', ...model.locations.map((l) => l.currency)])].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Lbl>
          <Lbl t="Customer"><input value={S.price.customer} onChange={setField('price', 'customer')} disabled={dis} /></Lbl>
          <Lbl t="Customer reference"><input value={S.price.customerRef} onChange={setField('price', 'customerRef')} disabled={dis} /></Lbl>
        </div>
      </section>

      <section className="card span2">
        <header className="card-hd">
          <h2>Metal details</h2>
          <div className="card-actions small muted">Metal <b className="mono">{usd(t.value)}</b> · Cast chrgs <b className="mono">{usd(t.castChg)}</b> · <b className="mono">{t.gms.toFixed(3)}</b> g</div>
        </header>
        <div className="card-bd metal-grid">
          <div className="form-grid">
            <Lbl t="Metal 1"><select value={S.metal.m1} onChange={setField('metal', 'm1')} disabled={dis} aria-label="Metal 1"><option value="">Select alloy</option>{alloyOpts.map((a, i) => <option key={a.code + i} value={a.code}>{a.star ? '★ ' : ''}{a.code} · {a.name}</option>)}</select></Lbl>
            <Lbl t="Grams"><input inputMode="decimal" value={S.metal.g1} onChange={setField('metal', 'g1')} disabled={dis} aria-label="Metal 1 grams" /></Lbl>
            <Lbl t="Metal 2"><select value={S.metal.m2} onChange={setField('metal', 'm2')} disabled={dis} aria-label="Metal 2"><option value="">— none —</option>{alloyOpts.map((a, i) => <option key={a.code + i} value={a.code}>{a.code} · {a.name}</option>)}</select></Lbl>
            <Lbl t="Grams"><input inputMode="decimal" value={S.metal.g2} onChange={setField('metal', 'g2')} disabled={dis || !S.metal.m2} aria-label="Metal 2 grams" /></Lbl>
            <Lbl t="Labour policy" hint={[!lm.cad && 'no CAD', !lm.set && 'setting $0', !lm.cast && 'no casting charge'].filter(Boolean).join(' · ')}>
              <select value={S.metal.laborMode} onChange={(e) => { const v = e.target.value; update((q) => {
                const had = P.LM(q.metal.laborMode).cad; q.metal.laborMode = v;
                if (!P.LM(v).cad && had) { q.price.cadPrev = q.price.cadType; q.price.cadType = 'None'; } else if (P.LM(v).cad && !had && q.price.cadPrev) q.price.cadType = q.price.cadPrev;
              }); }} disabled={dis} aria-label="Labour policy">
                {model.labor.map((m) => <option key={m.caption} value={m.caption}>{m.caption}{m.desc ? ` · ${m.desc}` : ''}</option>)}
              </select>
            </Lbl>
            <Lbl t="Metal rate">
              <div className="seg" role="group" aria-label="Metal rate">
                {['Spot', 'PM'].map((v) => (
                  <button key={v} type="button" aria-pressed={t.rateType === v} disabled={dis || !pm.ok}
                    onClick={() => update((q) => { q.metal.rateType = v; q.metal.rateUser = true; })}>{v}</button>
                ))}
              </div>
            </Lbl>
          </div>
          <table className="table rates">
            <thead><tr><th>Rate/oz</th><th className={t.rateType === 'PM' ? 'on' : ''}>PM</th><th className={t.rateType === 'Spot' ? 'on' : ''}>Spot</th></tr></thead>
            <tbody>
              {['AU', 'PT', 'PD', 'AG'].filter((k) => model.metals[k]).map((k) => {
                const m = model.metals[k], spot = P.spotOf(k, live), liveSpot = live?.spot?.[k]?.price > 0;
                return (
                  <tr key={k}>
                    <td title={`${m.name} · wastage ×${m.wastage} · surcharge ×${m.surcharge}`}>{m.code}</td>
                    <td className={`mono ${t.rateType === 'PM' ? 'on' : ''}`}>{m.pm ? usd(m.pm, 2) : '—'}</td>
                    <td className={`mono ${t.rateType === 'Spot' ? 'on' : ''}`} title={liveSpot ? 'Live spot × surcharge' : 'Backup spot rate from the sheet × surcharge'}>{spot ? usd(spot * m.surcharge, 2) : '—'}{!liveSpot && spot ? '*' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan={3} className="small muted">
              PM {pm.ok ? pm.dateTxt : 'unavailable'}{pm.ok && pm.stale ? ' (stale)' : ''} · Spot {rateInfo?.loading ? 'loading…' : rateInfo?.failed || rateInfo?.stale ? 'backup rates*' : live?.at ? new Date(live.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
              {onRefreshRates && <> · <button type="button" className="link-btn small" onClick={onRefreshRates}>refresh</button></>}
            </td></tr></tfoot>
          </table>
        </div>
      </section>

      <StoneTable P={P} S={S} t={t} update={update} readOnly={readOnly} />

      <AltGrid P={P} S={S} live={live} update={update} readOnly={readOnly} alloyOpts={alloyOpts} />

      <section className="card span2 totals-card">
        <div className="totals">
          <Tot label={lm.cast ? 'Casting' : 'Casting (metal value)'} v={usd(t.casting)} p={t} n={t.casting} />
          <Tot label={t.laborMode === P.DEF.labor ? 'Labour' : `Labour · ${t.laborMode}`} v={usd(t.labor)} p={t} n={t.labor} />
          <Tot label={`CAD · ${S.price.cadType}`} v={usd(t.cad)} p={t} n={t.cad} />
          <Tot label="Gemstones" v={usd(t.dia)} p={t} n={t.dia} />
          <Tot label="Setting" v={usd(t.set)} p={t} n={t.set} sub={!lm.set ? `not charged · ${t.laborMode}` : null} />
          <div className="tot">
            <small>{(S.addLabel || '').trim() || 'Add charges'}</small>
            <div className="row gap">
              <input className="mono" inputMode="decimal" value={S.addBasis === 'pct' ? S.addPct : S.addCharges} disabled={dis} aria-label="Additional charges"
                onChange={(e) => { const v = e.target.value; update((q) => { if (q.addBasis === 'pct') q.addPct = v; else q.addCharges = v; }); }} />
              <select value={S.addBasis} onChange={(e) => { const v = e.target.value; update((q) => { q.addBasis = v; }); }} disabled={dis} aria-label="Add charges basis"><option value="amt">$</option><option value="pct">%</option></select>
            </div>
            <small className="muted">{t.add ? `${usd(t.add, 2)} · ${t.addPct.toFixed(1)}% of subtotal` : 'amount or % of subtotal'}</small>
          </div>
          <div className="tot">
            <small>Override · {S.price.currency || '—'}</small>
            <input className="mono" inputMode="decimal" value={S.override} onChange={setTop('override')} disabled={dis} placeholder={t.local ? String(t.local) : ''} aria-label="Override total" />
            <small className="muted">{t.local ? `calculated ${S.price.currency} ${t.local.toLocaleString('en-US')}` : 'calculated —'}</small>
          </div>
          <div className="tot strong"><small>Gross USD</small><b className="mono">{usd(t.gross)}</b></div>
          <div className="tot strong"><small>USD · duty {t.duty}%{t.gross ? ` (${usd(t.withDuty - t.gross)})` : ''}</small><b className="mono">{usd(t.withDuty)}</b><small className="mono muted" title="Price code">{priceCode(t.withDuty)}</small></div>
          <div className="tot final">
            <small>{S.price.location ? `${S.price.location} total · ${S.price.currency}` : 'Total · select location'}</small>
            <b className="mono">{t.ov ? <><s>{money(S.price.currency, t.local)}</s> {money(S.price.currency, t.ov)}</> : t.final ? money(S.price.currency, t.final) : '—'}</b>
            <small>{!loc ? 'pick a location first' : S.price.currency === 'USD' ? 'USD · no conversion' : !t.fx ? `no rate for ${S.price.currency}` : `fx ${t.fx.toFixed(4)} incl. ${((loc.buffer || 0) * 100).toFixed(0)}% buffer · rounded to 5`}</small>
          </div>
        </div>
        {t.gross > 0 && (
          <div className="mixbar" aria-hidden="true">
            {[t.casting, t.labor, t.cad, t.dia, t.set, t.add].map((v, k) => <span key={k} className={`mx${k}`} style={{ width: `${(v / t.gross) * 100}%` }} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function Lbl({ t, hint, children }) {
  return <label className="field"><span>{t}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}
function Tot({ label, v, p, n, sub }) {
  return <div className="tot"><small>{label}</small><b className="mono">{v}</b><small className="muted">{sub || (p.gross ? `${((n / p.gross) * 100).toFixed(1)}% of total` : '0.0% of total')}</small></div>;
}

/* ---------------------------------------------------------------- stone details */
function StoneTable({ P, S, t, update, readOnly }) {
  const PL = S.price.priceList;
  const lm = P.LM(S.metal.laborMode);
  const setRow = (i, fn) => update((q) => { fn(q.stones[i], q); P.conformRow(q.stones[i], q); });
  const sel = (i, key, value, opts, { disabled, label, render = (x) => x } = {}) => (
    <select value={value || ''} disabled={readOnly || disabled} aria-label={`${label || key} row ${i + 1}`}
      onChange={(e) => {
        const v = e.target.value;
        setRow(i, (r) => {
          if (key === 'shape' && v !== r.shape) Object.assign(r, { shape: v, size: '', dims: '', color: '', clarity: '', spec: '' });
          else if (key === 'color' && v !== r.color) Object.assign(r, { color: v, clarity: '', spec: '' });
          else if (key === 'clarity' && v !== r.clarity) Object.assign(r, { clarity: v, spec: '' });
          else r[key] = v;
        });
      }}>
      <option value="">{disabled ? '—' : 'Select'}</option>
      {opts.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{render(o)}</option> : <option key={o.v} value={o.v}>{o.l}</option>))}
    </select>
  );
  const txt = (i, key, value, ph, cls = '') => (
    <input className={cls} value={value ?? ''} placeholder={ph} disabled={readOnly} aria-label={`${key} row ${i + 1}`}
      onChange={(e) => { let v = e.target.value; if (key === 'pcs') v = v.replace(/[^0-9]/g, ''); update((q) => { q.stones[i][key] = v; }); }} />
  );
  const setType = (i, v) => update((q) => {
    const r = q.stones[i];
    if (v === r.type) return;
    const was = r.type;
    if (v === 'Custom') Object.assign(r, { type: v, size: r.size === CUSTOM_SIZE ? r.dims || '' : P.sizeLabel(r), color: r.color === BLANK ? '' : r.color, clarity: r.clarity === BLANK ? '' : r.clarity, spec: r.spec === BLANK ? '' : r.spec });
    else if (r.type === 'Custom') Object.assign(r, { type: v, shape: '', size: '', dims: '', color: '', clarity: '', spec: '', ppcManual: '' });
    else Object.assign(r, { type: v, color: '', clarity: '', spec: '' });
    if (v === 'Mount' || was === 'Mount') { r.label = ''; delete r.labelKey; }
    P.conformRow(r, q);
  });

  return (
    <section className="card span2">
      <header className="card-hd">
        <h2>Stone details</h2>
        <div className="card-actions small">
          {t.flagged > 0 && <span className="pill warn">{t.flagged} row{t.flagged > 1 ? 's' : ''} need input</span>}
          <span className="muted">Total <b className="mono">{t.pcs}</b> pcs | <b className="mono">{t.ct.toFixed(3)}</b> cttw · stones <b className="mono">{usd(t.dia)}</b> · setting <b className="mono">{usd(t.set)}</b></span>
        </div>
      </header>
      <div className="card-bd">
        <div className="table-wrap">
          <table className="table stones-calc">
            <thead><tr><th>#</th><th>Type</th><th>Shape</th><th>Size</th><th>Color</th><th>Clarity</th><th>Spec</th><th>Label as</th><th>ct/Pc</th><th>Pcs</th><th>CTTW</th><th>$/Ct</th><th>Total</th><th>SetRate</th><th>Mode</th><th>SetTot</th><th /></tr></thead>
            <tbody>
              {S.stones.map((r, i) => {
                const c = P.calcRow(r, S);
                const isText = r.type === 'Custom';
                const sizes = r.shape && !isText ? P.sizesFor(r.shape).map((s) => ({ v: s.code, l: `${s.mm}${s.wt ? ` · ${s.wt}` : ''}` })).concat([{ v: CUSTOM_SIZE, l: 'Custom size — enter ct/pc…' }]) : [];
                return (
                  <tr key={i} className={c.flags.length ? 'flag' : ''} title={c.flags.join(' · ')}>
                    <td className="muted">{i + 1}</td>
                    <td><select value={r.type} onChange={(e) => setType(i, e.target.value)} disabled={readOnly} aria-label={`Type row ${i + 1}`}>{P.TYPES.map((x) => <option key={x}>{x}</option>)}</select></td>
                    {isText ? <>
                      <td>{txt(i, 'shape', r.shape, 'Shape')}</td>
                      <td>{txt(i, 'size', r.size, 'e.g. 8.10×5.65')}</td>
                      <td>{txt(i, 'color', r.color, 'Color', 'w-xs')}</td>
                      <td>{txt(i, 'clarity', r.clarity, 'Clarity', 'w-xs')}</td>
                      <td>{txt(i, 'spec', r.spec, 'Spec', 'w-xs')}</td>
                    </> : <>
                      <td>{sel(i, 'shape', r.shape, P.SHAPES)}</td>
                      <td>
                        {sel(i, 'size', r.size, sizes, { disabled: !r.shape })}
                        {r.size === CUSTOM_SIZE && <input className="w-s" value={r.dims || ''} placeholder="dims" disabled={readOnly} aria-label={`dims row ${i + 1}`} onChange={(e) => { const v = e.target.value; update((q) => { q.stones[i].dims = v; }); }} />}
                      </td>
                      {r.type === 'Mount'
                        ? <td colSpan={3}>{txt(i, 'label', r.label, 'Mount description')}</td>
                        : <>
                          <td>{sel(i, 'color', r.color, P.colorsFor(r, PL), { disabled: !(r.type && r.shape) || !PL, render: BL })}</td>
                          <td>{sel(i, 'clarity', r.clarity, P.claritiesFor(r, PL), { disabled: !r.color, render: BL })}</td>
                          <td>{sel(i, 'spec', r.spec, P.specsFor(r, PL), { disabled: !(r.color && r.clarity), render: BL })}</td>
                        </>}
                    </>}
                    <td>{r.type === 'Mount' ? null : txt(i, 'label', r.label, P.defaultLabel(r, S.price.location) || 'Label')}</td>
                    <td className={c.custom ? '' : 'calc mono'}>{c.custom ? txt(i, 'ctManual', r.ctManual, '0.000', 'w-s mono') : c.empty ? '' : c.ctpc ? c.ctpc.toFixed(4) : '—'}</td>
                    <td>{txt(i, 'pcs', r.pcs, '', 'w-xs mono')}</td>
                    <td className="calc mono">{c.empty ? '' : c.cttw.toFixed(3)}</td>
                    <td className={c.manualPpc && !c.empty ? '' : 'calc mono'} title={c.auto ? `List ${usd(c.listPrice, 2)} + handling ${usd(c.handling, 2)} = ${usd(c.ppc, 2)}/ct · StonePrice row ${c.priceRow}${c.how === 'gap' ? ' · between two weight bands: lower band' : ''}` : ''}>
                      {c.manualPpc && !c.empty ? txt(i, 'ppcManual', r.ppcManual, '$/ct', 'w-s mono') : c.empty || r.type === 'Mount' ? '' : c.ppc ? usd(c.ppc) : '—'}
                    </td>
                    <td className="calc mono">{c.empty ? '' : usd(c.total, 2)}</td>
                    <td className={c.setEdit && !c.empty ? '' : 'calc mono'}>
                      {c.setEdit && !c.empty
                        ? <input className="w-xs mono" value={String(r.setRate ?? '') !== '' ? r.setRate : ''} placeholder={c.setAuto ? c.setAuto.toFixed(2) : 'rate'} disabled={readOnly || !lm.set} aria-label={`Setting rate row ${i + 1}`}
                          onChange={(e) => { const v = e.target.value; update((q) => { q.stones[i].setRate = v; }); }} />
                        : c.empty ? '' : !lm.set ? '—' : c.setAuto ? c.setAuto.toFixed(2) : '—'}
                    </td>
                    <td className={c.modeEdit && !c.empty ? '' : 'calc'}>
                      {c.modeEdit && !c.empty
                        ? <select value={c.mode} disabled={readOnly} onChange={(e) => { const v = e.target.value; update((q) => { q.stones[i].setMode = v; }); }} aria-label={`Setting mode row ${i + 1}`}><option value="PPC">PPC</option><option value="PCT">PCT</option></select>
                        : c.empty ? '' : <b>{c.mode}</b>}
                    </td>
                    <td className="calc mono">{c.empty ? '' : usd(c.setTot, 2)}</td>
                    <td className="nowrap">{!readOnly && <>
                      <button type="button" className="x" title="Duplicate" aria-label={`Duplicate row ${i + 1}`} onClick={() => update((q) => { q.stones.splice(i + 1, 0, clone(q.stones[i])); })}>⧉</button>
                      <button type="button" className="x" title="Remove" aria-label={`Remove row ${i + 1}`} onClick={() => update((q) => { q.stones.splice(i, 1); if (!q.stones.length) q.stones.push(blankRow(P)); })}>×</button>
                    </>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!readOnly && <button type="button" className="link-btn" onClick={() => update((q) => { q.stones.push(blankRow(P)); })}>+ Add stone row</button>}
        <p className="muted small legend"><span className="calc-swatch" /> calculated / from the price data · text when a value is not in the price list</p>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- alternate pricing grid */
function AltGrid({ P, S, live, update, readOnly, alloyOpts }) {
  const [open, setOpen] = useState(S.alt.open);
  const grid = useMemo(() => P.variantGrid(S, live), [P, S, live]);
  const c = S.price.currency;
  const saveVariant = () => update((q) => {
    const rows = q.stones.filter((r) => !P.rowEmpty(r));
    q.alt.comps.push({ id: altId(), name: P.compName(q, rows), stones: clone(rows) });
    q.alt.open = true;
  });
  return (
    <section className="card span2">
      <header className="card-hd">
        <h2><button type="button" className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '▾' : '▸'} Alternate pricing grid</button></h2>
        {open && !readOnly && <div className="card-actions"><button type="button" className="btn sm" onClick={saveVariant}>Save current stones as a stone profile</button></div>}
      </header>
      {open && (
        <div className="card-bd">
          <div className="form-grid">
            {Array.from({ length: ALT_MAX }, (_, k) => (
              <div key={k} className="field">
                <span>Alternate metal {ALT_L[k]}</span>
                <div className="row gap">
                  <select value={S.alt.metals[k].m1} disabled={readOnly} aria-label={`Alternate metal ${ALT_L[k]}`} onChange={(e) => { const v = e.target.value; update((q) => { q.alt.metals[k].m1 = v; q.alt.open = true; }); }}>
                    <option value="">— not used —</option>{alloyOpts.map((a, i) => <option key={a.code + i} value={a.code}>{a.code}</option>)}
                  </select>
                  {S.metal.m2 && <select value={S.alt.metals[k].m2} disabled={readOnly} aria-label={`Alternate metal ${ALT_L[k]} second`} onChange={(e) => { const v = e.target.value; update((q) => { q.alt.metals[k].m2 = v; }); }}>
                    <option value="">Same as Metal 2</option>{alloyOpts.map((a, i) => <option key={a.code + i} value={a.code}>{a.code}</option>)}
                  </select>}
                </div>
              </div>
            ))}
          </div>
          {grid.rows.length === 0 ? <p className="muted small">Pick an alternate metal or save a stone profile to compare prices. Grams convert from Metal 1 by specific gravity.</p> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Stone profile</th>{grid.cols.map((col) => <th key={col.key} className="r">{col.g && !col.g.err ? [col.g.m1, col.g.g2 && col.g.m2].filter(Boolean).join(' + ') : col.label}<br /><small className="muted">{col.g && !col.g.err ? `${col.g.g1.toFixed(2)} g${col.g.g2 ? ` + ${col.g.g2.toFixed(2)} g` : ''}` : col.g?.err || ''}</small></th>)}<th /></tr></thead>
                <tbody>
                  {grid.rows.map(({ comp, sv, cells }) => (
                    <tr key={comp.id}>
                      <td><b>{comp.name}</b><br /><small className="muted">{comp.stones.length ? `${sv.pcs} pcs · ${sv.ct.toFixed(2)} ct` : 'no stones'}</small></td>
                      {cells.map((x, k) => <td key={k} className="r mono">{x && x.local ? money(c, x.local) : x && x.withDuty ? usd(x.withDuty) : '—'}</td>)}
                      <td>{!comp.implicit && !readOnly && <button type="button" className="x" aria-label="Remove stone profile" onClick={() => update((q) => { q.alt.comps = q.alt.comps.filter((cc) => cc.id !== comp.id); })}>×</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export { MODES, TEXT_WHEN_CUSTOM, num };
