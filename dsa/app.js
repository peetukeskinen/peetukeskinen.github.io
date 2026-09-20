/* ==========================================================================
   app.js — controls, results and charts for the DSA calculator

   Reads the form, runs the model (dsa/model.js and dsa/criteria.js) and
   redraws. A full run, including 1,000 simulated paths, takes a few tens of
   milliseconds, so everything is recomputed on every change.
   ========================================================================== */

(function () {
  'use strict';

  var data = window.DSA_DATA;
  var shocks = window.DSA_SHOCKS;
  var C = window.DSACriteria;

  var form = document.getElementById('dsa-form');
  var chartHost = document.getElementById('dsa-chart');
  var status = document.getElementById('dsa-status');
  if (!form || !data || !shocks) return;

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
    showScenarios: false,
    showNoAdjustment: true
  };

  function val(name) {
    var node = form.elements[name];
    if (!node) return null;
    if (node.type === 'checkbox') return node.checked;
    if (node.length && !node.value && node[0] && node[0].type === 'radio') {
      for (var i = 0; i < node.length; i++) if (node[i].checked) return node[i].value;
      return null;
    }
    return node.value;
  }

  function readParams() {
    return {
      plan: parseInt(val('plan'), 10),
      debtInitial: parseFloat(val('debtInitial')),
      rateShift: parseFloat(val('rateShift')),
      growthShift: parseFloat(val('growthShift')),
      phi: parseFloat(val('phi')),
      plausibility: parseInt(val('plausibility'), 10),
      method: val('method'),
      sfaMethod: parseInt(val('sfaMethod'), 10),
      useStochastic: val('useStochastic'),
      useDebtSafeguard: val('useDebtSafeguard'),
      useDeficitBenchmark: val('useDeficitBenchmark'),
      useDeficitSafeguard: val('useDeficitSafeguard')
    };
  }

  /* Live value labels next to each slider. */
  function syncOutputs(params) {
    setText('out-debtInitial', params.debtInitial.toFixed(1) + '% of GDP');
    setText('out-rateShift', signed(params.rateShift) + ' pp');
    setText('out-growthShift', signed(params.growthShift) + ' pp');
    setText('out-phi', params.phi.toFixed(2));
  }

  function signed(v) { return (v > 0 ? '+' : '') + v.toFixed(2).replace(/\.00$/, '.0'); }

  function setText(id, text) {
    var node = document.getElementById(id);
    if (node) node.textContent = text;
  }

  /* ---- rendering ------------------------------------------------------- */

  function render() {
    var params = readParams();
    syncOutputs(params);

    var t0 = performance.now();
    var r;
    try {
      r = C.solve(data, shocks, params);
    } catch (err) {
      status.textContent = 'The projection failed: ' + err.message;
      return;
    }

    if (r.failed) {
      setText('result-adjustment', '—');
      setText('result-binding', r.message);
      status.textContent = r.message;
      chartHost.innerHTML = '';
      document.getElementById('dsa-table-body').innerHTML = '';
      return;
    }

    var planFirst = r.planYears[0], planLast = r.planYears[r.planYears.length - 1];

    /* Headline numbers. */
    setText('result-adjustment', r.adjustment.toFixed(2));
    setText('result-adjustment-unit',
      'pp of GDP per year, ' + params.plan + ' years (' + planFirst + '–' + planLast + ')');
    setText('result-binding', r.bindingLabel);
    setText('result-spb', r.spbStar.toFixed(2) + '% of GDP');
    setText('result-debt-end', r.debtEnd.toFixed(1) + '% of GDP in ' + planLast);
    setText('result-debt-final', r.debtFinal.toFixed(1) + '% of GDP in ' + r.years[r.years.length - 1]);
    setText('result-total', (r.adjustment * params.plan).toFixed(2) + ' pp in total');

    /* Which criteria were switched on, and what each one asked for. */
    var reqBody = document.getElementById('dsa-requirements');
    if (reqBody) {
      var rows = [];
      [4, 3, 2, 1].forEach(function (s) {
        var names = { 1: 'DSA baseline (with the 3% deficit rule)', 2: 'DSA lower SPB',
                      3: 'DSA adverse r–g', 4: 'DSA financial stress' };
        var d = r.deterministic[s];
        rows.push([names[s], d.a === null ? 'not met below 2.00' : d.a.toFixed(2)]);
      });
      rows.push(['DSA stochastic (' + params.plausibility * 10 + '% of paths, ' +
                 (params.method === 'normal' ? 'normal' : 'bootstrap') + ')',
                 params.useStochastic ? (r.stochastic.a === null ? 'not met below 2.00' : r.stochastic.a.toFixed(2)) : 'off']);
      rows.push(['Debt sustainability safeguard' +
                 (r.debtSafeguard.applies ? ' (' + Math.abs(r.debtSafeguard.required).toFixed(1) + ' pp a year)' : ''),
                 !params.useDebtSafeguard ? 'off'
                   : !r.debtSafeguard.applies ? 'does not apply below 60%'
                   : r.debtSafeguard.a === null ? 'not met below 2.00' : r.debtSafeguard.a.toFixed(2)]);
      reqBody.innerHTML = rows.map(function (row) {
        return '<tr><th scope="row">' + row[0] + '</th><td>' + row[1] + '</td></tr>';
      }).join('');
    }

    /* Year-by-year table. */
    var body = document.getElementById('dsa-table-body');
    body.innerHTML = r.planYears.map(function (year, i) {
      return '<tr><th scope="row">' + year + '</th>' +
             '<td>' + r.finalPath[i].toFixed(2) + '</td>' +
             '<td>' + r.netExpenditure[i].toFixed(2) + '</td>' +
             '<td>' + r.bindingLabels[i] + '</td></tr>';
    }).join('');

    /* Chart. */
    var years = r.years;
    var series = [{
      name: 'With the plan',
      values: r.paths[1].debt.slice(1),
      color: 'var(--dsa-line, #7b2d2d)',
      width: 2.4
    }];

    if (val('showNoAdjustment')) {
      series.push({
        name: 'No consolidation',
        values: r.noAdjustment.debt.slice(1),
        color: 'var(--dsa-muted-line, #8c8474)',
        dash: '5 4'
      });
    }

    if (val('showScenarios')) {
      series.push({ name: 'Lower SPB', values: r.paths[2].debt.slice(1), color: 'var(--dsa-alt1, #3f6b7d)', width: 1.4 });
      series.push({ name: 'Adverse r–g', values: r.paths[3].debt.slice(1), color: 'var(--dsa-alt2, #8a6d1f)', width: 1.4 });
      series.push({ name: 'Financial stress', values: r.paths[4].debt.slice(1), color: 'var(--dsa-alt3, #5a5a8a)', width: 1.4 });
    }

    var bands = [];
    if (r.fan) {
      /* Pad the simulated years out to the full time axis. */
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
    }

    window.DSAChart.draw(chartHost, {
      years: years,
      series: series,
      bands: bands,
      shade: { from: planFirst, to: planLast, label: 'adjustment plan' },
      yLabel: 'debt, % of GDP',
      ariaLabel: 'Projected general government debt as a percentage of GDP, ' +
                 years[0] + ' to ' + years[years.length - 1] +
                 ', under an adjustment of ' + r.adjustment.toFixed(2) +
                 ' percentage points of GDP a year.',
      valueFormat: function (v) { return v.toFixed(1); }
    });

    /* Legend, built from the same series list. */
    var legend = document.getElementById('dsa-legend');
    legend.innerHTML = series.map(function (s) {
      return '<li><span class="dsa-key" style="background:' + s.color + '"></span>' + s.name + '</li>';
    }).join('') + (r.fan
      ? '<li><span class="dsa-key dsa-key-band"></span>simulated range (10th–90th percentile)</li>'
      : '');

    status.textContent = 'Recomputed in ' + Math.round(performance.now() - t0) + ' ms' +
      (r.fan ? ' using ' + shocks.meta.n_paths + ' simulated paths.' : '.');
  }

  /* ---- wiring ---------------------------------------------------------- */

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; render(); });
  }

  form.addEventListener('input', schedule);
  form.addEventListener('change', schedule);
  form.addEventListener('submit', function (e) { e.preventDefault(); });

  document.getElementById('dsa-reset').addEventListener('click', function () {
    Object.keys(DEFAULTS).forEach(function (name) {
      var node = form.elements[name];
      if (!node) return;
      if (node.type === 'checkbox') { node.checked = DEFAULTS[name]; return; }
      if (node.length && node[0] && node[0].type === 'radio') {
        for (var i = 0; i < node.length; i++) node[i].checked = (node[i].value === DEFAULTS[name]);
        return;
      }
      node.value = DEFAULTS[name];
    });
    render();
  });

  /* Defaults that depend on the data file rather than the markup. */
  form.elements.debtInitial.value = DEFAULTS.debtInitial;
  form.elements.phi.value = DEFAULTS.phi;
  setText('dsa-vintage', data.meta.vintage);
  setText('dsa-country', data.meta.country);

  render();
}());
