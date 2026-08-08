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
 * Reads Master Data and returns { records, invalidDateCount }.
 * Cached briefly to avoid re-reading the sheet on every widget call
 * during a single dashboard load.
 */
function getNormalizedRecords_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('normalized_records_v1');
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through to rebuild */ }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_MASTER_DATA);
  if (!sheet) throw new Error('Sheet "' + CONFIG.SHEET_MASTER_DATA + '" not found.');

  const lastRow = sheet.getLastRow();
  const lastCol = 14; // through Employee column; 15-17 intentionally ignored
  if (lastRow < 2) return { records: [], invalidDateCount: 0 };

  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
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

  const result = { records: records, invalidDateCount: invalidDateCount };
  cache.put('normalized_records_v1', JSON.stringify(result), CONFIG.CACHE_TTL_SECONDS);
  return result;
}

function formatTimestamp_(recordId) {
  const d = parseDateValue_(recordId);
  if (!d) return cleanString_(recordId);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

/** Clears the cached records — call after any Master Data edit if needed. */
function clearDataCache() {
  CacheService.getScriptCache().remove('normalized_records_v1');
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

  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom);
    out = out.filter(r => r.date && r.date >= from);
  }
  if (filters.dateTo) {
    const to = new Date(filters.dateTo);
    to.setHours(23, 59, 59, 999);
    out = out.filter(r => r.date && r.date <= to);
  }
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

/* ============================== KPIs ============================== */

function getKPIs(filters) {
  const data = getNormalizedRecords_();
  const filtered = applyFilters_(data.records, filters);

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
  const data = getNormalizedRecords_();
  const filtered = applyFilters_(data.records, filters);

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
  const data = getNormalizedRecords_();
  const filtered = applyFilters_(data.records, filters).filter(r => r.hasValidDate);

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
  const data = getNormalizedRecords_();
  const filtered = applyFilters_(data.records, filters).filter(r => r.hasValidDate);

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
  const data = getNormalizedRecords_();
  const merged = Object.assign({}, filters, { statusBucket: undefined });
  let filtered = applyFilters_(data.records, merged);
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

  return {
    kpis: kpis,
    byBranch: byBranch,
    byEmployee: byEmployee,
    byAccount: byAccount,
    byProblemType: byProblemType,
    dailyTrend: getDailyTrend(filters),
    openCases: getOpenCases(filters),
    topBranch: byBranch.length ? byBranch[0] : null,
    topAccount: byAccount.length ? byAccount[0] : null,
    topProblemType: byProblemType.length ? byProblemType[0] : null,
    avgCasesPerEmployee: byEmployee.length ? Math.round((kpis.total / byEmployee.length) * 10) / 10 : 0
  };
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
