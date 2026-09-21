/* ==========================================================================
   app.js — controls, results and charts for the DSA calculator

   Reads the form, runs the model (dsa/model.js and dsa/criteria.js) and
   redraws. A full run, including 1,000 simulated paths, takes a few tens of
   milliseconds, so everything is recomputed on every input event.

   Two ideas carry the page:
     - a reference trajectory. The baseline settings are solved once at load;
       as soon as a control leaves its default the baseline path is drawn as
       a grey ghost under the live line, and the headline shows the change.
       "Pin as reference" swaps the ghost for any scenario the visitor likes.
     - the rules as pictures. The debt safeguard is a slope the path has to
       beat, the stochastic test is two dots, and every rule's requirement is
       a bar with the binding one tagged.

   Two honesty rules the page keeps, both inherited from the search in
   criteria.js: a rule that no adjustment up to 2.00 pp can satisfy drops out
   of the maximum there, so this page reports "> 2.00" rather than the number
   the remaining rules give; and the deficit floors lift single plan years
   above the constant adjustment, so totals are summed from the year-by-year
   path rather than multiplied out.
   ========================================================================== */

(function () {
  'use strict';

  var data = window.DSA_DATA;
  var shocks = window.DSA_SHOCKS;
  var C = window.DSACriteria;
  var Chart = window.DSAChart;

  var form = document.getElementById('dsa-form');
  var chartHost = document.getElementById('dsa-chart');
  var rulesHost = document.getElementById('dsa-rules');
  var expenditureHost = document.getElementById('dsa-expenditure-chart');
  var status = document.getElementById('dsa-status');
  if (!form || !data || !shocks) return;

  /* Form values at the Commission's baseline. Strings for inputs, booleans
     for checkboxes: the same shapes the form gives back. */
  var DEFAULTS = {
    plan: '7',
    debtInitial: data.scalars.debt_initial.toFixed(1),
    rateShift: '0',
    growthShift: '0',
    phi: data.scalars.phi.toFixed(2),
    plausibility: '7',
    method: 'normal',
    sfaMethod: '0',
    useStochastic: true,
    useDebtSafeguard: true,
    useDeficitBenchmark: true,
    useDeficitSafeguard: true,
    showNoAdjustment: true,
    showScenarios: false
  };

  /* The keys that change the numbers, as opposed to what is drawn. */
  var MODEL_KEYS = ['plan', 'debtInitial', 'rateShift', 'growthShift', 'phi', 'plausibility',
                    'method', 'sfaMethod', 'useStochastic', 'useDebtSafeguard',
                    'useDeficitBenchmark', 'useDeficitSafeguard'];
  var SELECTS = ['plausibility', 'method', 'sfaMethod'];

  var SLIDERS = {
    debtInitial: { unit: '% of GDP', decimals: 1, signed: false },
    rateShift: { unit: ' pp', decimals: 1, signed: true },
    growthShift: { unit: ' pp', decimals: 2, signed: true },
    phi: { unit: '', decimals: 2, signed: false }
  };

  var COLORS = {
    line: 'var(--dsa-line, #7b2d2d)',
    ref: 'var(--dsa-ref, #978d79)',
    noPlan: 'var(--dsa-muted-line, #8c8474)',
    alt1: 'var(--dsa-alt1, #3f6b7d)',
    alt2: 'var(--dsa-alt2, #8a6d1f)',
    alt3: 'var(--dsa-alt3, #5a5a8a)',
    text: 'var(--ink-muted, #5b5449)'
  };

  var SCENARIO_NAMES = {
    1: 'DSA baseline scenario', 2: 'DSA lower-SPB scenario',
    3: 'DSA adverse r–g scenario', 4: 'DSA financial-stress scenario'
  };

  /* ---- form access ------------------------------------------------------- */

  function control(name) { return form.elements[name]; }

  function val(name) {
    var node = control(name);
    if (!node) return null;
    if (node.type === 'checkbox') return node.checked;
    if (node.length && node[0] && node[0].type === 'radio') {
      for (var i = 0; i < node.length; i++) if (node[i].checked) return node[i].value;
      return null;
    }
    return node.value;
  }

  function setVal(name, value) {
    var node = control(name);
    if (!node) return;
    if (node.type === 'checkbox') { node.checked = !!value; return; }
    if (node.length && node[0] && node[0].type === 'radio') {
      for (var i = 0; i < node.length; i++) node[i].checked = (node[i].value === String(value));
      return;
    }
    node.value = value;
  }

  function applyParams(obj) {
    Object.keys(DEFAULTS).forEach(function (k) {
      if (obj.hasOwnProperty(k)) setVal(k, obj[k]);
    });
  }

  /* Presets touch only the model, never the chart-only options. */
  function applyModel(obj) {
    MODEL_KEYS.forEach(function (k) { if (obj.hasOwnProperty(k)) setVal(k, obj[k]); });
  }

  function formState() {
    var s = {};
    Object.keys(DEFAULTS).forEach(function (k) { s[k] = val(k); });
    return s;
  }

  function toParams(state) {
    return {
      plan: parseInt(state.plan, 10),
      debtInitial: parseFloat(state.debtInitial),
      rateShift: parseFloat(state.rateShift),
      growthShift: parseFloat(state.growthShift),
      phi: parseFloat(state.phi),
      plausibility: parseInt(state.plausibility, 10),
      method: state.method,
      sfaMethod: parseInt(state.sfaMethod, 10),
      useStochastic: !!state.useStochastic,
      useDebtSafeguard: !!state.useDebtSafeguard,
      useDeficitBenchmark: !!state.useDeficitBenchmark,
      useDeficitSafeguard: !!state.useDeficitSafeguard
    };
  }

  /* A preset is on when its own settings are in force, whatever else is set.
     Applying it changes nothing, so the two states compare equal. Presets
     stack, so several can be on at once. */
  function chipOn(set, state) {
    return sameModel(Object.assign({}, state, set), state);
  }

  /* Compare as model parameters, so "100" and "100.0" are the same debt. */
  function sameModel(a, b) {
    var pa = toParams(a), pb = toParams(b);
    return MODEL_KEYS.every(function (k) {
      return typeof pa[k] === 'number' ? Math.abs(pa[k] - pb[k]) < 1e-9 : pa[k] === pb[k];
    });
  }

  /* ---- formatting ---------------------------------------------------------- */

  function signed(v, decimals) {
    var d = decimals === undefined ? 2 : decimals;
    var s = Math.abs(v).toFixed(d);
    if (Math.abs(v) < Math.pow(10, -d) / 2) return '0' + (d ? '.' + s.split('.')[1] : '');
    return (v > 0 ? '+' : '−') + s;
  }

  function sliderText(name, value) {
    var f = SLIDERS[name];
    var v = parseFloat(value);
    var num = f.signed ? signed(v, f.decimals).replace(/(\.\d)0$/, '$1') : v.toFixed(f.decimals);
    return num + f.unit;
  }

  function setText(id, content) {
    var node = document.getElementById(id);
    if (node) node.textContent = content;
  }

  function setHidden(id, hidden) {
    var node = document.getElementById(id);
    if (node) node.hidden = !!hidden;
  }

  function sum(arr) { return arr.reduce(function (s, v) { return s + v; }, 0); }

  /* Public debate is conducted in euros, not points of GDP. The workbook holds
     only real GDP levels and nominal growth rates, so the euro figures carry one
     external anchor — nominal GDP in the base year — forward by the model's own
     nominal growth, which responds to the controls. */
  function nominalGdp(r) {
    var n = [null, data.scalars.ngdp_initial];
    var g = r.paths[1].g;
    for (var t = 2; t <= r.inputs.totalPeriods; t++) n[t] = n[t - 1] * (1 + g[t]);
    return n;
  }

  /* Per plan year: that year's step, and the permanent adjustment reached so
     far, both valued at that year's GDP. */
  function euroPath(r) {
    var ngdp = nominalGdp(r);
    var step = [], cumulative = [], running = 0;
    for (var i = 0; i < r.planYears.length; i++) {
      var t = r.inputs.adjustmentStart + i;
      running += r.finalPath[i];
      step.push(r.finalPath[i] / 100 * ngdp[t]);
      cumulative.push(running / 100 * ngdp[t]);
    }
    return { step: step, cumulative: cumulative, ngdp: ngdp };
  }

  function bn(v) { return '€' + (v < 10 ? v.toFixed(1) : String(Math.round(v))) + ' bn'; }

  function joinNames(list) {
    if (list.length <= 1) return list.join('');
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }

  /* Name the controls that differ from the baseline: "rates +1.0 pp, 4-year plan". */
  function describe(state) {
    var parts = [];
    if (state.plan !== DEFAULTS.plan) parts.push(state.plan + '-year plan');
    if (parseFloat(state.debtInitial) !== parseFloat(DEFAULTS.debtInitial)) parts.push('debt ' + parseFloat(state.debtInitial).toFixed(0) + '%');
    if (parseFloat(state.rateShift) !== 0) parts.push('rates ' + sliderText('rateShift', state.rateShift));
    if (parseFloat(state.growthShift) !== 0) parts.push('growth ' + sliderText('growthShift', state.growthShift));
    if (parseFloat(state.phi) !== parseFloat(DEFAULTS.phi)) parts.push('multiplier ' + parseFloat(state.phi).toFixed(2));
    var off = [];
    if (!state.useStochastic) off.push('stochastic test');
    if (!state.useDebtSafeguard) off.push('debt safeguard');
    if (!state.useDeficitBenchmark) off.push('deficit benchmark');
    if (!state.useDeficitSafeguard) off.push('resilience safeguard');
    if (off.length === 3 && state.useStochastic) parts.push('safeguards off');
    else if (off.length) parts.push(off.join(', ') + ' off');
    if (state.plausibility !== DEFAULTS.plausibility) parts.push(state.plausibility * 10 + '% of paths');
    if (state.method !== DEFAULTS.method) parts.push('bootstrap shocks');
    if (state.sfaMethod !== DEFAULTS.sfaMethod) parts.push('zero SFA');
    return parts.length ? parts.join(', ') : 'baseline';
  }

  /* ---- reading a result ---------------------------------------------------- */

  /* Rules that are switched on but that no adjustment in the search range
     satisfies. criteria.js drops these from its maximum, so the page has to
     say so instead of reporting the remaining rules' number as required. */
  function unmetRules(r, params) {
    if (!r || r.failed) return [];
    var u = [];
    [4, 3, 2, 1].forEach(function (s) { if (r.deterministic[s].a === null) u.push(SCENARIO_NAMES[s]); });
    if (params.useStochastic && r.stochastic.a === null) u.push('DSA stochastic test');
    if (params.useDebtSafeguard && r.debtSafeguard.applies && r.debtSafeguard.a === null) u.push('debt sustainability safeguard');
    return u;
  }

  /* Which criterion set the number, in plain words; ties are named together. */
  function bindingParts(r, params) {
    if (r.bindingLabel === C.BINDING[0]) {
      var best = 0;
      [1, 2, 3, 4].forEach(function (s) { best = Math.max(best, r.deterministic[s].index); });
      var tied = [1, 2, 3, 4].filter(function (s) { return r.deterministic[s].index === best; });
      return {
        key: 'det' + tied[0],
        keys: tied.map(function (s) { return 'det' + s; }),
        text: tied.length === 1 ? SCENARIO_NAMES[tied[0]]
          : joinNames(tied.map(function (s) { return SCENARIO_NAMES[s]; })) + ' (tie)'
      };
    }
    if (r.bindingLabel === C.BINDING[0.5]) return { key: 'stoch', keys: ['stoch'], text: 'DSA stochastic test (' + params.plausibility * 10 + '% of paths)' };
    if (r.bindingLabel === C.BINDING[1]) return { key: 'safeguard', keys: ['safeguard'], text: 'debt sustainability safeguard' };
    return { key: 'other', keys: [], text: r.bindingLabel };
  }

  /* Years in which a given rule label set the year-by-year path. */
  function yearsWith(r, label) {
    var ys = [];
    r.bindingLabels.forEach(function (l, i) { if (l === label) ys.push(r.planYears[i]); });
    if (!ys.length) return null;
    return 'in ' + ys[0] + (ys.length > 1 ? '–' + String(ys[ys.length - 1]).slice(2) : '');
  }

  function isLifted(r) {
    return r.finalPath.some(function (v) { return v > r.adjustment + 1e-9; });
  }

  function ruleRows(r, params, ref, unmet) {
    var det = { 4: 'DSA: financial stress', 3: 'DSA: adverse r–g', 2: 'DSA: lower SPB', 1: 'DSA: baseline' };
    var short = { 4: 'Fin. stress', 3: 'Adverse r–g', 2: 'Lower SPB', 1: 'Baseline' };
    var rows = [];
    var refR = ref && ref.r && !ref.r.failed ? ref.r : null;
    var lifted = isLifted(r);
    /* A bar binds when it reaches the headline value; with an unmet rule the
       headline is "> 2.00" and nothing is tagged. */
    var top = function (a) { return !unmet.length && a !== null && Math.abs(a - r.adjustment) < 1e-9; };
    var bindNote = function (isBinding) {
      return isBinding && lifted ? yearsWith(r, r.bindingLabel) : null;
    };

    [4, 3, 2, 1].forEach(function (s) {
      var d = r.deterministic[s];
      var binding = top(d.a) && r.bindingLabel === C.BINDING[0];
      rows.push({
        label: det[s], short: short[s], value: d.a,
        state: d.a === null ? 'unmet' : (binding ? 'binding' : 'on'),
        note: bindNote(binding),
        base: refR ? refR.deterministic[s].a : null
      });
    });
    var stochBinding = top(r.stochastic.a) && r.bindingLabel === C.BINDING[0.5];
    rows.push({
      label: 'DSA: stochastic (' + params.plausibility * 10 + '%)', short: 'Stochastic',
      value: r.stochastic.a,
      state: !params.useStochastic ? 'off' : (r.stochastic.a === null ? 'unmet' : (stochBinding ? 'binding' : 'on')),
      note: bindNote(stochBinding),
      base: refR ? refR.stochastic.a : null
    });
    var sg = r.debtSafeguard;
    var sgBinding = top(sg.a) && r.bindingLabel === C.BINDING[1];
    rows.push({
      label: 'Debt safeguard', short: 'Debt safeguard', value: sg.a,
      state: !params.useDebtSafeguard ? 'off' : !sg.applies ? 'na' : (sg.a === null ? 'unmet' : (sgBinding ? 'binding' : 'on')),
      note: !params.useDebtSafeguard ? 'off' : !sg.applies ? 'not needed below 60%' : bindNote(sgBinding),
      base: refR && refR.debtSafeguard ? refR.debtSafeguard.a : null
    });
    var benchYears = yearsWith(r, C.BINDING[2]);
    rows.push({
      label: 'Deficit benchmark (floor)', short: 'Deficit floor', value: 0.5,
      state: !params.useDeficitBenchmark ? 'off' : (benchYears ? 'floor-binding' : 'floor'),
      note: benchYears
    });
    var resil = params.plan === 7 ? 0.25 : 0.4;
    var resilYears = yearsWith(r, C.BINDING[3]);
    rows.push({
      label: 'Resilience safeguard (floor)', short: 'Resilience floor', value: resil,
      state: !params.useDeficitSafeguard ? 'off' : (resilYears ? 'floor-binding' : 'floor'),
      note: resilYears
    });
    return rows;
  }

  /* Text alternatives for the two charts. */
  function writeLegend(series, years) {
    var legend = document.getElementById('dsa-legend');
    if (!legend) return;
    legend.innerHTML = series.map(function (s) {
      var lastIdx = -1;
      for (var j = Math.min(s.values.length, years.length) - 1; j >= 0; j--) {
        if (isFinite(s.values[j]) && s.values[j] !== null) { lastIdx = j; break; }
      }
      return '<li>' + s.name + (lastIdx >= 0 ? ': ' + s.values[lastIdx].toFixed(1) + '% of GDP in ' + years[lastIdx] : '') + '</li>';
    }).join('');
  }

  function writeRulesText(rows) {
    var node = document.getElementById('dsa-rules-text');
    if (!node) return;
    node.innerHTML = rows.map(function (row) {
      var s = row.label + ': ';
      if (row.state === 'off' || row.state === 'na') s += row.note || 'off';
      else if (row.state === 'unmet') s += 'more than 2.00 pp a year';
      else {
        s += row.value.toFixed(2) + ' pp a year';
        if (row.state === 'binding' || row.state === 'floor-binding') s += ', binding' + (row.note ? ' ' + row.note : '');
        if (row.state === 'floor' && !row.note) s += ' (floor, not reached)';
      }
      return '<li>' + s + '</li>';
    }).join('');
  }

  /* ---- state ---------------------------------------------------------------- */

  var BASE = { state: Object.assign({}, DEFAULTS) };
  BASE.params = toParams(BASE.state);
  BASE.r = C.solve(data, shocks, BASE.params);

  var pinned = null;          // {state, params, r, label}
  var lastStatus = '';

  /* ---- rendering ------------------------------------------------------------ */

  function markChanged(state) {
    Object.keys(SLIDERS).forEach(function (name) {
      setText('out-' + name, sliderText(name, state[name]));
      var wrap = control(name).closest('.dsa-control');
      if (wrap) wrap.classList.toggle('is-changed', parseFloat(state[name]) !== parseFloat(DEFAULTS[name]));
    });
    var planWrap = document.getElementById('plan-control');
    if (planWrap) planWrap.classList.toggle('is-changed', state.plan !== DEFAULTS.plan);
    var anySelect = false;
    SELECTS.forEach(function (name) {
      var changed = String(state[name]) !== String(DEFAULTS[name]);
      anySelect = anySelect || changed;
      var wrap = control(name).closest('.dsa-control');
      if (wrap) wrap.classList.toggle('is-changed', changed);
    });
    var adv = form.querySelector ? form.querySelector('.dsa-advanced') : null;
    if (adv) adv.classList.toggle('is-changed', anySelect ||
      state.showNoAdjustment !== DEFAULTS.showNoAdjustment || state.showScenarios !== DEFAULTS.showScenarios);

    var chips = document.querySelectorAll('#dsa-presets button[data-set]');
    var anyChip = false;
    Array.prototype.forEach.call(chips, function (chip) {
      var on = chipOn(JSON.parse(chip.getAttribute('data-set')), state);
      anyChip = anyChip || on;
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var clear = document.getElementById('dsa-presets-clear');
    if (clear) clear.hidden = !anyChip;
  }

  function setDelta(text, neutral) {
    var node = document.getElementById('result-delta');
    if (!node) return;
    node.hidden = false;
    node.textContent = text;
    node.classList.toggle('is-neutral', !!neutral);
  }

  /* The expenditure ceilings are the operational form of the same requirement,
     kept as a secondary block because the adjustment is the clearer number for
     a general reader. */
  function renderExpenditure(r, ref, refName, reason) {
    var values = document.getElementById('dsa-expenditure-values');
    if (reason) {
      expenditureHost.__dsaSpec = null;
      expenditureHost.innerHTML = '';
      values.innerHTML = '';
      setText('dsa-expenditure-note', reason);
      return;
    }
    var reference = ref ? r.planYears.map(function (year) {
      var i = ref.planYears.indexOf(year);
      return i < 0 ? null : ref.netExpenditure[i];
    }) : null;
    Chart.drawExpenditure(expenditureHost, {
      years: r.planYears, values: r.netExpenditure, reference: reference,
      ariaLabel: 'Annual nominal net expenditure growth ceilings: ' + r.planYears.map(function (year, i) {
        return year + ': ' + r.netExpenditure[i].toFixed(2) + ' percent';
      }).join('; ') + '.'
    });
    values.innerHTML = r.planYears.map(function (year, i) {
      return '<div><dt>' + year + '</dt><dd>' + r.netExpenditure[i].toFixed(2) + '%</dd></div>';
    }).join('');
    setText('dsa-expenditure-note', 'Ceilings include any year lifted by a deficit floor.' +
      (reference ? ' The dashed grey line is the ' + refName + ', over the plan years the two share.' : ''));
  }

  function render(announce) {
    var state = formState();
    var params = toParams(state);
    var narrow = chartHost.clientWidth > 0 && chartHost.clientWidth < 480;
    markChanged(state);

    var r;
    try {
      r = C.solve(data, shocks, params);
    } catch (err) {
      renderExpenditure(null, null, null, 'No expenditure ceilings: the projection failed.');
      lastStatus = 'The projection failed: ' + err.message;
      status.textContent = lastStatus;
      setText('result-figure', '—');
      setText('result-binding', 'projection unavailable; change a setting or reset to try again');
      ['result-delta', 'result-was', 'result-floors', 'dsa-refline', 'dsa-rules-panel', 'dsa-unmet'].forEach(function (id) { setHidden(id, true); });
      ['stat-total', 'stat-spb', 'stat-debt-end', 'stat-debt-final'].forEach(function (id) { setText(id, '—'); });
      chartHost.__dsaSpec = null;
      chartHost.innerHTML = '';
      rulesHost.__dsaSpec = null;
      rulesHost.innerHTML = '';
      writeLegend([], []);
      writeRulesText([]);
      document.getElementById('dsa-table-body').innerHTML = '';
      setText('out-rg', '');
      padForStage();
      return;
    }

    /* The reference: a pinned scenario, or the baseline once anything moved. */
    var ref = pinned || BASE;
    var refName = pinned ? 'pinned' : 'baseline';
    var showGhost = !!pinned || !sameModel(state, BASE.state);
    var refR = ref.r;
    var refOk = showGhost && !refR.failed;

    var pinBtn = document.getElementById('dsa-pin');
    if (pinBtn) {
      pinBtn.textContent = pinned ? 'Unpin reference' : 'Pin as reference';
      pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    }
    setHidden('dsa-refline', false);
    var refline = document.getElementById('dsa-refline');
    if (refline) refline.classList.toggle('is-off', !refOk);
    setText('dsa-ref-name', refOk
      ? (pinned ? 'Grey line: your pinned scenario (' + pinned.label + ')' : 'Grey line: the starting assumptions')
      : 'Change a setting and a grey line shows where you started.');

    /* ---- failed state: keep drawing ------------------------------------ */
    if (r.failed) {
      renderExpenditure(null, null, null, 'No expenditure ceilings: no adjustment up to 2.00 pp a year satisfies the rules.');
      var inputs = r.inputs;
      var fYears = [];
      for (var t = 1; t <= inputs.totalPeriods; t++) fYears.push(inputs.baseYear + t - 1);
      var pf = fYears.slice(inputs.adjustmentStart - 1, inputs.adjustmentEnd);
      setText('result-figure', '> 2.00');
      setText('result-unit', 'pp of GDP a year · ' + params.plan + '-year plan ' + pf[0] + '–' + pf[pf.length - 1]);
      setHidden('result-delta', true);
      setText('result-binding', 'no adjustment up to 2.00 a year meets the rules');
      setHidden('result-was', true);
      setHidden('result-floors', true);
      setHidden('result-euro', true);
      ['stat-total', 'stat-spb', 'stat-debt-end', 'stat-debt-final'].forEach(function (id) { setText(id, '—'); });
      var two = C.project(inputs, 1, 2, null).debt.slice(1);
      var none = C.project(inputs, 1, 0, null).debt.slice(1);
      var fSeries = [];
      if (refOk) fSeries.push({ name: refName, values: refR.paths[1].debt.slice(1, fYears.length + 1), color: COLORS.ref, labelColor: COLORS.text, width: 1.5, label: true });
      fSeries.push({ name: 'no consolidation', values: none, color: COLORS.noPlan, labelColor: COLORS.text, dash: '5 4', label: true });
      fSeries.push({ name: 'even 2.00 a year', values: two, color: COLORS.line, width: 2.4, label: true });
      Chart.draw(chartHost, {
        years: fYears, series: fSeries, bands: [],
        shade: { from: pf[0], to: pf[pf.length - 1], label: params.plan + '-YEAR PLAN' },
        thresholds: [{ value: 60, label: '60%' }, { value: 90, label: '90%' }],
        yLabel: 'debt, % of GDP', message: 'Still rising: no adjustment in range works',
        ariaLabel: 'Debt keeps rising even with 2 percentage points of adjustment a year.'
      });
      writeLegend(fSeries, fYears);
      rulesHost.__dsaSpec = null;
      rulesHost.innerHTML = '';
      writeRulesText([]);
      setHidden('dsa-rules-panel', true);
      setHidden('dsa-unmet', true);
      document.getElementById('dsa-table-body').innerHTML = '';
      setText('out-rg', '');
      if (announce) {
        lastStatus = 'No adjustment up to 2 points a year satisfies the rules with these settings.';
        status.textContent = lastStatus;
      }
      padForStage();
      return;
    }

    /* ---- headline --------------------------------------------------------- */
    var b = bindingParts(r, params);
    var unmet = unmetRules(r, params);
    var refUnmet = refR.failed ? [] : unmetRules(refR, ref.params);
    renderExpenditure(r, refOk && !refUnmet.length ? refR : null, refName, unmet.length
      ? 'No expenditure ceilings: ' + joinNames(unmet) + ' cannot be met with up to 2.00 pp a year.' : null);
    var years = r.years;
    var planFirst = r.planYears[0], planLast = r.planYears[r.planYears.length - 1];
    var lifted = isLifted(r);
    var total = sum(r.finalPath);
    var p1 = r.paths[1];
    var adjEnd = r.inputs.adjustmentEnd;

    setText('result-unit', 'pp of GDP a year · ' + params.plan + '-year plan ' + planFirst + '–' + planLast);
    if (unmet.length) {
      setText('result-figure', '> 2.00');
      setText('result-binding', 'even 2.00 a year does not meet the ' + joinNames(unmet) +
        '; the chart shows ' + r.adjustment.toFixed(2) + ', what the other rules need');
    } else {
      setText('result-figure', r.adjustment.toFixed(2));
      setText('result-binding', b.text);
    }

    var comparable = refOk && !unmet.length && !refUnmet.length;
    if (comparable) {
      var delta = r.adjustment - refR.adjustment;
      var flat = Math.abs(delta) < 0.005;
      setDelta((flat ? '= same as ' : (delta > 0 ? '▲ ' : '▼ ') + signed(delta) + ' vs ') + refName, flat);
      var refB = bindingParts(refR, ref.params);
      var wasNode = document.getElementById('result-was');
      if (refB.key !== b.key) {
        wasNode.textContent = '(' + refName + ': ' + refB.text + ')';
        wasNode.hidden = false;
      } else {
        wasNode.hidden = true;
      }
    } else if (!showGhost) {
      setDelta('= baseline', true);
      setHidden('result-was', true);
    } else {
      setHidden('result-delta', true);
      setHidden('result-was', true);
    }

    /* The deficit floors lift single years above the constant adjustment. */
    var floorsNode = document.getElementById('result-floors');
    if (floorsNode) {
      if (lifted && !unmet.length) {
        var lifts = [];
        [C.BINDING[2], C.BINDING[3]].forEach(function (label) {
          var ys = yearsWith(r, label);
          if (!ys) return;
          var v = null;
          r.bindingLabels.forEach(function (l, i) { if (l === label && v === null) v = r.finalPath[i]; });
          lifts.push(ys.replace(/^in /, '') + ' rises to ' + v.toFixed(2) + ' (' + label.toLowerCase() + ')');
        });
        floorsNode.textContent = 'Some years need more: ' + joinNames(lifts) +
          '. The chart uses ' + r.adjustment.toFixed(2) + '.';
        floorsNode.hidden = false;
      } else {
        floorsNode.hidden = true;
      }
    }

    var euroNode = document.getElementById('result-euro');
    if (unmet.length) {
      setText('stat-total', '—');
      setText('stat-spb', '—');
      if (euroNode) euroNode.hidden = true;
    } else {
      setText('stat-total', total.toFixed(1) + ' pp');
      /* The SPB path is linear in the adjustment, so the floored total adds exactly. */
      setText('stat-spb', (r.inputs.spb[r.inputs.adjustmentStart - 1] + total).toFixed(1) + '%');
      if (euroNode) {
        /* One figure, on the horizon public debate uses: what the first four
           years of the plan add up to as a permanent annual adjustment. */
        var eur = euroPath(r);
        var i4 = Math.min(3, eur.cumulative.length - 1);
        euroNode.textContent = 'In euros: about ' + bn(eur.cumulative[i4]) + ' a year by ' +
          r.planYears[i4] + (params.plan > 4 ? ', after four years of the plan.' : ', the whole plan.');
        euroNode.hidden = false;
      }
    }
    setText('stat-debt-end', r.debtEnd.toFixed(1) + '%');
    setText('stat-debt-final', r.debtFinal.toFixed(1) + '%');
    setText('stat-debt-end-year', String(planLast));
    setText('stat-debt-final-year', String(years[years.length - 1]));

    /* r - g at the end of the plan: the snowball in one number. */
    var rg = p1.iir[adjEnd] - 100 * p1.g[adjEnd];
    setText('out-rg', 'r − g at the end of the plan: ' + signed(rg, 1) + ' pp');

    /* ---- year table (collapsed) ------------------------------------------ */
    var eurTable = euroPath(r);
    document.getElementById('dsa-table-body').innerHTML = r.planYears.map(function (year, i) {
      var refDebt = refOk ? refR.paths[1].debt[refR.years.indexOf(year) + 1] : null;
      return '<tr><th scope="row">' + year + '</th>' +
             '<td>' + r.finalPath[i].toFixed(2) + '</td>' +
             '<td>' + eurTable.cumulative[i].toFixed(1) + '</td>' +
             '<td>' + r.netExpenditure[i].toFixed(2) + '</td>' +
             '<td>' + p1.debt[r.inputs.adjustmentStart + i].toFixed(1) +
               (isFinite(refDebt) && refDebt !== null && refDebt !== undefined ? ' <span class="dsa-table-ref">(' + refName + ' ' + refDebt.toFixed(1) + ')</span>' : '') + '</td>' +
             '<td>' + r.bindingLabels[i] + '</td></tr>';
    }).join('');

    /* ---- debt chart --------------------------------------------------------- */
    var series = [];
    if (refOk) {
      series.push({ name: refName, values: refR.paths[1].debt.slice(1, years.length + 1), color: COLORS.ref, labelColor: COLORS.text, width: 1.6, label: true });
    }
    if (state.showNoAdjustment) {
      series.push({ name: narrow ? 'no plan' : 'no consolidation', values: r.noAdjustment.debt.slice(1), color: COLORS.noPlan, labelColor: COLORS.text, dash: '5 4', width: 1.6, label: true });
    }
    if (state.showScenarios) {
      series.push({ name: narrow ? 'low SPB' : 'lower SPB', values: r.paths[2].debt.slice(1), color: COLORS.alt1, width: 1.3, label: true });
      series.push({ name: narrow ? 'adv. r–g' : 'adverse r–g', values: r.paths[3].debt.slice(1), color: COLORS.alt2, width: 1.3, label: true });
      series.push({ name: narrow ? 'stress' : 'financial stress', values: r.paths[4].debt.slice(1), color: COLORS.alt3, width: 1.3, label: true });
    }
    series.push({ name: narrow ? 'with plan' : 'with the plan', values: p1.debt.slice(1), color: COLORS.line, width: 2.4, label: true });

    var bands = [];
    var fanLastIdx = -1;
    if (r.fan) {
      var padTo = function (arr) {
        var out = new Array(years.length).fill(null);
        for (var i = 0; i < arr.length && i < out.length; i++) out[i] = arr[i];
        return out;
      };
      bands = [
        { lo: padTo(r.fan.p10), hi: padTo(r.fan.p90), opacity: 0.16 },
        { lo: padTo(r.fan.p20), hi: padTo(r.fan.p80), opacity: 0.16 },
        { lo: padTo(r.fan.p30), hi: padTo(r.fan.p70), opacity: 0.16 },
        { lo: padTo(r.fan.p40), hi: padTo(r.fan.p60), opacity: 0.16 }
      ];
      fanLastIdx = r.fan.years.length - 1;
    }

    var thresholds = [
      { value: 60, label: params.useDebtSafeguard && !narrow ? '60% · safeguard 0.5 pp a year' : '60%' },
      { value: 90, label: params.useDebtSafeguard && !narrow ? '90% · safeguard 1 pp a year' : '90%' }
    ];

    var guides = [];
    var sg = r.debtSafeguard;
    if (params.useDebtSafeguard && sg.applies) {
      var startVal = p1.debt[r.inputs.adjustmentStart - 1];
      guides.push({
        fromYear: planFirst - 1, fromValue: startVal,
        toYear: planLast, toValue: startVal + sg.required * params.plan,
        label: narrow ? null : 'safeguard: ' + Math.abs(sg.required).toFixed(1) + ' pp a year on average',
        emphasis: b.key === 'safeguard'
      });
    }

    var links = [];
    if (r.fan && b.key === 'stoch' && !unmet.length) {
      var pct = 'p' + params.plausibility * 10;
      links.push({
        fromYear: planLast, fromValue: r.debtEnd,
        toYear: r.fan.years[fanLastIdx], toValue: r.fan[pct][fanLastIdx],
        text: narrow ? params.plausibility * 10 + 'th pct.' : params.plausibility * 10 + 'th pct., 5 yrs on'
      });
    }

    var brackets = [];
    if (refOk) {
      var refAtPlanLast = refR.paths[1].debt[refR.years.indexOf(planLast) + 1];
      if (isFinite(refAtPlanLast) && Math.abs(r.debtEnd - refAtPlanLast) >= 0.5) {
        brackets.push({
          year: planLast, from: refAtPlanLast, to: r.debtEnd,
          text: narrow ? signed(r.debtEnd - refAtPlanLast, 1) + ' pp'
                       : r.debtEnd.toFixed(1) + '%, ' + signed(r.debtEnd - refAtPlanLast, 1) + ' pp vs ' + refName
        });
      }
    }

    var points = [{ year: planLast, value: r.debtEnd, text: narrow ? null : r.debtEnd.toFixed(1) + '% at end of plan' }];

    var notes = [];
    if (r.fan && !narrow) {
      notes.push({ year: r.fan.years[fanLastIdx], value: r.fan.p10[fanLastIdx], text: 'test ends ' + r.fan.years[fanLastIdx], anchor: 'end', below: true });
    }

    Chart.draw(chartHost, {
      years: years, series: series, bands: bands,
      shade: { from: planFirst, to: planLast, label: params.plan + '-YEAR PLAN ' + planFirst + '–' + String(planLast).slice(2) },
      thresholds: thresholds, guides: guides, links: links, points: points, brackets: brackets, notes: notes,
      include: BASE.r.paths[1].debt.slice(1, years.length + 1),
      yLabel: 'debt, % of GDP',
      ariaLabel: 'Projected government debt as a percentage of GDP, ' + years[0] + ' to ' + years[years.length - 1] +
                 ', with an adjustment of ' + r.adjustment.toFixed(2) + ' percentage points of GDP a year. ' +
                 'Debt is ' + r.debtEnd.toFixed(1) + ' percent at the end of the plan and ' + r.debtFinal.toFixed(1) + ' percent in ' + years[years.length - 1] + '.'
    });
    writeLegend(series, years);

    /* ---- rule bars ---------------------------------------------------------- */
    var rows = ruleRows(r, params, refOk ? ref : null, unmet);
    setHidden('dsa-rules-panel', false);
    Chart.drawBars(rulesHost, {
      rows: rows, max: 2,
      marker: unmet.length ? null : r.adjustment,
      markerLabel: lifted ? r.adjustment.toFixed(2) + ' before floors' : 'required ' + r.adjustment.toFixed(2),
      unit: 'pp of GDP a year',
      ariaLabel: 'What each scenario would require on its own. ' + (unmet.length
        ? joinNames(unmet) + ' cannot be met with up to 2 points a year.'
        : 'The binding rule is ' + b.text + ' at ' + r.adjustment.toFixed(2) + ' points a year.')
    });
    writeRulesText(rows);
    var unmetNode = document.getElementById('dsa-unmet');
    if (unmetNode) {
      unmetNode.hidden = !unmet.length;
      unmetNode.textContent = unmet.length
        ? 'Even 2.00 a year does not meet the ' + joinNames(unmet) + '. As in the original tool that rule drops out, and the chart shows what the other rules need.'
        : '';
    }

    /* ---- one sentence for assistive tech, only on committed changes ------ */
    if (announce) {
      var sentence = (unmet.length
        ? 'Required adjustment above 2 points a year: ' + joinNames(unmet) + ' cannot be met. '
        : 'Required adjustment ' + r.adjustment.toFixed(2) + ' points a year' +
          (comparable ? ', ' + signed(r.adjustment - refR.adjustment) + ' versus ' + refName : '') +
          '. Binding rule: ' + b.text + '. ') +
        'Debt ' + r.debtFinal.toFixed(1) + ' percent in ' + years[years.length - 1] + '.';
      if (sentence !== lastStatus) { status.textContent = sentence; lastStatus = sentence; }
    }
    padForStage();
  }

  /* On narrow screens the stage is sticky, so a focused control could scroll
     underneath it; scroll-padding keeps focus targets below it. */
  var stage = document.querySelector ? document.querySelector('.dsa-stage') : null;
  function padForStage() {
    if (!stage || typeof getComputedStyle !== 'function' || !document.documentElement) return;
    stage.classList.toggle('is-too-tall', stage.offsetHeight > window.innerHeight * 0.65);
    var stuck = getComputedStyle(stage).position === 'sticky';
    document.documentElement.style.scrollPaddingTop = stuck ? (stage.offsetHeight + 8) + 'px' : '';
  }

  /* ---- wiring ------------------------------------------------------------------ */

  /* One render per frame; the announce flag is kept if any call in the frame
     asked for it, since browsers deliver input and change together. */
  var queued = false, pendingAnnounce = false;
  function schedule(announce) {
    pendingAnnounce = pendingAnnounce || !!announce;
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      var a = pendingAnnounce;
      pendingAnnounce = false;
      render(a);
    });
  }

  form.addEventListener('input', function () { schedule(false); });
  form.addEventListener('change', function () { schedule(true); });
  form.addEventListener('submit', function (e) { e.preventDefault(); });

  document.getElementById('dsa-reset').addEventListener('click', function () {
    applyParams(DEFAULTS);
    render(true);
  });

  document.getElementById('dsa-pin').addEventListener('click', function () {
    if (pinned) {
      pinned = null;
    } else {
      var state = formState();
      var params = toParams(state);
      pinned = { state: state, params: params, r: C.solve(data, shocks, params), label: describe(state) };
    }
    render(true);
  });

  var presetsClear = document.getElementById('dsa-presets-clear');
  if (presetsClear) {
    presetsClear.addEventListener('click', function () {
      applyModel(DEFAULTS);
      render(true);
    });
  }

  var presets = document.getElementById('dsa-presets');
  if (presets) {
    presets.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-set]');
      if (!btn) return;
      var set = JSON.parse(btn.getAttribute('data-set'));
      var state = formState();
      var target = Object.assign({}, state);
      if (chipOn(set, state)) {
        /* A second tap drops this preset's settings and leaves the rest alone. */
        Object.keys(set).forEach(function (k) { target[k] = DEFAULTS[k]; });
      } else {
        /* Otherwise layer it on top of whatever is already set. */
        Object.assign(target, set);
      }
      applyModel(target);
      render(true);
    });
  }

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('resize', padForStage);
    if (stage) stage.addEventListener('toggle', padForStage, true);
    if (stage && typeof ResizeObserver !== 'undefined') new ResizeObserver(padForStage).observe(stage);
  }

  /* Baseline tick under each slider, at the default's position on the track. */
  Object.keys(SLIDERS).forEach(function (name) {
    var input = control(name);
    var wrap = input.closest('.dsa-control');
    var min = parseFloat(input.min), max = parseFloat(input.max);
    var pct = (parseFloat(DEFAULTS[name]) - min) / (max - min);
    if (wrap) wrap.style.setProperty('--base-pct', pct.toFixed(4));
  });

  /* Defaults that come from the data file rather than the markup. */
  applyParams(DEFAULTS);
  setText('dsa-vintage', data.meta.vintage);
  setText('dsa-country', data.meta.country);

  render(false);

  /* A small handle for tests and for driving the page from elsewhere. */
  window.DSACalculator = {
    apply: function (obj) { applyParams(Object.assign({}, DEFAULTS, obj)); render(true); },
    pin: function () { document.getElementById('dsa-pin').click(); },
    reset: function () { applyParams(DEFAULTS); render(true); },
    render: function () { render(true); }
  };
}());
