// اختبار أمان Fleet-new (CSV Formula Injection + XSS) — بيانات اصطناعية فقط، على الباك إند الحقيقي (.gs في vm عبر tests/server.js).
// التشغيل: node tests/security.test.js     ROOT=<مجلد> لاختبار نسخة أخرى.   (playwright + chromium)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const ROOT = process.env.ROOT || path.join(__dirname, '..');
const PORT = 8211;
let pass = 0, fail = 0;
const check = (n, c, extra) => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (c || extra === undefined ? '' : ' ' + JSON.stringify(extra))); };
(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { PORT, MALICIOUS_NAMES: '1' }), cwd: ROOT, stdio: 'ignore' });
  // server.js يقرأ ملفات .gs/index.html نسبةً إلى __dirname/.. ؛ عند ROOT مختلف ننسخ server.js إلى هناك (انظر تشغيل الضابط السالب)
  await new Promise((r) => setTimeout(r, 2500));
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const pg = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  await pg.addInitScript((u) => { try { localStorage.setItem('fleetSupportApiUrl', u); } catch (e) {} }, `http://localhost:${PORT}/exec`);
  await pg.route('**/*', (r) => r.request().url().includes('localhost') ? r.continue() : r.abort());
  await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await pg.waitForSelector('body:not(.is-loading)', { timeout: 20000 });
  await pg.waitForTimeout(1500);
  await pg.click('[data-page="page-reports"]'); await pg.click('#showStatsBtn'); await pg.waitForSelector('.rp-doc'); await pg.waitForTimeout(800);
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#exportExcelBtn')]);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '');
  check('تم تصدير CSV', csv.includes('إجمالى المشاكل'));
  const lines = csv.split('\n');
  check("CSV: الاسم الذي يبدأ بـ = + - @ يُسبق بـ '", csv.includes("\"'=HYPERLINK(\"\"http://x\"\",\"\"c\"\")\"") && csv.includes("\"'+1+1\"") && csv.includes("\"'@SUM(1)\"") && csv.includes("\"'-2+3\""));
  check('CSV: اسم يحوي فاصلة لا يكسر الأعمدة (مغلَّف بعلامات اقتباس)', csv.includes('"فرع, بفاصلة",'));
  check('CSV: اسم عادي لم يتغير ما عدا التغليف', /"الإسكندرية"|"المنصورة"|"طنطا"/.test(csv));
  check('CSV: الأرقام والنسب سليمة (…,<رقم>,…%)', /,\d+,\d+,\d+,\d+,[\d.]+%/.test(csv));
  // XSS (الاسم الرابع حمولة HTML)
  await pg.evaluate(() => { document.querySelectorAll('[data-page]').forEach((e) => e.click()); });
  await pg.waitForTimeout(1200);
  check('XSS: لا تنفيذ لحمولة في اسم فرع', (await pg.evaluate('window.__xss||0')) === 0);
  check('لا أخطاء JavaScript', errs.length === 0, errs.slice(0, 2));
  await b.close(); srv.kill();
  console.log(`\n${pass}/${pass + fail} اختبارًا ناجحًا`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
