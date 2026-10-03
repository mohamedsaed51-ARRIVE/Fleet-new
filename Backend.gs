/**
 * Backend.gs
 * ------------------------------------------------------------------
 * All KPI / chart / table calculations AND filter-option building
 * live here. Numbers are derived strictly from "Master Data" (rule
 * #5). Other sheets are read only for dropdown option lists, per the
 * approved rules:
 *   - Branch / Problem Type / Status / Account  -> "Lists" sheet
 *   - Employee / Driver                          -> "Master Data" only
 *     (Lists!E is reserved for data-entry validation, not filtering)
 * ------------------------------------------------------------------
 */

/* ============================== READ + NORMALIZE ============================== */

/**
 * أداء فقط (لا يغيّر أي نتيجة): getFullAppData تستدعي ~8 دوال وكلٌّ منها كانت تعيد قراءة الشيت كاملًا.
 * نحتفظ بالنتيجة في متغير داخل نفس التنفيذ فقط (كل تنفيذ Apps Script يبدأ بمتغيرات فارغة)،
 * فتُقرأ الورقة (أو الكاش) مرة واحدة لكل طلب، ويُحسب الفلتر مرة واحدة لكل مجموعة فلاتر.
 */
var RECORDS_MEMO_ = null;
var FILTER_MEMO_ = null;

function getNormalizedRecords_() {
  if (RECORDS_MEMO_) return RECORDS_MEMO_;
  RECORDS_MEMO_ = readNormalizedRecords_();
  return RECORDS_MEMO_;
}

/** Reads Master Data (through the script cache when possible) and returns { records, invalidDateCount }. */
function readNormalizedRecords_() {
  return buildNormalizedRecords_(readMasterValues_());
}

/**
 * القيم الخام لـ Master Data (14 عمودًا): من الكاش إن وُجدت، وإلا من الشيت ثم تُخزَّن في الكاش.
 * نخزّن القيم الخام وليس السجلات المشتقة: حجمها أصغر بكثير، ومسار البناء واحد (buildNormalizedRecords_)
 * سواء جاءت من الكاش أو من الشيت، فلا يمكن أن تختلف النتائج بين الحالتين.
 */
function readMasterValues_() {
  const cache = CacheService.getScriptCache();
  const hit = cacheGetValues_(cache);
  if (hit) return hit;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_MASTER_DATA);
  if (!sheet) throw new Error('Sheet "' + CONFIG.SHEET_MASTER_DATA + '" not found.');

  const lastRow = sheet.getLastRow();
  const lastCol = 14; // through Employee column; 15-17 intentionally ignored
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  cachePutValues_(cache, values);
  return values;
}

/** Raw sheet rows -> { records, invalidDateCount } (كل الاشتقاقات: التاريخ، الشهر، فئة الحالة...). */
function buildNormalizedRecords_(values) {
  const C = CONFIG.COLS;
  const records = [];
  let invalidDateCount = 0;

  values.forEach((row, i) => {
    const isBlank = row.every(v => v === '' || v === null);
    if (isBlank) return;

    const rawDate = row[C.DATE - 1];
    const parsedDate = parseDateValue_(rawDate);
    if (rawDate && !parsedDate) invalidDateCount++;

    const status = cleanString_(row[C.STATUS - 1]);
    const driver = cleanString_(row[C.DRIVER - 1]);
    const recordId = row[C.RECORD_ID - 1] || null;

    records.push({
      rowIndex: i + 2,
      sourceId: cleanString_(row[C.SOURCE_ID - 1]),
      lastUpdateRaw: cleanString_(row[C.LAST_UPDATE - 1]), // NOTE: not a timestamp — see README limitations
      recordId: recordId,
      recordIdDisplay: recordId ? formatTimestamp_(recordId) : '',
      date: parsedDate,
      dateKey: parsedDate ? toDateKey_(parsedDate) : null,
      monthKey: parsedDate ? toMonthKey_(parsedDate) : null, // derived, not read from sheet
      year: parsedDate ? parsedDate.getFullYear() : null,
      month: parsedDate ? parsedDate.getMonth() + 1 : null,
      day: parsedDate ? parsedDate.getDate() : null,
      hasValidDate: !!parsedDate,
      waybillCode: cleanString_(row[C.WAYBILL_CODE - 1]),
      account: cleanString_(row[C.ACCOUNT - 1]),
      driver: driver,
      driverDisplay: driver ? driver : CONFIG.DRIVER_EMPTY_DISPLAY,
      branch: cleanString_(row[C.BRANCH - 1]),
      problemType: cleanString_(row[C.PROBLEM_TYPE - 1]),
      status: status,
      statusBucket: getStatusBucket_(status),
      notes: cleanString_(row[C.NOTES - 1]),
      whatsappSent: row[C.WHATSAPP_SENT - 1] === true,
      senderNotified: row[C.SENDER_NOTIFIED - 1] === true,
      employee: cleanString_(row[C.EMPLOYEE - 1])
    });
  });

  return { records: records, invalidDateCount: invalidDateCount };
}

function formatTimestamp_(recordId) {
  const d = parseDateValue_(recordId);
  if (!d) return cleanString_(recordId);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

/* ---------------- Script cache (مقسّم على قطع) ----------------
 * CacheService يرفض أي قيمة أكبر من ~100KB. بدل تخطي الكاش كليًا مع البيانات الكبيرة، نقسّم
 * JSON على قطع ≤ 30,000 حرفًا (≤ 90KB حتى لو كل حرف 3 بايت)، ونكتب مفتاح الـ meta في الآخر
 * (يشير لـ generation واحد) فلا يرى القارئ مجموعة ناقصة أو مخلوطة بين تنفيذين متزامنين.
 * أي قطعة ناقصة/تالفة => نتجاهل الكاش ونقرأ من الشيت. تجاوز السقف => لا كاش (والطلب يعمل عادي).
 */
const CACHE_META_KEY_ = 'fs_master_values_v2_meta';
const CACHE_CHUNK_PREFIX_ = 'fs_master_values_v2:';
const CACHE_CHUNK_CHARS_ = 30000;
const CACHE_MAX_CHUNKS_ = 60;

function cacheReplacer_(key, value) {
  const orig = this[key];
  if (Object.prototype.toString.call(orig) === '[object Date]') {
    return { __d: isNaN(orig.getTime()) ? 'NaN' : orig.getTime() };   // يحفظ نوع Date (JSON العادي يحوّله لنص)
  }
  return value;
}
function cacheReviver_(key, value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && value.__d !== undefined) {
    return new Date(value.__d === 'NaN' ? NaN : value.__d);
  }
  return value;
}

function cacheChunkKeys_(meta) {
  const keys = [];
  for (let i = 0; i < meta.chunks; i++) keys.push(CACHE_CHUNK_PREFIX_ + meta.gen + ':' + i);
  return keys;
}

function cacheGetValues_(cache) {
  try {
    const metaRaw = cache.get(CACHE_META_KEY_);
    if (!metaRaw) return null;
    const meta = JSON.parse(metaRaw);
    const keys = cacheChunkKeys_(meta);
    const got = cache.getAll(keys);
    let s = '';
    for (let i = 0; i < keys.length; i++) {
      if (typeof got[keys[i]] !== 'string') return null;
      s += got[keys[i]];
    }
    if (s.length !== meta.length) return null;
    return JSON.parse(s, cacheReviver_);
  } catch (e) { return null; }   // أي مشكلة => نقرأ من الشيت
}

function cachePutValues_(cache, values) {
  try {
    const s = JSON.stringify(values, cacheReplacer_);
    const chunks = [];
    let pos = 0;
    while (pos < s.length) {
      let cut = Math.min(pos + CACHE_CHUNK_CHARS_, s.length);
      const last = s.charCodeAt(cut - 1);
      if (cut < s.length && last >= 0xD800 && last <= 0xDBFF) cut--;   // لا نقطع زوج surrogate (إيموجي) بين قطعتين
      chunks.push(s.substring(pos, cut));
      pos = cut;
      if (chunks.length > CACHE_MAX_CHUNKS_) return;                    // أكبر من السقف: لا كاش
    }
    const meta = { gen: Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), chunks: chunks.length, length: s.length };
    const obj = {};
    cacheChunkKeys_(meta).forEach((k, i) => { obj[k] = chunks[i]; });
    cache.putAll(obj, CONFIG.CACHE_TTL_SECONDS);
    cache.put(CACHE_META_KEY_, JSON.stringify(meta), CONFIG.CACHE_TTL_SECONDS);
  } catch (e) { /* الكاش تحسين فقط — لا يكسر الطلب أبدًا */ }
}

/** Clears the cached records — call after any Master Data edit if needed. */
function clearDataCache() {
  RECORDS_MEMO_ = null;
  FILTER_MEMO_ = null;
  const cache = CacheService.getScriptCache();
  try {
    const metaRaw = cache.get(CACHE_META_KEY_);
    if (metaRaw) cache.removeAll(cacheChunkKeys_(JSON.parse(metaRaw)));
  } catch (e) { /* تنتهي صلاحية القطع وحدها خلال TTL */ }
  cache.remove(CACHE_META_KEY_);
  return { cleared: true };
}

/* ============================== FILTERING ============================== */

/**
 * filters: {
 *   dateFrom, dateTo (ISO 'YYYY-MM-DD' strings, optional),
 *   branch, employee, account, driver, problemType (exact match, optional),
 *   statusBucket ('SOLVED'|'FOLLOWUP'|'OPEN', optional),
 *   search (free-text, optional — matches waybillCode/account/driver/employee)
 * }
 */
function applyFilters_(records, filters) {
  filters = filters || {};
  let out = records;

  // فلتر الفترة بمقارنة "يوم التقويم" (dateKey = yyyy-MM-dd بتوقيت الـ Script) — لا بالـ Date/UTC.
  // مقارنة Date كانت تحوّل '2026-08-01' لمنتصف الليل UTC فتُسقط سجلات أول/آخر يوم حسب الـ Timezone.
  // السجل بلا تاريخ صالح (dateKey = null) يُستبعد مع أي فلتر تاريخ — كما كان.
  const fromKey = normalizeFilterDate_(filters.dateFrom, 'dateFrom');
  const toKey = normalizeFilterDate_(filters.dateTo, 'dateTo');
  if (fromKey) out = out.filter(r => r.dateKey && r.dateKey >= fromKey);
  if (toKey) out = out.filter(r => r.dateKey && r.dateKey <= toKey);
  if (filters.branch) out = out.filter(r => r.branch === filters.branch);
  if (filters.employee) out = out.filter(r => r.employee === filters.employee);
  if (filters.account) out = out.filter(r => r.account === filters.account);
  if (filters.driver) out = out.filter(r => r.driver === filters.driver);
  if (filters.problemType) out = out.filter(r => r.problemType === filters.problemType);
  if (filters.statusBucket) out = out.filter(r => r.statusBucket === filters.statusBucket);

  if (filters.search) {
    const q = String(filters.search).trim().toLowerCase();
    if (q) {
      out = out.filter(r =>
        [r.waybillCode, r.account, r.driver, r.employee, r.branch]
          .some(v => v && v.toLowerCase().indexOf(q) !== -1)
      );
    }
  }

  return out;
}

/**
 * نفس applyFilters_ لكن تُحسب مرة واحدة لكل مجموعة فلاتر داخل التنفيذ الواحد
 * (getReportsBundle/getFullAppData كانتا تعيدان الفلترة 6-8 مرات بنفس الفلاتر).
 * النتيجة مصفوفة مشتركة: يُمنع تعديلها في مكانها (الدوال الحالية تستخدم filter/map/forEach فقط).
 */
function getFilteredRecords_(filters) {
  const data = getNormalizedRecords_();
  if (!FILTER_MEMO_ || FILTER_MEMO_.src !== data) FILTER_MEMO_ = { src: data, map: {} };
  const key = JSON.stringify(filters || {});
  if (!FILTER_MEMO_.map[key]) FILTER_MEMO_.map[key] = applyFilters_(data.records, filters);
  return FILTER_MEMO_.map[key];
}

/* ============================== KPIs ============================== */

function getKPIs(filters) {
  const data = getNormalizedRecords_();
  const filtered = getFilteredRecords_(filters);

  const total = filtered.length;
  const solved = filtered.filter(r => r.statusBucket === 'SOLVED').length;
  const followup = filtered.filter(r => r.statusBucket === 'FOLLOWUP').length;
  const open = filtered.filter(r => r.statusBucket === 'OPEN').length;
  const unknownStatus = filtered.filter(r => r.statusBucket === 'UNKNOWN').length;

  return {
    total: total,
    solved: solved,
    followup: followup,
    open: open,
    unknownStatus: unknownStatus,
    resolutionRatePct: pct_(solved, total),
    branchCount: uniqueCount_(filtered, 'branch'),
    employeeCount: uniqueCount_(filtered, 'employee'),
    accountCount: uniqueCount_(filtered, 'account'),
    driverCount: uniqueCount_(filtered.filter(r => r.driver), 'driver'),
    invalidDateRowCount: data.invalidDateCount
  };
}

function uniqueCount_(records, field) {
  const set = {};
  records.forEach(r => { if (r[field]) set[r[field]] = true; });
  return Object.keys(set).length;
}

/* ============================== GROUPINGS ============================== */

function getBranchPerformance(filters) { return groupByField_(filters, 'branch'); }
function getEmployeePerformance(filters) { return groupByField_(filters, 'employee'); }
function getAccountBreakdown(filters) { return groupByField_(filters, 'account'); }
function getProblemTypeBreakdown(filters) { return groupByField_(filters, 'problemType'); }

function groupByField_(filters, field) {
  const filtered = getFilteredRecords_(filters);

  const groups = {};
  filtered.forEach(r => {
    const key = r[field] || '(بدون قيمة)';
    if (!groups[key]) groups[key] = { name: key, total: 0, solved: 0, followup: 0, open: 0 };
    groups[key].total++;
    if (r.statusBucket === 'SOLVED') groups[key].solved++;
    else if (r.statusBucket === 'FOLLOWUP') groups[key].followup++;
    else if (r.statusBucket === 'OPEN') groups[key].open++;
  });

  return Object.keys(groups)
    .map(k => { const g = groups[k]; g.resolutionRatePct = pct_(g.solved, g.total); return g; })
    .sort((a, b) => b.total - a.total);
}

/* ============================== TRENDS ============================== */

function getDailyTrend(filters) {
  const filtered = getFilteredRecords_(filters).filter(r => r.hasValidDate);

  const byDate = {};
  filtered.forEach(r => {
    if (!byDate[r.dateKey]) byDate[r.dateKey] = { date: r.dateKey, total: 0, solved: 0, followup: 0, open: 0 };
    byDate[r.dateKey].total++;
    if (r.statusBucket === 'SOLVED') byDate[r.dateKey].solved++;
    else if (r.statusBucket === 'FOLLOWUP') byDate[r.dateKey].followup++;
    else if (r.statusBucket === 'OPEN') byDate[r.dateKey].open++;
  });

  return Object.keys(byDate).map(k => byDate[k]).sort((a, b) => a.date.localeCompare(b.date));
}

/** Sorted list of 'YYYY-MM' month keys actually present in valid-date rows. Used to populate comparison dropdowns. */
function getAvailableMonths() {
  const data = getNormalizedRecords_();
  const set = {};
  data.records.forEach(r => { if (r.monthKey) set[r.monthKey] = true; });
  return Object.keys(set).sort();
}

/**
 * Month-over-month comparison for a given field ('branch' or 'employee').
 * monthA/monthB are 'YYYY-MM' strings, derived at runtime from the Date
 * column (rule #4) — never read from stored Month/Year columns.
 */
function getMonthComparison(field, monthA, monthB, filters) {
  const filtered = getFilteredRecords_(filters).filter(r => r.hasValidDate);

  const build = monthKey => {
    const subset = filtered.filter(r => r.monthKey === monthKey);
    const total = {}, solved = {};
    subset.forEach(r => {
      const key = r[field] || '(بدون قيمة)';
      total[key] = (total[key] || 0) + 1;
      if (r.statusBucket === 'SOLVED') solved[key] = (solved[key] || 0) + 1;
    });
    return { total: total, solved: solved };
  };

  const a = build(monthA);
  const b = build(monthB);
  const names = Object.keys(Object.assign({}, a.total, b.total));

  const rows = names.map(name => {
    const t1 = a.total[name] || 0, s1 = a.solved[name] || 0;
    const t2 = b.total[name] || 0, s2 = b.solved[name] || 0;
    const rate1 = t1 ? s1 / t1 : null;
    const rate2 = t2 ? s2 / t2 : null;
    let changePct = null;
    if (rate1 !== null && rate1 !== 0 && rate2 !== null) {
      changePct = Math.round(((rate2 - rate1) / rate1) * 1000) / 10;
    }
    return {
      name: name,
      totalA: t1, solvedA: s1,
      totalB: t2, solvedB: s2,
      diff: t2 - t1,
      changePct: changePct
    };
  }).sort((x, y) => y.totalB - x.totalB);

  const totalsA = rows.reduce((s, r) => s + r.totalA, 0);
  const totalsB = rows.reduce((s, r) => s + r.totalB, 0);

  return {
    monthA: monthA,
    monthB: monthB,
    rows: rows,
    summary: {
      totalA: totalsA,
      totalB: totalsB,
      diff: totalsB - totalsA,
      changePct: totalsA ? pct_(totalsB - totalsA, totalsA) : null
    }
  };
}

/* ============================== OPEN CASES ============================== */

function getOpenCases(filters) {
  const merged = Object.assign({}, filters, { statusBucket: undefined });
  let filtered = getFilteredRecords_(merged);
  filtered = filtered.filter(r => r.statusBucket === 'OPEN' || r.statusBucket === 'FOLLOWUP');

  return filtered
    .sort((x, y) => (y.date ? y.date.getTime() : 0) - (x.date ? x.date.getTime() : 0))
    .map(r => ({
      sourceId: r.sourceId,
      date: r.dateKey,
      waybillCode: r.waybillCode,
      account: r.account,
      driver: r.driverDisplay,
      branch: r.branch,
      problemType: r.problemType,
      status: r.status,
      statusBucket: r.statusBucket,
      statusLabel: CONFIG.BUCKET_LABELS[r.statusBucket] || r.status,
      notes: r.notes,
      employee: r.employee,
      // "آخر تحديث" in the UI is shown from Record ID (an actual timestamp),
      // NOT from the "Last Update" column, whose values (e.g. "حبيبه_2")
      // are not timestamps — see README limitations.
      lastUpdated: r.recordIdDisplay,
      whatsappSent: r.whatsappSent,
      senderNotified: r.senderNotified
    }));
}

/* ============================== REPORTS ============================== */

function getReportsBundle(filters) {
  const byBranch = getBranchPerformance(filters);
  const byAccount = getAccountBreakdown(filters);
  const byProblemType = getProblemTypeBreakdown(filters);
  const byEmployee = getEmployeePerformance(filters);
  const kpis = getKPIs(filters);
  const dailyTrend = getDailyTrend(filters);

  // Executive Summary extras: add "% of total" to every ranked list (used by
  // Employee Ranking / Problem Types tables), and surface whoever is best by
  // SOLUTION RATE — separate from "most cases", which byBranch[0]/byEmployee[0]
  // already give us.
  addPctOfTotal_(byBranch, kpis.total);
  addPctOfTotal_(byEmployee, kpis.total);
  addPctOfTotal_(byProblemType, kpis.total);

  const bestEmployeeBySolution = bestBySolutionRate_(byEmployee);
  const bestBranchBySolution = bestBySolutionRate_(byBranch);

  return {
    kpis: kpis,
    byBranch: byBranch,
    byEmployee: byEmployee,
    byAccount: byAccount,
    byProblemType: byProblemType,
    dailyTrend: dailyTrend,
    dailyStatusBreakdown: getDailyStatusBreakdown(filters),
    openCases: getOpenCases(filters),
    topBranch: byBranch.length ? byBranch[0] : null,
    topAccount: byAccount.length ? byAccount[0] : null,
    topProblemType: byProblemType.length ? byProblemType[0] : null,
    bestEmployeeBySolution: bestEmployeeBySolution,
    bestBranchBySolution: bestBranchBySolution,
    avgCasesPerEmployee: byEmployee.length ? Math.round((kpis.total / byEmployee.length) * 10) / 10 : 0,
    reportPeriod: getReportPeriod_(dailyTrend, filters)
  };
}

/** Adds a `pctOfTotal` field (1 decimal, 0 when total is 0) to each row of a grouped list, in place. */
function addPctOfTotal_(list, total) {
  list.forEach(row => { row.pctOfTotal = pct_(row.total, total); });
  return list;
}

/** Picks the entry with the highest resolutionRatePct (min 1 case), tie-broken by higher total. Null if list is empty. */
function bestBySolutionRate_(list) {
  const candidates = list.filter(r => r.total > 0);
  if (!candidates.length) return null;
  return candidates.slice().sort((a, b) =>
    (b.resolutionRatePct - a.resolutionRatePct) || (b.total - a.total)
  )[0];
}

/** 'YYYY-MM-DD' → 'YYYY-MM-DD' period label for the report header. Falls back to the actual min/max dates in the filtered data when dateFrom/dateTo aren't set. */
function getReportPeriod_(dailyTrend, filters) {
  if (filters && (filters.dateFrom || filters.dateTo)) {
    return { from: filters.dateFrom || (dailyTrend.length ? dailyTrend[0].date : ''), to: filters.dateTo || (dailyTrend.length ? dailyTrend[dailyTrend.length - 1].date : '') };
  }
  if (!dailyTrend.length) return { from: '', to: '' };
  return { from: dailyTrend[0].date, to: dailyTrend[dailyTrend.length - 1].date };
}

/* ============================== DAILY STATUS (raw statuses) ============================== */

/**
 * Daily breakdown by the RAW "حالة الشحنة" string (not the 3-way bucket),
 * e.g. تم التاكيد / تم التسليم / تم الحل / جارى الحل / لم يتم التاكيد / لم يتم الحل.
 * Column set is built dynamically from whichever raw statuses actually
 * appear in the filtered data (ordered: known STATUS_BUCKETS values first,
 * in bucket order, then any unmapped/UNKNOWN values alphabetically) —
 * this avoids hardcoding spellings that may drift from the sheet.
 */
function getDailyStatusBreakdown(filters) {
  const filtered = getFilteredRecords_(filters).filter(r => r.hasValidDate);

  // Build the ordered column list.
  const known = [];
  ['SOLVED', 'FOLLOWUP', 'OPEN'].forEach(bucket => {
    (CONFIG.STATUS_BUCKETS[bucket] || []).forEach(s => { if (known.indexOf(s) === -1) known.push(s); });
  });
  const seenExtra = {};
  filtered.forEach(r => { if (r.status && known.indexOf(r.status) === -1) seenExtra[r.status] = true; });
  const statusKeys = known.concat(Object.keys(seenExtra).sort((a, b) => a.localeCompare(b, 'ar')));

  const byDate = {};
  filtered.forEach(r => {
    if (!byDate[r.dateKey]) {
      byDate[r.dateKey] = { date: r.dateKey, counts: {}, total: 0 };
      statusKeys.forEach(s => { byDate[r.dateKey].counts[s] = 0; });
    }
    const row = byDate[r.dateKey];
    if (r.status) row.counts[r.status] = (row.counts[r.status] || 0) + 1;
    row.total++;
  });

  const rows = Object.keys(byDate).map(k => byDate[k]).sort((a, b) => a.date.localeCompare(b.date));
  const grandTotal = { counts: {}, total: 0 };
  statusKeys.forEach(s => { grandTotal.counts[s] = 0; });
  rows.forEach(r => {
    statusKeys.forEach(s => { grandTotal.counts[s] += (r.counts[s] || 0); });
    grandTotal.total += r.total;
  });

  return { statusKeys: statusKeys, rows: rows, grandTotal: grandTotal };
}

/* ============================== FILTER OPTIONS ============================== */

/**
 * Source-of-truth rules (per approved business rules):
 *   - Branch, Problem Type, Status, Account  -> "Lists" sheet.
 *   - Employee                                -> Master Data ONLY
 *     (approved change — Lists!E is validation-only).
 *   - Driver                                  -> Master Data ONLY,
 *     filter omitted by the frontend when hasDrivers is false.
 */
function getFilterOptions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const listsSheet = ss.getSheetByName(CONFIG.SHEET_LISTS);
  if (!listsSheet) throw new Error('Sheet "' + CONFIG.SHEET_LISTS + '" not found.');

  const LC = CONFIG.LISTS_COLS;
  const lastRow = listsSheet.getLastRow();

  const branches = readListColumn_(listsSheet, LC.BRANCH, lastRow);
  const problemTypes = readListColumn_(listsSheet, LC.PROBLEM_TYPE, lastRow);
  const rawStatuses = readListColumn_(listsSheet, LC.STATUS, lastRow);
  const accounts = readListColumn_(listsSheet, LC.ACCOUNT, lastRow);

  const data = getNormalizedRecords_();
  const employees = uniqueSorted_(data.records, 'employee');
  const drivers = uniqueSorted_(data.records, 'driver');

  return {
    branches: branches,
    problemTypes: problemTypes,
    statuses: rawStatuses,
    statusBuckets: [
      { key: 'SOLVED', label: CONFIG.BUCKET_LABELS.SOLVED },
      { key: 'FOLLOWUP', label: CONFIG.BUCKET_LABELS.FOLLOWUP },
      { key: 'OPEN', label: CONFIG.BUCKET_LABELS.OPEN }
    ],
    accounts: accounts,
    employees: employees,
    drivers: drivers,
    hasDrivers: drivers.length > 0,
    availableMonths: getAvailableMonths()
  };
}

function readListColumn_(sheet, colIndex, lastRow) {
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, colIndex, lastRow - 1, 1).getValues();
  const seen = {};
  const out = [];
  values.forEach(row => {
    const v = cleanString_(row[0]);
    if (v && !seen[v]) { seen[v] = true; out.push(v); }
  });
  return out.sort((a, b) => a.localeCompare(b, 'ar'));
}

function uniqueSorted_(records, field) {
  const seen = {};
  const out = [];
  records.forEach(r => {
    const v = r[field];
    if (v && !seen[v]) { seen[v] = true; out.push(v); }
  });
  return out.sort((a, b) => a.localeCompare(b, 'ar'));
}
