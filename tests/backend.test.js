// backend.test.js — اختبارات الباك إند الحقيقي (.gs بدون تعديل) عبر محاكاة Apps Script.
// التشغيل: bash tests/run_all.sh   (أو:  TZ=Africa/Cairo node --test tests/backend.test.js)
// مهم: الاختبارات تعتمد على TZ العملية لمحاكاة Timezone الـ Script، فشغّلها تحت أكثر من TZ.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('./gas-shim');

const L = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi);   // وقت محلي = بتوقيت الـ Script
let n = 0;
// أعمدة Master Data (14): SourceID, LastUpdate, RecordID, التاريخ, كود البوليصة, Account, المندوب, الفرع, نوع المشكلة, الحالة, ملاحظات, واتساب, إبلاغ الراسل, الموظفة
const R = (date, o = {}) => ['S' + (++n), '', L(2026, 1, 1, 9, 0), date, 'WB' + n, o.account || 'A1', o.driver || '', ('branch' in o ? o.branch : 'B1'), o.type || 'T1', ('status' in o ? o.status : 'تم الحل'), o.notes || '', false, false, o.emp || 'E1'];
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
