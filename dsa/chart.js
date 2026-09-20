/* ==========================================================================
   chart.js — SVG charts for the DSA calculator

   Two renderers, written for this page rather than pulled from a library so
   the calculator keeps the site's habit of no build step and no third-party
   code:

     draw(host, spec)      a line chart with percentile bands, thresholds,
                           guides, direct end labels and annotations
     drawBars(host, spec)  a horizontal bar chart of what each rule requires

   Both size themselves to the host element, so type stays 11px at every
   width, and redraw when the host's width changes.

   Paint is set as presentation attributes with literal fallbacks, not left
   to the stylesheet alone: a custom property that fails to resolve makes
   fill invalid, and an invalid fill paints black. The stylesheet still wins
   where it applies, because CSS rules override presentation attributes.
   ========================================================================== */

(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  var INK = 'var(--ink, #23201b)';
  var INK_MUTED = 'var(--ink-muted, #5b5449)';
  var GRID = 'var(--dsa-grid, #e3ddd0)';
  var AXIS = 'var(--dsa-axis, #978d79)';
  var BAND = 'var(--dsa-band, #7b2d2d)';
  var SHADE = 'var(--dsa-shade, #ece7da)';
  var BG = 'var(--bg, #fbf9f5)';
  var LINE = 'var(--dsa-line, #7b2d2d)';
  var SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    for (var k in attrs) {
      if (attrs.hasOwnProperty(k) && attrs[k] !== undefined && attrs[k] !== null) {
        node.setAttribute(k, attrs[k]);
      }
    }
    return node;
  }

  function text(attrs, content, size, weight, halo) {
    var node = el('text', attrs);
    node.setAttribute('font-family', SANS);
    node.setAttribute('font-size', size || 11);
    if (weight) node.setAttribute('font-weight', weight);
    if (!attrs.fill) node.setAttribute('fill', INK_MUTED);
    if (halo) {
      /* A page-coloured outline under the glyphs, so a line crossing the
         text is masked around the letters. */
      node.setAttribute('paint-order', 'stroke');
      node.setAttribute('stroke', BG);
      node.setAttribute('stroke-width', 3);
      node.setAttribute('stroke-linejoin', 'round');
    }
    node.textContent = content;
    return node;
  }

  function isNum(v) { return v !== null && v !== undefined && isFinite(v); }

  function hostWidth(host, fallback) {
    var w = host.clientWidth || (host.getBoundingClientRect && host.getBoundingClientRect().width);
    return Math.max(300, Math.round(w || fallback));
  }

  /* Redraw when the host changes width by more than a few pixels. One
     observer per host; the latest spec is kept on the element. */
  function watch(host, renderer) {
    if (host.__dsaWatched) return;
    host.__dsaWatched = true;
    var last = host.clientWidth;
    var lastH = typeof window !== 'undefined' ? window.innerHeight : 0;
    var redraw = function () {
      var now = host.clientWidth;
      var nowH = typeof window !== 'undefined' ? window.innerHeight : 0;
      if (!host.__dsaSpec) return;
      if (Math.abs(now - last) < 8 && Math.abs(nowH - lastH) < 60) return;
      last = now;
      lastH = nowH;
      renderer(host, host.__dsaSpec);
    };
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(redraw).observe(host);
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', redraw);
    }
  }

  /* Push labels apart vertically so none overlap, keeping them in range. */
  function spread(items, minGap, lo, hi) {
    items.sort(function (a, b) { return a.y - b.y; });
    var i;
    for (i = 1; i < items.length; i++) {
      if (items[i].y - items[i - 1].y < minGap) items[i].y = items[i - 1].y + minGap;
    }
    if (items.length && items[items.length - 1].y > hi) {
      items[items.length - 1].y = hi;
      for (i = items.length - 2; i >= 0; i--) {
        if (items[i + 1].y - items[i].y < minGap) items[i].y = items[i + 1].y - minGap;
      }
    }
    if (items.length && items[0].y < lo) {
      items[0].y = lo;
      for (i = 1; i < items.length; i++) {
        if (items[i].y - items[i - 1].y < minGap) items[i].y = items[i - 1].y + minGap;
      }
    }
    return items;
  }

  /* ------------------------------------------------------------------------
     Line chart
     ------------------------------------------------------------------------ */

  /**
   * @param {HTMLElement} host   element to draw into (emptied first)
   * @param {Object} spec
   *   years       {number[]}   x values
   *   series      {Array}      [{name, values, color, dash, width, label, opacity}]
   *                            label: text at the right end, or true to use
   *                            the name plus the last value
   *   bands       {Array}      [{lo, hi, opacity}] percentile ribbons
   *   shade       {Object}     {from, to, label} highlighted x range
   *   thresholds  {Array}      [{value, label}] dashed horizontal lines
   *   guides      {Array}      [{fromYear, fromValue, toYear, toValue, label, emphasis}]
   *   links       {Array}      [{fromYear, fromValue, toYear, toValue, text}] dot-to-dot
   *   points      {Array}      [{year, value, text, color}]
   *   brackets    {Array}      [{year, from, to, text}] vertical gap markers
   *   notes       {Array}      [{year, value, text, anchor}]
   *   include     {number[]}   extra values the y domain must cover
   *   message     {string}     centred text, for the failed state
   *   yLabel, ariaLabel, valueFormat
   */
  function draw(host, spec) {
    host.__dsaSpec = spec;
    watch(host, draw);

    var W = hostWidth(host, 760);
    var narrow = W < 480;
    var H = Math.min(360, Math.round(W * (narrow ? 0.62 : 0.56)));
    var vh = (typeof window !== 'undefined' && window.innerHeight) || 0;
    if (vh && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 63.99rem)').matches) {
      H = Math.max(170, Math.min(H, Math.round(vh * 0.4)));
    }
    var PAD = { top: 38, right: narrow ? 86 : 138, bottom: 30, left: 34 };

    var years = spec.years;
    var series = (spec.series || []).filter(function (s) { return s && s.values; });
    var bands = spec.bands || [];
    var fmt = spec.valueFormat || function (v) { return v.toFixed(1); };
    var i, j, s;

    /* ---- domain: snapped to 20-pp steps, always holding 40-80, so the
       frame stays still while a line moves ------------------------------ */
    var lo = Infinity, hi = -Infinity;
    function consider(vals) {
      if (!vals) return;
      for (var k = 0; k < vals.length; k++) {
        var v = vals[k];
        if (!isNum(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    series.forEach(function (sr) { consider(sr.values); });
    bands.forEach(function (b) { consider(b.lo); consider(b.hi); });
    consider(spec.include);
    if (!isFinite(lo)) { lo = 0; hi = 100; }
    lo = Math.min(40, Math.floor(lo / 20) * 20);
    hi = Math.max(80, Math.ceil(hi / 20) * 20);
    if (hi - lo < 40) hi = lo + 40;

    var x0 = PAD.left, x1 = W - PAD.right, y0 = H - PAD.bottom, y1 = PAD.top;
    function sx(idx) { return x0 + (x1 - x0) * (idx / (years.length - 1)); }
    function sy(v) { return y0 + (y1 - y0) * ((v - lo) / (hi - lo)); }
    function xOfYear(year) { return sx(years.indexOf(year)); }

    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H,
      width: W, height: H,
      role: 'img',
      'aria-label': spec.ariaLabel || spec.yLabel || 'chart',
      style: 'touch-action: pan-y; max-width: 100%; height: auto; display: block;'
    });

    /* ---- plan window ---------------------------------------------------- */
    if (spec.shade) {
      var from = years.indexOf(spec.shade.from), to = years.indexOf(spec.shade.to);
      if (from >= 0 && to >= 0) {
        svg.appendChild(el('rect', {
          x: sx(from), y: y1, width: sx(to) - sx(from), height: y0 - y1, fill: SHADE
        }));
        svg.appendChild(text({
          x: (sx(from) + sx(to)) / 2, y: narrow ? y0 - 6 : y1 - 9, 'text-anchor': 'middle',
          'letter-spacing': '0.08em'
        }, spec.shade.label, 10));
      }
    }

    /* ---- gridlines, integer ticks ------------------------------------- */
    var step = 20;
    if (narrow && (hi - lo) / step > 6) step = 40;
    for (var v = lo; v <= hi + 1e-9; v += step) {
      var yy = sy(v);
      svg.appendChild(el('line', { x1: x0, x2: x1, y1: yy, y2: yy, stroke: GRID, 'stroke-width': 1 }));
      svg.appendChild(text({ x: x0 - 7, y: yy + 4, 'text-anchor': 'end' }, String(Math.round(v))));
    }

    /* ---- x ticks: spaced so they never crowd ---------------------------- */
    var every = Math.max(1, Math.ceil(years.length / ((x1 - x0) / 46)));
    for (i = 0; i < years.length; i++) {
      var last = i === years.length - 1;
      if (i % every !== 0 && !last) continue;
      if (!last && x1 - sx(i) < 48) continue;  // room for the right-aligned last label
      svg.appendChild(text({
        x: last ? x1 : sx(i), y: y0 + 18, 'text-anchor': last ? 'end' : 'middle'
      }, years[i]));
    }

    /* ---- thresholds ----------------------------------------------------- */
    (spec.thresholds || []).forEach(function (t) {
      if (t.value < lo || t.value > hi) return;
      var ty = sy(t.value);
      svg.appendChild(el('line', {
        x1: x0, x2: x1, y1: ty, y2: ty, stroke: AXIS, 'stroke-width': 1, 'stroke-dasharray': '2 4'
      }));
      if (t.label) {
        svg.appendChild(text({ x: x0 + 4, y: ty - 4, 'text-anchor': 'start' }, t.label, 10));
      }
    });

    /* ---- percentile ribbons --------------------------------------------- */
    bands.forEach(function (b) {
      var d = '';
      for (j = 0; j < years.length; j++) {
        if (!isNum(b.hi[j])) continue;
        d += (d ? 'L' : 'M') + sx(j).toFixed(1) + ' ' + sy(b.hi[j]).toFixed(1);
      }
      for (j = years.length - 1; j >= 0; j--) {
        if (!isNum(b.lo[j])) continue;
        d += 'L' + sx(j).toFixed(1) + ' ' + sy(b.lo[j]).toFixed(1);
      }
      if (d) svg.appendChild(el('path', { d: d + 'Z', fill: BAND, opacity: b.opacity, stroke: 'none' }));
    });

    /* ---- guides: rules drawn as geometry -------------------------------- */
    (spec.guides || []).forEach(function (g) {
      var gx0 = xOfYear(g.fromYear), gx1 = xOfYear(g.toYear);
      if (!isNum(gx0) || !isNum(gx1)) return;
      svg.appendChild(el('line', {
        x1: gx0, y1: sy(g.fromValue), x2: gx1, y2: sy(g.toValue),
        stroke: g.emphasis ? INK : AXIS, 'stroke-width': 1.2, 'stroke-dasharray': '5 3',
        opacity: g.emphasis ? 0.9 : 0.6
      }));
      if (g.label) {
        /* Below the guide's lower end, so neither the dashes nor the
           end-of-plan dot cross the text; step under a threshold line
           rather than onto its label. */
        var ly = Math.max(sy(g.fromValue), sy(g.toValue)) + 14;
        (spec.thresholds || []).forEach(function (t) {
          if (!t.label || t.value < lo || t.value > hi) return;
          var ty = sy(t.value);
          if (ly > ty - 15 && ly < ty + 7) ly = ty + 12;
        });
        svg.appendChild(text({
          x: (gx0 + gx1) / 2, y: ly, 'text-anchor': 'middle',
          fill: g.emphasis ? INK : INK_MUTED
        }, g.label, 10, null, true));
      }
    });

    /* ---- series --------------------------------------------------------- */
    series.forEach(function (sr) {
      var d = '';
      for (j = 0; j < years.length; j++) {
        var val = sr.values[j];
        if (!isNum(val)) continue;
        d += (d ? 'L' : 'M') + sx(j).toFixed(1) + ' ' + sy(val).toFixed(1);
      }
      if (!d) return;
      svg.appendChild(el('path', {
        d: d, fill: 'none', stroke: sr.color, 'stroke-width': sr.width || 2,
        'stroke-dasharray': sr.dash || null, 'stroke-linejoin': 'round',
        'stroke-linecap': 'round', opacity: sr.opacity || null
      }));
    });

    /* ---- axis ------------------------------------------------------------ */
    svg.appendChild(el('line', { x1: x0, x2: x1, y1: y0, y2: y0, stroke: AXIS, 'stroke-width': 1 }));
    if (spec.yLabel) svg.appendChild(text({ x: 2, y: 11 }, spec.yLabel));

    /* ---- direct labels at the right end, pushed apart ------------------- */
    var labels = [];
    series.forEach(function (sr) {
      if (!sr.label) return;
      var lastIdx = -1;
      for (j = sr.values.length - 1; j >= 0; j--) if (isNum(sr.values[j])) { lastIdx = j; break; }
      if (lastIdx < 0) return;
      var content = sr.label === true ? sr.name + ' ' + fmt(sr.values[lastIdx]) : sr.label;
      labels.push({ y: sy(sr.values[lastIdx]), text: content, color: sr.labelColor || sr.color, x: sx(lastIdx) });
    });
    spread(labels, 13, y1 + 4, y0 - 2);
    labels.forEach(function (lb) {
      svg.appendChild(text({ x: lb.x + 6, y: lb.y + 4, fill: lb.color, 'text-anchor': 'start' }, lb.text, 11, 600, true));
    });

    /* ---- dot-to-dot links (the stochastic test) ------------------------- */
    (spec.links || []).forEach(function (lk) {
      var ax = xOfYear(lk.fromYear), bx = xOfYear(lk.toYear);
      if (!isNum(ax) || !isNum(bx)) return;
      var ay = sy(lk.fromValue), by = sy(lk.toValue);
      svg.appendChild(el('line', { x1: ax, y1: ay, x2: bx, y2: by, stroke: INK, 'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: 0.7 }));
      [[ax, ay], [bx, by]].forEach(function (p) {
        svg.appendChild(el('circle', { cx: p[0], cy: p[1], r: 3.2, fill: BG, stroke: INK, 'stroke-width': 1.4 }));
      });
      if (lk.text) {
        svg.appendChild(text({ x: bx + 8, y: by + 4, 'text-anchor': 'start', fill: INK }, lk.text, 10, null, true));
      }
    });

    /* ---- points and brackets ---------------------------------------------- */
    (spec.points || []).forEach(function (p) {
      var px = xOfYear(p.year);
      if (!isNum(px) || !isNum(p.value)) return;
      var py = sy(p.value);
      svg.appendChild(el('circle', { cx: px, cy: py, r: 3.6, fill: p.color || LINE, stroke: BG, 'stroke-width': 1.5 }));
      /* A bracket on the same year carries the level itself. */
      var bracketed = (spec.brackets || []).some(function (b) { return b.year === p.year; });
      if (p.text && !bracketed) {
        var leftSide = px > x1 - 110;
        svg.appendChild(text({
          x: px + (leftSide ? -7 : 7), y: py - 7, 'text-anchor': leftSide ? 'end' : 'start', fill: INK
        }, p.text, 10, null, true));
      }
    });

    (spec.brackets || []).forEach(function (b) {
      var bx = xOfYear(b.year);
      if (!isNum(bx)) return;
      var top = sy(Math.max(b.from, b.to)), bottom = sy(Math.min(b.from, b.to));
      var bxx = bx + 12;
      svg.appendChild(el('path', {
        d: 'M' + (bxx - 3) + ' ' + top + 'H' + bxx + 'V' + bottom + 'H' + (bxx - 3),
        fill: 'none', stroke: INK, 'stroke-width': 1
      }));
      svg.appendChild(text({ x: bxx + 4, y: (top + bottom) / 2 + 4, fill: INK }, b.text, 10, 600, true));
    });

    (spec.notes || []).forEach(function (n) {
      var nx = xOfYear(n.year);
      if (!isNum(nx) || !isNum(n.value)) return;
      svg.appendChild(text({
        x: nx + (n.anchor === 'end' ? -4 : 4), y: sy(n.value) + (n.below ? 12 : -4), 'text-anchor': n.anchor || 'start'
      }, n.text, 10, null, true));
    });

    if (spec.message) {
      svg.appendChild(text({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, 'text-anchor': 'middle', fill: INK }, spec.message, 12, 600));
    }

    /* ---- hover / touch readout ------------------------------------------ */
    var hover = el('line', {
      x1: 0, x2: 0, y1: y1, y2: y0, stroke: AXIS, 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0
    });
    svg.appendChild(hover);

    var readout = document.createElement('div');
    readout.className = 'dsa-readout';
    readout.innerHTML = '&nbsp;';

    function nearest(evt) {
      var rect = svg.getBoundingClientRect();
      var px = (evt.clientX - rect.left) / rect.width * W;
      var best = 0, bestD = Infinity;
      for (var k = 0; k < years.length; k++) {
        var d = Math.abs(sx(k) - px);
        if (d < bestD) { bestD = d; best = k; }
      }
      return best;
    }
    function show(evt) {
      var k = nearest(evt);
      hover.setAttribute('x1', sx(k));
      hover.setAttribute('x2', sx(k));
      hover.setAttribute('opacity', 0.8);
      var parts = ['<strong>' + years[k] + '</strong>'];
      series.forEach(function (sr) {
        var val = sr.values[k];
        if (!isNum(val)) return;
        parts.push('<span class="dsa-key" style="background:' + sr.color + '"></span>' + sr.name + ' ' + fmt(val));
      });
      readout.innerHTML = parts.join(' &nbsp; ');
    }
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', function () {
      hover.setAttribute('opacity', 0);
      readout.innerHTML = '&nbsp;';
    });

    host.innerHTML = '';
    host.appendChild(svg);
    host.appendChild(readout);
  }

  /* ------------------------------------------------------------------------
     Bar chart: what each rule would require
     ------------------------------------------------------------------------ */

  /**
   * @param {HTMLElement} host
   * @param {Object} spec
   *   rows    {Array}   [{label, short, value, state, note, base}]
   *                     state: 'binding' | 'on' | 'off' | 'unmet' | 'floor' |
   *                            'floor-binding' | 'na'
   *                     base: the value under the reference settings, drawn
   *                           as a hollow marker when it differs
   *   max     {number}  right end of the scale (2)
   *   marker  {number}  the chosen adjustment, drawn as a dashed rule
   *   markerLabel {string}
   *   unit    {string}  axis caption
   */
  function drawBars(host, spec) {
    host.__dsaSpec = spec;
    watch(host, drawBars);

    var W = hostWidth(host, 760);
    var narrow = W < 480;
    var rowH = narrow ? 24 : 22;
    var labelW = narrow ? 118 : 168;
    /* Give the marker its own header row so small requirements cannot
       collide with the unit caption. */
    var PAD = { top: 30, right: 54, bottom: 20 };
    var rows = spec.rows || [];
    var H = PAD.top + rows.length * rowH + PAD.bottom;
    var max = spec.max || 2;
    var px0 = labelW, px1 = W - PAD.right;
    function sx(v) { return px0 + (px1 - px0) * Math.min(v, max) / max; }

    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img',
      'aria-label': spec.ariaLabel || 'What each rule would require',
      style: 'max-width: 100%; height: auto; display: block;'
    });

    /* hatch pattern for "not met below the top of the scale" */
    var defs = el('defs', {});
    var pat = el('pattern', { id: 'dsa-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    pat.appendChild(el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: AXIS, 'stroke-width': 1.5 }));
    defs.appendChild(pat);
    svg.appendChild(defs);

    /* scale */
    var tick;
    for (tick = 0; tick <= max + 1e-9; tick += 0.5) {
      var tx = sx(tick);
      svg.appendChild(el('line', { x1: tx, x2: tx, y1: PAD.top - 4, y2: H - PAD.bottom + 2, stroke: GRID, 'stroke-width': 1 }));
      svg.appendChild(text({ x: tx, y: H - PAD.bottom + 14, 'text-anchor': 'middle' }, tick.toFixed(1), 10));
    }
    if (spec.unit) svg.appendChild(text({ x: 2, y: 10, 'text-anchor': 'start' }, spec.unit, 10));

    /* The chosen adjustment, painted under the rows so the value labels stay
       legible where it crosses them. */
    if (isNum(spec.marker)) {
      var mx = sx(spec.marker);
      svg.appendChild(el('line', { x1: mx, x2: mx, y1: PAD.top - 6, y2: H - PAD.bottom + 2, stroke: LINE, 'stroke-width': 1.2, 'stroke-dasharray': '3 3' }));
      if (spec.markerLabel) {
        svg.appendChild(text({ x: mx, y: PAD.top - 8, 'text-anchor': 'middle', fill: LINE }, spec.markerLabel, 10, 600, true));
      }
    }

    rows.forEach(function (r, i) {
      var y = PAD.top + i * rowH;
      var mid = y + rowH / 2;
      var barH = 9;
      var binding = r.state === 'binding' || r.state === 'floor-binding';
      var label = narrow && r.short ? r.short : r.label;

      svg.appendChild(text({
        x: px0 - 8, y: mid + 4, 'text-anchor': 'end', fill: binding ? INK : INK_MUTED
      }, label, 11, binding ? 600 : null));

      if (r.state === 'off' || r.state === 'na') {
        svg.appendChild(text({ x: px0 + 4, y: mid + 4, 'text-anchor': 'start' }, r.note || 'off', 10, null, true));
        return;
      }
      if (r.state === 'unmet') {
        svg.appendChild(el('rect', { x: px0, y: mid - barH / 2, width: px1 - px0, height: barH, fill: 'url(#dsa-hatch)' }));
        svg.appendChild(text({ x: px1 + 5, y: mid + 4, fill: INK }, '> ' + max.toFixed(2), 10, 600, true));
        return;
      }
      if (!isNum(r.value)) return;

      var isFloor = r.state === 'floor' || r.state === 'floor-binding';
      svg.appendChild(el('rect', {
        x: px0, y: mid - barH / 2, width: Math.max(1, sx(r.value) - px0), height: barH, rx: 1,
        fill: isFloor ? (binding ? LINE : 'none') : (binding ? LINE : AXIS),
        stroke: isFloor && !binding ? AXIS : 'none', 'stroke-width': 1,
        opacity: isFloor && !binding ? 0.9 : (binding ? 1 : 0.55)
      }));
      if (isNum(r.base) && Math.abs(r.base - r.value) > 0.004) {
        var bx = sx(r.base);
        svg.appendChild(el('line', { x1: bx, x2: bx, y1: mid - 7, y2: mid + 7, stroke: INK, 'stroke-width': 1.5, opacity: 0.55 }));
      }
      var valueText = r.value.toFixed(2) + (binding ? '  binds' : '') + (r.note ? '  ' + r.note : '');
      svg.appendChild(text({ x: sx(r.value) + 5, y: mid + 4, fill: binding ? INK : INK_MUTED }, valueText, 10, binding ? 600 : null, true));
    });

    host.innerHTML = '';
    host.appendChild(svg);
  }

  /* Annual expenditure ceilings use their own percentage scale, not the
     debt chart's thresholds or its ten-year review horizon. */
  function drawExpenditure(host, spec) {
    host.__dsaSpec = spec;
    watch(host, drawExpenditure);
    var W = hostWidth(host, 600), H = 150;
    var left = 32, right = W - 26, top = 27, bottom = H - 25;
    var all = spec.values.concat(spec.reference || []).filter(isNum);
    var lo = Math.floor((Math.min.apply(null, all) - 0.25) * 2) / 2;
    var hi = Math.ceil((Math.max.apply(null, all) + 0.25) * 2) / 2;
    if (hi - lo < 1) hi = lo + 1;
    function x(i) { return left + (right - left) * i / (spec.years.length - 1); }
    function y(v) { return bottom - (bottom - top) * (v - lo) / (hi - lo); }
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H,
      role: 'img', 'aria-label': spec.ariaLabel });
    var span = hi - lo;
    var step = span > 6 ? 2 : span > 3 ? 1 : span > 1.2 ? 0.5 : 0.25;
    for (var tick = Math.ceil(lo / step) * step; tick <= hi + 1e-9; tick += step) {
      svg.appendChild(el('line', { x1: left, x2: right, y1: y(tick), y2: y(tick), stroke: GRID }));
      svg.appendChild(text({ x: left - 6, y: y(tick) + 3, 'text-anchor': 'end' },
        (Math.abs(tick) < 1e-9 ? 0 : tick).toFixed(step < 0.5 ? 2 : 1), 10));
    }
    if (lo < 0 && hi > 0) svg.appendChild(el('line', { x1: left, x2: right,
      y1: y(0), y2: y(0), stroke: AXIS, 'stroke-dasharray': '2 3' }));
    function path(values, color, dash) {
      var d = '', connected = false;
      values.forEach(function (v, i) {
        if (!isNum(v)) { connected = false; return; }
        d += (connected ? 'L' : 'M') + x(i) + ' ' + y(v); connected = true;
      });
      svg.appendChild(el('path', { d: d, fill: 'none', stroke: color,
        'stroke-width': dash ? 1.5 : 2.2, 'stroke-dasharray': dash || null }));
    }
    if (spec.reference) path(spec.reference, 'var(--dsa-ref, #978d79)', '4 3');
    path(spec.values, LINE);
    spec.years.forEach(function (year, i) {
      var v = spec.values[i];
      svg.appendChild(el('circle', { cx: x(i), cy: y(v), r: 3, fill: LINE }));
      svg.appendChild(text({ x: x(i) + (i === 0 ? 4 : 0), y: y(v) - 9, 'text-anchor': i === 0 ? 'start' : 'middle', fill: INK }, v.toFixed(2), 11, 600, true));
      svg.appendChild(text({ x: x(i), y: H - 6, 'text-anchor': 'middle' }, String(year), 10));
    });
    host.innerHTML = '';
    host.appendChild(svg);
  }

  global.DSAChart = { draw: draw, drawBars: drawBars, drawExpenditure: drawExpenditure };

}(typeof self !== 'undefined' ? self : this));
