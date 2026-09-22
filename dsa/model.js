/* ==========================================================================
   model.js — debt projection engine

   A direct translation of project_debt5_1v.m from the DSA 5.1 MATLAB tool
   (github.com/peetukeskinen/DSA5.1v), which follows the European Commission's
   Debt Sustainability Monitor 2023, Annex A3.

   Arrays are 1-based: index 0 is unused, so every line can be compared with
   the MATLAB source without shifting indices. Periods run 1..periods, where
   period 1 is 2023, periods 3..(2+plan) are the adjustment years, and the ten
   years after that are the review period.

   The MATLAB function receives its inputs by value and modifies several of
   them (og, spb, pb, ob, sb, iir, and the market rates under scenarios 3-4),
   so this version copies them first.
   ========================================================================== */

(function (global) {
  'use strict';

  /* Scenarios, matching the MATLAB numbering. */
  var SCENARIO = {
    ADJUSTMENT: 1,      // baseline: the plan is delivered and held
    LOWER_SPB: 2,       // structural primary balance slips after the plan
    ADVERSE_RG: 3,      // permanently higher interest rates, lower growth
    FINANCIAL_STRESS: 4 // temporary market stress, larger if debt is high
  };

  /* Parameters fixed in the Commission's method (project_debt5_1v.m, 103-111). */
  var SPB_SHOCK = 0.25;           // first-step slippage in the lower-SPB scenario
  var SPB_SHOCK2 = 2 * 0.25;      // permanent slippage from the second year on
  var INTEREST_RATE_SHOCK = 0.5;  // pp added to market rates in scenarios 3 and 4
  var RISK_PREMIA = 0.06;         // extra pp per pp of debt above 90% in scenario 4
  var STRESS_DEBT_THRESHOLD = 90;

  function copy(a) { return a.slice(); }

  function filled(n, value) {
    var out = new Array(n + 1);
    for (var i = 0; i <= n; i++) out[i] = value;
    return out;
  }

  /**
   * Project one debt path.
   *
   * @param {Object} o  inputs, all 1-based arrays unless noted:
   *   scenario, adjustment (pp of GDP per year), adjPeriods (4 or 7),
   *   iir, potgdp, og, epsilon, m, dcoa, dprop, sfa, inflation,
   *   rgdpInitial, debtInitial, alphaInitial, betaInitial,
   *   spb, iSt, iLt, mLt, pb, ob, sb, thetaLt,
   *   gShock, pbShock, iirShock (zero-filled when deterministic)
   * @returns {Object} debt, g, drgdp, iir, pb, spb, ob, sb, rgdp, interest
   */
  function projectDebt(o) {
    var periods = o.og.length - 1;
    var adjustment = o.adjustment;
    var scenario = o.scenario;

    /* Local copies of everything the MATLAB function writes into. */
    var og = copy(o.og);
    var spb = copy(o.spb);
    var pb = copy(o.pb);
    var ob = copy(o.ob);
    var sb = copy(o.sb);
    var iir = copy(o.iir);
    var iSt = copy(o.iSt);
    var iLt = copy(o.iLt);
    var potgdp = copy(o.potgdp);

    var rgdp = filled(periods, NaN);
    var drgdp = filled(periods, NaN);
    var g = filled(periods, NaN);
    var debt = filled(periods, NaN);
    var alpha = filled(periods, NaN);   // share of short-term debt in total debt
    var beta = filled(periods, NaN);    // share of new long-term debt in long-term debt
    var iirLt = filled(periods, NaN);
    var interest = filled(periods, NaN);

    var adjustmentStartT = 3;                       // 2025
    var beforeAdjustmentStartT = adjustmentStartT - 1;
    var adjustmentEndT = beforeAdjustmentStartT + o.adjPeriods;
    var reviewStartT = adjustmentEndT + 1;

    debt[1] = o.debtInitial;
    alpha[1] = o.alphaInitial;
    beta[1] = o.betaInitial;

    /* How much of the output gap closes each year (project_debt5_1v.m, 112-125).
       Under the lower-SPB scenario the two-thirds closure lasts longer, because
       the slippage itself keeps the gap open. */
    var ogClosingFactor = filled(periods, NaN);
    var t;
    if (scenario === SCENARIO.LOWER_SPB) {
      for (t = adjustmentStartT + 1; t <= reviewStartT + 2 && t <= periods; t++) ogClosingFactor[t] = 2 / 3;
      if (reviewStartT + 3 <= periods) ogClosingFactor[reviewStartT + 3] = 0.5;
      for (t = reviewStartT + 4; t <= periods; t++) ogClosingFactor[t] = 0;
    } else {
      for (t = adjustmentStartT + 1; t <= reviewStartT && t <= periods; t++) ogClosingFactor[t] = 2 / 3;
      if (reviewStartT + 1 <= periods) ogClosingFactor[reviewStartT + 1] = 0.5;
      for (t = reviewStartT + 2; t <= periods; t++) ogClosingFactor[t] = 0;
    }

    /* Adverse r-g: potential output grows 0.5pp slower through the review period. */
    if (scenario === SCENARIO.ADVERSE_RG) {
      var baselinePotgdp = copy(potgdp);
      var gdpShock = filled(periods, 0);
      for (t = reviewStartT; t <= periods; t++) gdpShock[t] = 0.005;
      for (t = beforeAdjustmentStartT; t <= periods; t++) {
        var dpotgdp = (baselinePotgdp[t] - baselinePotgdp[t - 1]) / baselinePotgdp[t - 1];
        potgdp[t] = (1 + dpotgdp - gdpShock[t]) * potgdp[t - 1];
      }
    }

    /* ---- first period -------------------------------------------------- */
    rgdp[1] = (1 + og[1] / 100) * potgdp[1];
    drgdp[1] = (rgdp[1] - o.rgdpInitial) / o.rgdpInitial;
    g[1] = (1 + drgdp[1]) * (1 + o.inflation[1]) - 1;

    /* ---- main loop ------------------------------------------------------ */
    for (t = beforeAdjustmentStartT; t <= periods; t++) {

      /* Real output. During the plan, consolidation costs m(t) * adjustment of
         growth; afterwards the output gap closes towards zero. */
      if (t <= adjustmentStartT) {
        rgdp[t] = potgdp[t] * (1 + og[t] / 100);
        drgdp[t] = (rgdp[t] - rgdp[t - 1]) / rgdp[t - 1] - (o.m[t] * adjustment / 100);
      } else {
        rgdp[t] = potgdp[t] * (1 + ogClosingFactor[t] * og[t - 1] / 100)
                  - rgdp[t - 1] * (o.m[t] * adjustment / 100);
        drgdp[t] = (rgdp[t] - rgdp[t - 1]) / rgdp[t - 1];
      }

      /* The MATLAB source adds a demand boost here under scenario 2 (line 177)
         and then overwrites rgdp on the next line, so the boost never takes
         effect. Reproduced deliberately: this port matches the published tool.
         See "Known quirks" in dsa/README.md. */

      rgdp[t] = (1 + drgdp[t]) * rgdp[t - 1];
      og[t] = 100 * ((rgdp[t] / potgdp[t]) - 1);
      g[t] = (1 + drgdp[t]) * (1 + o.inflation[t]) - 1;

      /* Primary balance by phase and scenario. */
      var planTotal = o.adjPeriods * adjustment + spb[beforeAdjustmentStartT];
      if (t <= beforeAdjustmentStartT) {
        pb[t] = spb[t] + o.epsilon * og[t];

      } else if (t >= adjustmentStartT && t <= adjustmentEndT) {
        spb[t] = (t - beforeAdjustmentStartT) * adjustment + spb[beforeAdjustmentStartT];
        pb[t] = spb[t] + o.epsilon * og[t] - o.dcoa[t] - o.dprop[t];

      } else if (t >= reviewStartT && scenario === SCENARIO.ADJUSTMENT) {
        pb[t] = planTotal + o.epsilon * og[t] - o.dcoa[t] - o.dprop[t];
        spb[t] = planTotal;

      } else if (t === reviewStartT && scenario === SCENARIO.LOWER_SPB) {
        pb[t] = planTotal - SPB_SHOCK + o.epsilon * og[t] - o.dcoa[t] - o.dprop[t];
        spb[t] = planTotal - SPB_SHOCK;

      } else if (t > reviewStartT && scenario === SCENARIO.LOWER_SPB) {
        pb[t] = planTotal - SPB_SHOCK2 + o.epsilon * og[t] - o.dcoa[t] - o.dprop[t];
        spb[t] = planTotal - SPB_SHOCK2;

      } else if (t >= reviewStartT && scenario === SCENARIO.ADVERSE_RG) {
        iLt[t] = iLt[t] + INTEREST_RATE_SHOCK;
        iSt[t] = iSt[t] + INTEREST_RATE_SHOCK;
        pb[t] = planTotal + o.epsilon * og[t] - o.dcoa[t] - o.dprop[t];
        spb[t] = planTotal;

      } else if (t === reviewStartT && scenario === SCENARIO.FINANCIAL_STRESS) {
        var premium = Math.max(0, debt[adjustmentEndT] - STRESS_DEBT_THRESHOLD) * RISK_PREMIA;
        iLt[t] = iLt[t] + 2 * INTEREST_RATE_SHOCK + premium;
        iSt[t] = iSt[t] + 2 * INTEREST_RATE_SHOCK + premium;
        pb[t] = planTotal + o.epsilon * og[t] - o.dcoa[t] - o.dprop[t];
        spb[t] = planTotal;

      } else if (t > reviewStartT && scenario === SCENARIO.FINANCIAL_STRESS) {
        pb[t] = planTotal + o.epsilon * og[t] - o.dcoa[t] - o.dprop[t];
        spb[t] = planTotal;

      } else {
        throw new Error('No scenario selected. Set scenario 1-4.');
      }

      /* Implicit interest rate. Up to the forecast horizon the Commission's own
         iir is used and the long-term rate is backed out of it; after that the
         long-term rate is rolled forward (DSM 2023, Annex A3.2, eq. 3 and 6). */
      if (t <= adjustmentStartT) {
        iirLt[t] = (iir[t] - alpha[t - 1] * iSt[t]) / (1 - alpha[t - 1]);
      } else {
        iirLt[t] = beta[t - 1] * iLt[t] + (1 - beta[t - 1]) * iirLt[t - 1];
        iir[t] = alpha[t - 1] * iSt[t] + (1 - alpha[t - 1]) * iirLt[t];
      }

      /* Stochastic shocks are added on top of the baseline drivers. Note that
         iirLt above stays shock-free, exactly as in the MATLAB order. */
      g[t] = g[t] + o.gShock[t];
      pb[t] = pb[t] + o.pbShock[t];
      iir[t] = iir[t] + o.iirShock[t];

      /* ---- debt dynamics ---------------------------------------------- */
      debt[t] = debt[t - 1] * ((1 + iir[t] / 100) / (1 + g[t])) - pb[t] + o.sfa[t];
      interest[t] = debt[t - 1] * ((iir[t] / 100) / (1 + g[t]));

      /* ---- maturity structure, which feeds next period's interest rate -- */
      var debtIncreasing = debt[t] - (debt[t - 1] / (1 + g[t]));
      var debtRolled = Math.abs(debtIncreasing)
        - (debt[t - 1] * (alpha[t - 1] + (1 - alpha[t - 1]) * o.mLt[t])) / (1 + g[t]);
      var dLtr, dStr, dLtn, dStn, dO;

      if (debtIncreasing > 0) {
        dLtr = (o.mLt[t] * (1 - alpha[t - 1]) * debt[t - 1]) / (1 + g[t]);
        dStr = alpha[t - 1] * debt[t - 1] / (1 + g[t]);
        dLtn = o.thetaLt * (debt[t] - (debt[t - 1] / (1 + g[t])));
        dStn = (1 - o.thetaLt) * (debt[t] - (debt[t - 1] / (1 + g[t])));
        dO = (debt[t - 1] / (1 + g[t])) - dStr - dLtr;
        alpha[t] = (dStr + dStn) / debt[t];
        beta[t] = (dLtr + dLtn) / (dLtr + dLtn + dO);

      } else if (debtRolled < 0) {
        /* Debt falls, but some maturing debt still has to be rolled over. */
        var term1 = (1 - alpha[t - 1]) * o.mLt[t] * debt[t - 1] / (1 + g[t]);
        var term2 = alpha[t - 1] * debt[t - 1] / (1 + g[t]);
        var term3 = Math.abs(debtIncreasing);
        dLtr = term1 * (1 - (term3 / (term1 + term2)));
        dStr = term2 * (1 - (term3 / (term1 + term2)));
        dO = debt[t - 1] * (1 - alpha[t - 1] - o.mLt[t] * (1 - alpha[t - 1])) / (1 + g[t]);
        alpha[t] = (dStr + 0) / debt[t];
        beta[t] = (dLtr + 0) / (dLtr + 0 + dO);

      } else {
        /* Debt falls by more than the amount maturing: nothing is refinanced.
           beta is the share of the long-term stock that is NEWLY ISSUED, so
           when nothing is issued it is 0 and the surviving stock keeps its
           coupons. The MATLAB source writes 1, which reprices the whole stock
           at the current market rate the year after debt starts falling faster
           than it matures -- +1.05 pp on the baseline plan, and worth 1.8 pp of
           the final debt ratio. Corrected here and upstream; see the README. */
        alpha[t] = 0;
        beta[t] = 0;
      }

      if (t >= 3) {
        ob[t] = pb[t] - interest[t];   // headline balance, for the 3% limit
        sb[t] = spb[t] - interest[t];  // structural balance, for the 1.5% safeguard
      }
    }

    return {
      debt: debt, g: g, drgdp: drgdp, iir: iir, pb: pb,
      spb: spb, ob: ob, sb: sb, rgdp: rgdp, interest: interest, og: og
    };
  }

  global.DSAModel = {
    SCENARIO: SCENARIO,
    projectDebt: projectDebt,
    filled: filled
  };

}(typeof self !== 'undefined' ? self : this));
