# DSA calculator

The browser version of the MATLAB DSA 5.1 tool
([peetukeskinen/DSA5.1v](https://github.com/peetukeskinen/DSA5.1v)), used by
`dsa.html`. Everything runs in the visitor's browser: no server, no build step
and no third-party code.

```text
dsa.html          the page: workbench (stage + controls + rule bars), notes
dsa/model.js      debt projection      <- project_debt5_1v.m
dsa/criteria.js   rules and safeguards <- runDsaModel5_1.m
dsa/chart.js      hand-written SVG: debt, expenditure growth and rule bars
dsa/app.js        form handling, reference ghost, pin, presets, rendering
dsa/data/*.js     data and shock draws, generated (see below)
```

Styling lives in section 11 of `css/style.css`, so the calculator follows the
site's palette in light and dark mode.

## How the page is put together

The calculator is a workbench. On screens 64rem and wider the controls form a
sticky rail on the left and the stage (headline, debt chart, rule bars) sits on
the right, so a slider and the line it moves are always in view together. Below
that width the stage comes first in the document and sticks to the top of the
screen while the controls scroll underneath it (switched off on viewports under
761px tall).

The headline is the required annual adjustment in structural primary balance
terms, with the binding rule beside it. The net expenditure growth ceilings —
the operational form the rules are written in, `netExpenditure` after the
year-specific deficit floors — sit in a secondary `<details>` below the
workbench with a short explainer, because their role is not obvious to a
general reader. A failed or individually unmet rule clears that path rather
than presenting an infeasible plan as a ceiling. The sticky stage switches off
whenever it would occupy more than 65% of the viewport height.

What makes a change visible:

- **Reference trajectory.** The baseline settings are solved once at load. As
  soon as any control leaves its default, the baseline path is drawn as a grey
  ghost under the live line, the headline shows `+0.36 vs baseline`, and the
  binding rule shows `(baseline: <rule>)` when it differs. *Pin as reference*
  swaps the ghost for whatever is on screen.
- **Rules as pictures.** 60 % and 90 % lines; the debt safeguard drawn as the
  slope across the plan window that the path has to beat; when the stochastic
  test binds, the two numbers it compares joined by a line; and under the chart
  a bar per criterion with the binding one tagged and a tick at the reference
  value.
- **Preset chips** set a scenario in one tap; a second tap returns to baseline.
- **Euros.** Public debate is conducted in billions, not points of GDP, so the
  headline restates the requirement as the permanent adjustment reached after
  four years — the horizon Finnish commentary uses. The year table carries the
  running euro total for every plan year. Both follow the controls, because they
  value each year's adjustment at the model's own nominal GDP path.

The interest-rate slider moves market rates from **2026**, not from the first
plan year. Up to 2025 the model takes the Commission's own implicit rate as
given and backs the long-term implicit rate out of it
(`model.js`, `iirLt[t] = (iir[t] - alpha*iSt[t]) / (1 - alpha)`), so a higher
market rate in that year would *lower* the implied long-term rate. Starting the
shift in 2026 keeps the back-out year intact; it raises the 2026 pass-through to
the implicit rate from 0.08 to 0.17 pp per pp of shock, and the adjustment a
+1 pp shock requires from 0.81 to 0.83.

The chart keeps a stable frame while a line moves: the y axis snaps to 20-pp
steps and always contains 40–80, and the baseline path is included in the
domain so the ghost never rescales the axis when it appears.

`window.DSACalculator` (`apply(obj)`, `pin()`, `reset()`, `render()`) exists so
tests can drive the page; the headless Firefox renders in the OneDrive test
folder use it, since `requestAnimationFrame` does not fire before Firefox
captures a screenshot.

## Regenerating the data

The data files are generated from the Commission's Excel workbook by the export
scripts kept with the MATLAB tool (outside this repository, under
`OneDrive/DSA/calculator/export`):

```sh
python3 export_data.py          # xlsx -> data/finland.json, data/shocks.json
python3 build_site_data.py      # json -> this repo's dsa/data/*.js
```

Euro amounts need one input the Commission workbook does not carry: a nominal
GDP level. `export_data.py` writes `scalars.ngdp_initial` from Eurostat
(nama_10_gdp, B1GQ, current prices, Finland 2023 = €273.0 bn, retrieved
2026-09-20) and the page carries it forward with the model's nominal growth.
Refresh that constant when the data vintage moves.

`finland.js` is about 3 kB and `shocks.js` about 300 kB. The data is loaded with
`<script>` tags rather than `fetch`, so opening `dsa.html` straight from disk
works.

The 1,000 shock paths are drawn once, with a fixed seed, and shipped with the
page: every visitor sees the same simulation, and the result does not move when
the page is reloaded. They are generated with numpy rather than MATLAB's
`mvnrnd`, so they are not bitwise the MATLAB tool's own draws. To use MATLAB's,
export `e_g`, `e_pb`, `e_i_st` and `e_i_lt` after the shock-generation block in
`runDsaModel5_1.m` and rebuild `shocks.js` from them.

## Checking against the MATLAB tool

The port was checked against an independently written Python translation of the
same MATLAB source. Ten parameter combinations — both plan lengths, safeguards
on and off, both plausibility levels, both shock methods, both SFA assumptions —
agree to 1.4e-14 across the full debt, balance, structural balance, structural
primary balance, net expenditure and percentile paths. The harness is under
`OneDrive/DSA/calculator/test` (`run_js.sh`, `compare.py`).

A 720-point sweep over the slider ranges produces no failures and no non-finite
values, with a worst case of 46 ms per full run including the simulation.

The baseline also reproduces the figures published in chapter 3 of the National
Audit Office's fiscal policy monitoring report 2024: 0.76 pp a year with the debt
sustainability safeguard binding, about 0.3 pp under the DSA criteria alone, net
expenditure growth of about 1.5% under a seven-year plan and about zero under a
four-year one, and the 2025 exception where the corrective arm lifts the first
year to 0.5 pp.

## Known quirks, reproduced on purpose

The point of the page is to reproduce the published tool, so the following are
kept rather than fixed. They are listed here so they are not mistaken for port
errors.

1. **The lower-SPB scenario has no demand effect.** `project_debt5_1v.m:177`
   adds a multiplier boost to real GDP and line 182 overwrites it. The boost is
   also missing a factor of 100. The two errors cancel to zero, and this port
   reproduces the zero.
2. **`if debt == 0` (line 341)** compares a whole vector and is never true.
3. **The debt safeguard band** (0.5 or 1.0 pp a year) is chosen from the
   starting debt ratio, not from debt along the path.
4. **The deficit benchmark** is applied in structural primary terms throughout.
   The comment in the MATLAB source describes a switch to structural balance
   terms from 2028, and `interest_benchmark` is computed for it, but it is never
   used.
5. **The financial stress scenario's rate rise** applies only in the first year
   of the review period; later years revert to baseline market rates, and the
   stress survives only through the implicit rate.
6. **The adverse r-g scenario compounds:** potential output is re-grown off the
   already-lowered level while growth is taken from the baseline.
7. **Shocks are added after real GDP and the output gap are fixed,** so a growth
   shock never feeds the cyclical part of the primary balance.
8. **Debt reprices very slowly.** `Baseline NFPC` row 38, *Share of long-term
   debt that matures every year*, converges to `Input data` C59 = 3.78%
   (source: "ECB, country-specific historical average shares over the 6 last
   available years"). That is an average residual maturity of 26 years; with
   the workbook's own 10.8% short-term share it makes the whole stock turn over
   in about 24 years, against roughly 6–7 years for Finnish government debt in
   practice. A +1 pp market shock therefore reaches the implicit rate by only
   0.40 pp after six years. The value is the Commission's input and is kept, but
   it is the single assumption that most flattens the interest-rate slider: at
   14% a year the same shock reaches 0.71 pp and costs 0.95 rather than 0.83.

One deliberate difference: where the MATLAB source flags the deficit resilience
safeguard as binding even in years when it did not raise the adjustment, this
page labels the year with the rule that actually set the number. The adjustment
path itself is identical.
