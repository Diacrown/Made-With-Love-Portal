// Printable quotation (port of MWL quoteDoc): "Breakup" shows the cost lines, "Price Only" the total,
// "No Price" the specification only.
import { usd, money, num } from '../pricing/util.js';

export default function QuoteDoc({ P, S, live, cadImage }) {
  const t = P.totals(S, live), c = S.price.currency, mode = S.mode;
  const loc = P.locOf(S.price.location) || {};
  const rows = S.stones.filter((r) => !P.rowEmpty(r));
  const showPrice = mode !== 'No Price', breakup = mode === 'Breakup';
  const a1 = P.alloyBy[S.metal.m1], a2 = P.alloyBy[S.metal.m2];
  const from = [loc.name, loc.address, [loc.phone, loc.email].filter(Boolean).join(' · ')].filter(Boolean);
  const grid = showPrice && P.altRows(S).length ? P.variantGrid(S, live) : null;
  return (
    <div className="qdoc">
      <div className="qh">
        <div><div className="qlogo">Made <i>with</i> Love</div>{from.map((x, i) => <div key={i} className="from">{x}</div>)}</div>
        <div className="meta"><b>{S.quoteName || 'Quotation'}</b><div>{S.job.date}</div>{S.price.customer && <div>{S.price.customer}</div>}{S.price.customerRef && <div>Ref {S.price.customerRef}</div>}</div>
      </div>
      <div className="qrow">
        {cadImage && <img src={cadImage} alt="CAD render" />}
        <dl>
          <dt>Job / Item</dt><dd>{[S.job.jobNo, S.job.itemNo].filter(Boolean).join(' / ') || '—'}</dd>
          <dt>Item</dt><dd>{[S.job.itemType, S.job.size].filter(Boolean).join(' · ') || '—'}</dd>
          <dt>Metal</dt><dd>{[a1 && `${a1.name}${S.metal.g1 ? ` · ${num(S.metal.g1).toFixed(2)} g` : ''}`, a2 && `${a2.name}${S.metal.g2 ? ` · ${num(S.metal.g2).toFixed(2)} g` : ''}`].filter(Boolean).join(' + ') || '—'}</dd>
          <dt>Stones</dt><dd>{t.pcs} pcs · {t.ct.toFixed(2)} ct total</dd>
        </dl>
      </div>
      {rows.length > 0 && (
        <table>
          <thead><tr><th>#</th><th>Type</th><th>Shape</th><th>Size</th><th>Quality</th><th className="r">Pcs</th><th className="r">CTTW</th>{breakup && <th className="r">Stones USD</th>}</tr></thead>
          <tbody>
            {rows.map((r, k) => {
              const x = P.calcRow(r, S);
              return <tr key={k}><td>{k + 1}</td><td>{r.type}</td><td>{r.shape}</td><td>{r.size ? P.sizeLabel(r) : ''}</td><td>{r.type === 'Mount' ? r.label : P.labelOf(r, S.price.location)}</td><td className="r">{x.pcs}</td><td className="r">{x.cttw.toFixed(3)}</td>{breakup && <td className="r">{usd(x.total + x.setTot)}</td>}</tr>;
            })}
          </tbody>
        </table>
      )}
      {showPrice && (
        <div className="qtot">
          {breakup && <>
            <div><span>Casting</span><span>{usd(t.casting)}</span></div>
            <div><span>Labour</span><span>{usd(t.labor)}</span></div>
            <div><span>CAD ({S.price.cadType})</span><span>{usd(t.cad)}</span></div>
            <div><span>Gemstones</span><span>{usd(t.dia)}</span></div>
            <div><span>Setting</span><span>{usd(t.set)}</span></div>
            {t.add > 0 && <div><span>{(S.addLabel || '').trim() || 'Additional charges'}</span><span>{usd(t.add)}</span></div>}
            <div><span>Total incl. {t.duty}% duty (USD)</span><span>{usd(t.withDuty)}</span></div>
          </>}
          <div className="g"><span>Total {c}</span><span>{t.final ? money(c, t.final) : '—'}</span></div>
          {loc.taxCaption && <div className="txc">{loc.taxCaption}</div>}
        </div>
      )}
      {grid && (
        <>
          <h3>Variant pricing · {c}</h3>
          <table>
            <thead><tr><th>Variant</th>{grid.cols.map((col) => <th key={col.key} className="r">{col.g && !col.g.err ? [col.g.m1, col.g.g2 && col.g.m2].filter(Boolean).join(' + ') : col.label}</th>)}</tr></thead>
            <tbody>{grid.rows.map(({ comp, sv, cells }) => <tr key={comp.id}><td><b>{comp.name}</b> <small>{sv.pcs} pcs · {sv.ct.toFixed(2)} ct</small></td>{cells.map((x, k) => <td key={k} className="r">{x && x.local ? money(c, x.local) : '—'}</td>)}</tr>)}</tbody>
          </table>
        </>
      )}
    </div>
  );
}
