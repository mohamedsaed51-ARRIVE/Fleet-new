/**
 * Reports.gs
 * ------------------------------------------------------------------
 * "تقرير الإدارة" — Management Report PDF export for the التقارير page.
 *
 * IMPORTANT: this renders a real PDF server-side via Apps Script's
 * HtmlService → getAs('application/pdf') conversion — it is NOT a
 * screenshot of the page (no html2canvas anywhere in this file).
 * The client (index.html / Scripts.html) calls getManagementReportPdf(),
 * gets back { fileName, base64, mimeType }, and downloads it as a Blob.
 * ------------------------------------------------------------------
 */

/** Public entry point — called from Code.gs (index.html/fetch flow) and directly via google.script.run (Dashboard.html flow). */
function getManagementReportPdf(filters) {
  filters = filters || {};
  try {
    const bundle = getReportsBundle(filters);
    const filterOptions = getFilterOptions();

    const fileName = buildReportFileName_(filters);
    const html = buildManagementReportHtml_(bundle, filters, filterOptions);

    const pdfBlob = HtmlService.createHtmlOutput(html).getAs('application/pdf').setName(fileName);
    const base64 = Utilities.base64Encode(pdfBlob.getBytes());

    if (!base64) {
      throw new Error('فشل إنشاء ملف PDF — الناتج فارغ.');
    }

    return { fileName: fileName, base64: base64, mimeType: 'application/pdf' };
  } catch (error) {
    // Logged server-side (visible in Apps Script "Executions" log) so the
    // real cause is never silent for the developer, even though the user
    // only ever sees the friendly Arabic message below.
    console.error('Management Report Export Error:', error);
    throw new Error('حدث خطأ أثناء إنشاء التقرير، برجاء المحاولة مرة أخرى. (' + (error && error.message ? error.message : error) + ')');
  }
}

/** e.g. Fleet_Support_Report_2026-08-12.pdf or Fleet_Support_Report_ElHaram_2026-08-12.pdf when a single branch is filtered. */
function buildReportFileName_(filters) {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const parts = ['Fleet_Support_Report'];
  if (filters && filters.branch) {
    const safe = String(filters.branch).trim().replace(/\s+/g, '_').replace(/[\\/:*?"<>|]/g, '');
    if (safe) parts.push(safe);
  }
  parts.push(today);
  return parts.join('_') + '.pdf';
}

function filterLabel_(value) { return (value && String(value).trim()) ? String(value).trim() : 'الكل'; }

function statusBucketLabel_(bucket) {
  if (!bucket) return 'الكل';
  const labels = { SOLVED: 'تم الحل', FOLLOWUP: 'قيد المتابعة', OPEN: 'لم يتم الحل' };
  return labels[bucket] || bucket;
}

function buildManagementReportHtml_(bundle, filters, filterOptions) {
  const k = bundle.kpis;
  const period = bundle.reportPeriod || { from: '', to: '' };
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

  const appliedFiltersRows = [
    ['الفرع', filterLabel_(filters.branch)],
    ['الموظفة', filterLabel_(filters.employee)],
    ['Account', filterLabel_(filters.account)],
    ['المندوب', filterLabel_(filters.driver)],
    ['نوع المشكلة', filterLabel_(filters.problemType)],
    ['حالة الشحنة', statusBucketLabel_(filters.statusBucket)]
  ];

  const css = `
    * { box-sizing: border-box; }
    body { font-family: 'Tajawal', Arial, sans-serif; direction: rtl; color: #1a2233; font-size: 12px; padding: 24px 32px; }
    h1,h2,h3 { margin: 0; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #2E86DE; padding-bottom: 12px; margin-bottom: 16px; }
    .brand { font-size: 20px; font-weight: 900; color: #2E86DE; }
    .brand-sub { font-size: 11px; color: #6b7686; }
    .report-title { text-align: center; margin: 6px 0 18px; }
    .report-title h2 { font-size: 18px; font-weight: 900; }
    .report-title .sub { font-size: 12px; color: #6b7686; margin-top: 4px; }
    .meta-grid { display: flex; gap: 16px; margin-bottom: 18px; }
    .meta-box { flex: 1; border: 1px solid #e3e7ee; border-radius: 8px; padding: 10px 12px; background: #f8fafc; }
    .meta-box .t { font-size: 10.5px; color: #6b7686; margin-bottom: 4px; }
    .meta-box .v { font-size: 12.5px; font-weight: 700; }
    .section { margin: 20px 0 10px; font-size: 14px; font-weight: 800; color: #1a2233; border-right: 4px solid #2E86DE; padding-right: 8px; page-break-after: avoid; }
    .kpi-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
    .kpi-box { flex: 1; min-width: 100px; border: 1px solid #e3e7ee; border-radius: 8px; padding: 8px 10px; text-align: center; }
    .kpi-box .v { font-size: 16px; font-weight: 900; color: #2E86DE; }
    .kpi-box .l { font-size: 10px; color: #6b7686; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
    th, td { border: 1px solid #e3e7ee; padding: 5px 7px; font-size: 10.5px; text-align: center; }
    th { background: #f1f5fb; font-weight: 800; }
    td:first-child, th:first-child { text-align: right; }
    .bar-wrap { background: #eef1f6; border-radius: 4px; height: 8px; width: 90px; display: inline-block; overflow: hidden; }
    .bar-fill { background: #1FA971; height: 8px; }
    .badge-good { color: #1FA971; font-weight: 800; }
    .badge-bad { color: #E5484D; font-weight: 800; }
    .footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 9.5px; color: #98a2b3; border-top: 1px solid #e3e7ee; padding-top: 6px; display: flex; justify-content: space-between; }
    .page-num:after { content: counter(page); }
  `;

  const kpiRow = `
    <div class="kpi-row">
      ${kpiBox_(k.total, 'إجمالى الشحنات')}
      ${kpiBox_(k.total, 'إجمالى المشاكل')}
      ${kpiBox_(k.solved, 'تم الحل')}
      ${kpiBox_(k.followup, 'جاري الحل')}
      ${kpiBox_(k.open, 'لم يتم الحل')}
      ${kpiBox_(k.resolutionRatePct + '%', 'Solution %')}
      ${kpiBox_(k.branchCount, 'عدد الفروع')}
      ${kpiBox_(k.employeeCount, 'عدد الموظفات')}
    </div>
    <div class="kpi-row">
      ${kpiBox_(bundle.topProblemType ? bundle.topProblemType.name : '—', 'أكثر نوع مشكلة')}
      ${kpiBox_(bundle.topBranch ? bundle.topBranch.name : '—', 'أكثر فرع لديه مشاكل')}
      ${kpiBox_(bundle.bestEmployeeBySolution ? bundle.bestEmployeeBySolution.name : '—', 'أفضل موظفة إنتاجية')}
      ${kpiBox_(bundle.bestBranchBySolution ? bundle.bestBranchBySolution.name + ' (' + bundle.bestBranchBySolution.resolutionRatePct + '%)' : '—', 'أفضل فرع Solution %')}
    </div>
  `;

  const dailyRows = bundle.dailyTrend.map(d => {
    const solvedPct = pct_(d.solved, d.total), followupPct = pct_(d.followup, d.total), openPct = pct_(d.open, d.total);
    return `<tr><td>${d.date}</td><td>${d.total}</td><td>${d.solved} (${solvedPct}%)</td><td>${d.followup} (${followupPct}%)</td><td>${d.open} (${openPct}%)</td></tr>`;
  }).join('');

  const empRows = bundle.byEmployee.map(e =>
    `<tr><td>${escapeHtml_(e.name)}</td><td>${e.total}</td><td>${e.solved}</td><td>${e.followup}</td><td>${e.open}</td><td>${e.resolutionRatePct}%</td></tr>`
  ).join('');

  const rankRows = bundle.byEmployee.map((e, i) =>
    `<tr><td>${i + 1}${i === 0 ? ' 🏆' : ''}</td><td>${escapeHtml_(e.name)}</td><td>${e.total}</td><td>${e.pctOfTotal}%</td><td>${e.resolutionRatePct}%</td></tr>`
  ).join('');

  const probRows = bundle.byProblemType.map(p =>
    `<tr><td>${escapeHtml_(p.name)}</td><td>${p.total}</td><td>${p.pctOfTotal}%</td></tr>`
  ).join('');

  const probResRows = bundle.byProblemType.map(p =>
    `<tr><td>${escapeHtml_(p.name)}</td><td>${p.total}</td><td>${p.solved}</td><td>${p.followup}</td><td>${p.open}</td><td>${p.resolutionRatePct}%</td></tr>`
  ).join('');

  const branchRows = bundle.byBranch.map(b =>
    `<tr><td>${escapeHtml_(b.name)}</td><td>${b.total}</td><td>${b.solved}</td><td>${b.followup}</td><td>${b.open}</td><td>${b.resolutionRatePct}%</td></tr>`
  ).join('');

  const branchResRows = bundle.byBranch.map(b =>
    `<tr><td>${escapeHtml_(b.name)}</td><td><span class="bar-wrap"><span class="bar-fill" style="width:${b.resolutionRatePct}%;"></span></span></td><td>${b.resolutionRatePct}%</td></tr>`
  ).join('');

  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><style>${css}</style></head><body>

    <div class="header">
      <div><div class="brand">ARRIVE</div><div class="brand-sub">Logistics</div></div>
      <div style="text-align:left;"><div class="brand-sub">Fleet Support – Management Report</div></div>
    </div>

    <div class="report-title">
      <h2>Fleet Support — تقرير الإدارة</h2>
      <div class="sub">من ${period.from || '—'} إلى ${period.to || '—'}</div>
    </div>

    <div class="meta-grid">
      <div class="meta-box"><div class="t">Report Period</div><div class="v">${period.from || '—'} → ${period.to || '—'}</div></div>
      <div class="meta-box"><div class="t">Generated on</div><div class="v">${now}</div></div>
      <div class="meta-box"><div class="t">Generated by</div><div class="v">Fleet Support Dashboard</div></div>
    </div>

    <div class="section">Applied Filters</div>
    <table><tbody>
      ${appliedFiltersRows.map(r => `<tr><td style="width:20%;font-weight:700;">${r[0]}</td><td>${escapeHtml_(r[1])}</td></tr>`).join('')}
    </tbody></table>

    <div class="section">Executive Summary</div>
    ${kpiRow}

    <div class="section">Daily Performance</div>
    <table><thead><tr><th>التاريخ</th><th>إجمالى</th><th>تم الحل</th><th>جاري الحل</th><th>لم يتم الحل</th></tr></thead>
    <tbody>${dailyRows || emptyRow_(5)}</tbody></table>

    <div class="section">Employee Productivity</div>
    <table><thead><tr><th>الموظفة</th><th>إجمالي الحالات</th><th>تم الحل</th><th>جاري الحل</th><th>فشل التواصل</th><th>Solution %</th></tr></thead>
    <tbody>${empRows || emptyRow_(6)}</tbody></table>

    <div class="section">Employee Ranking</div>
    <table><thead><tr><th>#</th><th>الموظفة</th><th>عدد الحالات</th><th>% من الإجمالى</th><th>Solution %</th></tr></thead>
    <tbody>${rankRows || emptyRow_(5)}</tbody></table>

    <div class="section">Problem Type Analysis</div>
    <table><thead><tr><th>نوع المشكلة</th><th>عدد الحالات</th><th>النسبة</th></tr></thead>
    <tbody>${probRows || emptyRow_(3)}</tbody></table>

    <div class="section">Problem Resolution</div>
    <table><thead><tr><th>نوع المشكلة</th><th>الإجمالي</th><th>تم الحل</th><th>جاري الحل</th><th>فشل التواصل</th><th>Solution %</th></tr></thead>
    <tbody>${probResRows || emptyRow_(6)}</tbody></table>

    <div class="section">Branch Performance</div>
    <table><thead><tr><th>الفرع</th><th>إجمالي المشاكل</th><th>تم الحل</th><th>جاري الحل</th><th>فشل التواصل</th><th>Solution %</th></tr></thead>
    <tbody>${branchRows || emptyRow_(6)}</tbody></table>

    <div class="section">Branch Resolution %</div>
    <table><thead><tr><th>الفرع</th><th></th><th>Solution %</th></tr></thead>
    <tbody>${branchResRows || emptyRow_(3)}</tbody></table>

    <div class="footer"><span>ARRIVE — Fleet Support Dashboard</span><span>${now}</span></div>

  </body></html>`;
}

function kpiBox_(value, label) {
  return `<div class="kpi-box"><div class="v">${value}</div><div class="l">${label}</div></div>`;
}

function emptyRow_(colspan) {
  return `<tr><td colspan="${colspan}" style="color:#98a2b3;">لا توجد بيانات فى الفترة المحددة</td></tr>`;
}

function escapeHtml_(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
