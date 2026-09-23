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
    outputGap: '0',
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
  var MODEL_KEYS = ['plan', 'debtInitial', 'rateShift', 'growthShift', 'outputGap', 'phi', 'plausibility',
                    'method', 'sfaMethod', 'useStochastic', 'useDebtSafeguard',
                    'useDeficitBenchmark', 'useDeficitSafeguard'];
  var SELECTS = ['plausibility', 'method', 'sfaMethod'];

  var SLIDERS = {
    debtInitial: { unit: '% of GDP', decimals: 1, signed: false },
    rateShift: { unit: ' points', decimals: 1, signed: true },
    growthShift: { unit: ' points', decimals: 2, signed: true },
    outputGap: { unit: ' points', decimals: 1, signed: true },
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

  /* The Commission's names for these are baseline, lower-SPB, adverse r-g and
     financial stress. Said plainly here; the glossary in Info gives the
     official ones. */
  var SCENARIO_NAMES = {
    1: 'the plan as written', 2: 'weaker discipline later',
    3: 'higher rates and lower growth', 4: 'market stress'
  };

  /* criteria.js keeps the Commission's labels; the page says them plainly. */
  var BINDING_PLAIN = {};
  BINDING_PLAIN[C.BINDING[0]] = 'a scenario';
  BINDING_PLAIN[C.BINDING[0.5]] = 'the simulations';
  BINDING_PLAIN[C.BINDING[1]] = 'debt safeguard';
  BINDING_PLAIN[C.BINDING[2]] = 'the 3% deficit rule';
  BINDING_PLAIN[C.BINDING[3]] = 'deficit resilience';

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
      outputGap: parseFloat(state.outputGap),
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
    if (parseFloat(state.outputGap) !== 0) parts.push('cycle ' + sliderText('outputGap', state.outputGap));
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
    return parts.length ? parts.join(', ') : "the Commission's settings";
  }

  /* ---- reading a result ---------------------------------------------------- */

  /* Rules that are switched on but that no adjustment in the search range
     satisfies. criteria.js drops these from its maximum, so the page has to
     say so instead of reporting the remaining rules' number as required. */
  function unmetRules(r, params) {
    if (!r || r.failed) return [];
    var u = [];
    [4, 3, 2, 1].forEach(function (s) { if (r.deterministic[s].a === null) u.push(SCENARIO_NAMES[s]); });
    if (params.useStochastic && r.stochastic.a === null) u.push('the simulations');
    if (params.useDebtSafeguard && r.debtSafeguard.applies && r.debtSafeguard.a === null) u.push('the debt safeguard');
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
    if (r.bindingLabel === C.BINDING[0.5]) return { key: 'stoch', keys: ['stoch'], text: 'the simulations (' + params.plausibility * 10 + '% of them)' };
    if (r.bindingLabel === C.BINDING[1]) return { key: 'safeguard', keys: ['safeguard'], text: 'the debt safeguard' };
    return { key: 'other', keys: [], text: r.bindingLabel };
  }

  /* One line under the chart saying what the binding rule is doing to the
     picture. The safeguard case is the one that matters: it fixes where debt
     has to end, so an assumption changes the effort needed to get there rather
     than where the line lands, which otherwise reads as a broken slider. */
  function whyText(r, params, b) {
    var planLast = r.planYears[r.planYears.length - 1];
    if (b.key === 'safeguard') {
      var sg = r.debtSafeguard;
      var start = r.paths[1].debt[r.inputs.adjustmentStart - 1];
      var target = start + sg.required * params.plan;
      return 'The debt safeguard asks for an average fall of ' + Math.abs(sg.required).toFixed(1) +
        ' points a year across the plan, from ' + start.toFixed(1) + '% in ' + (r.planYears[0] - 1) +
        ' to ' + target.toFixed(1) + '% in ' + planLast +
        '. That end point is fixed, so a change moves the effort needed, not where the line lands.';
    }
    if (b.key === 'stoch') {
      return 'The simulations decide it: by ' + (planLast + 5) + ' debt has to be below its ' +
        planLast + ' level in ' + params.plausibility * 10 + '% of the 1,000 simulations in the fan.';
    }
    if (b.key.indexOf('det') === 0) {
      return 'One scenario decides it: debt has to keep falling for ten years after the plan ' +
        'under ' + b.text + '.';
    }
    return '';
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
    var det = { 4: 'Market stress', 3: 'Higher rates, lower growth',
                2: 'Weaker discipline later', 1: 'The plan as written' };
    var short = { 4: 'Market stress', 3: 'Rates up, growth down',
                  2: 'Discipline slips', 1: 'Plan as written' };
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
      label: 'Simulations (' + params.plausibility * 10 + '%)', short: 'Simulations',
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
      label: 'The 3% deficit rule (floor)', short: '3% deficit rule', value: 0.5,
      state: !params.useDeficitBenchmark ? 'off' : (benchYears ? 'floor-binding' : 'floor'),
      note: benchYears
    });
    var resil = params.plan === 7 ? 0.25 : 0.4;
    var resilYears = yearsWith(r, C.BINDING[3]);
    rows.push({
      label: 'Deficit resilience (floor)', short: 'Deficit resilience', value: resil,
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
      else if (row.state === 'unmet') s += 'more than 2.00 points a year';
      else {
        s += row.value.toFixed(2) + ' points a year';
        if (row.state === 'binding' || row.state === 'floor-binding') s += ', binding' + (row.note ? ' ' + row.note : '');
        if (row.state === 'floor' && !row.note) s += ' (floor, not reached)';
      }
      return '<li>' + s + '</li>';
    }).join('');
  }

  /* ---- the settings as a link ------------------------------------------------
     Only what differs from the baseline goes in the hash, so a shared link is
     short and readable and the page keeps working with no hash at all. Values
     are validated on the way in: a hand-edited link can only produce a state
     the controls themselves could produce. */

  var HASH_BOOLS = ['useStochastic', 'useDebtSafeguard', 'useDeficitBenchmark',
                    'useDeficitSafeguard', 'showNoAdjustment', 'showScenarios'];
  var HASH_CHOICES = {
    plan: ['4', '7'],
    plausibility: ['7', '8', '9'],
    method: ['normal', 'bootstrap'],
    sfaMethod: ['0', '-1']
  };
  var ownsHash = false;

  function hasLocation() {
    return typeof window !== 'undefined' && window.location && window.history &&
           typeof window.history.replaceState === 'function';
  }

  /* A slider value is kept only if it is a number the track can actually reach. */
  function sanitiseSlider(name, raw) {
    var v = parseFloat(raw);
    if (!isFinite(v)) return null;
    var input = control(name);
    var min = parseFloat(input.min), max = parseFloat(input.max);
    if (v < min || v > max) return null;
    return v.toFixed(SLIDERS[name].decimals);
  }

  function stateToHash(state) {
    var parts = [];
    Object.keys(DEFAULTS).forEach(function (k) {
      /* Sliders compare as numbers, so a track that reports 0.0 where the
         default is 0 does not put a setting in the link that nothing changed. */
      var same = SLIDERS[k] ? parseFloat(state[k]) === parseFloat(DEFAULTS[k])
                            : String(state[k]) === String(DEFAULTS[k]);
      if (same) return;
      if (HASH_BOOLS.indexOf(k) >= 0) parts.push(k + '=' + (state[k] ? '1' : '0'));
      else parts.push(k + '=' + encodeURIComponent(state[k]));
    });
    return parts.join('&');
  }

  function hashToState(hash) {
    var out = {};
    (hash || '').replace(/^#/, '').split('&').forEach(function (pair) {
      if (!pair) return;
      var eq = pair.indexOf('=');
      if (eq < 0) return;
      var k = decodeURIComponent(pair.slice(0, eq));
      var raw = decodeURIComponent(pair.slice(eq + 1));
      if (!DEFAULTS.hasOwnProperty(k)) return;
      if (HASH_BOOLS.indexOf(k) >= 0) { out[k] = raw === '1' || raw === 'true'; return; }
      if (HASH_CHOICES[k]) { if (HASH_CHOICES[k].indexOf(raw) >= 0) out[k] = raw; return; }
      if (SLIDERS[k]) { var v = sanitiseSlider(k, raw); if (v !== null) out[k] = v; }
    });
    return out;
  }

  function linkFor(state) {
    var hash = stateToHash(state);
    var base = window.location.origin + window.location.pathname + window.location.search;
    return hash ? base + '#' + hash : base;
  }

  function writeHash(state) {
    if (!hasLocation()) return;
    var hash = stateToHash(state);
    /* Leave an unrelated anchor such as #main alone until we have put
       something of our own in the address bar. */
    if (!hash && !ownsHash) return;
    ownsHash = ownsHash || !!hash;
    try {
      window.history.replaceState(null, '',
        window.location.pathname + window.location.search + (hash ? '#' + hash : ''));
    } catch (e) { /* file:// and some embedded views refuse replaceState */ }
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
      (reference ? ' The dashed grey line is the ' + refName + ' path, over the plan years the two share.' : ''));
  }

  function render(announce) {
    var state = formState();
    var params = toParams(state);
    /* Only on a committed change: Safari caps replaceState calls, and a slider
       drag would otherwise spend that budget on frames nobody links to. */
    if (announce) writeHash(state);
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
      ['result-delta', 'result-was', 'result-floors', 'dsa-refline', 'dsa-rules-panel', 'dsa-unmet', 'dsa-why'].forEach(function (id) { setHidden(id, true); });
      ['stat-spb', 'stat-debt-end', 'stat-debt-final'].forEach(function (id) { setText(id, '—'); });
      chartHost.__dsaSpec = null;
      chartHost.innerHTML = '';
      rulesHost.__dsaSpec = null;
      rulesHost.innerHTML = '';
      writeLegend([], []);
      writeRulesText([]);
      document.getElementById('dsa-table-body').innerHTML = '';
      setText('out-rg', '');
      setText('out-og', '');
      padForStage();
      return;
    }

    /* The reference: a pinned scenario, or the baseline once anything moved. */
    var ref = pinned || BASE;
    /* The grey line is the Commission's own settings until something is
       pinned, and it is named that way everywhere it is referred to. */
    var refName = pinned ? 'pinned' : 'Commission';
    var refShort = narrow && !pinned ? 'EC' : refName;
    var showGhost = !!pinned || !sameModel(state, BASE.state);
    var refR = ref.r;
    var refOk = showGhost && !refR.failed;

    var pinBtn = document.getElementById('dsa-pin');
    if (pinBtn) {
      pinBtn.textContent = pinned ? 'Unpin reference' : 'Pin as reference';
      pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    }
    /* The reference line names the grey line, so it says nothing when there is
       no grey line: at the baseline the controls already say the settings are
       the Commission's. The empty row keeps its height so the buttons beside
       it do not move. */
    setHidden('dsa-refline', false);
    var refline = document.getElementById('dsa-refline');
    if (refline) refline.classList.toggle('is-off', !refOk);
    setText('dsa-ref-name', refOk
      ? (pinned ? 'Grey line: your pinned scenario (' + pinned.label + ')'
                : "Grey line: the Commission's own settings")
      : '');

    /* ---- failed state: keep drawing ------------------------------------ */
    if (r.failed) {
      renderExpenditure(null, null, null, 'No expenditure ceilings: no adjustment up to 2.00 points a year satisfies the rules.');
      var inputs = r.inputs;
      /* Same drawn window as the normal path: five years past the plan. */
      var fYears = [];
      for (var t = 1; t <= inputs.adjustmentEnd + 5; t++) fYears.push(inputs.baseYear + t - 1);
      var nf = fYears.length;
      var pf = fYears.slice(inputs.adjustmentStart - 1, inputs.adjustmentEnd);
      setText('result-figure', '> 2.00');
      setText('result-unit', 'points of GDP a year · ' + params.plan + '-year plan ' + pf[0] + '–' + pf[pf.length - 1]);
      setHidden('result-delta', true);
      setText('result-binding', 'no adjustment up to 2.00 a year meets the rules');
      setHidden('result-was', true);
      setHidden('result-floors', true);
      setHidden('result-euro', true);
      setHidden('dsa-why', true);
      ['stat-spb', 'stat-debt-end', 'stat-debt-final'].forEach(function (id) { setText(id, '—'); });
      var two = C.project(inputs, 1, 2, null).debt.slice(1, nf + 1);
      var none = C.project(inputs, 1, 0, null).debt.slice(1, nf + 1);
      var fSeries = [];
      if (refOk) fSeries.push({ name: refShort, values: refR.paths[1].debt.slice(1, nf + 1), color: COLORS.ref, labelColor: COLORS.text, width: 1.5, label: true });
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
      setText('out-og', '');
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
      ? 'No expenditure ceilings: ' + joinNames(unmet) + ' cannot be met with up to 2.00 points a year.' : null);
    var years = r.years;
    /* The chart stops five years after the plan. That is the last year able to
       decide any criterion -- the safeguard is settled inside the plan, the
       stochastic test compares the plan's end with this year, and across the
       whole slider space no deterministic scenario was ever the binding one on
       a later year -- and it is where the fan ends, so the chart no longer
       continues with deterministic lines that look firmer than they are. The
       model still runs to its full horizon and that year stays in the stats. */
    var chartYears = years.slice(0, r.inputs.adjustmentEnd + 5);
    var nChart = chartYears.length;
    var lastYear = years[years.length - 1];
    var planFirst = r.planYears[0], planLast = r.planYears[r.planYears.length - 1];
    var lifted = isLifted(r);
    var total = sum(r.finalPath);   // only the structural balance below uses this
    var p1 = r.paths[1];
    var adjEnd = r.inputs.adjustmentEnd;

    setText('result-unit', 'points of GDP a year · ' + params.plan + '-year plan ' + planFirst + '–' + planLast);
    if (unmet.length) {
      setText('result-figure', '> 2.00');
      setText('result-binding', 'even 2.00 a year does not meet ' + joinNames(unmet) +
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
      /* Nothing has changed yet, which the untouched controls already show. */
      setHidden('result-delta', true);
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
          lifts.push(ys.replace(/^in /, '') + ' rises to ' + v.toFixed(2) +
            ' (' + (BINDING_PLAIN[label] || label.toLowerCase()) + ')');
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
      setText('stat-spb', '—');
      if (euroNode) euroNode.hidden = true;
    } else {
      /* The SPB path is linear in the adjustment, so the floored total adds exactly. */
      setText('stat-spb', (r.inputs.spb[r.inputs.adjustmentStart - 1] + total).toFixed(1) + '%');
      if (euroNode) {
        /* The figure Finnish debate quotes for a four-year term: the
           cumulative adjustment reached by its end, which is where the
           8-12 billion in circulation comes from. Not the sum of the four
           years' flows, which is larger. */
        var eur = euroPath(r);
        var i4 = Math.min(3, eur.cumulative.length - 1);
        euroNode.textContent = 'In euros: about ' + bn(eur.cumulative[i4]) +
          ' of consolidation in total over ' +
          (params.plan > 4 ? 'the four years to ' : 'the plan, to ') + r.planYears[i4] + '.';
        euroNode.hidden = false;
      }
    }
    setText('stat-debt-end', r.debtEnd.toFixed(1) + '%');
    setText('stat-debt-final', r.debtFinal.toFixed(1) + '%');
    setText('stat-debt-end-year', String(planLast));
    setText('stat-debt-final-year', String(lastYear));

    var whyNode = document.getElementById('dsa-why');
    if (whyNode) {
      var why = unmet.length ? '' : whyText(r, params, b);
      whyNode.textContent = why;
      whyNode.hidden = !why;
    }

    /* r - g at the end of the plan: the snowball in one number. */
    var rg = p1.iir[adjEnd] - 100 * p1.g[adjEnd];
    setText('out-rg', 'Interest rate minus growth at the end of the plan: ' + signed(rg, 1) + ' points');

    /* The gap the starting-position slider produces, as a level. */
    setText('out-og', 'Output gap in ' + planFirst + ': ' +
      signed(p1.og[r.inputs.adjustmentStart], 1) + '% of potential, closed by ' +
      (planLast + 3) + '.');

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
             '<td>' + (BINDING_PLAIN[r.bindingLabels[i]] || r.bindingLabels[i]) + '</td></tr>';
    }).join('');

    /* ---- debt chart --------------------------------------------------------- */
    var series = [];
    if (refOk) {
      series.push({ name: refShort, values: refR.paths[1].debt.slice(1, nChart + 1), color: COLORS.ref, labelColor: COLORS.text, width: 1.6, label: true });
    }
    if (state.showNoAdjustment) {
      series.push({ name: narrow ? 'no plan' : 'no consolidation', values: r.noAdjustment.debt.slice(1, nChart + 1), color: COLORS.noPlan, labelColor: COLORS.text, dash: '5 4', width: 1.6, label: true });
    }
    if (state.showScenarios) {
      series.push({ name: narrow ? 'discipline' : 'discipline slips', values: r.paths[2].debt.slice(1, nChart + 1), color: COLORS.alt1, width: 1.3, label: true });
      series.push({ name: narrow ? 'rates up' : 'rates up, growth down', values: r.paths[3].debt.slice(1, nChart + 1), color: COLORS.alt2, width: 1.3, label: true });
      series.push({ name: narrow ? 'stress' : 'market stress', values: r.paths[4].debt.slice(1, nChart + 1), color: COLORS.alt3, width: 1.3, label: true });
    }
    series.push({ name: narrow ? 'with plan' : 'with the plan', values: p1.debt.slice(1, nChart + 1), color: COLORS.line, width: 2.4, label: true });

    var bands = [];
    var fanLastIdx = -1;
    if (r.fan) {
      var padTo = function (arr) {
        var out = new Array(nChart).fill(null);
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
      { value: 60, label: params.useDebtSafeguard && !narrow ? '60% · safeguard 0.5 points a year' : '60%' },
      { value: 90, label: params.useDebtSafeguard && !narrow ? '90% · safeguard 1 points a year' : '90%' }
    ];

    /* The safeguard used to be drawn as a sloped dashed line across the plan
       window with its own label. It crowded the years it ran through, and what
       it said is said better in words under the chart. */

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
          text: narrow ? signed(r.debtEnd - refAtPlanLast, 1) + ' points'
                       : r.debtEnd.toFixed(1) + '%, ' + signed(r.debtEnd - refAtPlanLast, 1) + ' points vs ' + refName
        });
      }
    }

    var points = [{ year: planLast, value: r.debtEnd, text: narrow ? null : r.debtEnd.toFixed(1) + '% at end of plan' }];

    /* The fan's last year is now the axis's last year, so a note saying so
       would only repeat the axis. */
    var notes = [];

    Chart.draw(chartHost, {
      years: chartYears, series: series, bands: bands,
      shade: { from: planFirst, to: planLast, label: params.plan + '-YEAR PLAN ' + planFirst + '–' + String(planLast).slice(2) },
      thresholds: thresholds, links: links, points: points, brackets: brackets, notes: notes,
      include: BASE.r.paths[1].debt.slice(1, nChart + 1),
      yLabel: 'debt, % of GDP',
      ariaLabel: 'Projected government debt as a percentage of GDP, ' + chartYears[0] + ' to ' +
                 chartYears[nChart - 1] + ', with an adjustment of ' + r.adjustment.toFixed(2) +
                 ' percentage points of GDP a year. Debt is ' + r.debtEnd.toFixed(1) +
                 ' percent at the end of the plan and ' + r.debtFinal.toFixed(1) + ' percent in ' +
                 lastYear + ', beyond the chart.'
    });
    writeLegend(series, chartYears);

    /* ---- rule bars ---------------------------------------------------------- */
    var rows = ruleRows(r, params, refOk ? ref : null, unmet);
    setHidden('dsa-rules-panel', false);
    Chart.drawBars(rulesHost, {
      rows: rows, max: 2,
      marker: unmet.length ? null : r.adjustment,
      markerLabel: lifted ? r.adjustment.toFixed(2) + ' before floors' : 'required ' + r.adjustment.toFixed(2),
      unit: 'points of GDP a year',
      ariaLabel: 'What each scenario would require on its own. ' + (unmet.length
        ? joinNames(unmet) + ' cannot be met with up to 2 points a year.'
        : 'The binding rule is ' + b.text + ' at ' + r.adjustment.toFixed(2) + ' points a year.')
    });
    writeRulesText(rows);
    var unmetNode = document.getElementById('dsa-unmet');
    if (unmetNode) {
      unmetNode.hidden = !unmet.length;
      unmetNode.textContent = unmet.length
        ? 'Even 2.00 a year does not meet ' + joinNames(unmet) + '. As in the original tool that one drops out, and the chart shows what the rest need.'
        : '';
    }

    /* ---- one sentence for assistive tech, only on committed changes ------ */
    if (announce) {
      var sentence = (unmet.length
        ? 'Required adjustment above 2 points a year: ' + joinNames(unmet) + ' cannot be met. '
        : 'Required adjustment ' + r.adjustment.toFixed(2) + ' points a year' +
          (comparable ? ', ' + signed(r.adjustment - refR.adjustment) + ' versus ' + refName : '') +
          '. Binding rule: ' + b.text + '. ') +
        'Debt ' + r.debtFinal.toFixed(1) + ' percent in ' + lastYear + '.';
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
      /* Only the settings the lit chips own: a slider moved by hand stays put.
         Reset, in the controls, is the one that returns everything. */
      var state = formState();
      var target = Object.assign({}, state);
      Array.prototype.forEach.call(
        document.querySelectorAll('#dsa-presets button[data-set]'), function (chip) {
          var set = JSON.parse(chip.getAttribute('data-set'));
          if (!chipOn(set, state)) return;
          Object.keys(set).forEach(function (k) { target[k] = DEFAULTS[k]; });
        });
      applyModel(target);
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

  var copyBtn = document.getElementById('dsa-copy');
  if (copyBtn) {
    var copyTimer = null;
    copyBtn.addEventListener('click', function () {
      if (!hasLocation()) return;
      var link = linkFor(formState());
      var done = function (text) {
        copyBtn.textContent = text;
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(function () { done('Copied'); },
                                                 function () { done('In address bar'); });
      } else {
        /* No clipboard permission: the address bar already holds the link. */
        done('In address bar');
      }
    });
  }

  /* Defaults that come from the data file rather than the markup. */
  applyParams(DEFAULTS);
  setText('dsa-vintage', data.meta.vintage);
  setText('dsa-country', data.meta.country);

  /* A link's settings, if there are any, on top of the defaults. */
  if (hasLocation() && window.location.hash) {
    var fromLink = hashToState(window.location.hash);
    if (Object.keys(fromLink).length) {
      ownsHash = true;
      applyParams(fromLink);
    }
  }

  render(false);

  /* A small handle for tests and for driving the page from elsewhere. */
  window.DSACalculator = {
    apply: function (obj) { applyParams(Object.assign({}, DEFAULTS, obj)); render(true); },
    pin: function () { document.getElementById('dsa-pin').click(); },
    reset: function () { applyParams(DEFAULTS); render(true); },
    render: function () { render(true); },
    link: function () { return hasLocation() ? linkFor(formState()) : null; },
    fromLink: function (hash) { applyParams(hashToState(hash)); render(true); }
  };
}());
