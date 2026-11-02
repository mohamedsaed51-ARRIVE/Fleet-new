// backend.test.js — اختبارات الباك إند الحقيقي (.gs بدون تعديل) عبر محاكاة Apps Script.
// التشغيل: bash tests/run_all.sh   (أو:  TZ=Africa/Cairo node --test tests/backend.test.js)
// مهم: الاختبارات تعتمد على TZ العملية لمحاكاة Timezone الـ Script، فشغّلها تحت أكثر من TZ.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('./gas-shim');

const L = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi);   // وقت محلي = بتوقيت الـ Script
let n = 0;
// أعمدة Master Data (14): SourceID, LastUpdate, RecordID, التاريخ, كود البوليصة, Account, المندوب, الفرع, نوع المشكلة, الحالة, ملاحظات, واتساب, إبلاغ الراسل, الموظفة
const R = (date, o = {}) => ['S' + (++n), '', ('rid' in o ? o.rid : L(2026, 1, 1, 9, 0)), date, 'WB' + n, o.account || 'A1', o.driver || '', ('branch' in o ? o.branch : 'B1'), o.type || 'T1', ('status' in o ? o.status : 'تم الحل'), o.notes || '', o.wa === true, o.sn === true, o.emp || 'E1'];
const mk = (rows, extra) => createBackend(Object.assign({ rows }, extra || {}));
const total = (b, f) => { const r = b.ctx.api(Object.assign({ action: 'kpis' }, f || {})); assert.equal(r.ok, true, JSON.stringify(r)); return r.data.total; };

/* ------------------------------ Date filtering ------------------------------ */
test('date: أول يوم في الفترة (تاريخ بدون وقت) يدخل', () => {
  const b = mk([R(L(2026, 8, 1)), R(L(2026, 8, 2))]);
  assert.equal(total(b, { dateFrom: '2026-08-01' }), 2);
});
test('date: آخر يوم في الفترة (تاريخ بدون وقت وبوقت 23:59) يدخل', () => {
  const b = mk([R(L(2026, 8, 31)), R(L(2026, 8, 31, 23, 59)), R(L(2026, 9, 1))]);
  assert.equal(total(b, { dateTo: '2026-08-31' }), 2);
});
test('date: نفس اليوم (from = to) يرجّع كل سجلات اليوم فقط', () => {
  const b = mk([R(L(2026, 8, 5)), R(L(2026, 8, 5, 0, 1)), R(L(2026, 8, 5, 23, 59)), R(L(2026, 8, 4, 23, 59)), R(L(2026, 8, 6))]);
  assert.equal(total(b, { dateFrom: '2026-08-05', dateTo: '2026-08-05' }), 3);
});
test('date: حدود الشهر (يوليو|أغسطس)', () => {
  const b = mk([R(L(2026, 7, 31)), R(L(2026, 7, 31, 23, 59)), R(L(2026, 8, 1)), R(L(2026, 8, 1, 0, 0))]);
  assert.equal(total(b, { dateTo: '2026-07-31' }), 2);
  assert.equal(total(b, { dateFrom: '2026-08-01' }), 2);
});
test('date: تاريخ بوقت — يُحتسب بيوم التقويم لا بالساعة', () => {
  const b = mk([R(L(2026, 8, 10, 0, 0)), R(L(2026, 8, 10, 13, 30)), R(L(2026, 8, 10, 23, 59))]);
  assert.equal(total(b, { dateFrom: '2026-08-10', dateTo: '2026-08-10' }), 3);
});
test('date: تاريخ فاضي — يظهر بدون فلتر ويُستبعد مع فلتر تاريخ', () => {
  const b = mk([R(''), R(L(2026, 8, 1))]);
  assert.equal(total(b), 2);
  assert.equal(total(b, { dateFrom: '2026-01-01' }), 1);
  assert.equal(total(b, { dateTo: '2026-12-31' }), 1);
});
test('date: تاريخ غير صالح — يُعدّ في invalidDateRowCount ويُستبعد مع فلتر تاريخ', () => {
  const b = mk([R('تاريخ خاطئ'), R(L(2026, 8, 1))]);
  const k = b.ctx.api({ action: 'kpis' }).data;
  assert.equal(k.total, 2); assert.equal(k.invalidDateRowCount, 1);
  assert.equal(total(b, { dateFrom: '2026-01-01' }), 1);
});
test('date: صيغة "4/82026" المشوّهة تُقرأ يوم 4 / شهر 8 / 2026', () => {
  const b = mk([R('4/82026')]);
  assert.equal(total(b, { dateFrom: '2026-08-04', dateTo: '2026-08-04' }), 1);
});
test('date: صيغة فلتر غير صالحة → رد خطأ واضح (ok:false) وليس نتيجة فاضية صامتة', () => {
  const b = mk([R(L(2026, 8, 1))]);
  const r = b.ctx.api({ action: 'kpis', dateFrom: 'abc' });
  assert.equal(r.ok, false); assert.match(r.error, /dateFrom/);
});
test('date: الاتجاه اليومي وفلتر الفترة متسقين (مجموع الأيام = الإجمالي المفلتر)', () => {
  const b = mk([R(L(2026, 8, 1)), R(L(2026, 8, 1, 22, 0)), R(L(2026, 8, 2)), R(L(2026, 8, 3))]);
  const f = { dateFrom: '2026-08-01', dateTo: '2026-08-02' };
  const t = b.ctx.api(Object.assign({ action: 'dailyTrend' }, f)).data;
  assert.deepEqual(t.map(x => [x.date, x.total]), [['2026-08-01', 2], ['2026-08-02', 1]]);
  assert.equal(total(b, f), 3);
});
test('date: المقارنة الشهرية تستخدم نفس مفتاح اليوم (أول الشهر لا يقع في الشهر السابق)', () => {
  const b = mk([R(L(2026, 7, 31)), R(L(2026, 8, 1)), R(L(2026, 8, 1, 23, 59))]);
  const r = b.ctx.api({ action: 'monthComparison', field: 'branch', monthA: '2026-07', monthB: '2026-08' }).data;
  assert.equal(r.summary.totalA, 1); assert.equal(r.summary.totalB, 2);
});

/* ------------------------------ KPIs ------------------------------ */
test('kpi: dataset فاضية — أصفار بدون NaN', () => {
  const b = mk([]);
  const k = b.ctx.api({ action: 'kpis' }).data;
  assert.equal(k.total, 0); assert.equal(k.resolutionRatePct, 0);
  assert.ok(Object.values(k).every(v => Number.isFinite(v)));
  assert.deepEqual(b.ctx.api({ action: 'branchPerformance' }).data, []);
});
test('kpi: مقام صفر بعد الفلترة', () => {
  const b = mk([R(L(2026, 8, 1))]);
  assert.equal(b.ctx.api({ action: 'kpis', branch: 'غير موجود' }).data.resolutionRatePct, 0);
});
test('kpi: حالة غير مصنفة (UNKNOWN) تدخل في الإجمالي وخارج الفئات الثلاث — السلوك الحالي موثّق', () => {
  const b = mk([R(L(2026, 8, 1), { status: 'تم الحل' }), R(L(2026, 8, 1), { status: 'حالة غريبة' }), R(L(2026, 8, 1), { status: '' })]);
  const k = b.ctx.api({ action: 'kpis' }).data;
  assert.equal(k.total, 3); assert.equal(k.solved, 1); assert.equal(k.unknownStatus, 2);
  assert.equal(k.solved + k.followup + k.open + k.unknownStatus, k.total);
  assert.equal(k.resolutionRatePct, 33.3);   // المقام = الإجمالي شامل UNKNOWN (قاعدة حالية لم تتغير)
});
test('kpi: dataset عادية — تصنيف الفئات والنسب', () => {
  const st = ['تم الحل', 'تم التسليم', 'جارى الحل', 'تم التاكيد', 'لم يتم الحل', 'لم يتم التاكيد', 'لم يتم الحل', 'تم الحل'];
  const b = mk(st.map(s => R(L(2026, 8, 1), { status: s })));
  const k = b.ctx.api({ action: 'kpis' }).data;
  assert.deepEqual([k.total, k.solved, k.followup, k.open], [8, 3, 2, 3]);
  assert.equal(k.resolutionRatePct, 37.5);
});
test('kpi: التجميع حسب الفرع يطابق الإجمالي', () => {
  const b = mk([R(L(2026, 8, 1), { branch: 'X' }), R(L(2026, 8, 1), { branch: 'X' }), R(L(2026, 8, 1), { branch: 'Y' }), R(L(2026, 8, 1), { branch: '' })]);
  const g = b.ctx.api({ action: 'branchPerformance' }).data;
  assert.equal(g.reduce((s, r) => s + r.total, 0), 4);
  assert.ok(g.some(r => r.name === '(بدون قيمة)'));
});

/* ------------------------------ Filters ------------------------------ */
const mixed = () => mk([
  R(L(2026, 8, 1), { branch: 'X', status: 'تم الحل', emp: 'E1' }), R(L(2026, 8, 2), { branch: 'X', status: 'جارى الحل', emp: 'E2' }),
  R(L(2026, 8, 3), { branch: 'Y', status: 'لم يتم الحل', emp: 'E1', account: 'ZZ-Special' }), R(L(2026, 9, 1), { branch: 'Y', status: 'تم الحل', emp: 'E2' })]);
test('filters: فرع', () => assert.equal(total(mixed(), { branch: 'X' }), 2));
test('filters: فئة الحالة', () => assert.equal(total(mixed(), { statusBucket: 'SOLVED' }), 2));
test('filters: فترة', () => assert.equal(total(mixed(), { dateFrom: '2026-08-02', dateTo: '2026-08-31' }), 2));
test('filters: فلاتر متعددة معًا', () => assert.equal(total(mixed(), { branch: 'Y', statusBucket: 'SOLVED', dateFrom: '2026-08-01' }), 1));
test('filters: بحث نصي', () => assert.equal(total(mixed(), { search: 'zz-spec' }), 1));
test('filters: إعادة الضبط (بدون فلاتر) ترجّع الكل', () => { const b = mixed(); total(b, { branch: 'X' }); assert.equal(total(b), 4); });
test('filters: الحالات المفتوحة تتجاهل فلتر الحالة وتستثني المحلولة', () => {
  const r = mixed().ctx.api({ action: 'openCases', statusBucket: 'SOLVED' }).data;
  assert.equal(r.length, 2);
});

/* ------------------------------ API ------------------------------ */
test('api: طلب صحيح يرجّع ok:true + action + data', () => {
  const r = mixed().ctx.api({ action: 'kpis' }); assert.equal(r.ok, true); assert.equal(r.action, 'kpis'); assert.ok(r.data);
});
test('api: action مجهول → ok:false', () => {
  const r = mixed().ctx.api({ action: 'nope' }); assert.equal(r.ok, false); assert.match(r.error, /Unknown action/);
});
test('api: نتيجة فاضية صالحة', () => {
  const b = mixed();
  assert.deepEqual(b.ctx.api({ action: 'openCases', branch: 'zzz' }).data, []);
  assert.deepEqual(b.ctx.api({ action: 'dailyTrend', branch: 'zzz' }).data, []);
});
test('api: غياب شيت Master Data → ok:false برسالة واضحة', () => {
  const b = mixed(); delete b.sheets['Master Data'];
  const r = b.ctx.api({ action: 'kpis' }); assert.equal(r.ok, false); assert.match(r.error, /Master Data/);
});
test('api: fullAppData يحتوي كل الأجزاء وبتناسق (total = مجموع الفروع)', () => {
  const d = mixed().ctx.api({ action: 'fullAppData' }).data;
  assert.equal(d.kpis.total, d.byBranch.reduce((s, r) => s + r.total, 0));
  assert.equal(d.kpis.total, d.dailyTrend.reduce((s, r) => s + r.total, 0));
  for (const k of ['filterOptions', 'kpis', 'byBranch', 'byEmployee', 'byAccount', 'byProblemType', 'dailyTrend', 'openCases']) assert.ok(k in d, k);
});
test('api: reportsBundle متسق مع KPIs', () => {
  const b = mixed(); const r = b.ctx.api({ action: 'reportsBundle' }).data;
  assert.equal(r.kpis.total, total(b));
  assert.equal(r.dailyStatusBreakdown.grandTotal.total, r.dailyTrend.reduce((s, x) => s + x.total, 0));
});
test('api: تقرير PDF يرجّع base64 غير فاضي', () => {
  const r = mixed().ctx.api({ action: 'managementReportPdf' }); assert.equal(r.ok, true); assert.ok(r.data.base64.length > 100);
});

/* ------------------------------ Performance / Cache ------------------------------ */
const big = n => { const rows = []; for (let i = 0; i < n; i++) rows.push(R(L(2026, 1 + (i % 9), 1 + (i % 27), i % 24), { branch: 'فرع ' + (i % 7), status: ['تم الحل', 'جارى الحل', 'لم يتم الحل'][i % 3], notes: 'ملاحظة طويلة بالعربي لزيادة الحجم '.repeat(2) + i })); return rows; };
test('perf: طلب fullAppData يقرأ Master Data مرة واحدة فقط', () => {
  const b = mk(big(50)); b.ctx.api({ action: 'fullAppData' }); assert.equal(b.stats.sheetReads, 1);
});
test('perf: بيانات أكبر من حد الكاش (بالبايت) — لا أخطاء، والكاش يعمل بين الطلبات', () => {
  const b = mk(big(1500));
  const first = b.ctx.api({ action: 'kpis' }).data;
  assert.equal(b.stats.cacheRejected, 0, 'لا يجب أن يُرفض أي put لتجاوز الحد');
  assert.ok(b.stats.cachePuts > 1, 'الكاش مقسّم على أكثر من مفتاح');
  b.ctx.RECORDS_MEMO_ = null;                                  // محاكاة طلب جديد (تنفيذ جديد)
  const reads = b.stats.sheetReads;
  const second = b.ctx.api({ action: 'kpis' }).data;
  assert.equal(b.stats.sheetReads, reads, 'الطلب الثاني من الكاش بدون قراءة الشيت');
  assert.deepEqual(second, first);
});
test('perf: نتائج الفلترة بالتاريخ ثابتة بين تنفيذ بكاش دافئ وتنفيذ بارد', () => {
  const b = mk(big(1500)); const f = { dateFrom: '2026-03-01', dateTo: '2026-05-31' };
  const cold = total(b, f); b.ctx.RECORDS_MEMO_ = null; assert.equal(total(b, f), cold);
});
test('perf: بيانات أكبر من سقف الكاش الكلي — تعمل بدون كاش وبدون أخطاء', () => {
  const b = mk(big(9000));
  assert.equal(total(b), 9000); assert.equal(b.stats.cacheRejected, 0);
});
test('perf: clearDataCache يمسح كل قطع الكاش (refresh يعيد القراءة)', () => {
  const b = mk(big(1500)); total(b); b.ctx.api({ action: 'refresh' });
  assert.ok(b.stats.sheetReads >= 2);
});
test('perf: تلف قطعة كاش لا يكسر الطلب — يُعاد البناء من الشيت', () => {
  const b = mk(big(1500)); const t = total(b);
  const k = Object.keys(b.cacheStore).find(x => /chunk/.test(x)) || Object.keys(b.cacheStore)[1];
  b.cacheStore[k] = '{bad'; b.ctx.RECORDS_MEMO_ = null;
  assert.equal(total(b), t);
});

/* ------------------------------ تطابق ألوان تقرير PDF مع Design System ------------------------------ */
test('design: RPT_TOKENS_ (Reports.gs) مطابقة لـ tokens في DesignSystem.html', () => {
  const fs = require('fs'), path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'DesignSystem.html'), 'utf8');
  const v = name => { const m = css.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})')); assert.ok(m, 'token غير موجود: ' + name); return m[1].toUpperCase(); };
  const map = { blue: 'arrive-blue', teal: 'arrive-teal', navy: 'arrive-navy', light: 'arrive-light-blue', gray: 'arrive-gray', blue800: 'arrive-blue-800',
    g50: 'gray-50', g100: 'gray-100', g200: 'gray-200', g300: 'gray-300',
    success: 'status-success', successBg: 'status-success-bg', successFg: 'status-success-fg',
    warn: 'status-under-action', warnBg: 'status-under-action-bg', warnFg: 'status-under-action-fg',
    bad: 'status-violation', badBg: 'status-violation-bg', badFg: 'status-violation-fg' };
  const T = createBackend({}).ctx.__tokens;
  for (const k of Object.keys(map)) assert.equal(String(T[k]).toUpperCase(), v(map[k]), k);
});

/* ------------------------------ Analytics (تحليل الفريق / الفترات / النتائج) ------------------------------ */
const an = (b, f) => { const r = b.ctx.api(Object.assign({ action: 'analytics' }, f || {})); assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };

test('analytics: نسبة الحل والتأكيد بمقامين منفصلين (تسليم/جارى الحل خارج النسبتين)', () => {
  const st = ['تم الحل', 'تم الحل', 'تم الحل', 'لم يتم الحل', 'تم التاكيد', 'لم يتم التاكيد', 'لم يتم التاكيد', 'تم التسليم', 'جارى الحل', 'حالة غريبة'];
  const t = an(mk(st.map(s => R(L(2026, 8, 1), { status: s })))).team;
  assert.deepEqual([t.total, t.resolved, t.unresolved, t.confirmed, t.notConfirmed, t.delivered, t.inProgress, t.otherStatus], [10, 3, 1, 1, 2, 1, 1, 1]);
  assert.equal(t.solveRatePct, 75); assert.equal(t.confirmRatePct, 33.3);
  assert.equal(t.resolved + t.unresolved + t.confirmed + t.notConfirmed + t.delivered + t.inProgress + t.otherStatus, t.total);
});
test('analytics: مقام صفر => null وليس 0%', () => {
  const t = an(mk([R(L(2026, 8, 1), { status: 'تم الحل' })])).team;
  assert.equal(t.solveRatePct, 100); assert.equal(t.confirmRatePct, null);
});
test('analytics: dataset فاضية بدون أخطاء', () => {
  const a = an(mk([]));
  assert.equal(a.team.total, 0); assert.deepEqual(a.monthly, []); assert.deepEqual(a.senders, []);
  assert.equal(a.periods.weekday.rows.every(r => r.total === 0 && !r.isPeak), true);
});
test('analytics: الأرقام الشهرية بدون ثغرات + فرق عن الشهر السابق', () => {
  const b = mk([R(L(2026, 1, 5)), R(L(2026, 1, 6)), R(L(2026, 3, 1)), R(L(2026, 3, 2)), R(L(2026, 3, 3)), R(L(2026, 3, 4), { status: 'لم يتم الحل' })]);
  const m = an(b).monthly;
  assert.deepEqual(m.map(x => [x.month, x.total]), [['2026-01', 2], ['2026-02', 0], ['2026-03', 4]]);
  assert.equal(m[0].diffVsPrev, null); assert.equal(m[1].diffVsPrev, -2); assert.equal(m[2].changePctVsPrev, null);   // السابق صفر => لا نسبة
  assert.equal(m[2].solveRatePct, 75); assert.equal(m[1].solveRatePct, null);
});
test('analytics: الشهور تستثني السجلات بلا تاريخ صالح ومجموعها = إجمالي المؤرخ', () => {
  const b = mk([R(L(2026, 1, 5)), R(''), R('خطأ'), R(L(2026, 2, 5))]);
  const a = an(b);
  assert.equal(a.monthly.reduce((s, x) => s + x.total, 0), 2); assert.equal(a.team.total, 4);
});
test('analytics: مصفوفة الموظفة × الشهر تطابق الشهري', () => {
  const b = mk([R(L(2026, 1, 5), { emp: 'E1' }), R(L(2026, 1, 6), { emp: 'E2' }), R(L(2026, 2, 6), { emp: 'E1' }), R(L(2026, 2, 7), { emp: 'E1' })]);
  const em = an(b).employeeMonthly;
  assert.deepEqual(em.months, ['2026-01', '2026-02']);
  assert.deepEqual(em.rows.map(r => [r.name, r.counts, r.total]), [['E1', [1, 2], 3], ['E2', [1, 0], 1]]);
});
test('analytics: يوم الأسبوع — الترتيب سبت→جمعة والذروة', () => {
  // 2026-08-01 سبت ، 2026-08-02 أحد ، 2026-08-09 أحد
  const b = mk([R(L(2026, 8, 1), { branch: 'X' }), R(L(2026, 8, 2), { branch: 'X' }), R(L(2026, 8, 2), { branch: 'Y' }), R(L(2026, 8, 9), { branch: 'X' })]);
  const w = an(b).periods.weekday;
  assert.deepEqual(w.rows.map(r => r.label), ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة']);
  assert.deepEqual(w.rows.map(r => r.total), [1, 3, 0, 0, 0, 0, 0]);
  assert.deepEqual(w.rows.map(r => r.isPeak), [false, true, false, false, false, false, false]);
  assert.deepEqual(w.rows[1].topBranches, [{ name: 'X', total: 2 }, { name: 'Y', total: 1 }]);
});
test('analytics: أسابيع الشهر (1-7 / 8-14 / 15-21 / 22+)', () => {
  const b = mk([R(L(2026, 8, 7)), R(L(2026, 8, 8)), R(L(2026, 8, 21)), R(L(2026, 8, 22)), R(L(2026, 8, 31))]);
  assert.deepEqual(an(b).periods.monthPart.rows.map(r => r.total), [1, 1, 1, 2]);
});
test('analytics: فترات اليوم من وقت التسجيل (Record ID) وسجل بلا وقت يُحصى كـ missing', () => {
  const b = mk([R(L(2026, 8, 1), { rid: L(2026, 8, 1, 9, 5) }), R(L(2026, 8, 1), { rid: L(2026, 8, 1, 10, 59) }), R(L(2026, 8, 1), { rid: L(2026, 8, 1, 14, 0) }), R(L(2026, 8, 1), { rid: '' })]);
  const h = an(b).periods.hour;
  assert.deepEqual(h.rows.map(r => [r.label, r.total]), [['8ص – 10ص', 1], ['10ص – 12م', 1], ['2م – 4م', 1]]);
  assert.equal(h.missing, 1);
  assert.deepEqual(h.rows.map(r => r.total), [1, 1, 1]);
});
test('analytics: ذروة فترة اليوم + أكثر فرع في الفترة', () => {
  const at = (hh, branch) => R(L(2026, 8, 1), { rid: L(2026, 8, 1, hh, 0), branch });
  const h = an(mk([at(9, 'X'), at(9, 'X'), at(8, 'Y'), at(13, 'Z')])).periods.hour;   // 8-10: 3 حالات
  const peak = h.rows.filter(r => r.isPeak);
  assert.equal(peak.length, 1); assert.equal(peak[0].total, 3);
  assert.deepEqual(peak[0].topBranches[0], { name: 'X', total: 2 });
});
test('analytics: أعلى أنواع المشاكل مع أعداد الحل والتأكيد', () => {
  const rows = [['T1', 'تم الحل'], ['T1', 'تم الحل'], ['T1', 'تم التاكيد'], ['T2', 'لم يتم الحل'], ['T2', 'لم يتم التاكيد']].map(([t, s]) => R(L(2026, 8, 1), { type: t, status: s }));
  const p = an(mk(rows)).problemTypes;
  assert.deepEqual(p.map(x => [x.name, x.total, x.resolved, x.confirmed]), [['T1', 3, 2, 1], ['T2', 2, 0, 0]]);
  assert.equal(p[0].pctOfTotal, 60);
});
test('analytics: الراسلون (Account) وأكثر نوع مشكلة لكل راسل', () => {
  const rows = [['A1', 'T1'], ['A1', 'T1'], ['A1', 'T2'], ['A2', 'T2']].map(([a, t]) => R(L(2026, 8, 1), { account: a, type: t }));
  const s = an(mk(rows)).senders;
  assert.deepEqual(s.map(x => [x.name, x.total]), [['A1', 3], ['A2', 1]]);
  assert.deepEqual(s[0].topProblemType, { name: 'T1', total: 2 });
});
test('analytics: المناديب — السجلات بلا مندوب تُستبعد وتُحصى', () => {
  const rows = [R(L(2026, 8, 1), { driver: 'D1', branch: 'X' }), R(L(2026, 8, 1), { driver: 'D1', branch: 'X' }), R(L(2026, 8, 1), { driver: 'D2', branch: 'Y' }), R(L(2026, 8, 1))];
  const a = an(mk(rows));
  assert.deepEqual(a.drivers.map(d => [d.name, d.total]), [['D1', 2], ['D2', 1]]);
  assert.equal(a.driverMissingCount, 1); assert.equal(a.team.drivers, 2);
  assert.deepEqual(a.drivers[0].topBranch, { name: 'X', total: 2 });
});
test('analytics: واتساب/إبلاغ الراسل وفلاتر الـ API تنطبق على التحليل', () => {
  const b = mk([R(L(2026, 8, 1), { wa: true, sn: true, branch: 'X' }), R(L(2026, 8, 1), { wa: true, branch: 'X' }), R(L(2026, 8, 1), { branch: 'Y' })]);
  const t = an(b).team;
  assert.deepEqual([t.whatsappSent, t.senderNotified, t.whatsappPct, t.senderNotifiedPct], [2, 1, 66.7, 33.3]);
  assert.equal(an(b, { branch: 'Y' }).team.total, 1);
});
test('analytics: مجاميع الفروع والموظفين = الإجمالي، وتصل ضمن fullAppData', () => {
  const b = mk([R(L(2026, 8, 1), { branch: 'X', emp: 'E1' }), R(L(2026, 8, 1), { branch: 'Y', emp: 'E2' }), R(L(2026, 8, 1), { branch: '', emp: 'E2' })]);
  const a = an(b);
  assert.equal(a.branchOutcome.reduce((s, x) => s + x.total, 0), 3); assert.equal(a.employeeOutcome.reduce((s, x) => s + x.total, 0), 3);
  const full = b.ctx.api({ action: 'fullAppData' }).data;
  assert.equal(full.analytics.team.total, 3);
});
