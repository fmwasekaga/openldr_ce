# DISA result status — reverse-engineering findings

**Date:** 2026-07-16
**Status:** signal LOCATED and measured; decoder NOT yet implemented
**Method:** empirical, against live production DISA + OpenLDR v1 (read-only)
**Ground truth:** OpenLDR v1 `Requests.HL7ResultStatusCode` for the same labs

## Result

**`TESTDATA_STATUS` bytes 77–79 hold the reviewer's initials. Non-zero ⇒ reviewed ⇒ `F`;
zero ⇒ not reviewed ⇒ `R`. Measured 98.99% accurate over 168,289 real panels.**

```
rule: TESTDATA_STATUS bytes[77..79] != 0  =>  F , else R
  F & reviewed  (correct) = 157,713
  R & !reviewed (correct) =   8,875
  F & !reviewed (miss)    =     476
  R & reviewed  (miss)    =   1,225
  ACCURACY = 98.99%   (n = 168,289 labelled panels, TDS0% range)
```

Corroboration — `uint16LE` at offset 23, read only on reviewed panels, is a **year**:

```
2013: 2673   2014: 6963   2015: 26336   2016: 15489
2017: 51161  2018: 55423  2019: 893
```

A clean histogram over the database's actual lifetime. Offsets ~21–26 are a review
**timestamp** (year at 23–24, little-endian uint16); 77–79 are `REVIEWINIT` as ASCII
(observed `65,80,66` = `"APB"`).

This matches HL7 table 0123 exactly: `R` = *"Results stored; not yet verified"*.

## Why this matters

`packages/disalab`'s `TESTDATA` decoder reads **only from offset 80 onward**
(`TESTDATA.ts:39`, `Core.FixString(_data, 80, _data.length)`). Bytes 0–79 were never
decoded. The review signal has been sitting unread in every row.

## What was ruled out (each disproved by data, not reasoning)

| Hypothesis | Verdict |
|---|---|
| Status derives from AUDTDATA `WL101`/`WA500` | **FALSE.** Identical event signatures produce different statuses: `[WS031]` → both `F` (513) and `X` (1020); `[WL101,WS031]` → both `F` (1601) and `R` (67). The audit trail does not contain the F/R distinction. |
| `WA500` (print/review) is required for `F` | **FALSE.** 47 labs had neither `WA500` nor `WL101` and were still `F`. |
| The CLI's `WL101`/`WA500` convention is simply wrong | **FALSE.** Both exist abundantly — `WL101` in 83,122 labs, `WA500` in 75,021, spanning the whole lab range (TDS0010012→TDS0139520). |
| `WL101`/`WA500` are era-specific | **FALSE.** They span the entire range. But `WS101`/`WP101` are **alternative** results-insert codes the CLI doesn't know (287 vs 31 in one sample). |
| `TESTDATA.TESTEDDATE` / `REVIEWEDDATE` columns carry it | **FALSE.** Real columns, but **null on all 13,253** sampled rows in this deployment. |

## Facts established

1. **v1's `HL7ResultStatusCode` is per-OBR (per panel), not per-request.** 2,702,268 `F`
   rows across 1,571,922 distinct requests (~1.7 rows each). A request can be `F` on one
   panel and `I` on another. **`V2Payload.result_status` is a single per-request field —
   the data models do not line up.** This is very likely what HL7's `A` ("some but not all
   results available") exists for.

2. **Real distribution** (all `TZDISA%` requests, 3,437,966 rows):

   | status | rows | share | distinct requests |
   |---|---|---|---|
   | `F` | 2,702,268 | 78.60% | 1,571,922 |
   | `I` | 545,317 | 15.86% | 444,178 |
   | `R` | 112,639 | 3.28% | 81,190 |
   | `X` | 77,115 | 2.24% | 59,650 |
   | `A` | 624 | **0.02%** | 624 |
   | (blank) | 3 | — | 2 |

   `A` is 624 rows in 3.4M — effectively noise. Any elaborate rule for it is solving an
   imaginary problem.

3. **`I` means "v1 has the request but no results"** — `compare-batch.ts:60-65` already
   encodes this: *"labs_without_v1_results where HL7ResultStatusCode = 'I'"*.

4. **The `(lab, panel)` join is sound**: 13,253 of 13,254 v1 OBR rows joined to a DISA
   `TESTDATA` panel via `(LABNO, TESTCODE)` ↔ `(RequestID, LIMSPanelCode)`.

5. **`X` (rejected) already works** — it comes from `Condition` (`REGDAT4.ts:123`, bytes
   548–553) and `RJREA`/`RJREM` observations, not the audit trail.

## Proposed rule (per panel), to be implemented and re-measured

```
X  rejected (Condition / RJREA / RJREM)          — implemented, working
I  no results for the panel                      — ~15.9% of reality
R  results exist, TESTDATA_STATUS[77..79] == 0   — not reviewed
F  results exist, TESTDATA_STATUS[77..79] != 0   — reviewed
A  not derivable; 0.02% — accept as a known gap
```

Open question that must be decided before implementing: **per-panel vs per-request.**
v1 stores per-OBR; `V2Payload.result_status` is per-request. Either aggregate (and decide
the precedence), or carry status per panel — which is a `V2Payload` schema change.

## Residual, honest caveats

- **1,225 `R & reviewed` misses (1.2%)**: panels with reviewer initials that v1 still calls
  `R`. Unexplained. Possibly a review that happened *after* v1 ingested, i.e. a timing
  artefact rather than a decode error — testable by comparing the offset-23 review year
  against v1's ingest date.
- **476 `F & !reviewed` misses (0.3%)**: unexplained.
- The exact byte layout of the review timestamp at ~21–26 is **not fully decoded** — only
  the year (23–24, uint16 LE) is confirmed. Offsets 25/26 do not look like a plain month
  (values 30/31/55 and 11/12/14 observed), so the structure is not a naive
  `SYSTEMTIME`. Needs work before `authorised_at` can be populated from it.
- All figures are from the **Tanzania** deployment (`TDS0%` / `TZDISA%`). Mozambique and
  Zambia are unverified and may differ — DISA versions clearly vary within one database
  already (`WS101` vs `WL101`).

## Consequence for the current slice

The committed AUDTDATA derivation (`53caa77`) is **measured at 1/100 against ground truth**
and must not ship. The compare-gate addition in the same commit is **pure gain** — it is
what caught this — and should be kept regardless.

Also uncovered: `v1-transform.ts`'s `analysis_at`/`authorised_at` rely on the same
`WL101`/`WA500` lookup and are **not among the 13 compared fields**, so they have been
silently unverified. Worth its own check.
