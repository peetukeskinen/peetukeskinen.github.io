/* ==========================================================================
   chart.js — small SVG line chart with percentile bands

   Written for this page rather than pulled from a library, so the calculator
   keeps the site's habit of no build step and no third-party code. Colours
   come from the stylesheet's custom properties, so light and dark mode and
   any future change of palette are handled in one place.
   ========================================================================== */

(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var W = 760, H = 380;
  var PAD = { top: 24, right: 22, bottom: 34, left: 46 };

  /* Paint and type are set as presentation attributes with literal fallbacks,
     not left to the stylesheet alone. A custom property that fails to resolve
     makes fill invalid, and an invalid fill paints black, so every var() here
     carries a fallback colour. The stylesheet still wins where it applies:
     CSS rules override presentation attributes. */
  var INK_MUTED = 'var(--ink-muted, #5b5449)';
  var GRID = 'var(--dsa-grid, #e3ddd0)';
  var AXIS = 'var(--dsa-axis, #978d79)';
  var BAND = 'var(--dsa-band, #7b2d2d)';
  var SHADE = 'var(--dsa-shade, #ece7da)';
  var SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

  function text(attrs, content, size) {
    var node = el('text', attrs);
    node.setAttribute('font-family', SANS);
    node.setAttribute('font-size', size || 11);
    if (!attrs.fill) node.setAttribute('fill', INK_MUTED);
    node.textContent = content;
    return node;
  }

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    for (var k in attrs) {
      if (attrs.hasOwnProperty(k) && attrs[k] !== undefined && attrs[k] !== null) {
        node.setAttribute(k, attrs[k]);
      }
    }
    return node;
  }

  function niceStep(span, target) {
    var raw = span / target;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  /**
   * Draw a chart.
   *
   * @param {HTMLElement} host      element to draw into (emptied first)
   * @param {Object} spec
   *   years   {number[]}  x values
   *   series  {Array}     [{name, values, color, dash, width}]
   *   bands   {Array}     [{lo, hi, opacity}] percentile ribbons, drawn behind
   *   shade   {Object}    {from, to, label} highlighted x range (the plan)
   *   yLabel  {string}
   *   valueFormat {Function}
   */
  function draw(host, spec) {
    var years = spec.years;
    var series = spec.series.filter(function (s) { return s.values; });
    var bands = spec.bands || [];
    var fmt = spec.valueFormat || function (v) { return v.toFixed(1); };

    /* ---- scales -------------------------------------------------------- */
    var lo = Infinity, hi = -Infinity;
    function consider(vals) {
      for (var i = 0; i < vals.length; i++) {
        var v = vals[i];
        if (v === null || v === undefined || !isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    series.forEach(function (s) { consider(s.values); });
    bands.forEach(function (b) { consider(b.lo); consider(b.hi); });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    var pad = (hi - lo) * 0.08 || 1;
    lo -= pad; hi += pad;

    var x0 = PAD.left, x1 = W - PAD.right, y0 = H - PAD.bottom, y1 = PAD.top;
    function sx(i) { return x0 + (x1 - x0) * (i / (years.length - 1)); }
    function sy(v) { return y0 + (y1 - y0) * ((v - lo) / (hi - lo)); }

    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': spec.ariaLabel || spec.yLabel
    });

    /* ---- plan period shading ------------------------------------------ */
    if (spec.shade) {
      var from = years.indexOf(spec.shade.from), to = years.indexOf(spec.shade.to);
      if (from >= 0 && to >= 0) {
        svg.appendChild(el('rect', {
          x: sx(from), y: y1, width: sx(to) - sx(from), height: y0 - y1,
          fill: SHADE, stroke: 'none'
        }));
        svg.appendChild(text({
          x: (sx(from) + sx(to)) / 2, y: y1 - 8, 'text-anchor': 'middle',
          class: 'dsa-chart-note', 'letter-spacing': '0.08em'
        }, spec.shade.label, 10));
      }
    }

    /* ---- y gridlines and ticks ---------------------------------------- */
    var step = niceStep(hi - lo, 5);
    var start = Math.ceil(lo / step) * step;
    for (var v = start; v <= hi; v += step) {
      var yy = sy(v);
      svg.appendChild(el('line', {
        x1: x0, x2: x1, y1: yy, y2: yy, stroke: GRID, 'stroke-width': 1
      }));
      svg.appendChild(text(
        { x: x0 - 8, y: yy + 4, 'text-anchor': 'end', class: 'dsa-chart-tick' },
        Math.abs(v) < 1e-9 ? '0' : fmt(v)
      ));
    }

    /* ---- x ticks. The last label is right-aligned so it cannot spill over
       the edge of the drawing area. ------------------------------------- */
    var every = years.length > 14 ? 3 : 2;
    for (var i = 0; i < years.length; i++) {
      var last = i === years.length - 1;
      if (i % every !== 0 && !last) continue;
      svg.appendChild(text({
        x: last ? x1 : sx(i), y: y0 + 20,
        'text-anchor': last ? 'end' : 'middle', class: 'dsa-chart-tick'
      }, years[i]));
    }

    /* ---- percentile ribbons -------------------------------------------- */
    bands.forEach(function (b) {
      var d = '';
      var j;
      for (j = 0; j < years.length; j++) {
        if (b.hi[j] === null || b.hi[j] === undefined) continue;
        d += (d ? 'L' : 'M') + sx(j).toFixed(2) + ' ' + sy(b.hi[j]).toFixed(2);
      }
      for (j = years.length - 1; j >= 0; j--) {
        if (b.lo[j] === null || b.lo[j] === undefined) continue;
        d += 'L' + sx(j).toFixed(2) + ' ' + sy(b.lo[j]).toFixed(2);
      }
      if (!d) return;
      svg.appendChild(el('path', { d: d + 'Z', fill: BAND, opacity: b.opacity, stroke: 'none' }));
    });

    /* ---- series -------------------------------------------------------- */
    series.forEach(function (s) {
      var d = '';
      for (var j = 0; j < years.length; j++) {
        var val = s.values[j];
        if (val === null || val === undefined || !isFinite(val)) continue;
        d += (d ? 'L' : 'M') + sx(j).toFixed(2) + ' ' + sy(val).toFixed(2);
      }
      if (!d) return;
      svg.appendChild(el('path', {
        d: d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 2,
        'stroke-dasharray': s.dash || null, 'stroke-linejoin': 'round'
      }));
    });

    /* ---- axis lines ---------------------------------------------------- */
    svg.appendChild(el('line', { x1: x0, x2: x1, y1: y0, y2: y0, stroke: AXIS, 'stroke-width': 1 }));

    /* The unit sits horizontally above the axis: a rotated label is easy to
       clip and hard to read at this size. */
    if (spec.yLabel) {
      svg.appendChild(text({ x: 2, y: 11, class: 'dsa-chart-tick' }, spec.yLabel));
    }

    /* ---- hover readout -------------------------------------------------- */
    var hover = el('line', {
      x1: 0, x2: 0, y1: y1, y2: y0, stroke: AXIS,
      'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0
    });
    svg.appendChild(hover);

    var readout = document.createElement('div');
    readout.className = 'dsa-readout';
    readout.setAttribute('aria-live', 'polite');
    readout.innerHTML = '&nbsp;';

    function nearest(evt) {
      var rect = svg.getBoundingClientRect();
      var px = (evt.clientX - rect.left) / rect.width * W;
      var best = 0, bestD = Infinity;
      for (var j = 0; j < years.length; j++) {
        var d = Math.abs(sx(j) - px);
        if (d < bestD) { bestD = d; best = j; }
      }
      return best;
    }

    svg.addEventListener('mousemove', function (evt) {
      var j = nearest(evt);
      hover.setAttribute('x1', sx(j));
      hover.setAttribute('x2', sx(j));
      hover.setAttribute('opacity', 0.8);
      var parts = ['<strong>' + years[j] + '</strong>'];
      series.forEach(function (s) {
        var val = s.values[j];
        if (val === null || val === undefined || !isFinite(val)) return;
        parts.push('<span class="dsa-key" style="background:' + s.color + '"></span>' +
                   s.name + ' ' + fmt(val));
      });
      readout.innerHTML = parts.join(' &nbsp; ');
    });
    svg.addEventListener('mouseleave', function () {
      hover.setAttribute('opacity', 0);
      readout.innerHTML = '&nbsp;';
    });

    host.innerHTML = '';
    host.appendChild(svg);
    host.appendChild(readout);
  }

  global.DSAChart = { draw: draw };

}(typeof self !== 'undefined' ? self : this));
