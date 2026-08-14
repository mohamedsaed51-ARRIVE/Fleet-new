/**
 * Code.gs
 * ------------------------------------------------------------------
 * Entry point.
 *
 * ===========================  ARCHITECTURE  =========================
 * There is exactly ONE Dashboard in this project: index.html.
 *
 * doGet() renders index.html AS AN APPS SCRIPT TEMPLATE (not a static
 * file), so the real, current deployment URL (ScriptApp.getService().
 * getUrl()) is injected straight into the page every time it loads —
 * see SERVER_API_URL near the top of index.html's <script>. This is
 * what fixes the "stale deployment" symptom: index.html no longer
 * depends on a hand-typed DEFAULT_API_URL that can drift out of date
 * after a redeploy. It always calls itself.
 *
 * index.html still works fine if copied out and hosted elsewhere as a
 * plain static file (the template tag simply won't be there, and it
 * falls back to DEFAULT_API_URL / the ⚙️ settings override) — but the
 * canonical, supported deployment is: doGet() -> index.html, on this
 * Web App's own /exec URL.
 *
 * Dashboard.html + Scripts.html are a legacy, functionally-equivalent
 * copy of the same UI (used google.script.run instead of fetch). They
 * are NOT served by doGet() and are not part of this deployment. Kept
 * only so no history/functionality is lost; safe to ignore or delete
 * once you've confirmed index.html covers everything you need.
 * ======================================================================
 *
 * - doGet() with no "action" param  -> serves index.html (the one and
 *   only Dashboard), with the live API URL injected server-side.
 * - doGet() with an "action" param  -> returns raw JSON only, never
 *   HTML. This is the JSON API index.html calls via fetch().
 *
 * This Web App must be deployed with "Who has access: Anyone" so that
 * fetch() calls (including from the page calling its own /exec URL)
 * are never rejected.
 * ------------------------------------------------------------------
 */

function doGet(e) {
  const params = (e && e.parameter) || {};

  if (params.action) {
    return handleJsonAction_(params);
  }

  const tpl = HtmlService.createTemplateFromFile('index');
  tpl.serverApiUrl = ScriptApp.getService().getUrl();

  return tpl.evaluate()
    .setTitle('نظام متابعة Fleet Support — ARRIVE')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function handleJsonAction_(params) {
  const filters = {
    dateFrom: params.dateFrom || null,
    dateTo: params.dateTo || null,
    branch: params.branch || null,
    employee: params.employee || null,
    account: params.account || null,
    driver: params.driver || null,
    problemType: params.problemType || null,
    statusBucket: params.statusBucket || null,
    search: params.search || null
  };

  let payload;
  try {
    switch (params.action) {
      case 'kpis': payload = getKPIs(filters); break;
      case 'branchPerformance': payload = getBranchPerformance(filters); break;
      case 'employeePerformance': payload = getEmployeePerformance(filters); break;
      case 'accountBreakdown': payload = getAccountBreakdown(filters); break;
      case 'problemTypeBreakdown': payload = getProblemTypeBreakdown(filters); break;
      case 'dailyTrend': payload = getDailyTrend(filters); break;
      case 'openCases': payload = getOpenCases(filters); break;
      case 'filterOptions': payload = getFilterOptions(); break;
      case 'reportsBundle': payload = getReportsBundle(filters); break;
      case 'dailyStatusBreakdown': payload = getDailyStatusBreakdown(filters); break;
      case 'managementReportPdf': payload = getManagementReportPdf(filters); break;
      case 'fullAppData': payload = getFullAppData(filters); break;
      case 'refresh': payload = refreshAndGetFullAppData(filters); break;
      case 'monthComparison':
        payload = getMonthComparison(params.field || 'branch', params.monthA, params.monthB, filters);
        break;
      default:
        return jsonOutput_({ ok: false, error: 'Unknown action: ' + params.action });
    }
    return jsonOutput_({ ok: true, action: params.action, data: payload });
  } catch (err) {
    return jsonOutput_({ ok: false, action: params.action, error: err.message });
  }
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Single bundled call used by Scripts.html on page load and on every
 * filter change / refresh — minimizes google.script.run round trips.
 */
function getFullAppData(filters) {
  return {
    filterOptions: getFilterOptions(),
    kpis: getKPIs(filters),
    byBranch: getBranchPerformance(filters),
    byEmployee: getEmployeePerformance(filters),
    byAccount: getAccountBreakdown(filters),
    byProblemType: getProblemTypeBreakdown(filters),
    dailyTrend: getDailyTrend(filters),
    openCases: getOpenCases(filters)
  };
}

/** Called by the Refresh button before re-fetching data. */
function refreshAndGetFullAppData(filters) {
  clearDataCache();
  return getFullAppData(filters);
}
