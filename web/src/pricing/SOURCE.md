# Pricing engine - copied unchanged

These files are an exact copy of `src/shared/` from Diacrown/Unified-Quote-Calculator
(commit 994d33e, 2026-10-19). That engine is checked against the original
MWL calculator (tools.ezjems.com/tools/MWL-JWCalc.html) on thousands of random quotes.

Do not edit them here. Change them in the Unified-Quote-Calculator repo (where the parity tests live) and copy
them again, so both apps always price the same way. `npm run check:pricing` verifies the copy is unchanged.

| File | sha256 |
|---|---|
| util.js | `4cc87d11c73e1af4` |
| pricing.js | `8b2ca1736fad1ee5` |
| quote.js | `53991d5f3a0e7acd` |
| sheet-model.js | `a55404bd5818c021` |
| sheet-config.js | `12025cfc3dd63c16` |
