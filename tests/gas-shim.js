// gas-shim.js — يشغّل ملفات .gs الحقيقية (بدون تعديل) داخل vm مع محاكاة لخدمات Apps Script.
// ملاحظة: الـ Timezone الخاص بالـ Script يُحاكى بـ TZ الخاص بعملية node (مثال: TZ=Africa/Cairo node ...).
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');

const mkSheet = data => ({
  getLastRow: () => data.length,
  getRange: (r, c, nr, nc) => ({
    getValues: () => data.slice(r - 1, r - 1 + nr).map(row => { const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); return o; })
  })
});

/**
 * opts: { rows: [[14 cols]...], lists: [[hdr..],[..]], cacheLimitBytes, port }
 * يرجع { ctx, stats, cacheStore } — stats.sheetReads = عدد قراءات getValues على Master Data.
 */
function createBackend(opts) {
  opts = opts || {};
  const rows = opts.rows || [];
  const lists = opts.lists || [['الفروع', 'أنواع', 'حالة', 'Account']];
  const stats = { sheetReads: 0, cachePuts: 0, cacheRejected: 0 };
  const master = mkSheet([[...Array(14)].map(() => 'h'), ...rows]);
  const origGet = master.getRange;
  master.getRange = (...a) => { const g = origGet(...a); const gv = g.getValues; return { getValues: () => { stats.sheetReads++; return gv(); } }; };
  const sheets = { 'Master Data': master, 'Lists': mkSheet(lists) };
  const cacheStore = {};
  const limit = opts.cacheLimitBytes || 100 * 1024;   // حد Apps Script الفعلي لكل قيمة (بالبايت)
  const cache = {
    get: k => (k in cacheStore ? cacheStore[k] : null),
    put: (k, v) => { if (Buffer.byteLength(String(v), 'utf8') > limit) { stats.cacheRejected++; throw new Error('Argument too large: value'); } stats.cachePuts++; cacheStore[k] = v; },
    putAll: o => Object.keys(o).forEach(k => cache.put(k, o[k])),
    getAll: ks => { const out = {}; ks.forEach(k => { if (k in cacheStore) out[k] = cacheStore[k]; }); return out; },
    remove: k => { delete cacheStore[k]; },
    removeAll: ks => ks.forEach(k => delete cacheStore[k])
  };
  const port = opts.port || 8123;
  const p2 = n => String(n).padStart(2, '0');
  const ctx = {
    console, Date, JSON, Math, Object, Array, String, Number, RegExp, Error, Set, Map, parseInt, parseFloat, isNaN, Boolean,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }) },
    CacheService: { getScriptCache: () => cache },
    Session: { getScriptTimeZone: () => process.env.TZ || 'UTC' },
    Utilities: {
      formatDate: (d, tz, f) => f.replace('yyyy', d.getFullYear()).replace('MM', p2(d.getMonth() + 1)).replace('dd', p2(d.getDate())).replace('HH', p2(d.getHours())).replace('mm', p2(d.getMinutes())),
      base64Encode: b => Buffer.from(b).toString('base64')
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'http://localhost:' + port + '/exec' }) },
    HtmlService: { createHtmlOutput: html => ({ getAs: () => ({ setName() { return this; }, getBytes: () => Buffer.from(html) }) }), XFrameOptionsMode: { ALLOWALL: 1 } }
  };
  vm.createContext(ctx);
  for (const f of ['Config', 'Helpers', 'Backend', 'Assets', 'Reports', 'Code']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f + '.gs'), 'utf8') + '\n;', ctx, { filename: f + '.gs' });
  }
  vm.runInContext('this.__CONFIG=CONFIG;this.__tokens=RPT_TOKENS_;', ctx);
  /** استدعاء الـ API كما تفعل الواجهة (doGet) وإرجاع JSON مُحلَّل. */
  ctx.api = params => JSON.parse(ctx.doGet({ parameter: params }).s);
  return { ctx, stats, cacheStore, sheets };
}
module.exports = { createBackend, ROOT };
