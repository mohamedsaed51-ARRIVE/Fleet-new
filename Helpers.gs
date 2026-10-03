/**
 * Helpers.gs
 * ------------------------------------------------------------------
 * Defensive helpers shared across the backend. Date parsing lives
 * here because "التاريخ" in Master Data is not consistently typed
 * (real Date objects in most rows, malformed text in some).
 * ------------------------------------------------------------------
 */

/**
 * Best-effort parse of a raw "التاريخ" cell value into a JS Date.
 * Returns null if the value can't be confidently parsed — callers
 * MUST treat null as "no valid date" rather than guessing further.
 */
function parseDateValue_(raw) {
  if (raw === null || raw === undefined || raw === '') return null;

  // Case 1: Sheets already gave us a real Date object.
  if (Object.prototype.toString.call(raw) === '[object Date]') {
    return isNaN(raw.getTime()) ? null : raw;
  }

  const str = String(raw).trim();
  if (!str) return null;

  // Case 2: standard-ish separators (D/M/YYYY, D-M-YYYY, YYYY-MM-DD, etc.)
  // Try native parsing first.
  const native = new Date(str);
  if (!isNaN(native.getTime()) && /\d{4}/.test(str)) {
    return native;
  }

  // Case 3: malformed single-slash pattern seen in real data, e.g. "4/82026"
  // meaning day=4, month=8, year=2026 (month+year glued together with no
  // separator). Heuristic: one slash, second segment is 5 digits where the
  // first digit is a valid month (1-9) and the rest is a 4-digit year.
  const m = str.match(/^(\d{1,2})\/(\d{5})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const monthDigit = parseInt(m[2].charAt(0), 10);
    const year = parseInt(m[2].substring(1), 10);
    if (monthDigit >= 1 && monthDigit <= 9 && day >= 1 && day <= 31 && year > 2000) {
      const guessed = new Date(year, monthDigit - 1, day);
      if (!isNaN(guessed.getTime())) return guessed;
    }
  }

  // Could not parse — caller should count this as "invalid date", not drop silently.
  return null;
}

/**
 * يحوّل قيمة فلتر تاريخ قادمة من الواجهة/الـ API إلى 'yyyy-MM-dd' (يوم تقويم).
 * يقبل 'yyyy-MM-dd' أو ISO يبدأ بنفس الشكل. فارغ => null (لا فلتر). غير صالح => يرمي خطأ واضحًا
 * (بدل نتيجة فاضية صامتة)، فيعود من الـ API كـ { ok:false, error }.
 */
function normalizeFilterDate_(v, name) {
  if (v === null || v === undefined || v === '') return null;
  const m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d) return m[1] + '-' + m[2] + '-' + m[3];
  }
  throw new Error('Invalid ' + (name || 'date') + ' filter (expected yyyy-MM-dd): ' + v);
}

/** Returns 'YYYY-MM-DD' for a Date, in the script's timezone. */
function toDateKey_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** Returns 'YYYY-MM' for a Date, in the script's timezone. */
function toMonthKey_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM');
}

/** Trims and normalizes a cell value to a display string, or '' if empty. */
function cleanString_(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** Returns true if a string value is non-empty after trimming. */
function hasValue_(v) {
  return cleanString_(v) !== '';
}

/** Safe percentage: 0 when denominator is 0, rounded to 1 decimal. */
function pct_(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** Builds a lookup Set-like object from a flat array (normalized). */
function toSet_(arr) {
  const set = {};
  arr.forEach(v => {
    const c = cleanString_(v);
    if (c) set[c] = true;
  });
  return set;
}

/**
 * Includes another HTML file's content inline. Standard Apps Script
 * templating pattern — used by Dashboard.html to pull in Styles.html
 * and Scripts.html.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
