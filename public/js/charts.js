/**
 * CHARTS.JS — Plain SVG charts fed by real task data (no library).
 * Depends on escapeHtml() from api.js.
 */
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

  // Trend charts are drawn at the container's real pixel width so text never stretches;
  // a single observer redraws them when the layout changes.
  const redraws = new Map();
  const observer = 'ResizeObserver' in window
    ? new ResizeObserver((entries) => {
        entries.forEach((entry) => {
          const draw = redraws.get(entry.target);
          if (draw && Math.round(entry.contentRect.width) !== entry.target._lastWidth) draw();
        });
      })
    : null;

  function emptyBox(text) {
    return `<div class="chart-empty">${escapeHtml(text)}</div>`;
  }

  function pct(value, total) {
    return total > 0 ? Math.round((value / total) * 100) : 0;
  }

  /* ---------------------------------------------------------------- Donut */

  function donut(el, { segments, centerValue, centerLabel, ariaLabel, emptyText = 'Belum ada data.' }) {
    const rows = segments.map((s) => ({ ...s, value: Number(s.value) || 0 }));
    const total = rows.reduce((sum, s) => sum + s.value, 0);
    if (total === 0) {
      el.innerHTML = emptyBox(emptyText);
      return;
    }

    const size = 152;
    const stroke = 18;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    let offset = 0;

    const arcs = rows.filter((s) => s.value > 0).map((s) => {
      const len = (s.value / total) * c;
      const arc = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" style="stroke: ${s.color}"
        stroke-width="${stroke}" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}">
        <title>${escapeHtml(s.label)}: ${s.value} (${pct(s.value, total)}%)</title></circle>`;
      offset += len;
      return arc;
    }).join('');

    const summary = rows.map((s) => `${s.label} ${s.value} (${pct(s.value, total)}%)`).join(', ');

    el.innerHTML = `
      <div class="chart-donut-wrap">
        <figure class="chart-donut" style="width:${size}px;height:${size}px;">
          <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true" focusable="false">
            <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" class="chart-donut-track" stroke-width="${stroke}"/>
            <g transform="rotate(-90 ${size / 2} ${size / 2})">${arcs}</g>
          </svg>
          <figcaption class="chart-donut-center">
            <span class="chart-donut-value">${escapeHtml(centerValue ?? total)}</span>
            <span class="chart-donut-label">${escapeHtml(centerLabel ?? 'tugas')}</span>
          </figcaption>
        </figure>
        <ul class="chart-legend">
          ${rows.map((s) => `
            <li>
              <span class="chart-swatch" style="background: ${s.color}" aria-hidden="true"></span>
              <span class="chart-legend-label">${s.labelHtml || escapeHtml(s.label)}</span>
              <span class="chart-num">${s.value} <span class="muted">· ${pct(s.value, total)}%</span></span>
            </li>`).join('')}
        </ul>
        <p class="sr-only">${escapeHtml(ariaLabel)}: ${escapeHtml(summary)}.</p>
      </div>`;
  }

  /* ---------------------------------------------------------------- Trend */

  function bucketStart(date, unit) {
    const d = new Date(date);
    if (unit === 'hour') { d.setMinutes(0, 0, 0); return d; }
    d.setHours(0, 0, 0, 0);
    if (unit === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    if (unit === 'month') d.setDate(1);
    return d;
  }

  function nextBucket(date, unit) {
    const d = new Date(date);
    if (unit === 'hour') d.setHours(d.getHours() + 1);
    else if (unit === 'day') d.setDate(d.getDate() + 1);
    else if (unit === 'week') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    return d;
  }

  function axisLabel(d, unit) {
    if (unit === 'hour') return `${String(d.getHours()).padStart(2, '0')}:00`;
    if (unit === 'month') return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }

  function longLabel(d, unit) {
    const date = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    if (unit === 'hour') return `${date} ${axisLabel(d, unit)}`;
    if (unit === 'week') return `Minggu mulai ${DAYS[d.getDay()]}, ${date}`;
    if (unit === 'month') return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    return `${DAYS[d.getDay()]}, ${date}`;
  }

  // Pick a bucket size that keeps the chart readable for the given span.
  function pickUnit(from, to) {
    const days = (to - from) / 86400000;
    if (days <= 1) return 'hour';
    if (days <= 62) return 'day';
    if (days <= 7 * 104) return 'week';
    return 'month';
  }

  /** Count tasks created and completed per bucket between `from` and `to` (local time). */
  function buildSeries(tasks, from, to, unit) {
    const buckets = [];
    const index = new Map();
    for (let d = bucketStart(from, unit); d <= to; d = nextBucket(d, unit)) {
      index.set(d.getTime(), buckets.length);
      buckets.push({ start: d, created: 0, completed: 0 });
    }
    const add = (iso, key) => {
      if (!iso) return;
      const t = new Date(iso);
      if (Number.isNaN(t.getTime()) || t < from || t > to) return;
      const i = index.get(bucketStart(t, unit).getTime());
      if (i !== undefined) buckets[i][key] += 1;
    };
    tasks.forEach((task) => {
      add(task.created_at, 'created');
      if (task.status === 'Done') add(task.completed_at, 'completed');
    });
    return buckets;
  }

  function drawTrend(el, buckets, unit) {
    const width = Math.max(el.clientWidth || 0, 280);
    el._lastWidth = Math.round(width);
    const height = 220;
    const pad = { top: 12, right: 12, bottom: 28, left: 32 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const n = buckets.length;

    const max = Math.max(1, ...buckets.map((b) => Math.max(b.created, b.completed)));
    const step = Math.max(1, Math.ceil(max / 4));
    const yMax = step * 4;
    const x = (i) => (n === 1 ? pad.left + plotW / 2 : pad.left + (i * plotW) / (n - 1));
    const y = (v) => pad.top + plotH - (v / yMax) * plotH;

    const grid = [0, 1, 2, 3, 4].map((k) => {
      const v = k * step;
      return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(v)}" y2="${y(v)}"/>
        <text x="${pad.left - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    }).join('');

    // Always label the first and last bucket; edge labels anchor inward so they never clip.
    const stride = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 64))));
    const labelled = (i) => i === n - 1 || (i % stride === 0 && n - 1 - i >= stride * 0.6);
    const anchor = (i) => (n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle');
    const xLabels = buckets.map((b, i) => (labelled(i)
      ? `<text x="${x(i)}" y="${height - 8}" text-anchor="${anchor(i)}">${axisLabel(b.start, unit)}</text>`
      : '')).join('');

    const path = (key) => buckets.map((b, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(b[key]).toFixed(1)}`).join(' ');
    const showDots = n <= 31;
    const dots = (key, cls) => (showDots
      ? buckets.map((b, i) => `<circle class="${cls}" cx="${x(i)}" cy="${y(b[key])}" r="3"/>`).join('')
      : '');

    // Transparent column per bucket gives a native tooltip with the exact numbers.
    const colW = n === 1 ? plotW : plotW / (n - 1);
    const hits = buckets.map((b, i) => `<rect class="chart-hit" x="${Math.max(pad.left, x(i) - colW / 2)}" y="${pad.top}"
      width="${Math.min(colW, plotW)}" height="${plotH}"><title>${longLabel(b.start, unit)}: ${b.created} dibuat, ${b.completed} selesai</title></rect>`).join('');

    el.innerHTML = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
        <g class="chart-grid">${grid}</g>
        <g class="chart-axis">${xLabels}</g>
        <path class="chart-line chart-line-created" d="${path('created')}"/>
        <path class="chart-line chart-line-completed" d="${path('completed')}"/>
        ${dots('created', 'chart-dot-created')}${dots('completed', 'chart-dot-completed')}
        ${hits}
      </svg>`;
  }

  /**
   * Line chart: tasks created vs completed per bucket.
   * Returns totals so the caller can render legend numbers.
   */
  function trend(el, { tasks, from, to = new Date(), unit, ariaLabel, emptyText = 'Belum ada aktivitas pada periode ini.' }) {
    observer?.unobserve(el);
    redraws.delete(el);

    const u = unit || pickUnit(from, to);
    const buckets = buildSeries(tasks, from, to, u);
    const totals = buckets.reduce((acc, b) => ({ created: acc.created + b.created, completed: acc.completed + b.completed }), { created: 0, completed: 0 });

    const summaryEl = el.nextElementSibling?.classList.contains('chart-summary') ? el.nextElementSibling : null;
    if (totals.created + totals.completed === 0) {
      el.innerHTML = emptyBox(emptyText);
      if (summaryEl) summaryEl.textContent = `${ariaLabel}: tidak ada data.`;
      return totals;
    }

    const draw = () => drawTrend(el, buckets, u);
    draw();
    redraws.set(el, draw);
    observer?.observe(el);

    if (summaryEl) {
      const peak = buckets.reduce((best, b) => (b.created + b.completed > best.created + best.completed ? b : best), buckets[0]);
      summaryEl.textContent = `${ariaLabel}: ${totals.created} tugas dibuat dan ${totals.completed} tugas selesai. `
        + `Aktivitas tertinggi ${longLabel(peak.start, u)} (${peak.created} dibuat, ${peak.completed} selesai).`;
    }
    return totals;
  }

  window.ChartKit = { donut, trend, pickUnit };
})();
