/* ==================================================================
   Fleet Support Dashboard — منطق الصفحة
   ------------------------------------------------------------------
   القسم A  طبقة البيانات (apiCall / الفلاتر / الاتصال)  ← لم يتغير منطقها
   القسم B  أدوات التنسيق (أرقام، تواريخ، حالات)
   القسم C  مكونات: DataGrid, Charts, KPI, Alerts
   القسم D  عرض الصفحات
   القسم E  تقرير الإدارة (المعاينة / الطباعة)
   القسم F  الأحداث والتشغيل
   ================================================================== */

/* ================================================================== */
/* A) DATA LAYER                                                       */
/* ================================================================== */

// ---- API URL resolution -------------------------------------------------
// 1) SERVER_API_URL: يُحقن عند كل تحميل من doGet() (Code.gs) بواسطة
//    ScriptApp.getService().getUrl() — هو دائمًا رابط هذا الـ Deployment.
// 2) DEFAULT_API_URL: يُستخدم فقط إذا فُتح الملف كملف ثابت خارج Apps Script.
// 3) إعداد ⚙️ المحفوظ في localStorage له الأولوية دائمًا.
const RAW_SERVER_API_URL = "<?!= serverApiUrl ? serverApiUrl : '' ?>";
const SERVER_API_URL = RAW_SERVER_API_URL.indexOf('https://') === 0 ? RAW_SERVER_API_URL : '';
const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycby1kE988N8TAwORXRPcnxZ_Z64GRrksri161Be5FhkLvCHytlCJVZaDkEs0K1twYLM3/exec";
const RAW_LOGO = "<?!= getLogoDataUri_() ?>";
const LOGO_URI = RAW_LOGO.indexOf('data:image') === 0 ? RAW_LOGO : '';
let currentApiUrl = lsGet('fleetSupportApiUrl') || SERVER_API_URL || DEFAULT_API_URL;

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* التخزين غير متاح — لا مشكلة */ } }

// Maps the "action" name used throughout this file to the actual
// server-side function name + how to build its argument list.
const GAS_RUN_MAP = {
  kpis:                  filters => ['getKPIs', [filters]],
  branchPerformance:     filters => ['getBranchPerformance', [filters]],
  employeePerformance:   filters => ['getEmployeePerformance', [filters]],
  accountBreakdown:      filters => ['getAccountBreakdown', [filters]],
  problemTypeBreakdown:  filters => ['getProblemTypeBreakdown', [filters]],
  dailyTrend:            filters => ['getDailyTrend', [filters]],
  openCases:             filters => ['getOpenCases', [filters]],
  filterOptions:         ()      => ['getFilterOptions', []],
  reportsBundle:         filters => ['getReportsBundle', [filters]],
  dailyStatusBreakdown:  filters => ['getDailyStatusBreakdown', [filters]],
  managementReportPdf:   filters => ['getManagementReportPdf', [filters]],
  fullAppData:           filters => ['getFullAppData', [filters]],
  refresh:               filters => ['refreshAndGetFullAppData', [filters]],
  monthComparison:       filters => ['getMonthComparison', [filters.field || 'branch', filters.monthA, filters.monthB, filters]]
};

const HAS_GAS_RUN = typeof google !== 'undefined' && !!(google.script && google.script.run);

function apiCall(action, params) {
  return HAS_GAS_RUN ? apiCallViaGasRun(action, params) : apiCallViaFetch(action, params);
}

function apiCallViaGasRun(action, params) {
  return new Promise((resolve, reject) => {
    const mapper = GAS_RUN_MAP[action];
    if (!mapper) { reject(new Error('Unknown action: ' + action)); return; }
    const [fnName, args] = mapper(params || {});
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(err => reject(new Error((err && err.message) || 'حدث خطأ فى السيرفر')))
      [fnName].apply(null, args);
  });
}

async function apiCallViaFetch(action, params) {
  const url = new URL(currentApiUrl);
  url.searchParams.set('action', action);
  Object.entries(params || {}).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });
  let res;
  try {
    res = await fetch(url.toString(), { method: 'GET', cache: 'no-store' });
  } catch (networkErr) {
    throw new Error('تعذّر الوصول للسيرفر — تأكد من الاتصال بالإنترنت ومن رابط الـ API في الإعدادات');
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'حدث خطأ فى الـ API');
  return json.data;
}

function getCurrentFilters() {
  return {
    dateFrom: val('filterDateFrom') || null,
    dateTo: val('filterDateTo') || null,
    branch: val('filterBranch') || null,
    employee: val('filterEmployee') || null,
    account: val('filterAccount') || null,
    driver: val('filterDriver') || null,
    problemType: val('filterProblemType') || null,
    statusBucket: val('filterStatus') || null
  };
}
function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }

/* ================================================================== */
/* B) FORMAT + STATUS HELPERS                                          */
/* ================================================================== */
const $ = id => document.getElementById(id);
const ATTENTION_PCT = 50;            // نفس حد «يحتاج متابعة» المستخدم في تقارير النظام (Config.gs → REPORT.ATTENTION_RESOLUTION_PCT)
const TOP_N = 10;                    // عدد العناصر في الرسوم الترتيبية (الجداول تعرض الكل)
const MISSING = 'غير محدد بالمصدر';  // قيمة غير موجودة في المصدر — لا تُخمَّن

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const N = t => '<bdi class="num" dir="ltr">' + t + '</bdi>';          // رقم/تاريخ يبقى LTR داخل النص العربي
const fInt = n => (n === null || n === undefined || n === '') ? '—' : Number(n).toLocaleString('en-US');
const fPct = n => (n === null || n === undefined) ? '—' : Number(n).toFixed(1) + '%';
const fDeltaInt = n => (n === null || n === undefined) ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('en-US');
const fDeltaPct = n => (n === null || n === undefined) ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1) + '%';
const pctOf = (n, d) => d ? Math.round((n / d) * 1000) / 10 : 0;     // نفس قاعدة pct_() في Helpers.gs
const pad2 = n => (n < 10 ? '0' : '') + n;
function fStamp(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function fDay(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function setText(id, text) { const el = $(id); if (el) el.textContent = text; }
function setHTML(id, html) { const el = $(id); if (el) el.innerHTML = html; }
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function hexA(hex, a) {
  const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}

// حالة الشحنة (3 فئات من Config.gs) ←→ حالات النظام المعتمدة (tint + icon + text)
const STATUS_ICON = { success: 'circle-check', 'in-progress': 'clock', 'under-action': 'triangle-exclamation', violation: 'circle-exclamation', closed: 'circle-xmark' };
const BUCKET = {
  SOLVED:   { label: 'تم الحل',      status: 'success' },
  FOLLOWUP: { label: 'قيد المتابعة', status: 'under-action' },
  OPEN:     { label: 'لم يتم الحل',  status: 'violation' }
};
function badge(status, label, small, icon) {
  return '<span class="ar-badge ' + status + (small ? ' sm' : '') + '"><i class="fa-solid fa-' + (icon || STATUS_ICON[status] || 'circle') + '" aria-hidden="true"></i>' + esc(label) + '</span>';
}
function rateHTML(v) {
  if (v === null || v === undefined) return '—';
  const w = Math.max(0, Math.min(100, Number(v)));
  return '<span class="ar-rate"><span class="trk"><span style="width:' + w + '%"></span></span><span class="pc">' + fPct(v) + '</span></span>';
}

/* ================================================================== */
/* C) COMPONENTS                                                       */
/* ================================================================== */

/* ---------- Alert / Empty ---------- */
function alertHTML(type, title, text, actions) {
  const icon = { info: 'circle-info', warning: 'triangle-exclamation', violation: 'circle-exclamation', success: 'circle-check' }[type] || 'circle-info';
  return '<div class="ar-alert ' + type + '" role="alert"><i class="fa-solid fa-' + icon + '" aria-hidden="true"></i><div class="tx"><b>' + esc(title) + '</b>' + (text ? '<span>' + text + '</span>' : '') + '</div>' +
    (actions ? '<div class="acts">' + actions + '</div>' : '') + '</div>';
}
const EMPTY_TEXT = 'لا توجد بيانات متاحة وفقًا للفلاتر المحددة.';
function emptyHTML(text, icon) {
  return '<div class="ar-empty"><div class="disc"><i class="fa-solid fa-' + (icon || 'inbox') + '" aria-hidden="true"></i></div><b>' + esc(text || EMPTY_TEXT) + '</b><span>جرّب توسيع الفترة أو إعادة ضبط الفلاتر.</span></div>';
}

/* ---------- KPI card ---------- */
function kpiHTML(o) {
  return '<div class="ar-kpi tone-' + (o.tone || 'brand') + (o.compact ? ' compact' : '') + '"><div class="disc"><i class="fa-solid fa-' + o.icon + '" aria-hidden="true"></i></div>' +
    '<div class="body"><div class="lbl">' + o.label + '</div><div class="val">' + o.value + (o.unit ? '<span class="unit">' + o.unit + '</span>' : '') + '</div>' +
    (o.sub ? '<div class="sub">' + o.sub + '</div>' : '') + '</div></div>';
}
function kpiSet(k, f, compact) {
  const t = k.total;
  const share = n => N(fPct(pctOf(n, t))) + ' من الإجمالي';
  return {
    total:    { tone: 'brand', icon: 'boxes-stacked', label: 'إجمالي المشاكل', value: N(fInt(k.total)), sub: periodSub(f), compact },
    solved:   { tone: 'success', icon: STATUS_ICON.success, label: 'تم الحل', value: N(fInt(k.solved)), sub: share(k.solved), compact },
    followup: { tone: 'under-action', icon: STATUS_ICON['under-action'], label: 'قيد المتابعة', value: N(fInt(k.followup)), sub: share(k.followup), compact },
    open:     { tone: 'violation', icon: STATUS_ICON.violation, label: 'لم يتم الحل', value: N(fInt(k.open)), sub: share(k.open), compact },
    rate:     { tone: 'brand', icon: 'percent', label: 'نسبة الحل', value: N(Number(k.resolutionRatePct).toFixed(1)), unit: '%', sub: 'تم الحل ÷ إجمالي المشاكل', compact },
    branches: { tone: 'brand', icon: 'building', label: 'عدد الفروع', value: N(fInt(k.branchCount)), sub: 'فروع لديها حالات', compact },
    employees:{ tone: 'brand', icon: 'users', label: 'عدد الموظفات', value: N(fInt(k.employeeCount)), sub: 'موظفات لديهن حالات', compact },
    accounts: { tone: 'brand', icon: 'briefcase', label: 'عدد Accounts', value: N(fInt(k.accountCount)), sub: 'Accounts لديها حالات', compact }
  };
}
let lastDaily = [];
function periodOf(daily, f) {
  daily = daily || [];
  f = f || {};
  if (f.dateFrom || f.dateTo) return { from: f.dateFrom || (daily.length ? daily[0].date : ''), to: f.dateTo || (daily.length ? daily[daily.length - 1].date : '') };
  if (!daily.length) return { from: '', to: '' };
  return { from: daily[0].date, to: daily[daily.length - 1].date };
}
function periodText(p) { return (p && (p.from || p.to)) ? (N(esc(p.from || '—')) + ' ← ' + N(esc(p.to || '—'))) : MISSING; }
function periodSub(f) { const p = periodOf(lastDaily, f); return (p.from || p.to) ? 'الفترة: ' + periodText(p) : ''; }

/* ---------- Cells (مشتركة بين الجداول التفاعلية وجداول التقرير) ---------- */
function colClass(c) {
  return c.cls || ({ int: 'c-num', pct: 'c-num', rate: 'c-num', date: 'c-num', rank: 'c-rank', name: 'c-name', note: 'c-note' }[c.type] || '');
}
function cellHTML(c, r) {
  if (c.render) return c.render(r);
  const v = r[c.key];
  switch (c.type) {
    case 'rank': return r._rank == null ? '' : N(r._rank);
    case 'int':  return (v === null || v === undefined) ? '—' : N(fInt(v));
    case 'pct':  return (v === null || v === undefined) ? '—' : N(fPct(v));
    case 'rate': return rateHTML(v);
    case 'date': return v ? N(esc(v)) : '—';
    case 'id':   return v ? '<span class="id-text">' + esc(v) + '</span>' : '—';
    case 'note': return v ? '<span title="' + esc(v) + '">' + esc(v) + '</span>' : '—';
    default:     return (v === '' || v === null || v === undefined) ? '—' : esc(v);
  }
}
function sortVal(c, r) { return c.sort ? c.sort(r) : r[c.key]; }

/* ---------- DataGrid: ترتيب + بحث + ترقيم صفحات + Sticky header + صف إجمالي ---------- */
class DataGrid {
  constructor(hostId, o) {
    this.host = $(hostId);
    this.o = Object.assign({ pageSize: 10, pageSizes: [10, 25, 50, 100], searchable: true, sortable: true, title: '', empty: EMPTY_TEXT,
      summary: null, searchKeys: null, searchPlaceholder: 'بحث…', maxHeight: 560, columns: [] }, o);
    this.rows = []; this.q = ''; this.sortKey = null; this.sortDir = 1; this.page = 1; this.pageSize = this.o.pageSize;
    this.host.innerHTML =
      '<div class="ar-table-card" style="--tbl-max:' + this.o.maxHeight + 'px">' +
      '<div class="ar-table-bar"><h3>' + esc(this.o.title) + '<span class="count" data-r="count"></span></h3><div class="ar-table-tools">' +
      (this.o.searchable ? '<div class="ar-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input class="ar-input" type="search" data-r="q" placeholder="' + esc(this.o.searchPlaceholder) + '" aria-label="بحث في الجدول"></div>' : '') +
      '<select class="ar-select" data-r="ps" aria-label="عدد الصفوف في الصفحة" hidden>' + this.o.pageSizes.map(n => '<option value="' + n + '"' + (n === this.pageSize ? ' selected' : '') + '>' + n + ' صف</option>').join('') + '</select>' +
      '</div></div><div class="ar-table-wrap" data-r="wrap"></div><div class="ar-pager" data-r="pager"></div></div>';
    this.el = k => this.host.querySelector('[data-r="' + k + '"]');
    const q = this.el('q');
    if (q) q.addEventListener('input', () => { this.q = q.value; this.page = 1; this.renderBody(); });
    this.el('ps').addEventListener('change', e => { this.pageSize = parseInt(e.target.value, 10) || 10; this.page = 1; this.renderBody(); });
    this.el('wrap').addEventListener('click', e => {
      const th = e.target.closest('th[data-k]'); if (!th) return;
      const k = th.getAttribute('data-k');
      if (this.sortKey === k) this.sortDir = -this.sortDir; else { this.sortKey = k; this.sortDir = 1; }
      this.renderBody();
    });
    this.el('pager').addEventListener('click', e => {
      const b = e.target.closest('button[data-p]'); if (!b || b.disabled) return;
      this.page = parseInt(b.getAttribute('data-p'), 10); this.renderBody();
    });
    this.renderBody();
  }
  setRows(rows) {
    this.rows = (rows || []).map((r, i) => Object.assign({}, r, { _rank: i + 1 }));
    this.page = 1; this.renderBody();
  }
  view() {
    let v = this.rows;
    const q = (this.q || '').trim().toLowerCase();
    if (q) {
      const keys = this.o.searchKeys || this.o.columns.filter(c => !c.render && c.type !== 'rank' && c.type !== 'rate').map(c => c.key);
      v = v.filter(r => keys.some(k => r[k] !== null && r[k] !== undefined && String(r[k]).toLowerCase().indexOf(q) !== -1));
    }
    if (this.sortKey) {
      const c = this.o.columns.find(c => c.key === this.sortKey);
      if (c) {
        const d = this.sortDir;
        v = v.slice().sort((a, b) => {
          const x = sortVal(c, a), y = sortVal(c, b);
          if (x === y) return 0;
          if (x === null || x === undefined || x === '') return 1;
          if (y === null || y === undefined || y === '') return -1;
          if (typeof x === 'number' && typeof y === 'number') return (x - y) * d;
          return String(x).localeCompare(String(y), 'ar') * d;
        });
      }
    }
    return v;
  }
  renderBody() {
    const cols = this.o.columns, v = this.view(), total = v.length;
    const pages = Math.max(1, Math.ceil(total / this.pageSize));
    if (this.page > pages) this.page = pages;
    const start = (this.page - 1) * this.pageSize;
    const slice = v.slice(start, start + this.pageSize);
    this.el('count').textContent = this.rows.length ? ' (' + fInt(this.rows.length) + ')' : '';
    this.el('ps').hidden = this.rows.length <= this.o.pageSizes[0];

    const th = cols.map(c => {
      const sortable = this.o.sortable && c.sortable !== false && c.type !== 'rank';
      const on = sortable && this.sortKey === c.key;
      const ic = on ? (this.sortDir > 0 ? 'sort-up' : 'sort-down') : 'sort';
      return '<th scope="col" class="' + colClass(c) + (sortable ? ' is-sortable' : '') + (on ? ' is-sorted' : '') + '"' + (sortable ? ' data-k="' + c.key + '" tabindex="0"' : '') +
        (on ? ' aria-sort="' + (this.sortDir > 0 ? 'ascending' : 'descending') + '"' : '') + '>' + esc(c.label) + (sortable ? '<i class="fa-solid fa-' + ic + ' si" aria-hidden="true"></i>' : '') + '</th>';
    }).join('');
    let body;
    if (!total) {
      body = '<tr><td class="empty-cell" colspan="' + cols.length + '">' + emptyHTML(this.rows.length ? 'لا توجد نتائج مطابقة للبحث.' : this.o.empty, this.rows.length ? 'magnifying-glass' : 'inbox').replace('<span>جرّب توسيع الفترة أو إعادة ضبط الفلاتر.</span>', this.rows.length ? '<span>غيّر كلمات البحث.</span>' : '<span>جرّب توسيع الفترة أو إعادة ضبط الفلاتر.</span>') + '</td></tr>';
    } else {
      body = slice.map(r => '<tr>' + cols.map(c => '<td class="' + colClass(c) + '">' + cellHTML(c, r) + '</td>').join('') + '</tr>').join('');
    }
    let foot = '';
    if (this.o.summary && total) {
      const s = this.o.summary(v);
      if (s) foot = '<tfoot><tr>' + cols.map(c => '<td class="' + colClass(c) + '">' + (s[c.key] === undefined ? '' : cellHTML(c, s)) + '</td>').join('') + '</tr></tfoot>';
    }
    this.el('wrap').innerHTML = '<table class="ar-table"><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody>' + foot + '</table>';

    // pager
    const pg = this.el('pager');
    if (!total) { pg.innerHTML = ''; pg.hidden = true; return; }
    pg.hidden = false;
    const to = Math.min(total, start + this.pageSize);
    let btns = '';
    if (pages > 1) {
      const from = Math.max(1, Math.min(this.page - 2, pages - 4)), upto = Math.min(pages, from + 4);
      btns += '<button type="button" data-p="' + (this.page - 1) + '" ' + (this.page <= 1 ? 'disabled' : '') + ' aria-label="الصفحة السابقة"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>';
      for (let p = from; p <= upto; p++) btns += '<button type="button" data-p="' + p + '" class="' + (p === this.page ? 'is-current' : '') + '"' + (p === this.page ? ' aria-current="page"' : '') + '>' + p + '</button>';
      btns += '<button type="button" data-p="' + (this.page + 1) + '" ' + (this.page >= pages ? 'disabled' : '') + ' aria-label="الصفحة التالية"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>';
    }
    pg.innerHTML = '<span>عرض ' + N(fInt(start + 1)) + ' إلى ' + N(fInt(to)) + ' من ' + N(fInt(total)) + '</span><div class="pages">' + btns + '</div>';
  }
}

/* جدول ثابت لتقرير الإدارة (بدون تفاعل) — نفس الخلايا ونفس الأعمدة */
function staticTable(cols, rows, summary, cls) {
  if (!rows.length) return '<div class="rp-empty">لا توجد بيانات في الفترة المحددة.</div>';
  const th = cols.map(c => '<th class="' + colClass(c) + '">' + esc(c.label) + '</th>').join('');
  const body = rows.map((r, i) => { const rr = Object.assign({ _rank: i + 1 }, r); return '<tr>' + cols.map(c => '<td class="' + colClass(c) + '">' + cellHTML(c, rr) + '</td>').join('') + '</tr>'; }).join('');
  const foot = summary ? '<tfoot><tr>' + cols.map(c => '<td class="' + colClass(c) + '">' + (summary[c.key] === undefined ? '' : cellHTML(c, summary)) + '</td>').join('') + '</tr></tfoot>' : '';
  return (rows.length <= 16 ? '<div class="rp-keep">' : '') + '<table class="rp-table ' + (cls || '') + '"><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody>' + foot + '</table>' + (rows.length <= 16 ? '</div>' : '');
}

/* ---------- Charts (Chart.js مضبوط على هوية ARRIVE وعلى الـ RTL) ---------- */
let P = {};   // palette من الـ tokens (مصدر واحد)
function initPalette() {
  P = {
    blue: cssVar('--chart-1'), teal: cssVar('--chart-highlight'), navy: cssVar('--chart-3'), g400: cssVar('--chart-4'), g300: cssVar('--chart-5'),
    grid: cssVar('--chart-grid'), axis: cssVar('--chart-axis'), label: cssVar('--chart-label'), target: cssVar('--chart-target'),
    success: cssVar('--status-success'), amber: cssVar('--status-under-action'), red: cssVar('--status-violation'), text: cssVar('--text-primary')
  };
  Chart.defaults.font.family = "Cairo, Inter, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = P.label;
}
const ValueLabels = {
  id: 'valueLabels', defaults: { display: false, suffix: '', last: false },
  afterDatasetsDraw(chart, _a, o) {
    if (!o || !o.display) return;
    const ctx = chart.ctx, horiz = chart.options.indexAxis === 'y', isLine = chart.config.type === 'line';
    ctx.save(); ctx.font = '600 11px Inter, Cairo, sans-serif'; ctx.fillStyle = P.text;
    chart.data.datasets.forEach((ds, di) => {
      if (!chart.isDatasetVisible(di)) return;
      const meta = chart.getDatasetMeta(di);
      meta.data.forEach((el, i) => {
        const v = ds.data[i]; if (v === null || v === undefined) return;
        const txt = (Number.isInteger(v) ? fInt(v) : Number(v).toFixed(1)) + (o.suffix || '');
        if (isLine) { if (o.last && i === meta.data.length - 1) { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(txt, el.x, el.y - 8); } return; }
        if (horiz) { const rev = chart.scales.x && chart.scales.x.options.reverse; ctx.textBaseline = 'middle'; ctx.textAlign = rev ? 'right' : 'left'; ctx.fillText(txt, el.x + (rev ? -6 : 6), el.y); }
        else { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(txt, el.x, el.y - 5); }
      });
    });
    ctx.restore();
  }
};
const TargetLine = {
  id: 'targetLine', defaults: { value: null },
  afterDraw(chart, _a, o) {
    if (!o || o.value === null || o.value === undefined) return;
    const y = chart.scales.y, a = chart.chartArea; if (!y) return;
    const py = y.getPixelForValue(o.value), ctx = chart.ctx;
    ctx.save(); ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = P.target;
    ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = P.target; ctx.font = '700 11px Cairo, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(o.label || '', a.left + 4, py - 4); ctx.restore();
  }
};
const CenterText = {
  id: 'centerText', defaults: { value: '', label: '' },
  afterDraw(chart, _a, o) {
    if (!o || o.value === '') return;
    const a = chart.chartArea, cx = (a.left + a.right) / 2, cy = (a.top + a.bottom) / 2, ctx = chart.ctx;
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = P.navy; ctx.font = '700 26px Inter, Cairo, sans-serif'; ctx.fillText(o.value, cx, cy - 8);
    ctx.fillStyle = P.label; ctx.font = '600 12px Cairo, sans-serif'; ctx.fillText(o.label, cx, cy + 14); ctx.restore();
  }
};

let chartInstances = {};
function destroyChart(id) { if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; } }
function tooltipOpts(extra) {
  return Object.assign({
    rtl: true, textDirection: 'rtl', titleAlign: 'right', bodyAlign: 'right', backgroundColor: P.navy, padding: 10, cornerRadius: 6, boxPadding: 4,
    titleFont: { family: 'Cairo, Inter', weight: '700', size: 12 }, bodyFont: { family: 'Cairo, Inter', size: 12 },
    callbacks: {
      label(c) {
        const v = typeof c.parsed === 'number' ? c.parsed : (c.chart.options.indexAxis === 'y' ? c.parsed.x : c.parsed.y);
        return ' ' + (c.dataset.label ? c.dataset.label + ': ' : '') + (Number.isInteger(v) ? fInt(v) : Number(v).toFixed(1)) + (c.dataset.suffix || '');
      }
    }
  }, extra || {});
}
function shortLabel(l, n) { l = String(l); return l.length > n ? l.slice(0, n - 1) + '…' : l; }

// حاوية الرسم: نعرض Empty State بدل الرسم الفارغ
function chartHost(id) { const cv = $(id); return cv ? cv.parentElement : null; }
function toggleEmpty(id, empty) {
  const h = chartHost(id); if (!h) return;
  const cv = $(id); let e = h.querySelector('.ar-empty');
  if (empty) {
    if (!e) { h.insertAdjacentHTML('beforeend', emptyHTML()); e = h.querySelector('.ar-empty'); }
    e.hidden = false; cv.hidden = true; destroyChart(id);
  } else { if (e) e.hidden = true; cv.hidden = false; }
}
function topNote(noteId, shown, total) {
  const n = $(noteId); if (!n) return;
  if (total > shown) { n.hidden = false; n.innerHTML = '<i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>يعرض الرسم أعلى ' + N(shown) + ' من ' + N(fInt(total)) + ' — القائمة الكاملة في الجدول.</span>'; }
  else n.hidden = true;
}

/**
 * Bar: الفئات تُرتَّب من اليمين إلى اليسار (الأهم على اليمين) — قاعدة الـ RTL في الـ Design System.
 * أعلى قيمة تُظلَّل بلون التيل (إبراز واحد فقط).
 */
function bar(id, labels, data, o) {
  o = o || {};
  destroyChart(id);
  const empty = !data.length;
  toggleEmpty(id, empty);
  if (empty) return;
  const el = $(id), horiz = !!o.horizontal;
  if (horiz) chartHost(id).style.height = Math.max(150, labels.length * 30 + 44) + 'px';
  const hl = o.highlight === false ? -1 : data.indexOf(Math.max.apply(null, data));
  const colors = data.map((_, i) => i === hl ? P.teal : P.blue);
  const grid = { color: P.grid, drawTicks: false }, noGrid = { display: false };
  const catTicks = { autoSkip: false, maxRotation: horiz ? 0 : 40, minRotation: 0, color: P.label, callback(v) { return shortLabel(this.getLabelForValue(v), horiz ? 22 : 14); } };
  const valTicks = { precision: 0, color: P.label, font: { family: 'Inter, Cairo', size: 11 } };
  const scales = horiz
    ? { x: { reverse: true, beginAtZero: true, grace: '14%', grid, border: { display: false }, ticks: valTicks },
        y: { position: 'right', grid: noGrid, border: { color: P.axis }, ticks: catTicks } }
    : { x: { reverse: true, grid: noGrid, border: { color: P.axis }, ticks: catTicks },
        y: { position: 'right', beginAtZero: true, grace: o.max ? 0 : '12%', max: o.max, grid, border: { display: false }, ticks: valTicks } };
  chartInstances[id] = new Chart(el, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4, maxBarThickness: horiz ? 20 : 34, borderSkipped: false, suffix: o.suffix || '' }] },
    options: {
      indexAxis: horiz ? 'y' : 'x', responsive: true, maintainAspectRatio: false, animation: o.animate === false ? false : { duration: 350 },
      layout: { padding: { top: 20, left: 6, right: 2 } },
      plugins: { legend: { display: false }, tooltip: tooltipOpts(), valueLabels: { display: true, suffix: o.suffix || '' }, targetLine: o.target || { value: null } },
      scales
    }
  });
}
function groupedBar(id, labels, d1, d2, l1, l2) {
  destroyChart(id);
  const empty = !labels.length; toggleEmpty(id, empty); if (empty) return;
  chartInstances[id] = new Chart($(id), {
    type: 'bar',
    data: { labels, datasets: [
      { label: l1, data: d1, backgroundColor: P.g300, borderRadius: 4, maxBarThickness: 26 },
      { label: l2, data: d2, backgroundColor: P.blue, borderRadius: 4, maxBarThickness: 26 } ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 350 }, layout: { padding: { top: 20 } },
      plugins: { legend: { position: 'bottom', rtl: true, labels: { boxWidth: 10, boxHeight: 10, padding: 14, font: { family: 'Cairo, Inter', size: 12 } } }, tooltip: tooltipOpts(), valueLabels: { display: true } },
      scales: {
        x: { reverse: true, grid: { display: false }, border: { color: P.axis }, ticks: { autoSkip: false, maxRotation: 40, callback(v) { return shortLabel(this.getLabelForValue(v), 14); } } },
        y: { position: 'right', beginAtZero: true, grace: '12%', grid: { color: P.grid, drawTicks: false }, border: { display: false }, ticks: { precision: 0, font: { family: 'Inter, Cairo', size: 11 } } }
      }
    }
  });
}
/** Line: السلاسل الزمنية استثناء موثّق — الزمن من اليسار (الأقدم) إلى اليمين (الأحدث) وتُوسَم آخر قيمة. */
function line(id, labels, data, o) {
  o = o || {};
  destroyChart(id);
  const empty = !data.length; toggleEmpty(id, empty); if (empty) return;
  chartInstances[id] = new Chart($(id), {
    type: 'line',
    data: { labels, datasets: [{ label: o.label || 'عدد المشاكل', data, borderColor: P.blue, backgroundColor: hexA(P.blue, .08), fill: true, tension: .3, borderWidth: 2, pointRadius: data.length > 40 ? 0 : 3, pointHoverRadius: 5, pointBackgroundColor: P.blue }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: o.animate === false ? false : { duration: 350 }, interaction: { mode: 'index', intersect: false }, layout: { padding: { top: 22, right: 14 } },
      plugins: { legend: { display: false }, tooltip: tooltipOpts(), valueLabels: { display: true, last: true } },
      scales: {
        x: { grid: { display: false }, border: { color: P.axis }, ticks: { maxTicksLimit: 10, maxRotation: 0, font: { family: 'Inter, Cairo', size: 11 } } },
        y: { beginAtZero: true, grace: '12%', grid: { color: P.grid, drawTicks: false }, border: { display: false }, ticks: { precision: 0, font: { family: 'Inter, Cairo', size: 11 } } }
      }
    }
  });
}
/** Donut لتوزيع الحالات (السلسلة هي حالة ← تُستخدم ألوان الحالات) + legend HTML بالأرقام والنسب (لا اعتماد على اللون وحده). */
function renderStatusDonut(hostId, k, canvasId) {
  const host = $(hostId); if (!host) return;
  const items = [
    { key: 'SOLVED', n: k.solved, color: P.success }, { key: 'FOLLOWUP', n: k.followup, color: P.amber }, { key: 'OPEN', n: k.open, color: P.red }
  ];
  const sum = items.reduce((s, i) => s + i.n, 0);
  destroyChart(canvasId);
  if (!k.total || !sum) { host.innerHTML = emptyHTML(); return; }
  host.innerHTML = '<div class="ar-donut"><div class="cv"><canvas id="' + canvasId + '"></canvas></div><ul class="ar-legend">' +
    items.map(i => '<li><span class="sw" style="background:' + i.color + '"></span><span class="t">' + BUCKET[i.key].label + '</span><span class="v">' + fInt(i.n) + '</span><span class="p">' + fPct(pctOf(i.n, k.total)) + '</span></li>').join('') + '</ul></div>';
  chartInstances[canvasId] = new Chart($(canvasId), {
    type: 'doughnut',
    data: { labels: items.map(i => BUCKET[i.key].label), datasets: [{ data: items.map(i => i.n), backgroundColor: items.map(i => i.color), borderWidth: 2, borderColor: '#fff' }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '70%', animation: { duration: 350 },
      plugins: { legend: { display: false }, centerText: { value: fInt(k.total), label: 'إجمالي' },
        tooltip: tooltipOpts({ callbacks: { label(c) { return ' ' + c.label + ': ' + fInt(c.parsed) + ' (' + fPct(pctOf(c.parsed, k.total)) + ')'; } } }) }
    }
  });
}

/* ================================================================== */
/* D) STATE + PAGES                                                    */
/* ================================================================== */
const state = { data: null, applied: {}, bundle: null, bundleFilters: null };
let grids = {};

const PAGES = {
  'page-home':      { title: 'الملخص التنفيذي' },
  'page-dashboard': { title: 'لوحة المتابعة' },
  'page-branches':  { title: 'أداء الفروع' },
  'page-employees': { title: 'أداء الموظفين' },
  'page-open':      { title: 'الحالات المفتوحة' },
  'page-reports':   { title: 'التقارير' }
};
function goToPage(pageId) {
  document.querySelectorAll('.ar-nav-item').forEach(t => { const on = t.dataset.page === pageId; t.classList.toggle('is-active', on); if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('is-active', p.id === pageId));
  setText('headerTitle', (PAGES[pageId] || {}).title || '');
  closeSidebar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function openSidebar() { $('sidebar').classList.add('is-open'); $('scrim').classList.add('is-open'); }
function closeSidebar() { $('sidebar').classList.remove('is-open'); $('scrim').classList.remove('is-open'); }

/* ---------- Connection status ---------- */
function setLoading(on) {
  document.body.classList.toggle('is-loading', !!on);
  const pill = $('statusPill');
  if (on) { pill.className = 'ar-sync is-loading'; $('statusIcon').className = 'fa-solid fa-rotate'; setText('systemStatus', 'جارٍ التحميل…'); }
}
function setConnected(ok, message) {
  const pill = $('statusPill');
  pill.className = 'ar-sync' + (ok ? '' : ' is-error');
  $('statusIcon').className = 'fa-solid ' + (ok ? 'fa-circle-check' : 'fa-circle-exclamation');
  setText('systemStatus', message && ok ? message : (ok ? 'البيانات محدثة' : 'خطأ في الاتصال'));
  const host = $('alertHost');
  if (ok) { host.innerHTML = ''; return; }
  host.innerHTML = alertHTML('violation', 'تعذّر تحديث البيانات',
    esc(message || 'تعذّر الاتصال') + (HAS_GAS_RUN ? '' : ' — الرابط الحالي: <bdi dir="ltr" class="num">' + esc(currentApiUrl) + '</bdi>'),
    '<button class="ar-btn sm ar-btn-secondary" type="button" data-act="retry"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>إعادة المحاولة</button>' +
    (HAS_GAS_RUN ? '' : '<button class="ar-btn sm ar-btn-ghost" type="button" data-act="settings"><i class="fa-solid fa-gear" aria-hidden="true"></i>إعدادات الاتصال</button>'));
}

/* ---------- Settings modal ---------- */
function openSettings() { $('apiUrlInput').value = currentApiUrl; $('settingsModal').classList.add('is-open'); $('apiUrlInput').focus(); }
function closeSettings() { $('settingsModal').classList.remove('is-open'); }

/* ---------- Load ---------- */
async function loadAll() {
  setLoading(true);
  try {
    const data = await apiCall('fullAppData', getCurrentFilters());
    state.applied = getCurrentFilters();
    onFullAppData(data);
    setConnected(true);
  } catch (err) {
    console.error(err);
    setConnected(false, err.message);
  } finally { setLoading(false); }
}

function onFullAppData(data) {
  state.data = data;
  lastDaily = data.dailyTrend || [];
  setText('tsDashboard', fStamp());
  populateFilterDropdowns(data.filterOptions);
  populateMonthSelects(data.filterOptions.availableMonths);
  renderChips();
  renderKPIs(data);
  renderHome(data);
  renderDashboardCharts(data);
  renderBranchPage(data.byBranch);
  renderEmployeePage(data.byEmployee, data.kpis);
  renderOpenCases(data.openCases);
  checkReportStale();
}

/* ---------- Filters ---------- */
const FILTER_LABELS = { dateFrom: 'من تاريخ', dateTo: 'إلى تاريخ', branch: 'الفرع', employee: 'الموظفة', account: 'Account', driver: 'المندوب', problemType: 'نوع المشكلة', statusBucket: 'الحالة' };
const FILTER_INPUT = { dateFrom: 'filterDateFrom', dateTo: 'filterDateTo', branch: 'filterBranch', employee: 'filterEmployee', account: 'filterAccount', driver: 'filterDriver', problemType: 'filterProblemType', statusBucket: 'filterStatus' };
function populateFilterDropdowns(opts) {
  populateSelect('filterBranch', opts.branches, 'كل الفروع');
  populateSelect('filterEmployee', opts.employees, 'الكل');
  populateSelect('filterAccount', opts.accounts, 'كل الـ Accounts');
  populateSelect('filterProblemType', opts.problemTypes, 'الكل');
  populateSelect('filterDriver', opts.drivers, 'الكل');
  $('driverFilterGroup').hidden = !opts.hasDrivers;
}
function populateSelect(id, values, allLabel) {
  const el = $(id), current = el.value;
  el.innerHTML = '<option value="">' + allLabel + '</option>' + values.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
  if (values.indexOf(current) !== -1) el.value = current;
}
function populateMonthSelects(months) {
  ['branchM1', 'branchM2', 'employeeM1', 'employeeM2'].forEach(id => {
    const el = $(id); if (!el) return;
    const current = el.value;
    el.innerHTML = months.map(m => '<option value="' + m + '">' + m + '</option>').join('');
    if (months.indexOf(current) !== -1) el.value = current;
    else if (months.length) { const isSecond = id.endsWith('M2'); el.value = isSecond ? months[months.length - 1] : months[Math.max(0, months.length - 2)]; }
  });
}
function renderChips() {
  const f = state.applied, keys = Object.keys(FILTER_LABELS).filter(k => f[k]);
  const cnt = $('filterCount'); cnt.hidden = !keys.length; cnt.textContent = keys.length;
  $('activeChips').innerHTML = keys.length ? keys.map(k => {
    const v = k === 'statusBucket' ? (BUCKET[f[k]] || {}).label || f[k] : f[k];
    return '<span class="ar-chip"><b>' + FILTER_LABELS[k] + ':</b> ' + (/^\d{4}-\d{2}-\d{2}$/.test(v) ? N(esc(v)) : esc(v)) + '<button type="button" data-clear="' + k + '" aria-label="إزالة فلتر ' + FILTER_LABELS[k] + '"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></span>';
  }).join('') : '<span class="muted" style="font-size:12px">لا توجد فلاتر مفعّلة — تُعرض كل البيانات</span>';
}

/* ---------- KPIs ---------- */
function renderKPIs(data) {
  const k = data.kpis, f = state.applied, S = kpiSet(k, f);
  setHTML('homeKpis', [S.total, S.rate, S.open, S.followup].map(kpiHTML).join(''));
  setHTML('dashKpis', [S.total, S.solved, S.followup, S.open, S.rate, S.branches, S.employees, S.accounts].map(kpiHTML).join(''));
  const meta = '<span><i class="fa-solid fa-calendar-days" aria-hidden="true"></i> الفترة: ' + periodText(periodOf(lastDaily, f)) + '</span><span><i class="fa-solid fa-database" aria-hidden="true"></i> عدد السجلات: ' + N(fInt(k.total)) + '</span>';
  setHTML('homeMeta', meta); setHTML('dashMeta', meta);
}

/* ---------- الملخص التنفيذي ---------- */
function bestByRate(list) {   // نفس قاعدة bestBySolutionRate_ في Backend.gs
  const c = (list || []).filter(r => r.total > 0);
  if (!c.length) return null;
  return c.slice().sort((a, b) => (b.resolutionRatePct - a.resolutionRatePct) || (b.total - a.total))[0];
}
function tagList(list, valFn) {
  return list.map(b => '<span class="tg">' + esc(b.name) + '<span class="num">' + valFn(b) + '</span></span>').join('');
}
function attentionRows(k, byBranch) {
  const top = (key) => byBranch.filter(b => b[key] > 0).slice().sort((a, b) => b[key] - a[key]).slice(0, 3);
  const row = (cls, icon, title, n, key) => {
    const t = top(key);
    return '<div class="ar-attn-row ' + cls + '"><div class="ic"><i class="fa-solid fa-' + icon + '" aria-hidden="true"></i></div><div class="bd"><div class="hd"><b>' + title + '</b><span class="big">' + fInt(n) + '</span><span class="pc">(' + fPct(pctOf(n, k.total)) + ' من الإجمالي)</span></div>' +
      '<div class="ls">' + (t.length ? 'أكثر الفروع: ' + tagList(t, b => fInt(b[key])) : 'لا توجد حالات في هذه الفئة.') + '</div></div></div>';
  };
  const low = byBranch.filter(b => b.total > 0 && b.resolutionRatePct < ATTENTION_PCT).slice().sort((a, b) => a.resolutionRatePct - b.resolutionRatePct);
  const lowRow = low.length
    ? '<div class="ar-attn-row under-action"><div class="ic"><i class="fa-solid fa-building-circle-exclamation" aria-hidden="true"></i></div><div class="bd"><div class="hd"><b>فروع نسبة الحل فيها أقل من ' + ATTENTION_PCT + '%</b><span class="big">' + fInt(low.length) + '</span><span class="pc">من ' + fInt(byBranch.length) + ' فرع</span></div><div class="ls">' + tagList(low.slice(0, 6), b => fPct(b.resolutionRatePct)) + (low.length > 6 ? '<span class="muted">+' + (low.length - 6) + ' أخرى</span>' : '') + '</div></div></div>'
    : '<div class="ar-attn-row success"><div class="ic"><i class="fa-solid fa-building-circle-check" aria-hidden="true"></i></div><div class="bd"><div class="hd"><b>لا توجد فروع نسبة الحل فيها أقل من ' + ATTENTION_PCT + '%</b></div></div></div>';
  return row('violation', STATUS_ICON.violation, 'حرج · لم يتم الحل', k.open, 'open') +
         row('under-action', STATUS_ICON['under-action'], 'يحتاج متابعة · قيد المتابعة', k.followup, 'followup') +
         row('success', STATUS_ICON.success, 'تحت السيطرة · تم الحل', k.solved, 'solved') + lowRow;
}
function highlightItems(d) {
  const bb = bestByRate(d.byBranch), be = bestByRate(d.byEmployee);
  const cnt = (o) => o ? esc(o.name) + '<span class="num">' + fInt(o.total) + ' حالة</span>' : '—';
  const rate = (o) => o ? esc(o.name) + '<span class="num">' + fPct(o.resolutionRatePct) + ' · ' + fInt(o.total) + ' حالة</span>' : '—';
  return [
    ['building', 'أكثر فرع به مشاكل', cnt(d.byBranch[0])],
    ['triangle-exclamation', 'أكثر نوع مشكلة', cnt(d.byProblemType[0])],
    ['briefcase', 'أكثر Account به مشاكل', cnt(d.byAccount[0])],
    ['user-clock', 'الأعلى نشاطًا (موظفة)', cnt(d.byEmployee[0])],
    ['trophy', 'أفضل فرع في نسبة الحل', rate(bb)],
    ['award', 'أفضل موظفة في نسبة الحل', rate(be)]
  ];
}
function dataQualityAlert(k) {
  const items = [];
  if (k.invalidDateRowCount > 0) items.push(N(fInt(k.invalidDateRowCount)) + ' سجل بتاريخ غير صالح في Master Data (إجمالي الورقة وليس بعد الفلاتر) — يُستبعد من الاتجاه اليومي والمقارنة الشهرية وأي فلتر تاريخ.');
  if (k.unknownStatus > 0) items.push(N(fInt(k.unknownStatus)) + ' سجل بقيمة حالة غير مصنفة — يُحتسب في الإجمالي ولا يدخل في فئات الحل الثلاث.');
  return items.length ? alertHTML('warning', 'ملاحظات على جودة البيانات', '<ul style="margin:4px 0 0;padding-inline-start:18px">' + items.map(i => '<li>' + i + '</li>').join('') + '</ul>') : '';
}
function renderHome(d) {
  const k = d.kpis;
  setHTML('dataQualityHost', dataQualityAlert(k));
  setHTML('attentionHost', k.total ? attentionRows(k, d.byBranch) : emptyHTML());
  renderStatusDonut('homeDonutHost', k, 'chHomeDonut');
  setHTML('highlightsHost', k.total ? highlightItems(d).map(h => '<div class="it"><div class="ic"><i class="fa-solid fa-' + h[0] + '" aria-hidden="true"></i></div><div><div class="q">' + h[1] + '</div><div class="a">' + h[2] + '</div></div></div>').join('') : emptyHTML());
  line('chHomeDaily', d.dailyTrend.map(x => x.date), d.dailyTrend.map(x => x.total));
}

/* ---------- لوحة المتابعة ---------- */
function topSlice(arr, n) { return arr.slice(0, n); }
function renderDashboardCharts(d) {
  const b = topSlice(d.byBranch, TOP_N), e = topSlice(d.byEmployee, TOP_N), a = topSlice(d.byAccount, TOP_N), t = topSlice(d.byProblemType, TOP_N);
  bar('chBranch', b.map(x => x.name), b.map(x => x.total)); topNote('noteBranch', b.length, d.byBranch.length);
  bar('chEmployee', e.map(x => x.name), e.map(x => x.total), { horizontal: true }); topNote('noteEmployee', e.length, d.byEmployee.length);
  bar('chAccount', a.map(x => x.name), a.map(x => x.total), { horizontal: true }); topNote('noteAccount', a.length, d.byAccount.length);
  bar('chType', t.map(x => x.name), t.map(x => x.total), { horizontal: true }); topNote('noteType', t.length, d.byProblemType.length);
  renderStatusDonut('dashDonutHost', d.kpis, 'chDashDonut');
  line('chDaily', d.dailyTrend.map(x => x.date), d.dailyTrend.map(x => x.total));
}

/* ---------- أداء الفروع / الموظفين ---------- */
const sumRows = (rows, key) => rows.reduce((s, r) => s + (r[key] || 0), 0);
function summaryFor(label) {
  return rows => { const t = sumRows(rows, 'total'), s = sumRows(rows, 'solved'); return { name: label, total: t, solved: s, followup: sumRows(rows, 'followup'), open: sumRows(rows, 'open'), resolutionRatePct: pctOf(s, t) }; };
}
const perfCols = (nameLabel, totalLabel) => [
  { key: 'rank', type: 'rank', label: '#' },
  { key: 'name', type: 'name', label: nameLabel },
  { key: 'total', type: 'int', label: totalLabel },
  { key: 'solved', type: 'int', label: 'تم الحل' },
  { key: 'followup', type: 'int', label: 'قيد المتابعة' },
  { key: 'open', type: 'int', label: 'لم يتم الحل' },
  { key: 'resolutionRatePct', type: 'rate', label: 'نسبة الحل' }
];
function renderBranchPage(byBranch) {
  grids.branch.setRows(byBranch);
  const rates = byBranch.slice().sort((a, b) => b.resolutionRatePct - a.resolutionRatePct).slice(0, TOP_N);
  bar('chBranchRes', rates.map(b => b.name), rates.map(b => b.resolutionRatePct), { suffix: '%', max: 100, highlight: false, target: { value: ATTENTION_PCT, label: 'حد المتابعة ' + ATTENTION_PCT + '%' } });
  topNote('noteBranchRes', rates.length, byBranch.length);
}
function renderEmployeePage(byEmployee, kpis) {
  grids.employee.setRows(byEmployee);
  setHTML('topEmployeeLabel', byEmployee.length ? esc(byEmployee[0].name) + ' — ' + N(fInt(byEmployee[0].total)) + ' حالة' : '—');
  const avg = byEmployee.length ? Math.round((kpis.total / byEmployee.length) * 10) / 10 : 0;
  setHTML('avgPerEmployeeLabel', N(avg.toLocaleString('en-US')) + ' حالة');
  const w = topSlice(byEmployee, TOP_N);
  bar('chEmployeeWorkload', w.map(e => e.name), w.map(e => e.total), { horizontal: true });
  topNote('noteWorkload', w.length, byEmployee.length);
}

/* ---------- المقارنة بين شهرين (نفس الاستدعاءات) ---------- */
function deltaBadge(changePct) {
  if (changePct === null || changePct === undefined) return badge('closed', 'لا يوجد أساس للمقارنة', true, 'minus');
  if (changePct > 3) return badge('success', 'تحسّن', true, 'arrow-up');
  if (changePct < -3) return badge('violation', 'انخفاض', true, 'arrow-down');
  return badge('closed', 'ثابت', true, 'minus');
}
function compareCols(res, nameLabel) {
  return [
    { key: 'name', type: 'name', label: nameLabel },
    { key: 'totalA', type: 'int', label: 'حالات ' + res.monthA },
    { key: 'solvedA', type: 'int', label: 'تم حلها ' + res.monthA },
    { key: 'totalB', type: 'int', label: 'حالات ' + res.monthB },
    { key: 'solvedB', type: 'int', label: 'تم حلها ' + res.monthB },
    { key: 'diff', type: 'int', label: 'الفرق', render: r => N(fDeltaInt(r.diff)) },
    { key: 'changePct', type: 'pct', label: 'نسبة تغيّر نسبة الحل', render: r => r.changePct === null ? '—' : N(fDeltaPct(r.changePct)) },
    { key: 'delta', type: 'text', label: 'الحالة', sort: r => r.changePct === null ? null : r.changePct, render: r => deltaBadge(r.changePct) }
  ];
}
async function branchCompare() {
  const m1 = val('branchM1'), m2 = val('branchM2');
  if (!m1 || !m2) { setHTML('branchCompareMsg', alertHTML('info', 'لا توجد بيانات مؤرخة كافية', 'لا يوجد شهران على الأقل لإجراء المقارنة بعد.')); return; }
  setHTML('branchCompareMsg', '');
  const btn = $('branchCompareBtn'); btn.disabled = true; btn.classList.add('is-busy');
  try { onBranchCompare(await apiCall('monthComparison', Object.assign({ field: 'branch', monthA: m1, monthB: m2 }, getCurrentFilters()))); }
  catch (err) { setConnected(false, err.message); }
  finally { btn.disabled = false; btn.classList.remove('is-busy'); }
}
function onBranchCompare(res) {
  setHTML('branchCompM1Total', N(fInt(res.summary.totalA)));
  setHTML('branchCompM2Total', N(fInt(res.summary.totalB)));
  setHTML('branchCompDiff', N(fDeltaInt(res.summary.diff)));
  setHTML('branchCompChangePct', res.summary.changePct === null ? '—' : N(fDeltaPct(res.summary.changePct)));
  const top6 = res.rows.slice(0, 6);
  groupedBar('chBranchCompare', top6.map(r => r.name), top6.map(r => r.totalA), top6.map(r => r.totalB), res.monthA, res.monthB);
  if (!grids.branchCompare || grids.branchCompare._cols !== 'branch' + res.monthA + res.monthB) {
    grids.branchCompare = new DataGrid('branchCompareTableHost', { title: 'مقارنة الفروع بين الشهرين', columns: compareCols(res, 'الفرع'), pageSize: 10, searchPlaceholder: 'ابحث باسم الفرع…' });
    grids.branchCompare._cols = 'branch' + res.monthA + res.monthB;
  }
  grids.branchCompare.setRows(res.rows);
}
async function employeeCompare() {
  const m1 = val('employeeM1'), m2 = val('employeeM2');
  if (!m1 || !m2) { setHTML('employeeCompareMsg', alertHTML('info', 'لا توجد بيانات مؤرخة كافية', 'لا يوجد شهران على الأقل لإجراء المقارنة بعد.')); return; }
  setHTML('employeeCompareMsg', '');
  const btn = $('employeeCompareBtn'); btn.disabled = true; btn.classList.add('is-busy');
  try { onEmployeeCompare(await apiCall('monthComparison', Object.assign({ field: 'employee', monthA: m1, monthB: m2 }, getCurrentFilters()))); }
  catch (err) { setConnected(false, err.message); }
  finally { btn.disabled = false; btn.classList.remove('is-busy'); }
}
function onEmployeeCompare(res) {
  if (!grids.employeeCompare || grids.employeeCompare._cols !== 'emp' + res.monthA + res.monthB) {
    grids.employeeCompare = new DataGrid('employeeCompareTableHost', { title: 'مقارنة الموظفين بين الشهرين', columns: compareCols(res, 'الموظفة'), pageSize: 10, searchPlaceholder: 'ابحث باسم الموظفة…' });
    grids.employeeCompare._cols = 'emp' + res.monthA + res.monthB;
  }
  grids.employeeCompare.setRows(res.rows);
  const top6 = res.rows.slice(0, 6);
  groupedBar('chEmployeeCompare', top6.map(r => r.name), top6.map(r => r.totalA), top6.map(r => r.totalB), res.monthA, res.monthB);
}

/* ---------- الحالات المفتوحة ---------- */
function renderOpenCases(cases) {
  grids.open.setRows(cases || []);
  const n = (cases || []).length;
  const b = $('navOpenBadge'); b.hidden = !n; b.textContent = n > 999 ? '999+' : n;
}

/* ================================================================== */
/* E) تقرير الإدارة — معاينة A4 + طباعة                                */
/* ================================================================== */
function deriveFindings(b) {
  const k = b.kpis, out = [];
  if (k.open > 0) out.push({ title: 'حالات لم يتم حلها', evidence: N(fInt(k.open)) + ' حالة بحالة «لم يتم الحل» من أصل ' + N(fInt(k.total)) + ' (' + N(fPct(pctOf(k.open, k.total))) + ').', impact: N(fInt(k.open)) + ' حالة ما زالت مفتوحة دون حل ضمن الفترة.' });
  if (k.followup > 0) out.push({ title: 'حالات قيد المتابعة', evidence: N(fInt(k.followup)) + ' حالة قيد المتابعة (' + N(fPct(pctOf(k.followup, k.total))) + ' من الإجمالي).', impact: 'تحتاج متابعة حتى الإغلاق؛ تُحتسب ضمن الحالات المفتوحة في صفحة الحالات المفتوحة.' });
  const low = b.byBranch.filter(x => x.total > 0 && x.resolutionRatePct < ATTENTION_PCT).slice().sort((a, c) => a.resolutionRatePct - c.resolutionRatePct);
  if (low.length) {
    const pending = low.reduce((s, x) => s + x.followup + x.open, 0);
    out.push({ title: 'فروع نسبة الحل فيها أقل من ' + ATTENTION_PCT + '%', evidence: low.map(x => esc(x.name) + ' (' + N(fPct(x.resolutionRatePct)) + ' — ' + N(fInt(x.solved)) + ' من ' + N(fInt(x.total)) + ')').join('، ') + '.', impact: 'إجمالي الحالات غير المحلولة (قيد المتابعة + لم يتم الحل) في هذه الفروع: ' + N(fInt(pending)) + ' حالة.' });
  }
  if (k.unknownStatus > 0) out.push({ title: 'حالات بقيمة حالة غير مصنفة', evidence: N(fInt(k.unknownStatus)) + ' سجل بقيمة حالة غير مدرجة في فئات تم الحل / قيد المتابعة / لم يتم الحل.', impact: 'تُحتسب في الإجمالي ولا تدخل في أي فئة، فلا يكتمل مجموع الفئات الثلاث.' });
  if (k.invalidDateRowCount > 0) out.push({ title: 'سجلات بتاريخ غير صالح', evidence: N(fInt(k.invalidDateRowCount)) + ' سجل في Master Data (إجمالي الورقة وليس بعد الفلاتر).', impact: 'تُستبعد من الاتجاه اليومي والمقارنة الشهرية وأي فلتر تاريخ.' });
  return out;
}
const missingHTML = '<span class="rp-missing">' + MISSING + '</span>';
function rpHead(no, title) { return '<div class="rp-section-head"><span class="no">' + no + '</span><h2>' + title + '</h2><span class="rule"></span></div>'; }

function buildReportDoc(b, f) {
  const k = b.kpis, p = b.reportPeriod || { from: '', to: '' }, today = fDay();
  const periodHtml = (p.from || p.to) ? 'من ' + N(esc(p.from || '—')) + ' إلى ' + N(esc(p.to || '—')) : MISSING;
  const lab = v => v ? esc(v) : 'الكل';
  const flt = [['الفرع', lab(f.branch)], ['الموظفة', lab(f.employee)], ['Account', lab(f.account)], ['المندوب', lab(f.driver)], ['نوع المشكلة', lab(f.problemType)], ['حالة الشحنة', f.statusBucket ? esc((BUCKET[f.statusBucket] || {}).label || f.statusBucket) : 'الكل']];
  const logo = LOGO_URI ? '<img src="' + LOGO_URI + '" alt="ARRIVE">' : '<b>ARRIVE</b>';

  const cover = '<section class="rp-cover"><div class="logo">' + logo + '</div><div class="sys">نظام متابعة Fleet Support</div>' +
    '<div class="mid"><div class="kicker">تقرير الإدارة</div><h1>متابعة المشاكل وأداء الفروع<br><em>Fleet Support</em></h1><div class="period">الفترة: ' + periodHtml + '</div></div>' +
    '<div class="meta"><div><div class="k">القسم</div><div class="v">Fleet Support</div></div><div><div class="k">تاريخ إصدار التقرير</div><div class="v">' + N(today) + '</div></div>' +
    '<div><div class="k">أُعدّ بواسطة</div><div class="v">لوحة متابعة Fleet Support</div></div><div><div class="k">عدد السجلات في التقرير</div><div class="v">' + N(fInt(k.total)) + '</div></div></div></section>';

  const runHead = '<div class="rp-run-head"><span class="lg">' + (LOGO_URI ? '<img src="' + LOGO_URI + '" alt="ARRIVE">' : '<b style="color:#fff">ARRIVE</b>') + '</span><b>تقرير الإدارة — Fleet Support</b><span class="sp"></span><span>' + periodHtml + '</span></div>';
  const runFoot = '<div class="rp-run-foot"><span>ARRIVE — نظام متابعة Fleet Support</span><span class="sp"></span><span>أُصدر في ' + N(fStamp()) + '</span></div>';

  let body = '';
  const S = kpiSet(k, f, true);
  const findings = deriveFindings(b);

  /* 01 الملخص التنفيذي */
  const low = b.byBranch.filter(x => x.total > 0 && x.resolutionRatePct < ATTENTION_PCT);
  body += '<section class="rp-section">' + rpHead('01', 'الملخص التنفيذي');
  body += '<div class="rp-scope">' + flt.map(x => '<div><span class="k">' + x[0] + '</span><span class="v">' + x[1] + '</span></div>').join('') + '</div>';
  if (!k.total) {
    body += '<div class="rp-empty">' + EMPTY_TEXT + '</div></section>';
  } else {
    body += '<div class="rp-callout">خلال الفترة ' + periodHtml + ' سُجّلت ' + N(fInt(k.total)) + ' حالة، تم حل ' + N(fInt(k.solved)) + ' منها بنسبة ' + N(fPct(k.resolutionRatePct)) + '. ' +
      'يوجد ' + N(fInt(k.open)) + ' حالة لم يتم حلها و' + N(fInt(k.followup)) + ' قيد المتابعة، و' + N(fInt(low.length)) + ' فرع نسبة الحل فيه أقل من ' + ATTENTION_PCT + '%.</div>';
    body += '<div class="rp-kpis">' + [S.total, S.rate, S.open, S.followup].map(kpiHTML).join('') + '</div>';
    body += '<div class="rp-kpis">' + [S.solved, S.branches, S.employees, S.accounts].map(kpiHTML).join('') + '</div>';
    const hl = highlightItems({ byBranch: b.byBranch, byProblemType: b.byProblemType, byAccount: b.byAccount, byEmployee: b.byEmployee });
    body += '<div class="rp-sub">أبرز النتائج</div>' + staticTable([{ key: 'q', type: 'name', label: 'المؤشر' }, { key: 'a', type: 'text', label: 'النتيجة', render: r => r.a }], hl.map(h => ({ q: h[1], a: h[2] })));
    body += '</section>';

    /* 02 مؤشرات الأداء */
    body += '<section class="rp-section">' + rpHead('02', 'مؤشرات الأداء');
    const kRows = [
      ['إجمالي المشاكل', N(fInt(k.total)), 'عدد السجلات بعد تطبيق الفلاتر.'],
      ['تم الحل', N(fInt(k.solved)), 'سجلات تصنَّف «تم الحل» وفق إعدادات حالة الشحنة في النظام.'],
      ['قيد المتابعة', N(fInt(k.followup)), 'سجلات تصنَّف «قيد المتابعة» وفق إعدادات حالة الشحنة في النظام.'],
      ['لم يتم الحل', N(fInt(k.open)), 'سجلات تصنَّف «لم يتم الحل» وفق إعدادات حالة الشحنة في النظام.'],
      ['نسبة الحل', N(fPct(k.resolutionRatePct)), 'تم الحل ÷ إجمالي المشاكل × 100، بتقريب إلى خانة عشرية واحدة.'],
      ['عدد الفروع', N(fInt(k.branchCount)), 'عدد الفروع المختلفة التي لديها حالات بعد الفلاتر.'],
      ['عدد الموظفات', N(fInt(k.employeeCount)), 'عدد الموظفات المختلفات اللاتي لديهن حالات بعد الفلاتر.'],
      ['عدد Accounts', N(fInt(k.accountCount)), 'عدد الـ Accounts المختلفة التي لديها حالات بعد الفلاتر.']
    ];
    if (k.unknownStatus > 0) kRows.push(['حالات غير مصنفة', N(fInt(k.unknownStatus)), 'قيمة الحالة غير مدرجة في الفئات الثلاث (تُحتسب في الإجمالي فقط).']);
    body += staticTable([{ key: 'a', type: 'name', label: 'المؤشر' }, { key: 'b', type: 'int', label: 'القيمة', render: r => r.b }, { key: 'c', type: 'text', label: 'طريقة الحساب' }], kRows.map(r => ({ a: r[0], b: r[1], c: r[2] })));
    body += '</section>';

    /* 03 التحليل التفصيلي */
    body += '<section class="rp-section">' + rpHead('03', 'التحليل التفصيلي');
    body += '<div class="rp-sub">الاتجاه اليومي<small>الوحدة: عدد الحالات — الأقدم يسارًا والأحدث يمينًا</small></div>';
    body += b.dailyTrend.length ? '<div class="rp-chart"><canvas id="rpChDaily"></canvas></div>' : '';
    const dayCols = [{ key: 'date', type: 'date', label: 'التاريخ' }, { key: 'total', type: 'int', label: 'إجمالي المشاكل' }]
      .concat([['solved', 'تم الحل'], ['followup', 'قيد المتابعة'], ['open', 'لم يتم الحل']].map(a => ({ key: a[0], type: 'int', label: a[1], render: r => N(fInt(r[a[0]])) + ' <span class="muted">(' + N(fPct(pctOf(r[a[0]], r.total))) + ')</span>' })));
    const dayTot = sumRows(b.dailyTrend, 'total');
    body += staticTable(dayCols, b.dailyTrend, b.dailyTrend.length ? { date: 'الإجمالي', total: dayTot, solved: sumRows(b.dailyTrend, 'solved'), followup: sumRows(b.dailyTrend, 'followup'), open: sumRows(b.dailyTrend, 'open') } : null);
    if (b.dailyTrend.length && dayTot !== k.total) body += '<div class="rp-note">مجموع الجدول اليومي ' + N(fInt(dayTot)) + ' من أصل ' + N(fInt(k.total)) + ' حالة: الفرق ' + N(fInt(k.total - dayTot)) + ' سجل بلا تاريخ صالح يُستبعد من الجداول اليومية.</div>';

    const dsb = b.dailyStatusBreakdown;
    if (dsb && dsb.rows && dsb.rows.length) {
      body += '<div class="rp-sub">الحالة اليومية<small>حسب قيمة «حالة الشحنة» الأصلية كما في Master Data</small></div>';
      const sCols = [{ key: 'date', type: 'date', label: 'التاريخ' }].concat(dsb.statusKeys.map((s, i) => ({ key: 's' + i, type: 'int', label: s }))).concat([{ key: 'total', type: 'int', label: 'الإجمالي الكلي' }]);
      const sRows = dsb.rows.map(r => { const o = { date: r.date, total: r.total }; dsb.statusKeys.forEach((s, i) => { o['s' + i] = r.counts[s] || 0; }); return o; });
      const sSum = { date: 'الإجمالي الكلي', total: dsb.grandTotal.total }; dsb.statusKeys.forEach((s, i) => { sSum['s' + i] = dsb.grandTotal.counts[s] || 0; });
      body += staticTable(sCols, sRows, sSum);
    }

    body += '<div class="rp-sub">أداء الفروع<small>الوحدة: عدد الحالات</small></div>';
    const bt = b.byBranch.slice(0, TOP_N);
    body += bt.length ? '<div class="rp-chart"><canvas id="rpChBranch"></canvas></div>' : '';
    body += (b.byBranch.length > bt.length) ? '<div class="rp-note">يعرض الرسم أعلى ' + bt.length + ' فروع من ' + b.byBranch.length + ' — الجدول يعرض الكل.</div>' : '';
    body += staticTable(perfCols('الفرع', 'إجمالي المشاكل'), b.byBranch, b.byBranch.length ? summaryFor('الإجمالي')(b.byBranch) : null);

    body += '<div class="rp-sub">أداء الموظفات</div>';
    const empCols = [{ key: 'rank', type: 'rank', label: '#' }, { key: 'name', type: 'name', label: 'الموظفة' }, { key: 'total', type: 'int', label: 'إجمالي الحالات' }, { key: 'pctOfTotal', type: 'pct', label: '% من الإجمالي' },
      { key: 'solved', type: 'int', label: 'تم الحل' }, { key: 'followup', type: 'int', label: 'قيد المتابعة' }, { key: 'open', type: 'int', label: 'لم يتم الحل' }, { key: 'resolutionRatePct', type: 'rate', label: 'نسبة الحل' }];
    const empSum = b.byEmployee.length ? Object.assign(summaryFor('الإجمالي')(b.byEmployee), { pctOfTotal: 100 }) : null;
    body += staticTable(empCols, b.byEmployee, empSum);

    body += '<div class="rp-sub">أنواع المشاكل<small>الوحدة: عدد الحالات</small></div>';
    const pt = b.byProblemType.slice(0, TOP_N);
    body += pt.length ? '<div class="rp-chart"><canvas id="rpChProblem"></canvas></div>' : '';
    const ptCols = [{ key: 'name', type: 'name', label: 'نوع المشكلة' }, { key: 'total', type: 'int', label: 'الإجمالي' }, { key: 'pctOfTotal', type: 'pct', label: 'النسبة' },
      { key: 'solved', type: 'int', label: 'تم الحل' }, { key: 'followup', type: 'int', label: 'قيد المتابعة' }, { key: 'open', type: 'int', label: 'لم يتم الحل' }, { key: 'resolutionRatePct', type: 'rate', label: 'نسبة الحل' }];
    const ptSum = b.byProblemType.length ? Object.assign(summaryFor('الإجمالي')(b.byProblemType), { pctOfTotal: 100 }) : null;
    body += staticTable(ptCols, b.byProblemType, ptSum);
    body += '</section>';

    /* 04 الملاحظات */
    body += '<section class="rp-section">' + rpHead('04', 'الملاحظات ونتائج المراجعة');
    if (!findings.length) body += '<div class="rp-empty">لا توجد ملاحظات مستخرجة من البيانات ضمن الفترة والفلاتر الحالية.</div>';
    else {
      body += '<p class="rp-p">الملاحظات التالية مستخرجة آليًا من أرقام التقرير فقط. الحقول غير الموجودة في مصدر البيانات (الخطورة، السبب الجذري، الإجراء، المسؤول، تاريخ الاستحقاق) لم تُخمَّن.</p>';
      body += findings.map((x, i) => '<div class="rp-finding"><div class="fh"><span class="no">' + (i + 1) + '</span><b>' + x.title + '</b></div><div class="fb"><span class="k">الدليل</span><span>' + x.evidence + '</span><span class="k">الأثر</span><span>' + x.impact + '</span>' +
        '<span class="k">الخطورة · السبب الجذري · الإجراء · المسؤول · تاريخ الاستحقاق</span><span class="nv">' + MISSING + '</span></div></div>').join('');
    }
    body += '</section>';

    /* 05 التوصيات */
    body += '<section class="rp-section">' + rpHead('05', 'التوصيات');
    if (!findings.length) body += '<div class="rp-empty">لا توجد توصيات — لا توجد ملاحظات تستدعي إجراءً ضمن الفترة والفلاتر الحالية.</div>';
    else {
      body += staticTable([{ key: 'problem', type: 'name', label: 'المشكلة' }, { key: 'impact', type: 'text', label: 'التأثير', render: r => r.impact }, { key: 'action', type: 'text', label: 'الإجراء المطلوب', render: () => missingHTML },
        { key: 'owner', type: 'text', label: 'المسؤول', render: () => missingHTML }, { key: 'priority', type: 'text', label: 'الأولوية', render: () => missingHTML }], findings.map(x => ({ problem: x.title, impact: x.impact })));
      body += '<div class="rp-note">لا يتضمن مصدر البيانات إجراءات أو مسؤولين أو أولويات؛ تُستكمل هذه الأعمدة عند اعتماد الإدارة للإجراءات. عمود «الحالة» غير معروض لأنه غير مُدخل في المصدر.</div>';
    }
    body += '</section>';

    /* 06 الختام */
    body += '<section class="rp-section">' + rpHead('06', 'الختام والملخص الإداري');
    const bb = bestByRate(b.byBranch);
    body += '<div class="rp-sub">أهم ما يجب أن تعرفه الإدارة</div><ul class="rp-list">' +
      '<li><i class="fa-solid fa-circle" aria-hidden="true"></i><span>إجمالي المشاكل ' + N(fInt(k.total)) + '، ونسبة الحل ' + N(fPct(k.resolutionRatePct)) + '.</span></li>' +
      '<li><i class="fa-solid fa-circle" aria-hidden="true"></i><span>' + N(fInt(k.open)) + ' حالة لم يتم حلها و' + N(fInt(k.followup)) + ' قيد المتابعة.</span></li>' +
      (b.topBranch ? '<li><i class="fa-solid fa-circle" aria-hidden="true"></i><span>أكثر فرع به مشاكل: ' + esc(b.topBranch.name) + ' (' + N(fInt(b.topBranch.total)) + ' حالة).</span></li>' : '') +
      (b.topProblemType ? '<li><i class="fa-solid fa-circle" aria-hidden="true"></i><span>أكثر نوع مشكلة: ' + esc(b.topProblemType.name) + ' (' + N(fInt(b.topProblemType.total)) + ' حالة).</span></li>' : '') +
      (bb ? '<li><i class="fa-solid fa-circle" aria-hidden="true"></i><span>أفضل فرع في نسبة الحل: ' + esc(bb.name) + ' (' + N(fPct(bb.resolutionRatePct)) + ' من ' + N(fInt(bb.total)) + ' حالة).</span></li>' : '') + '</ul>';
    body += '<div class="rp-sub">أهم نقاط المتابعة</div>' + (findings.length ? '<ul class="rp-list">' + findings.map(x => '<li><i class="fa-solid fa-circle" aria-hidden="true"></i><span><b>' + x.title + ':</b> ' + x.evidence + '</span></li>').join('') + '</ul>' : '<div class="rp-empty">لا توجد نقاط متابعة مستخرجة.</div>');
    body += '<div class="rp-sub">الإجراءات المطلوبة</div><div class="rp-callout">' + (findings.length ? 'يُحدَّد الإجراء والمسؤول وتاريخ الاستحقاق لكل نقطة متابعة أعلاه بقرار من الإدارة؛ لا توجد هذه البيانات في مصدر التقرير.' : 'لا توجد إجراءات مطلوبة مستخرجة من البيانات.') + '</div>';
    body += '</section>';
  }

  return '<div class="rp-doc">' + cover + '<table class="rp-frame"><thead><tr><td>' + runHead + '</td></tr></thead><tfoot><tr><td>' + runFoot + '</td></tr></tfoot><tbody><tr><td><div class="rp-main">' + body + '</div></td></tr></tbody></table></div>';
}
function drawReportCharts(b) {
  const bt = b.byBranch.slice(0, TOP_N), pt = b.byProblemType.slice(0, TOP_N);
  if ($('rpChDaily')) line('rpChDaily', b.dailyTrend.map(x => x.date), b.dailyTrend.map(x => x.total), { animate: false });
  if ($('rpChBranch')) bar('rpChBranch', bt.map(x => x.name), bt.map(x => x.total), { animate: false });
  if ($('rpChProblem')) { bar('rpChProblem', pt.map(x => x.name), pt.map(x => x.total), { horizontal: true, animate: false }); const h = chartHost('rpChProblem'); h.style.height = Math.max(150, pt.length * 30 + 44) + 'px'; chartInstances.rpChProblem.resize(); }
}

async function showReportStats() {
  const btn = $('showStatsBtn'), lbl = btn.querySelector('span');
  btn.disabled = true; btn.classList.add('is-busy'); lbl.textContent = 'جارٍ الحساب…';
  setHTML('reportMsg', '');
  try {
    const f = getCurrentFilters();
    const bundle = await apiCall('reportsBundle', f);
    onReportsBundle(bundle, f);
    lbl.textContent = 'تم تحديث الإحصائية';
    setTimeout(() => { lbl.textContent = 'عرض الإحصائية'; }, 1400);
  } catch (err) {
    setConnected(false, err.message); lbl.textContent = 'عرض الإحصائية';
  } finally { btn.disabled = false; btn.classList.remove('is-busy'); }
}
function onReportsBundle(bundle, f) {
  state.bundle = bundle; state.bundleFilters = JSON.stringify(f || getCurrentFilters());
  ['rpChDaily', 'rpChBranch', 'rpChProblem'].forEach(destroyChart);
  $('reportDoc').innerHTML = buildReportDoc(bundle, f || getCurrentFilters());
  drawReportCharts(bundle);
  setHTML('reportHint', 'التقرير مبني ' + N(fStamp()) + ' — ' + N(fInt(bundle.kpis.total)) + ' سجل.');
  checkReportStale();
}
function checkReportStale() {
  if (!state.bundle) return;
  const stale = state.bundleFilters !== JSON.stringify(state.applied);
  setHTML('reportMsg', stale ? alertHTML('info', 'التقرير المعروض لا يطابق الفلاتر الحالية', 'اضغط «عرض الإحصائية» لتحديثه قبل التصدير أو الطباعة.') : '');
}
async function printReport() {
  if (!state.bundle) { await showReportStats(); if (!state.bundle) return; }
  goToPage('page-reports');
  document.body.classList.add('print-report');
  const done = () => { document.body.classList.remove('print-report'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 150);
}

/* ---------- تصدير PDF من السيرفر (منطق التصدير كما هو) ---------- */
async function exportManagementReportPdf() {
  if (!state.bundle) { setHTML('reportMsg', alertHTML('info', 'ابنِ الإحصائية أولًا', 'اضغط «عرض الإحصائية» قبل تصدير تقرير الإدارة.')); return; }
  const btn = $('exportPdfBtn'), lbl = btn.querySelector('span'), original = lbl.textContent;
  btn.disabled = true; btn.classList.add('is-busy'); lbl.textContent = 'جارٍ إنشاء التقرير…';
  try {
    const res = await apiCall('managementReportPdf', getCurrentFilters());
    if (!res || !res.base64) throw new Error('لم يتم استلام ملف PDF صالح من السيرفر.');
    const byteChars = atob(res.base64), byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const blob = new Blob([new Uint8Array(byteNumbers)], { type: res.mimeType || 'application/pdf' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = res.fileName || 'Fleet_Support_Report.pdf';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    lbl.textContent = 'تم تصدير التقرير';
  } catch (err) {
    console.error('Management Report Export Error:', err);
    setConnected(false, err.message); lbl.textContent = 'فشل التصدير — حاول مجددًا';
  } finally { setTimeout(() => { lbl.textContent = original; btn.disabled = false; btn.classList.remove('is-busy'); }, 1800); }
}
function exportReportCSV() {
  if (!state.bundle) { setHTML('reportMsg', alertHTML('info', 'ابنِ الإحصائية أولًا', 'اضغط «عرض الإحصائية» قبل التصدير.')); return; }
  const b = state.bundle;
  let csv = 'ملخص التقرير\n';
  csv += 'إجمالى المشاكل,' + b.kpis.total + '\n';
  csv += 'تم الحل,' + b.kpis.solved + '\n';
  csv += 'قيد المتابعة,' + b.kpis.followup + '\n';
  csv += 'لم يتم الحل,' + b.kpis.open + '\n';
  csv += 'نسبة الحل,' + b.kpis.resolutionRatePct + '%\n\n';
  csv += 'الفرع,عدد المشاكل,تم الحل,قيد المتابعة,لم يتم الحل,نسبة الحل\n';
  b.byBranch.forEach(r => { csv += `${r.name},${r.total},${r.solved},${r.followup},${r.open},${r.resolutionRatePct}%\n`; });
  csv += '\nالموظفة,عدد الحالات,تم الحل,قيد المتابعة,لم يتم الحل,نسبة الحل\n';
  b.byEmployee.forEach(r => { csv += `${r.name},${r.total},${r.solved},${r.followup},${r.open},${r.resolutionRatePct}%\n`; });
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'fleet-support-report-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

/* ================================================================== */
/* F) INIT + EVENTS                                                    */
/* ================================================================== */
function placeholderChart(id, text) {
  const h = chartHost(id); if (!h || h.querySelector('.ar-empty')) return;
  h.insertAdjacentHTML('beforeend', '<div class="ar-empty"><div class="disc"><i class="fa-solid fa-chart-column" aria-hidden="true"></i></div><b>' + text + '</b><span>اختر الشهرين ثم اضغط «مقارنة».</span></div>');
  $(id).hidden = true;
}
function initGrids() {
  placeholderChart('chBranchCompare', 'لم تُجرَ مقارنة بعد');
  placeholderChart('chEmployeeCompare', 'لم تُجرَ مقارنة بعد');
  grids.branch = new DataGrid('branchTableHost', { title: 'ترتيب الفروع', columns: perfCols('الفرع', 'عدد المشاكل'), summary: summaryFor('الإجمالي'), pageSize: 10, searchPlaceholder: 'ابحث باسم الفرع…' });
  grids.employee = new DataGrid('employeeTableHost', { title: 'ترتيب الموظفين', columns: perfCols('الموظفة', 'عدد الحالات'), summary: summaryFor('الإجمالي'), pageSize: 10, searchPlaceholder: 'ابحث باسم الموظفة…' });
  grids.open = new DataGrid('openTableHost', {
    title: 'الحالات النشطة', pageSize: 25, pageSizes: [10, 25, 50, 100], searchPlaceholder: 'ابحث في الحالات…',
    searchKeys: ['waybillCode', 'account', 'driver', 'employee', 'branch'], maxHeight: 620,
    columns: [
      { key: 'date', type: 'date', label: 'التاريخ' },
      { key: 'waybillCode', type: 'id', label: 'كود البوليصة' },
      { key: 'account', type: 'text', label: 'Account' },
      { key: 'driver', type: 'text', label: 'اسم المندوب' },
      { key: 'branch', type: 'text', label: 'الفرع' },
      { key: 'problemType', type: 'text', label: 'نوع المشكلة' },
      { key: 'statusLabel', type: 'text', label: 'حالة الشحنة', render: c => { const m = BUCKET[c.statusBucket]; return m ? badge(m.status, c.statusLabel, true) : esc(c.statusLabel || c.status || '—'); } },
      { key: 'employee', type: 'text', label: 'اسم الموظفة' },
      { key: 'lastUpdated', type: 'date', label: 'آخر تحديث' },
      { key: 'notes', type: 'note', label: 'ملاحظات', sortable: false }
    ]
  });
}

function wireEvents() {
  document.querySelectorAll('.ar-nav-item').forEach(t => t.addEventListener('click', () => goToPage(t.dataset.page)));
  $('menuBtn').addEventListener('click', openSidebar);
  $('scrim').addEventListener('click', closeSidebar);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSidebar(); closeSettings(); } });

  $('applyFiltersBtn').addEventListener('click', loadAll);
  $('clearFiltersBtn').addEventListener('click', () => {
    Object.keys(FILTER_INPUT).forEach(k => { const el = $(FILTER_INPUT[k]); if (el) el.value = ''; });
    loadAll();
  });
  $('filterBody').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') loadAll(); });
  $('activeChips').addEventListener('click', e => {
    const b = e.target.closest('button[data-clear]'); if (!b) return;
    const el = $(FILTER_INPUT[b.dataset.clear]); if (el) el.value = '';
    loadAll();
  });
  $('filterToggle').addEventListener('click', () => {
    const bar = $('filterBar'), c = bar.classList.toggle('ar-filter-collapsed');
    $('filterToggle').setAttribute('aria-expanded', String(!c));
    $('filterToggle').innerHTML = '<i class="fa-solid fa-chevron-' + (c ? 'down' : 'up') + '" aria-hidden="true"></i><span>' + (c ? 'إظهار' : 'إخفاء') + '</span>';
  });

  $('refreshBtn').addEventListener('click', async function () {
    const btn = this; btn.disabled = true; btn.classList.add('is-busy'); setLoading(true);
    try {
      const data = await apiCall('refresh', getCurrentFilters());
      state.applied = getCurrentFilters();
      onFullAppData(data); setConnected(true);
    } catch (err) { setConnected(false, err.message); }
    finally { btn.disabled = false; btn.classList.remove('is-busy'); setLoading(false); }
  });
  $('alertHost').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    if (b.dataset.act === 'retry') loadAll(); else if (b.dataset.act === 'settings') openSettings();
  });

  $('settingsBtn').addEventListener('click', openSettings);
  $('cancelApiUrlBtn').addEventListener('click', closeSettings);
  $('settingsModal').addEventListener('click', e => { if (e.target === $('settingsModal')) closeSettings(); });
  $('saveApiUrlBtn').addEventListener('click', () => {
    const newUrl = $('apiUrlInput').value.trim();
    if (!newUrl) return;
    currentApiUrl = newUrl; lsSet('fleetSupportApiUrl', newUrl);
    closeSettings(); loadAll();
  });

  $('branchCompareBtn').addEventListener('click', branchCompare);
  $('employeeCompareBtn').addEventListener('click', employeeCompare);
  $('showStatsBtn').addEventListener('click', showReportStats);
  $('exportExcelBtn').addEventListener('click', exportReportCSV);
  $('printBtn').addEventListener('click', printReport);
  $('exportPdfBtn').addEventListener('click', exportManagementReportPdf);
}

function boot() {
  document.querySelectorAll('img[data-logo]').forEach(img => {
    if (LOGO_URI) img.src = LOGO_URI;
    else img.replaceWith(Object.assign(document.createElement('span'), { className: 'ar-brand-fallback', textContent: 'ARRIVE' }));
  });
  initPalette();
  Chart.register(ValueLabels, TargetLine, CenterText);
  initGrids();
  wireEvents();
  loadAll();
}
boot();
