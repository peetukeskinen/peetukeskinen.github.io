/* ==========================================================================
   criteria.js — the EU fiscal rules applied to the projections

   Translated from runDsaModel5_1.m. Given the baseline data and the settings
   chosen on the page, it finds the smallest annual adjustment that satisfies
   every criterion that is switched on:

     - DSA deterministic : debt falls throughout the 10-year review period in
                           all four scenarios, and the headline deficit stays
                           below 3% of GDP in the baseline
     - DSA stochastic    : debt is lower after five years than at the end of
                           the plan with the chosen probability
     - debt safeguard    : debt falls on average by 0.5 (debt 60-90%) or
                           1.0 (debt above 90%) pp of GDP per plan year
     - deficit benchmark : at least 0.5 pp a year while the deficit exceeds 3%
     - deficit resilience: at least 0.4 pp (0.25 under a 7-year plan) a year
                           until the structural balance reaches -1.5% of GDP
   ========================================================================== */

(function (global) {
  'use strict';

  var M = global.DSAModel;
  var filled = M.filled;

  /* Thresholds written into the MATLAB source (runDsaModel5_1.m, 138-142). */
  var STEP = 0.01;
  var GRID_MAX = 2;
  var MAX_DEFICIT = -3.05;        // Treaty headline deficit limit, with rounding margin
  var BENCHMARK_A = 0.5;          // minimum adjustment under the deficit benchmark
  var DEFICIT_SAFEGUARD = -1.55;  // structural balance floor, with rounding margin

  /* Which rule ends up binding, using the MATLAB indicator values. */
  var BINDING = {
    0: 'DSA — deterministic scenarios',
    0.5: 'DSA — stochastic scenarios',
    1: 'Debt sustainability safeguard',
    2: 'Deficit benchmark',
    3: 'Deficit resilience safeguard'
  };

  var GRID = (function () {
    var g = [];
    for (var i = 1; i <= Math.round(GRID_MAX / STEP); i++) g.push(i * STEP);
    return g;
  }());

  /** MATLAB's prctile: values sit at (i-0.5)/n, linear in between, flat outside.
      Checked by hand against MATLAB's documented example: for x = [1 2 3 4] the
      positions are 12.5, 37.5, 62.5 and 87.5, so prctile(x, 50) = 2.5 and
      prctile(x, 10) = 1 (below the first position, so clamped). */
  function prctile(sorted, p) {
    var n = sorted.length;
    if (n === 0) return NaN;
    if (n === 1) return sorted[0];
    var pos = (p / 100) * n + 0.5;          // 1-based position
    if (pos <= 1) return sorted[0];
    if (pos >= n) return sorted[n - 1];
    var lo = Math.floor(pos);
    var frac = pos - lo;
    return sorted[lo - 1] + frac * (sorted[lo] - sorted[lo - 1]);
  }

  /** Linear spacing, as MATLAB's linspace. */
  function linspace(a, b, n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(a + (b - a) * i / (n - 1));
    return out;
  }

  /** Turn the exported data plus the page settings into 1-based model inputs. */
  function buildInputs(data, params) {
    var s = data.scalars, series = data.series;
    var plan = params.plan;
    var extra = plan === 7 ? 3 : 0;
    var prePlan = 2;
    var adjustmentStart = prePlan + 1;
    var adjustmentEnd = prePlan + plan;
    var totalPeriods = prePlan + plan + 10;
    var t, i;

    function oneBased(arr, n) {
      var out = filled(n, NaN);
      for (i = 0; i < n && i < arr.length; i++) out[i + 1] = arr[i];
      return out;
    }

    var potgdp = oneBased(series.potgdp, totalPeriods);
    var inflation = oneBased(series.inflation, totalPeriods);
    var iSt = oneBased(series.i_st, totalPeriods);
    var iLt = oneBased(series.i_lt, totalPeriods);
    var sfa = oneBased(series.sfa, totalPeriods);
    var ageing = oneBased(series.ageing, totalPeriods);
    var property = oneBased(series.property, totalPeriods);

    /* Short forecast horizons: the rest is filled in by the projection. */
    var og = filled(totalPeriods, NaN);
    for (i = 0; i < series.og.length; i++) og[i + 1] = series.og[i];
    var iir = filled(totalPeriods, NaN);
    for (i = 0; i < series.iir.length; i++) iir[i + 1] = series.iir[i];
    var spb = filled(totalPeriods, NaN);
    var pb = filled(totalPeriods, NaN);
    var ob = filled(totalPeriods, NaN);
    var sb = filled(totalPeriods, NaN);
    for (i = 0; i < 2; i++) {
      spb[i + 1] = series.spb[i];
      pb[i + 1] = series.pb[i];
      ob[i + 1] = series.ob[i];
      sb[i + 1] = series.sb[i];
    }

    /* ---- settings the visitor can change ------------------------------- */

    /* Interest rates: shift market rates from the first plan year onwards.
       The implicit rate follows through the roll-over recursion. */
    if (params.rateShift) {
      for (t = adjustmentStart; t <= totalPeriods; t++) {
        iSt[t] += params.rateShift;
        iLt[t] += params.rateShift;
      }
    }

    /* Potential growth: re-grow the level path from the first plan year on. */
    if (params.growthShift) {
      var basePot = potgdp.slice();
      for (t = adjustmentStart; t <= totalPeriods; t++) {
        var dpot = (basePot[t] - basePot[t - 1]) / basePot[t - 1];
        potgdp[t] = (1 + dpot + params.growthShift / 100) * potgdp[t - 1];
      }
    }

    /* Stock-flow adjustment: the Commission's revised path, or zero after the
       forecast horizon (the old assumption). */
    if (params.sfaMethod === -1) {
      for (t = 4; t <= totalPeriods; t++) sfa[t] = 0;
    }

    /* Ageing costs and property income, relative to the end of the plan. */
    var dcoa = filled(totalPeriods, 0);
    var dprop = filled(totalPeriods, 0);
    var cumCoa = 0, cumProp = 0;
    for (t = adjustmentEnd + 1; t <= totalPeriods; t++) {
      cumCoa += (ageing[t - 1] - ageing[t]);
      dcoa[t] = -cumCoa;
      cumProp += (property[t - 1] - property[t]);
      dprop[t] = cumProp;
    }

    /* The fiscal multiplier bites only during the plan years. */
    var phi = params.phi === undefined || params.phi === null ? s.phi : params.phi;
    var m = filled(totalPeriods, 0);
    for (t = adjustmentStart; t <= adjustmentEnd; t++) m[t] = phi;

    /* Share of long-term debt maturing each year: converges over ten years. */
    var ramp = linspace(s.share_lt_maturing_t0, s.share_lt_maturing_t10, 10);
    var mLt = filled(totalPeriods, NaN);
    for (i = 0; i < 10; i++) mLt[i + 2] = ramp[i];
    for (t = 12; t <= totalPeriods; t++) mLt[t] = s.share_lt_maturing_t10;

    var debtInitial = params.debtInitial === undefined || params.debtInitial === null
      ? s.debt_initial : params.debtInitial;

    return {
      plan: plan, extra: extra, prePlan: prePlan,
      adjustmentStart: adjustmentStart, adjustmentEnd: adjustmentEnd,
      totalPeriods: totalPeriods,
      baseYear: data.meta.base_year,
      potgdp: potgdp, inflation: inflation, og: og, iir: iir,
      iSt: iSt, iLt: iLt, sfa: sfa, spb: spb, pb: pb, ob: ob, sb: sb,
      dcoa: dcoa, dprop: dprop, m: m, mLt: mLt,
      epsilon: s.epsilon, thetaLt: s.theta_lt, phi: phi,
      rgdpInitial: s.rgdp_initial, debtInitial: debtInitial,
      alphaInitial: s.alpha_initial, betaInitial: s.beta_initial,
      primExpenditure: s.prim_expenditure,
      zeros: filled(totalPeriods, 0)
    };
  }

  /** Run one projection at a given adjustment, with or without shocks. */
  function project(inputs, scenario, adjustment, shocks) {
    return M.projectDebt({
      scenario: scenario,
      adjustment: adjustment,
      adjPeriods: inputs.plan,
      iir: inputs.iir, potgdp: inputs.potgdp, og: inputs.og,
      epsilon: inputs.epsilon, m: inputs.m, dcoa: inputs.dcoa, dprop: inputs.dprop,
      sfa: inputs.sfa, inflation: inputs.inflation,
      rgdpInitial: inputs.rgdpInitial, debtInitial: inputs.debtInitial,
      alphaInitial: inputs.alphaInitial, betaInitial: inputs.betaInitial,
      spb: inputs.spb, iSt: inputs.iSt, iLt: inputs.iLt, mLt: inputs.mLt,
      pb: inputs.pb, ob: inputs.ob, sb: inputs.sb, thetaLt: inputs.thetaLt,
      gShock: (shocks && shocks.g) || inputs.zeros,
      pbShock: (shocks && shocks.pb) || inputs.zeros,
      iirShock: (shocks && shocks.iir) || inputs.zeros
    });
  }

  /* ---- deterministic criterion ----------------------------------------- */

  /** Smallest adjustment for which debt declines through the review period
      (and, in the baseline, the deficit stays under 3% of GDP). */
  function deterministicIndex(inputs, scenario) {
    for (var j = 0; j < GRID.length; j++) {
      var p = project(inputs, scenario, GRID[j], null);
      var declining = true;
      for (var t = inputs.adjustmentEnd + 1; t <= inputs.totalPeriods; t++) {
        if (!(p.debt[t] - p.debt[t - 1] < 0)) { declining = false; break; }
      }
      if (!declining) continue;
      if (scenario === M.SCENARIO.ADJUSTMENT) {
        var deficitOk = true;
        for (var s = inputs.adjustmentEnd; s <= inputs.totalPeriods; s++) {
          if (!(p.ob[s] > MAX_DEFICIT)) { deficitOk = false; break; }
        }
        if (!deficitOk) continue;
      }
      return { index: j + 1, a: GRID[j], spbStar: p.spb[inputs.adjustmentEnd], paths: p };
    }
    return { index: 0, a: null, spbStar: null, paths: null };
  }

  /* ---- stochastic criterion --------------------------------------------- */

  /** Debt path under one set of shocks, reusing the baseline drivers.

      The shocks are added to nominal growth, the primary balance and the
      implicit interest rate, so the real economy and the primary balance
      before shocks are the same across paths for a given adjustment. Only the
      debt, maturity and interest-rate recursion has to be repeated. This is
      the same arithmetic as model.js, and is checked against it at load. */
  function shockedDebt(inputs, base, shockG, shockPb, shockIir, upTo) {
    var n = upTo;
    var debt = filled(n, NaN);
    var alpha = filled(n, NaN);
    var beta = filled(n, NaN);
    var iirLt = filled(n, NaN);
    debt[1] = inputs.debtInitial;
    alpha[1] = inputs.alphaInitial;
    beta[1] = inputs.betaInitial;

    for (var t = 2; t <= n; t++) {
      var g = base.g[t] + (shockG[t] || 0);
      var pb = base.pb[t] + (shockPb[t] || 0);
      var iir;
      if (t <= inputs.adjustmentStart) {
        iirLt[t] = (inputs.iir[t] - alpha[t - 1] * inputs.iSt[t]) / (1 - alpha[t - 1]);
        iir = inputs.iir[t];
      } else {
        iirLt[t] = beta[t - 1] * inputs.iLt[t] + (1 - beta[t - 1]) * iirLt[t - 1];
        iir = alpha[t - 1] * inputs.iSt[t] + (1 - alpha[t - 1]) * iirLt[t];
      }
      iir = iir + (shockIir[t] || 0);

      debt[t] = debt[t - 1] * ((1 + iir / 100) / (1 + g)) - pb + inputs.sfa[t];

      var debtIncreasing = debt[t] - (debt[t - 1] / (1 + g));
      var debtRolled = Math.abs(debtIncreasing)
        - (debt[t - 1] * (alpha[t - 1] + (1 - alpha[t - 1]) * inputs.mLt[t])) / (1 + g);

      if (debtIncreasing > 0) {
        var dLtr = (inputs.mLt[t] * (1 - alpha[t - 1]) * debt[t - 1]) / (1 + g);
        var dStr = alpha[t - 1] * debt[t - 1] / (1 + g);
        var dLtn = inputs.thetaLt * (debt[t] - (debt[t - 1] / (1 + g)));
        var dStn = (1 - inputs.thetaLt) * (debt[t] - (debt[t - 1] / (1 + g)));
        var dO = (debt[t - 1] / (1 + g)) - dStr - dLtr;
        alpha[t] = (dStr + dStn) / debt[t];
        beta[t] = (dLtr + dLtn) / (dLtr + dLtn + dO);
      } else if (debtRolled < 0) {
        var term1 = (1 - alpha[t - 1]) * inputs.mLt[t] * debt[t - 1] / (1 + g);
        var term2 = alpha[t - 1] * debt[t - 1] / (1 + g);
        var term3 = Math.abs(debtIncreasing);
        var ltr = term1 * (1 - (term3 / (term1 + term2)));
        var str = term2 * (1 - (term3 / (term1 + term2)));
        var out = debt[t - 1] * (1 - alpha[t - 1] - inputs.mLt[t] * (1 - alpha[t - 1])) / (1 + g);
        alpha[t] = str / debt[t];
        beta[t] = ltr / (ltr + out);
      } else {
        alpha[t] = 0;
        beta[t] = 1;
      }
    }
    return debt;
  }

  /** Per-path shock vectors, placed in the five years after the plan ends. */
  function shockVectors(inputs, shocks, method, path) {
    var n = inputs.totalPeriods;
    var g = filled(n, 0), pb = filled(n, 0), iir = filled(n, 0);
    var set = method === 'bootstrap' ? shocks.bootstrap : shocks.normal;
    var alpha = inputs.alphaInitial;
    for (var y = 0; y < shocks.meta.years; y++) {
      var t = inputs.adjustmentEnd + 1 + y;
      if (t > n) break;
      /* Growth shocks are stored as rates (a 3pp shock is 0.03), matching the
         units of g in the projection; balance and interest shocks are in pp. */
      g[t] = set.g[path][y];
      pb[t] = set.pb[path][y];
      iir[t] = method === 'bootstrap'
        ? set.iir[path][y]
        : alpha * set.i_st[path][y] + (1 - alpha) * set.i_lt[path][y];
    }
    return { g: g, pb: pb, iir: iir };
  }

  /** Smallest adjustment for which the chosen percentile of the simulated debt
      ratio is lower five years after the plan than at the end of the plan. */
  function stochasticIndex(inputs, shocks, params) {
    var horizon = inputs.adjustmentEnd + shocks.meta.years;
    var nPaths = shocks.meta.n_paths;
    var percentile = params.plausibility * 10;   // 7 -> 70th percentile
    var vectors = [];
    var p;
    for (p = 0; p < nPaths; p++) vectors.push(shockVectors(inputs, shocks, params.method, p));

    for (var j = 0; j < GRID.length; j++) {
      var base = project(inputs, M.SCENARIO.ADJUSTMENT, GRID[j], null);
      var atEnd = new Array(nPaths);
      var atHorizon = new Array(nPaths);
      for (p = 0; p < nPaths; p++) {
        var v = vectors[p];
        var d = shockedDebt(inputs, base, v.g, v.pb, v.iir, horizon);
        atEnd[p] = d[inputs.adjustmentEnd];
        atHorizon[p] = d[horizon];
      }
      atEnd.sort(function (a, b) { return a - b; });
      atHorizon.sort(function (a, b) { return a - b; });
      if (prctile(atHorizon, percentile) < prctile(atEnd, percentile)) {
        return { index: j + 1, a: GRID[j], vectors: vectors, horizon: horizon };
      }
    }
    return { index: 0, a: null, vectors: vectors, horizon: horizon };
  }

  /** Percentile bands of simulated debt, year by year, at one adjustment. */
  function fanChart(inputs, shocks, params, adjustment, vectors) {
    var horizon = inputs.adjustmentEnd + shocks.meta.years;
    var nPaths = shocks.meta.n_paths;
    var base = project(inputs, M.SCENARIO.ADJUSTMENT, adjustment, null);
    var byYear = [];
    var t, p;
    for (t = 0; t <= horizon; t++) byYear.push(new Array(nPaths));
    for (p = 0; p < nPaths; p++) {
      var v = vectors[p];
      var d = shockedDebt(inputs, base, v.g, v.pb, v.iir, horizon);
      for (t = 1; t <= horizon; t++) byYear[t][p] = d[t];
    }
    var bands = { years: [], p10: [], p20: [], p30: [], p40: [], p50: [], p60: [], p70: [], p80: [], p90: [] };
    for (t = 1; t <= horizon; t++) {
      byYear[t].sort(function (a, b) { return a - b; });
      bands.years.push(inputs.baseYear + t - 1);
      [10, 20, 30, 40, 50, 60, 70, 80, 90].forEach(function (q) {
        bands['p' + q].push(prctile(byYear[t], q));
      });
    }
    return bands;
  }

  /* ---- safeguards and the final path ------------------------------------ */

  function solve(data, shocks, params) {
    var inputs = buildInputs(data, params);
    var plan = inputs.plan;
    var adjEnd = inputs.adjustmentEnd;
    var resilienceA = plan === 7 ? 0.25 : 0.4;
    var indices = [];
    var t, j;

    /* DSA deterministic, scenarios 4 down to 1 as in the MATLAB loop. */
    var deterministic = {};
    for (var sc = 4; sc >= 1; sc--) {
      deterministic[sc] = deterministicIndex(inputs, sc);
      if (params.useDeterministic !== false) indices.push(deterministic[sc].index);
    }

    /* DSA stochastic. */
    var stochastic = { index: 0, a: null, vectors: [] };
    if (params.useStochastic !== false) {
      stochastic = stochasticIndex(inputs, shocks, params);
      indices.push(stochastic.index);
    } else {
      stochastic.vectors = [];
      for (var p = 0; p < shocks.meta.n_paths; p++) {
        stochastic.vectors.push(shockVectors(inputs, shocks, params.method, p));
      }
    }

    /* Debt sustainability safeguard: average yearly fall over the plan. */
    var debtSafeguard = { index: 0, a: null, required: null, applies: false };
    if (params.useDebtSafeguard && inputs.debtInitial >= 60) {
      debtSafeguard.applies = true;
      debtSafeguard.required = inputs.debtInitial > 90 ? -1 : -0.5;
      for (j = 0; j < GRID.length; j++) {
        var p1 = project(inputs, M.SCENARIO.ADJUSTMENT, GRID[j], null);
        var sum = 0, n = 0;
        for (t = inputs.adjustmentStart; t <= adjEnd; t++) {
          sum += p1.debt[t] - p1.debt[t - 1];
          n++;
        }
        if (sum / n < debtSafeguard.required) {
          debtSafeguard.index = j + 1;
          debtSafeguard.a = GRID[j];
          break;
        }
      }
      indices.push(debtSafeguard.index);
    }

    var maxIndex = Math.max.apply(null, indices.concat([0]));
    if (maxIndex === 0) {
      return { failed: true, inputs: inputs,
               message: 'No adjustment in the 0.01-2.00 range satisfies the criteria.' };
    }
    var a = GRID[maxIndex - 1];

    /* Which criterion set the requirement. */
    /* The MATLAB source tests the stochastic criterion first, so when two
       criteria tie at the same adjustment the stochastic one is reported. */
    var bindingCode = 0;
    if (params.useStochastic !== false && maxIndex === stochastic.index) {
      bindingCode = 0.5;
    } else if (debtSafeguard.index && maxIndex === debtSafeguard.index) {
      bindingCode = 1;
    }
    var binding = [];
    for (t = 0; t < plan; t++) binding.push(bindingCode);

    var finalPath = [];
    for (t = 0; t < plan; t++) finalPath.push(a);

    /* The path at the binding adjustment, used for the safeguard checks and
       for the charts. */
    var chosen = project(inputs, M.SCENARIO.ADJUSTMENT, a, null);

    /* Deficit benchmark: while last year's deficit is above 3% of GDP, at
       least 0.5 pp a year. */
    if (params.useDeficitBenchmark && a < BENCHMARK_A) {
      for (t = 0; t < plan; t++) {
        var obPrev = chosen.ob[inputs.adjustmentStart - 1 + t];
        if (!(obPrev > MAX_DEFICIT)) {
          finalPath[t] = BENCHMARK_A;
          binding[t] = 2;
        }
      }
    }

    /* Deficit resilience safeguard: until the structural balance reaches
       -1.5% of GDP, at least 0.4 pp a year (0.25 under a seven-year plan). */
    if (params.useDeficitSafeguard && a < resilienceA) {
      for (t = 0; t < plan; t++) {
        var sbPrev = chosen.sb[inputs.adjustmentStart - 1 + t];
        if (!(sbPrev > DEFICIT_SAFEGUARD)) {
          if (resilienceA > finalPath[t]) {
            finalPath[t] = resilienceA;
            binding[t] = 3;
          }
        }
      }
    }

    /* Net primary expenditure growth, the form the rules are written in. */
    var netExpenditure = [];
    for (t = 0; t < plan; t++) {
      var tt = inputs.adjustmentStart + t;
      var potGrowth = (inputs.potgdp[tt] - inputs.potgdp[tt - 1]) * 100 / inputs.potgdp[tt - 1];
      netExpenditure.push(potGrowth + inputs.inflation[tt] * 100
        - (finalPath[t] / inputs.primExpenditure) * 100);
    }

    /* Charts: the four scenarios at the binding adjustment, plus a no-policy
       path for comparison, plus the simulated bands. */
    var scenarioPaths = {};
    for (var s2 = 1; s2 <= 4; s2++) scenarioPaths[s2] = project(inputs, s2, a, null);
    var noAdjustment = project(inputs, M.SCENARIO.ADJUSTMENT, 0, null);
    var fan = params.useStochastic !== false
      ? fanChart(inputs, shocks, params, a, stochastic.vectors)
      : null;

    var years = [];
    for (t = 1; t <= inputs.totalPeriods; t++) years.push(inputs.baseYear + t - 1);

    return {
      failed: false,
      inputs: inputs,
      years: years,
      planYears: years.slice(inputs.adjustmentStart - 1, adjEnd),
      adjustment: a,
      spbStar: chosen.spb[adjEnd],
      binding: binding,
      bindingLabel: BINDING[bindingCode],
      bindingLabels: binding.map(function (c) { return BINDING[c]; }),
      finalPath: finalPath,
      netExpenditure: netExpenditure,
      deterministic: deterministic,
      stochastic: { a: stochastic.a, index: stochastic.index },
      debtSafeguard: debtSafeguard,
      paths: scenarioPaths,
      noAdjustment: noAdjustment,
      fan: fan,
      debtEnd: chosen.debt[adjEnd],
      debtFinal: chosen.debt[inputs.totalPeriods],
      deficitEnd: chosen.ob[adjEnd],
      structuralEnd: chosen.sb[adjEnd]
    };
  }

  global.DSACriteria = {
    GRID: GRID,
    BINDING: BINDING,
    prctile: prctile,
    buildInputs: buildInputs,
    project: project,
    shockedDebt: shockedDebt,
    shockVectors: shockVectors,
    fanChart: fanChart,
    solve: solve
  };

}(typeof self !== 'undefined' ? self : this));
