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
terms, with the binding rule beside it and, under both, a plain sentence saying
what the number is: how much the budget has to improve each year, counted
before interest and with the cycle taken out, from spending cuts or tax rises
or both. The net expenditure growth ceilings —
the operational form the rules are written in, `netExpenditure` after the
year-specific deficit floors — sit in a secondary `<details>` below the
workbench with a short explainer, because their role is not obvious to a
general reader. A failed or individually unmet rule clears that path rather
than presenting an infeasible plan as a ceiling. The sticky stage switches off
whenever it would occupy more than 65% of the viewport height.

What makes a change visible:

- **Reference trajectory.** Every control's default is the Commission's own
  setting, and the page says so rather than calling it "the baseline": a line
  at the top of the controls explains the dot on a changed control and the tick
  under a slider, the hints name the Commission's figure where there is one,
  and the Commission's option is marked in each method dropdown. Those settings
  are solved once at load. As soon as any control moves, that path is drawn as
  a grey ghost under the live line, the headline shows `+0.07 vs Commission`,
  and the binding rule shows `(Commission: <rule>)` when it differs. *Pin as
  reference* swaps the ghost for whatever is on screen, and the same labels
  then read "pinned".
- **Rules as pictures.** 60 % and 90 % lines; the debt safeguard drawn as the
  slope across the plan window that the path has to beat; when the stochastic
  test binds, the two numbers it compares joined by a line; and under the chart
  a bar per criterion with the binding one tagged and a tick at the reference
  value.
- **Starting position.** The *Starting position* slider moves the 2025 output
  gap, the last year the Commission supplies one, and the model closes the gap
  from there on its own schedule -- always reaching zero three years after the
  plan ends. It is the one control that separates a better economy from a good
  year: potential growth moves real growth one for one and leaves the gap
  alone, while this moves output relative to potential and then fades. The
  readout under it gives the resulting gap as a level.
- **Preset chips stack.** Each one sets only its own controls and leaves the
  rest alone, so rates +1 pp, growth −0.5 pp and the safeguards off can all be
  on at once. A second tap on a chip returns just that chip's settings to the
  baseline; *Clear*, which appears beside the row once any chip is on, does
  that for every lit chip and leaves a slider moved by hand alone. *Reset*, in
  the controls, is the one that returns everything. A chip also lights up when
  its setting is reached by dragging the slider to the same value.
- **A link carries the settings.** Whatever differs from the baseline goes in
  the URL hash on each committed change, and *Copy link* under the chart puts
  that address on the clipboard, so a particular combination can be sent to
  someone. Values are validated on the way back in, so a hand-edited link can
  only produce a state the controls themselves could produce.
- **Why the chart looks like that.** A line under it names what the binding
  rule is doing. It matters most for the debt safeguard: the safeguard fixes
  where debt has to be at the end of the plan, so changing an assumption
  changes the effort needed to get there rather than where the line lands,
  which otherwise reads as a slider that does nothing.
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

Both shock methods draw from the same quarterly series (the Darvas block,
`STOCH!I3:L97`: short rate, long rate, nominal growth, primary balance, clipped
at three standard deviations). The normal method draws from its covariance; the
bootstrap resamples it in two-year blocks. They then share the aggregation, so
they differ only in the distribution assumed, not in what is being shocked.

One departure from the published MATLAB, made deliberately: the tool's
`stochMethod = 2` read `STOCH!C3:F49` instead, the AMECO block, which holds
annual *levels* of growth, the primary balance, the implicit rate and the SFA
minus their 1976-2022 means. Those are not shocks. Finland's implicit interest
rate fell from 10.4% to about 1% over that sample, so demeaning it produces
deviations of plus or minus six percentage points; added to a projected rate of
about 2.5% they drove the simulated implicit rate negative in 1,996 of 5,000
path-years. The fix is in the MATLAB source as well as here.

The 1,000 shock paths are drawn once, with a fixed seed, and shipped with the
page: every visitor sees the same simulation, and the result does not move when
the page is reloaded. They are generated with numpy rather than MATLAB's
`mvnrnd`, so they are not bitwise the MATLAB tool's own draws. To use MATLAB's,
export `e_g`, `e_pb`, `e_i_st` and `e_i_lt` after the shock-generation block in
`runDsaModel5_1.m` and rebuild `shocks.js` from them.

## Checking against the MATLAB tool

The port was checked against an independently written Python translation of the
same MATLAB source. Twenty-one parameter combinations — both plan lengths, safeguards
on and off, both plausibility levels, both shock methods, both SFA assumptions,
each slider on its own including the starting output gap, and five stacked at
once — agree to 1.4e-14 across
the full debt, balance, structural balance, structural primary balance, net
expenditure and percentile paths. The harness is under
`OneDrive/DSA/calculator/test` (`run_js.sh`, `compare.py`).

A 2,224-point sweep produces no failures and no non-finite values, with a worst
case of 144 ms per full run including the simulation: 2,160 points over the
slider ranges, all 16 combinations of the rule switches on both plan lengths,
and all 32 combinations of the preset chips.

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
8. **Debt reprices about half as fast as the data say.** `Baseline NFPC` row 38,
   *Share of long-term debt that matures every year*, converges to `Input data`
   C59 = 3.78% (source: "ECB, country-specific historical average shares over
   the 6 last available years"). It is built as

   ```text
   (debt with residual maturity < 1 year  -  short-term debt by original maturity)
   ---------------------------------------------------------------------------
                          long-term debt
   ```

   all three as shares of government debt. That construction is exactly right:
   the numerator is long-term debt falling due within the year. Run it on
   Eurostat's own figures for Finnish general government (`gov_10dd_rmd`,
   `gov_10dd_ggd`) and it gives 7.3% (2022), 6.1% (2023), 6.8% (2024) and 5.8%
   (2025) — roughly double the workbook's value. Eurostat also publishes the
   average remaining maturity directly: 7.4-7.8 years over the same period,
   against the 13 years the workbook's 3.78% implies for a uniform redemption
   ladder, or the 26 years it implies under the geometric roll-over this model
   actually uses.

   The value is the Commission's input and is kept. It is worth knowing which
   way it leans: at 6.5% a year the baseline adjustment is 0.78 rather than 0.76
   and a +1 pp market shock costs 0.87 rather than 0.83; at 11.4%, the rate that
   matches the measured 7.8-year maturity under this model's recursion, 0.81 and
   0.92. So the page understates how much a rate shock costs, by around a third.

   One likely reason the subtraction comes out small: `Input data` C57, the
   short-term share, is a *three*-year Eurostat average while row 38 is a
   *six*-year ECB average. Subtracting two shares that are each around 11-18%
   and averaged over different windows, from different sources, leaves a
   remainder of about 4% that is very sensitive to the mismatch.

One deliberate difference: where the MATLAB source flags the deficit resilience
safeguard as binding even in years when it did not raise the adjustment, this
page labels the year with the rule that actually set the number. The adjustment
path itself is identical.
