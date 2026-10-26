initNavigation('reports');

const PERIOD_LABELS = { all: 'Semua Waktu', month: 'Bulan Ini', week: 'Minggu Ini', today: 'Hari Ini' };
const STATUS_SEGMENTS = [
  { key: 'todo_tasks', label: 'To Do', color: 'var(--status-todo)' },
  { key: 'in_progress_tasks', label: 'In Progress', color: 'var(--status-in-progress)' },
  { key: 'completed_tasks', label: 'Done', color: 'var(--status-done)' },
];

let currentPeriod = 'all';

function printReport() {
  window.print();
}

function changePeriod(period) {
  currentPeriod = period;
  Object.keys(PERIOD_LABELS).forEach(p => {
    document.getElementById(`btn-period-${p}`).setAttribute('aria-pressed', String(p === period));
  });
  loadReportsData();
}

// Bar width is relative to the largest group; label shows share of total.
function renderBars(el, rows, total, labelFn, colorFn, emptyText = 'Belum ada data tugas pada periode ini.') {
  if (!rows.length) {
    el.innerHTML = `<p class="muted" style="font-size: 0.8125rem;">${emptyText}</p>`;
    return;
  }
  const max = Math.max(...rows.map(r => parseInt(r.count, 10)), 1);
  el.innerHTML = rows.map(r => {
    const count = parseInt(r.count, 10);
    const share = total > 0 ? Math.round((count / total) * 100) : 0;
    return `
      <div>
        <div class="bar-row-head">
          ${labelFn(r)}
          <span class="font-mono">${count} · ${share}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width: ${(count / max) * 100}%; background: ${colorFn(r)};"></div></div>
      </div>`;
  }).join('');
}

// Same period boundaries as /api/reports/analytics (local time).
function periodStart(period, tasks) {
  const now = new Date();
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'week') {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return monday;
  }
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  const times = tasks.map(t => new Date(t.created_at).getTime()).filter(Number.isFinite);
  if (!times.length) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const first = new Date(Math.min(...times));
  first.setHours(0, 0, 0, 0);
  return first;
}

function renderTrend(tasks) {
  const to = new Date();
  const from = periodStart(currentPeriod, tasks);
  const periodFrom = new Date(from);
  // Show at least 7 days so a fresh week/month still reads as a line, not a dot.
  if (currentPeriod !== 'today' && (to - from) < 6 * 86400000) {
    from.setDate(from.getDate() - 6 + Math.floor((to - from) / 86400000));
  }
  const unit = ChartKit.pickUnit(from, to);
  const unitText = { hour: 'per jam', day: 'per hari', week: 'per minggu', month: 'per bulan' }[unit];
  document.getElementById('trend-sub').textContent = `${PERIOD_LABELS[currentPeriod]}, ${unitText}. Selesai dihitung dari tanggal penyelesaian.`;
  const totals = ChartKit.trend(document.getElementById('trend-chart'), {
    tasks, from, to, unit,
    ariaLabel: `Tren tugas ${PERIOD_LABELS[currentPeriod].toLowerCase()}`,
    emptyText: 'Belum ada tugas dibuat atau diselesaikan pada periode ini.',
  });
  // Legend counts only the real period (the padded days before it are context), matching the KPIs.
  const inPeriod = (d) => d && new Date(d) >= periodFrom && new Date(d) <= to;
  document.getElementById('trend-created').textContent = currentPeriod === 'all'
    ? totals.created : tasks.filter(t => inPeriod(t.created_at)).length;
  document.getElementById('trend-completed').textContent = currentPeriod === 'all'
    ? totals.completed : tasks.filter(t => inPeriod(t.completed_at)).length;
}

let loadSeq = 0;

async function loadReportsData() {
  document.getElementById('print-timestamp').textContent = new Date().toLocaleString('id-ID');
  document.getElementById('print-period').textContent = PERIOD_LABELS[currentPeriod];
  const seq = ++loadSeq;

  try {
    const [res, tasksRes] = await Promise.all([
      apiFetch(`/api/reports/analytics?period=${currentPeriod}`),
      apiFetch('/api/tasks'),
    ]);
    // Ignore responses from an older period click that resolved late.
    if (seq !== loadSeq || !res || !res.data) return;

    renderTrend((tasksRes && tasksRes.data) || []);

    const m = res.data.metrics;
    document.getElementById('kpi-completion-rate').textContent = `${m.completion_rate}%`;
    document.getElementById('kpi-ontime-rate').textContent = parseInt(m.completed_tasks, 10) > 0 ? `${m.on_time_rate}%` : '–';
    document.getElementById('kpi-completed-tasks').textContent = m.completed_tasks;
    document.getElementById('kpi-total-tasks').textContent = m.total_tasks;
    document.getElementById('kpi-overdue-tasks').textContent = m.overdue_tasks;

    ChartKit.donut(document.getElementById('status-chart'), {
      segments: STATUS_SEGMENTS.map(s => ({ label: s.label, value: m[s.key], color: s.color })),
      centerValue: `${Math.round(m.completion_rate || 0)}%`,
      centerLabel: 'selesai',
      ariaLabel: 'Komposisi status tugas',
      emptyText: 'Belum ada tugas pada periode ini.',
    });

    const reports = res.data.member_reports || [];
    renderBars(
      document.getElementById('member-bars'),
      reports,
      reports.reduce((sum, r) => sum + (parseInt(r.count, 10) || 0), 0),
      r => `<span style="font-weight: 600; overflow-wrap: anywhere;">${escapeHtml(r.name)}</span>`,
      () => 'var(--cta)',
      'Belum ada laporan selesai dari anggota pada periode ini.',
    );
  } catch (err) {
    if (seq === loadSeq) {
      showLoadError(['#trend-chart', '#status-chart', '#member-bars'], 'loadReportsData', err);
    }
  }
}

loadReportsData();
