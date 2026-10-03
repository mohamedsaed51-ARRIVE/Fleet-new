/**
 * Reports.gs
 * ------------------------------------------------------------------
 * "تقرير الإدارة" — تصدير PDF من السيرفر لصفحة التقارير.
 *
 * يُنتج PDF حقيقيًا عبر HtmlService → getAs('application/pdf'). هذا المحوّل قديم:
 * لا يدعم flex ولا متغيرات CSS ولا خطوطًا خارجية، لذلك التصميم هنا مبني على
 * جداول وألوان صريحة (hex) منقولة حرفيًا من DesignSystem.html (كتلة :root).
 * التقرير التفاعلي/المطبوع من المتصفح (صفحة التقارير ← طباعة) هو النسخة عالية الدقة.
 *
 * منطق الأرقام لم يتغير: getReportsBundle(filters) هو المصدر الوحيد للبيانات.
 * ------------------------------------------------------------------
 */

/** ألوان الهوية — نسخة صريحة من tokens في DesignSystem.html (يتحقق منها اختبار التطابق). */
var RPT_TOKENS_ = {
  blue: '#0837C9', blue800: '#05237F', teal: '#00C7E6', navy: '#0F172A', light: '#E6F4FF', gray: '#64748B',
  g50: '#F8FAFC', g100: '#F1F5F9', g200: '#E2E8F0', g300: '#CBD5E1',
  success: '#22C55E', successBg: '#DCFCE7', successFg: '#15803D',
  warn: '#F59E0B', warnBg: '#FEF3C7', warnFg: '#B45309',
  bad: '#EF4444', badBg: '#FEE2E2', badFg: '#B91C1C'
};

/** Public entry point — called from Code.gs (index.html/fetch flow) and directly via google.script.run. */
function getManagementReportPdf(filters) {
  filters = filters || {};
  try {
    const bundle = getReportsBundle(filters);
    const fileName = buildReportFileName_(filters);
    const html = buildManagementReportHtml_(bundle, filters);

    const pdfBlob = HtmlService.createHtmlOutput(html).getAs('application/pdf').setName(fileName);
    const base64 = Utilities.base64Encode(pdfBlob.getBytes());
    if (!base64) throw new Error('فشل إنشاء ملف PDF — الناتج فارغ.');

    return { fileName: fileName, base64: base64, mimeType: 'application/pdf' };
  } catch (error) {
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
  return CONFIG.BUCKET_LABELS[bucket] || bucket;
}

/** الملاحظات: مستخرجة من أرقام الـ bundle فقط — لا حقول مخمَّنة. */
function deriveReportFindings_(bundle) {
  const k = bundle.kpis, out = [];
  const thr = CONFIG.REPORT.ATTENTION_RESOLUTION_PCT;
  if (k.open > 0) out.push({ title: 'حالات لم يتم حلها', evidence: k.open + ' حالة من أصل ' + k.total + ' (' + pct_(k.open, k.total) + '%).', impact: k.open + ' حالة ما زالت مفتوحة دون حل ضمن الفترة.' });
  if (k.followup > 0) out.push({ title: 'حالات قيد المتابعة', evidence: k.followup + ' حالة (' + pct_(k.followup, k.total) + '% من الإجمالي).', impact: 'تحتاج متابعة حتى الإغلاق.' });
  const low = bundle.byBranch.filter(function (b) { return b.total > 0 && b.resolutionRatePct < thr; })
    .sort(function (a, b) { return a.resolutionRatePct - b.resolutionRatePct; });
  if (low.length) {
    let pending = 0;
    low.forEach(function (b) { pending += b.followup + b.open; });
    out.push({
      title: 'فروع نسبة الحل فيها أقل من ' + thr + '%',
      evidence: low.map(function (b) { return b.name + ' (' + b.resolutionRatePct + '% — ' + b.solved + ' من ' + b.total + ')'; }).join('، ') + '.',
      impact: 'الحالات غير المحلولة (قيد المتابعة + لم يتم الحل) في هذه الفروع: ' + pending + ' حالة.'
    });
  }
  if (k.unknownStatus > 0) out.push({ title: 'حالات بقيمة حالة غير مصنفة', evidence: k.unknownStatus + ' سجل بقيمة حالة غير مدرجة في الفئات الثلاث.', impact: 'تُحتسب في الإجمالي ولا تدخل في أي فئة.' });
  if (k.invalidDateRowCount > 0) out.push({ title: 'سجلات بتاريخ غير صالح', evidence: k.invalidDateRowCount + ' سجل في Master Data (إجمالي الورقة وليس بعد الفلاتر).', impact: 'تُستبعد من الاتجاه اليومي وأي فلتر تاريخ.' });
  return out;
}

function buildManagementReportHtml_(bundle, filters) {
  const T = RPT_TOKENS_;
  const k = bundle.kpis;
  const period = bundle.reportPeriod || { from: '', to: '' };
  const periodTxt = (period.from || period.to) ? ('من ' + ltr_(period.from || '—') + ' إلى ' + ltr_(period.to || '—')) : 'غير محدد بالمصدر';
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const thr = CONFIG.REPORT.ATTENTION_RESOLUTION_PCT;
  const logo = getLogoDataUri_();
  const logoImg = logo ? '<img src="' + logo + '" height="34" alt="ARRIVE">' : '<b style="color:#fff;font-size:20px">ARRIVE</b>';
  const findings = deriveReportFindings_(bundle);
  const MISSING = 'غير محدد بالمصدر';

  const css = [
    '@page { size: A4; margin: 14mm 12mm; }',
    'body { font-family: Cairo, Arial, sans-serif; direction: rtl; color: ' + T.navy + '; font-size: 11px; margin: 0; }',
    'table { width: 100%; border-collapse: collapse; }',
    '.cover td { background: ' + T.blue + '; color: #fff; }',
    '.sec { font-size: 15px; font-weight: bold; color: ' + T.blue800 + '; border-right: 5px solid ' + T.blue + '; padding: 2px 10px; margin: 18px 0 8px; page-break-after: avoid; }',
    '.sub { font-size: 12px; font-weight: bold; color: ' + T.navy + '; margin: 12px 0 5px; page-break-after: avoid; }',
    '.kpi td { width: 25%; border: 1px solid ' + T.g200 + '; background: #fff; padding: 8px 10px; vertical-align: top; }',
    '.kpi .l { font-size: 10px; color: ' + T.gray + '; }',
    '.kpi .v { font-size: 20px; font-weight: bold; color: ' + T.blue + '; }',
    '.kpi .s { font-size: 9px; color: ' + T.gray + '; }',
    '.dt th { background: ' + T.blue + '; color: #fff; padding: 6px 7px; font-size: 10px; border: 1px solid ' + T.blue + '; text-align: center; }',
    '.dt td { padding: 5px 7px; border: 1px solid ' + T.g200 + '; text-align: center; font-size: 10px; }',
    '.dt tr { page-break-inside: avoid; }',
    '.dt td.n { text-align: right; font-weight: bold; }',
    '.dt tr.z td { background: ' + T.g50 + '; }',
    '.dt tr.sum td { background: ' + T.light + '; font-weight: bold; border-top: 2px solid ' + T.blue + '; }',
    '.call { background: ' + T.light + '; border-right: 4px solid ' + T.blue + '; padding: 8px 12px; margin: 8px 0; font-size: 11px; }',
    '.miss { color: ' + T.gray + '; font-style: italic; }',
    '.ok { color: ' + T.successFg + '; font-weight: bold; } .bad { color: ' + T.badFg + '; font-weight: bold; } .mid { color: ' + T.warnFg + '; font-weight: bold; }',
    '.foot { font-size: 9px; color: ' + T.gray + '; border-top: 1px solid ' + T.g200 + '; padding-top: 5px; margin-top: 14px; }',
    '.num { direction: ltr; unicode-bidi: embed; }'
  ].join('\n');

  function kpiCell(label, value, sub) {
    return '<td><div class="l">' + label + '</div><div class="v">' + value + '</div><div class="s">' + (sub || '&nbsp;') + '</div></td>';
  }
  function share(n) { return pct_(n, k.total) + '% من الإجمالي'; }
  function rateCell(v) { const c = v >= 80 ? 'ok' : (v < thr ? 'bad' : 'mid'); return '<span class="' + c + ' num">' + v + '%</span>'; }
  function table(heads, rows, sumRow) {
    if (!rows.length) return '<div class="call">لا توجد بيانات في الفترة المحددة.</div>';
    return '<table class="dt"><thead><tr>' + heads.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r, i) { return '<tr' + (i % 2 ? ' class="z"' : '') + '>' + r.map(function (c, j) { return '<td' + (j === 0 ? ' class="n"' : '') + '>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody>' +
      (sumRow ? '<tfoot><tr class="sum">' + sumRow.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr></tfoot>' : '') + '</table>';
  }
  function sum(rows, key) { let s = 0; rows.forEach(function (r) { s += r[key] || 0; }); return s; }
  const perfHeads = function (a, b) { return [a, b, 'تم الحل', 'قيد المتابعة', 'لم يتم الحل', 'نسبة الحل']; };
  const perfRow = function (r) { return [escapeHtml_(r.name), ltr_(r.total), ltr_(r.solved), ltr_(r.followup), ltr_(r.open), rateCell(r.resolutionRatePct)]; };
  const perfSum = function (rows) { const t = sum(rows, 'total'), s = sum(rows, 'solved'); return ['الإجمالي', ltr_(t), ltr_(s), ltr_(sum(rows, 'followup')), ltr_(sum(rows, 'open')), '<span class="num">' + pct_(s, t) + '%</span>']; };

  let html = '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><style>' + css + '</style></head><body>';

  // الغلاف
  html += '<table class="cover" style="height:250mm"><tr><td style="padding:22px 28px;height:40px">' + logoImg + '</td></tr>' +
    '<tr><td style="padding:0 28px;vertical-align:middle"><div style="color:' + T.teal + ';font-size:13px;font-weight:bold">تقرير الإدارة</div>' +
    '<div style="font-size:30px;font-weight:bold;margin:8px 0">متابعة المشاكل وأداء الفروع<br>Fleet Support</div>' +
    '<div style="font-size:14px">الفترة: ' + periodTxt + '</div></td></tr>' +
    '<tr><td style="padding:18px 28px;font-size:11px"><table><tr>' +
    '<td style="color:#fff">القسم<br><b>Fleet Support</b></td><td style="color:#fff">تاريخ الإصدار<br><b class="num">' + today + '</b></td>' +
    '<td style="color:#fff">أُعدّ بواسطة<br><b>لوحة متابعة Fleet Support</b></td><td style="color:#fff">عدد السجلات<br><b class="num">' + k.total + '</b></td></tr></table></td></tr></table>';
  html += '<div style="page-break-after:always"></div>';

  // 01 الملخص التنفيذي
  html += '<div class="sec">01 · الملخص التنفيذي</div>';
  html += '<table class="dt" style="margin-bottom:8px"><tbody>' + [
    ['الفرع', filterLabel_(filters.branch)], ['الموظفة', filterLabel_(filters.employee)], ['Account', filterLabel_(filters.account)],
    ['المندوب', filterLabel_(filters.driver)], ['نوع المشكلة', filterLabel_(filters.problemType)], ['حالة الشحنة', statusBucketLabel_(filters.statusBucket)]
  ].map(function (r) { return '<tr><td class="n" style="width:22%;background:' + T.g50 + '">' + r[0] + '</td><td>' + escapeHtml_(r[1]) + '</td></tr>'; }).join('') + '</tbody></table>';
  if (!k.total) {
    html += '<div class="call">لا توجد بيانات متاحة وفقًا للفلاتر المحددة.</div>';
  } else {
    const lowN = bundle.byBranch.filter(function (b) { return b.total > 0 && b.resolutionRatePct < thr; }).length;
    html += '<div class="call">خلال الفترة ' + periodTxt + ' سُجّلت ' + ltr_(k.total) + ' حالة، تم حل ' + ltr_(k.solved) + ' منها بنسبة ' + ltr_(k.resolutionRatePct + '%') +
      '. يوجد ' + ltr_(k.open) + ' حالة لم يتم حلها و' + ltr_(k.followup) + ' قيد المتابعة، و' + ltr_(lowN) + ' فرع نسبة الحل فيه أقل من ' + thr + '%.</div>';
    html += '<table class="kpi"><tr>' + kpiCell('إجمالي المشاكل', ltr_(k.total)) + kpiCell('نسبة الحل', ltr_(k.resolutionRatePct + '%'), 'تم الحل ÷ الإجمالي') +
      kpiCell('لم يتم الحل', '<span style="color:' + T.badFg + '">' + ltr_(k.open) + '</span>', share(k.open)) + kpiCell('قيد المتابعة', '<span style="color:' + T.warnFg + '">' + ltr_(k.followup) + '</span>', share(k.followup)) + '</tr></table>';
    html += '<table class="kpi"><tr>' + kpiCell('تم الحل', '<span style="color:' + T.successFg + '">' + ltr_(k.solved) + '</span>', share(k.solved)) + kpiCell('عدد الفروع', ltr_(k.branchCount)) + kpiCell('عدد الموظفات', ltr_(k.employeeCount)) + kpiCell('عدد Accounts', ltr_(k.accountCount)) + '</tr></table>';

    // 02 مؤشرات
    html += '<div class="sec">02 · مؤشرات الأداء</div>';
    const bestB = bundle.bestBranchBySolution, bestE = bundle.bestEmployeeBySolution;
    html += table(['المؤشر', 'القيمة'], [
      ['أكثر فرع به مشاكل', bundle.topBranch ? escapeHtml_(bundle.topBranch.name) + ' — ' + ltr_(bundle.topBranch.total) + ' حالة' : '—'],
      ['أكثر نوع مشكلة', bundle.topProblemType ? escapeHtml_(bundle.topProblemType.name) + ' — ' + ltr_(bundle.topProblemType.total) + ' حالة' : '—'],
      ['أفضل فرع في نسبة الحل', bestB ? escapeHtml_(bestB.name) + ' — ' + ltr_(bestB.resolutionRatePct + '%') : '—'],
      ['أفضل موظفة في نسبة الحل', bestE ? escapeHtml_(bestE.name) + ' — ' + ltr_(bestE.resolutionRatePct + '%') : '—']
    ]);

    // 03 التحليل
    html += '<div class="sec">03 · التحليل التفصيلي</div><div class="sub">الأداء اليومي</div>';
    html += table(['التاريخ', 'إجمالي المشاكل', 'تم الحل', 'قيد المتابعة', 'لم يتم الحل'], bundle.dailyTrend.map(function (d) {
      return [ltr_(d.date), ltr_(d.total), ltr_(d.solved) + ' (' + pct_(d.solved, d.total) + '%)', ltr_(d.followup) + ' (' + pct_(d.followup, d.total) + '%)', ltr_(d.open) + ' (' + pct_(d.open, d.total) + '%)'];
    }), bundle.dailyTrend.length ? ['الإجمالي', ltr_(sum(bundle.dailyTrend, 'total')), ltr_(sum(bundle.dailyTrend, 'solved')), ltr_(sum(bundle.dailyTrend, 'followup')), ltr_(sum(bundle.dailyTrend, 'open'))] : null);
    if (bundle.dailyTrend.length && sum(bundle.dailyTrend, 'total') !== k.total) html += '<div class="call">مجموع الجدول اليومي ' + sum(bundle.dailyTrend, 'total') + ' من أصل ' + k.total + ' حالة: الفرق سجلات بلا تاريخ صالح تُستبعد من الجداول اليومية.</div>';
    html += '<div class="sub">أداء الفروع</div>' + table(perfHeads('الفرع', 'إجمالي المشاكل'), bundle.byBranch.map(perfRow), bundle.byBranch.length ? perfSum(bundle.byBranch) : null);
    html += '<div class="sub">أداء الموظفات</div>' + table(['#', 'الموظفة', 'إجمالي الحالات', '% من الإجمالي', 'تم الحل', 'قيد المتابعة', 'لم يتم الحل', 'نسبة الحل'],
      bundle.byEmployee.map(function (e, i) { return [ltr_(i + 1), escapeHtml_(e.name), ltr_(e.total), ltr_(e.pctOfTotal + '%'), ltr_(e.solved), ltr_(e.followup), ltr_(e.open), rateCell(e.resolutionRatePct)]; }));
    html += '<div class="sub">أنواع المشاكل</div>' + table(['نوع المشكلة', 'الإجمالي', 'النسبة', 'تم الحل', 'قيد المتابعة', 'لم يتم الحل', 'نسبة الحل'],
      bundle.byProblemType.map(function (p) { return [escapeHtml_(p.name), ltr_(p.total), ltr_(p.pctOfTotal + '%'), ltr_(p.solved), ltr_(p.followup), ltr_(p.open), rateCell(p.resolutionRatePct)]; }));

    // 04 الملاحظات
    html += '<div class="sec">04 · الملاحظات ونتائج المراجعة</div>';
    if (!findings.length) html += '<div class="call">لا توجد ملاحظات مستخرجة من البيانات.</div>';
    else html += table(['#', 'الملاحظة', 'الدليل', 'الأثر', 'الخطورة / السبب الجذري / المسؤول / الاستحقاق'],
      findings.map(function (f, i) { return [ltr_(i + 1), escapeHtml_(f.title), escapeHtml_(f.evidence), escapeHtml_(f.impact), '<span class="miss">' + MISSING + '</span>']; }));

    // 05 التوصيات
    html += '<div class="sec">05 · التوصيات</div>';
    if (!findings.length) html += '<div class="call">لا توجد توصيات — لا توجد ملاحظات تستدعي إجراءً.</div>';
    else {
      html += table(['المشكلة', 'التأثير', 'الإجراء المطلوب', 'المسؤول', 'الأولوية'],
        findings.map(function (f) { const m = '<span class="miss">' + MISSING + '</span>'; return [escapeHtml_(f.title), escapeHtml_(f.impact), m, m, m]; }));
      html += '<div class="call">لا يتضمن مصدر البيانات إجراءات أو مسؤولين أو أولويات؛ تُستكمل عند اعتماد الإدارة.</div>';
    }

    // 06 الختام
    html += '<div class="sec">06 · الختام والملخص الإداري</div><div class="call">إجمالي المشاكل ' + ltr_(k.total) + '، ونسبة الحل ' + ltr_(k.resolutionRatePct + '%') + '. ' +
      ltr_(k.open) + ' حالة لم يتم حلها و' + ltr_(k.followup) + ' قيد المتابعة. ' + (findings.length ? 'نقاط المتابعة مفصّلة في قسم الملاحظات.' : '') + '</div>';
  }
  html += '<div class="foot">ARRIVE — نظام متابعة Fleet Support &nbsp;|&nbsp; أُصدر في <span class="num">' + now + '</span></div></body></html>';
  return html;
}

function ltr_(v) { return '<span class="num">' + escapeHtml_(v) + '</span>'; }

function escapeHtml_(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
