/**
 * Code.gs
 * ------------------------------------------------------------------
 * Entry point.
 *
 * - doGet() with no "action" param  -> serves the Apps-Script-hosted
 *   Dashboard web app (Dashboard.html + Styles.html + Scripts.html),
 *   using google.script.run internally.
 * - doGet() with an "action" param  -> returns raw JSON. This is what
 *   the STANDALONE index.html (a separate, self-contained file that
 *   can be opened locally / hosted anywhere) calls via fetch().
 * - All functions below are also directly callable from Scripts.html
 *   via google.script.run.<functionName>(...).
 *
 * IMPORTANT for the standalone index.html to work: this Web App must
 * be deployed with "Who has access: Anyone" — otherwise cross-origin
 * fetch() calls from outside script.google.com will be rejected.
 * ------------------------------------------------------------------
 */

function doGet(e) {
  const params = (e && e.parameter) || {};

  if (params.action) {
    return handleJsonAction_(params);
  }

  return HtmlService.createTemplateFromFile('Dashboard')
    .evaluate()
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
