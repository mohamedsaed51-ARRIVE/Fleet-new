/**
 * Config.gs
 * ------------------------------------------------------------------
 * Single source of truth for sheet names, column positions, and the
 * status-bucket mapping. Change values HERE, not inside Backend.gs.
 * ------------------------------------------------------------------
 */

const CONFIG = {
  SHEET_MASTER_DATA: 'Master Data',
  SHEET_LISTS: 'Lists',
  SHEET_TEMPLATE: 'Template',
  SHEET_SETTINGS: 'Settings',

  // 1-based column indices in "Master Data", matching the real header row.
  COLS: {
    SOURCE_ID: 1,          // SourceID
    LAST_UPDATE: 2,        // Last Update
    RECORD_ID: 3,          // Record ID (entry timestamp)
    DATE: 4,               // التاريخ
    WAYBILL_CODE: 5,       // كود البوليصة
    ACCOUNT: 6,             // Account
    DRIVER: 7,              // اسم المندوب
    BRANCH: 8,              // الفرع
    PROBLEM_TYPE: 9,        // نوع المشكلة
    STATUS: 10,             // حالة الشحنة
    NOTES: 11,              // ملاحظات
    WHATSAPP_SENT: 12,      // تم إرسال واتساب
    SENDER_NOTIFIED: 13,    // تم إبلاغ الراسل
    EMPLOYEE: 14            // اسم الموظفة
    // Columns 15-17 (الشهر / السنة / اليوم) are intentionally NOT used.
    // Month/Year/Day are derived at runtime from DATE (rule #4).
  },

  // Columns in "Lists" sheet used to populate filter dropdowns.
  // NOTE: Employee is deliberately NOT read from here (see approved
  // change) — it is built dynamically from Master Data in Backend.gs.
  LISTS_COLS: {
    BRANCH: 1,        // الفروع
    PROBLEM_TYPE: 2,  // أنواع المشاكل
    STATUS: 3,        // حالة الشحنه
    ACCOUNT: 4         // Account Name
    // Column 5 (أسماء الموظفات) exists in Lists for DATA VALIDATION
    // on the Template sheet only — it is not used for filtering.
  },

  // --- STATUS BUCKET MAPPING (flagged assumption — confirm with client) ---
  // The real "حالة الشحنة" column has 6 distinct values, but the
  // dashboard KPIs/charts need 3 buckets. Adjust this mapping if the
  // business definition differs.
  STATUS_BUCKETS: {
    SOLVED: ['تم الحل', 'تم التسليم'],
    FOLLOWUP: ['جارى الحل', 'تم التاكيد'],
    OPEN: ['لم يتم الحل', 'لم يتم التاكيد']
  },

  BUCKET_LABELS: {
    SOLVED: 'تم الحل',
    FOLLOWUP: 'قيد المتابعة',
    OPEN: 'لم يتم الحل'
  },

  DRIVER_EMPTY_DISPLAY: '—',

  // Cache lifetime (seconds) for computed dashboard payloads.
  CACHE_TTL_SECONDS: 60
};

/**
 * Returns 'SOLVED' | 'FOLLOWUP' | 'OPEN' | 'UNKNOWN' for a raw status string.
 */
function getStatusBucket_(rawStatus) {
  if (!rawStatus) return 'UNKNOWN';
  const s = String(rawStatus).trim();
  for (const bucket in CONFIG.STATUS_BUCKETS) {
    if (CONFIG.STATUS_BUCKETS[bucket].indexOf(s) !== -1) return bucket;
  }
  return 'UNKNOWN'; // status value not covered by the mapping above
}
