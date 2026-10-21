# Quote calculator

The **Quotes** screen is the MWL calculator (UI mock "Calculator" sheet) inside the portal. Prices come from the
MWL pricing engine in `web/src/pricing/`, an unchanged copy of `src/shared/` from **Unified-Quote-Calculator**
(checked against the original MWL page on thousands of random quotes). `npm run check:pricing` confirms the copy
has not been edited. Because it is the MWL engine, the MWL rules apply (e.g. DMT duty 16%, rounding to the nearest 5),
not the JWY / Phoenix rules.

## Who sees prices
`quote.read` / `quote.write` (migration 11) go to admin, office admin, front office and back office.
CAD and QC users do not see price data, rates or quotes. A quote on a job follows the job's offices; a quote without
a job (scratch quote) is visible to its author and admins only.

## Publishing the price data (admin, whenever the master price sheet changes)
1. Share the master **price** sheet (`1LQdSkcYGab2hwWQiqDqVRH866Babjqx9R1Mh65IovjY`, tabs Location, Master, Size,
   StonePrice, SettingRates, LaborPolicy, CastingRates, MetalMaster, AlloyMaster, LabelAs) as "Anyone with the link: Viewer",
   or export its tabs to JSON.
2. `npm run sync:pricing:dry` - shows the checker report. Errors block publishing; warnings do not.
3. `npm run sync:pricing -- --note "October prices"` - publishes it as the live version.
   (`--file tabs.json` publishes from a file instead of the sheet. Set `PRICE_SHEET_ID` in `.env` to use another sheet.)
4. Admin -> Price data lists every version with its warnings; "Make live" rolls back to an older one.

## Live rates
The `rates` Edge Function fetches gold/platinum/palladium/silver spot (gold-api.com) and FX (ECB via frankfurter,
then two fallbacks), cached 10 minutes in `rate_snapshots`. If every source fails, the calculator uses the sheet's
backup spot rate and Location FXR (marked with `*`), exactly as MWL did. PM rates come from the sheet (MetalMaster).
Set the Edge Function secret `ALLOWED_ORIGIN` to the portal address.

## Making a quote
- Job -> **Quotes** tab -> **New quote from this job**: fills job number, item, size, customer alias, the location
  (the job's company code = the price sheet's LocationCode), and the **accepted CAD version's** metal weights and
  stone matrix (CAD stone types DIA/LGD/GEM -> Mined/LGD/Gems; sizes matched by mm, or by carat for fancy shapes
  listed by weight). Anything that cannot be matched is listed at the top and left for the user.
- Rows without a list price ask for $/ct, as in MWL.
- **Save** stores the quote with its revision, totals, the price-data version and the rates used. If someone else
  saved in between, the save is refused with "Saved by someone else" instead of overwriting.
- **Price Only / Breakup / No Price** controls what the printed quotation shows; **Print / PDF** prints it;
  **Export JSON** gives the GATI export (same fields as MWL).
