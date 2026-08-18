// The Analytics view is read-only reference. It opens with a humanized overview
// strip (headline rates as percentages, where a percentage is the honest
// reading), collapses the occasional filter behind a calm disclosure, and then
// frames the deep count tables — which stay authoritative and keep their exact
// numerator/denominator values because several of the "rates" are ratios, not
// percentages — around the operator's improvement decisions. Each band leads
// with its key metric and folds the exhaustive breakdowns behind a native
// disclosure. Every `<tbody id>`, `<th>` set, and column order the served
// analytics scripts depend on is preserved verbatim.

/** @param {string} id @param {string[]} headers */
const table = (id, headers) =>
  "<table><thead><tr>" +
  headers.map((header) => `<th>${header}</th>`).join("") +
  `</tr></thead><tbody id="${id}"></tbody></table>`;

/** @param {string} title @param {string} tableMarkup */
const metric = (title, tableMarkup) =>
  `<div class="an-metric"><h3 class="an-metric__title">${title}</h3><div class="an-scroll">${tableMarkup}</div></div>`;

// A demoted breakdown: same metric label, folded behind a native disclosure so
// each band leads with its key table and the exhaustive detail is on-demand.
/** @param {string} title @param {string} tableMarkup */
const fold = (title, tableMarkup) =>
  `<details class="an-metric an-fold"><summary class="an-metric__title">${title}</summary><div class="an-scroll">${tableMarkup}</div></details>`;

// Overview: the page's at-a-glance answer. The outputs are populated
// best-effort by analytics.js; static marks convey each rate's polarity.
const OVERVIEW_SECTION =
  '<section class="qb-region an-overview" aria-labelledby="analytics-overview-title"><h2 class="qb-visually-hidden" id="analytics-overview-title">Overview</h2><div class="an-stat-strip"><div class="an-stat"><span class="an-stat__label">Evaluations</span><output class="an-stat__value" id="analytics-overview-evaluations">—</output></div><div class="an-stat" data-mark="filled"><span class="an-stat__label">Clear rate</span><output class="an-stat__value" id="analytics-overview-clear">—</output></div><div class="an-stat" data-mark="hollow"><span class="an-stat__label">Blocking rate</span><output class="an-stat__value" id="analytics-overview-blocking">—</output></div><div class="an-stat" data-mark="inset"><span class="an-stat__label">Error rate</span><output class="an-stat__value" id="analytics-overview-error">—</output></div><div class="an-stat" data-mark="filled"><span class="an-stat__label">Review-Run success</span><output class="an-stat__value" id="analytics-overview-review-success">—</output></div><div class="an-stat"><span class="an-stat__label">Tokens / eval</span><output class="an-stat__value" id="analytics-overview-tokens-per-eval">—</output></div><div class="an-stat"><span class="an-stat__label">Tokens / blocking</span><output class="an-stat__value" id="analytics-overview-tokens-per-blocking">—</output></div></div><output class="an-population" aria-live="polite" id="analytics-population"></output></section>';

// The 14-field filter is used occasionally; keep it behind a disclosure so the
// data leads. It must stay nested inside a <section> so the global
// `main > details{display:none}` rule (which hides the Operator menu) never
// catches it.
// Daily trend: the "is quality improving?" signal — per-day evaluation volume
// and outcome mix, populated by analytics.js. Sits directly under the Overview.
const TREND_SECTION =
  '<section class="qb-region an-trend-region" aria-labelledby="analytics-trend-title"><h2 id="analytics-trend-title">Daily trend</h2><div class="an-trend" id="analytics-daily-trend"></div></section>';

const FILTER_SECTION =
  '<section class="qb-region an-filters-region" aria-labelledby="analytics-filters-title"><h2 class="qb-visually-hidden" id="analytics-filters-title">Filters</h2><details class="an-filters"><summary>Filters</summary><form id="analytics-filters"><label for="analytics-repository">Repository</label><input id="analytics-repository" name="repository_id"><label for="analytics-base">Base commit</label><input id="analytics-base" name="base_commit"><label for="analytics-head">Head commit</label><input id="analytics-head" name="head_commit"><label for="analytics-pull-request">Pull request</label><input id="analytics-pull-request" min="1" name="pull_request_number" type="number"><label for="analytics-review">Review</label><input id="analytics-review" name="review_id"><label for="analytics-review-version">Review Version</label><input id="analytics-review-version" name="review_version_id"><label for="analytics-criterion">Criterion</label><input id="analytics-criterion" name="criterion_id"><label for="analytics-model">Model</label><input id="analytics-model" name="model"><label for="analytics-reasoning">Reasoning effort</label><input id="analytics-reasoning" name="reasoning_effort"><label for="analytics-tier">Service tier</label><input id="analytics-tier" name="service_tier"><label for="analytics-outcome">Terminal outcome</label><select id="analytics-outcome" name="terminal_outcome"><option value="">All</option><option value="clear">Clear</option><option value="advisory">Advisory</option><option value="blocking">Blocking</option><option value="error">Error</option></select><label for="analytics-start">Start</label><input id="analytics-start" min="0" name="start" type="number"><label for="analytics-end">End</label><input id="analytics-end" min="0" name="end" type="number"><button type="submit">Filter</button></form></details></section>';

const OUTCOMES_SECTION =
  '<section class="qb-region an-band" aria-labelledby="analytics-outcomes-title"><h2 id="analytics-outcomes-title">Are reviews catching the right things?</h2>' +
  metric(
    "Evaluation outcomes",
    table("analytics-evaluation-outcomes", [
      "Clear Evaluations",
      "Advisory Evaluations",
      "Blocking Evaluations",
      "Error Evaluations",
      "Pending Evaluations",
      "Clear Evaluation share",
      "Advisory Evaluation share",
      "Blocking Evaluation share",
      "Error Evaluation share",
    ]),
  ) +
  fold(
    "Finding impact",
    table("analytics-finding-impact", [
      "Advisory Finding count",
      "Blocking Finding count",
      "Findings per triggered Criterion Result",
    ]),
  ) +
  "</section>";

const REVIEWS_SECTION =
  '<section class="qb-region an-band" aria-labelledby="analytics-reviews-title"><h2 id="analytics-reviews-title">Which reviews &amp; criteria pull their weight?</h2>' +
  metric(
    "Review applicability",
    table("analytics-applicability", [
      "Review identity",
      "Applicable Reviews",
      "Not-applicable Reviews",
      "Applicability errors",
      "Review applicability rate",
      "Review applicability error rate",
    ]),
  ) +
  fold(
    "Criterion outcomes",
    table("analytics-criteria", [
      "Criterion identity",
      "Triggered Criterion Results",
      "Clear Criterion Results",
      "Not-applicable Criterion Results",
      "Error Criterion Results",
      "Criterion trigger rate",
      "Criterion clear rate",
      "Criterion not-applicable rate",
      "Criterion error rate",
    ]),
  ) +
  fold(
    "Pull-request Criterion transitions",
    table("analytics-transitions", [
      "Triggered-to-clear transitions",
      "No-longer-applicable transitions",
      "Triggered-to-error transitions",
      "Transition sample size",
    ]),
  ) +
  "</section>";

const WAIVERS_SECTION =
  '<section class="qb-region an-band" aria-labelledby="analytics-waivers-title"><h2 id="analytics-waivers-title">Waivers</h2>' +
  metric(
    "Waiver coverage",
    table("analytics-waivers", [
      "Advisory Finding population",
      "Findings with Waiver Requests",
      "Waiver-request rate",
      "Findings with accepted Decisions",
      "Waived-Finding rate",
    ]),
  ) +
  fold(
    "Decision history",
    table("analytics-waiver-decisions", [
      "Accepted Decisions",
      "Denied Decisions",
      "Error Decisions",
      "Accepted Decision share",
      "Denied Decision share",
      "Error Decision share",
    ]),
  ) +
  "</section>";

const RELIABILITY_SECTION =
  '<section class="qb-region an-band" aria-labelledby="analytics-reliability-title"><h2 id="analytics-reliability-title">Is execution healthy?</h2>' +
  metric(
    "Review-Run reliability",
    table("analytics-review-run-reliability", [
      "Successful Review Runs",
      "Failed Review Runs",
      "Operator-cancelled Review Runs",
      "Superseded Review Runs",
      "Active Review Runs",
      "Successful Review Run share",
      "Failed Review Run share",
      "Operator-cancelled Review Run share",
      "Superseded Review Run share",
    ]),
  ) +
  fold(
    "Waiver-Adjudication reliability",
    table("analytics-waiver-adjudication-reliability", [
      "Completed Waiver Adjudications",
      "Failed Waiver Adjudications",
      "Cancelled Waiver Adjudications",
      "Active Waiver Adjudications",
      "Completed Waiver Adjudication share",
      "Failed Waiver Adjudication share",
      "Cancelled Waiver Adjudication share",
    ]),
  ) +
  fold(
    "Execution failure codes",
    table("analytics-execution-failure-codes", [
      "Failure execution kind",
      "Stable failure code",
      "Failure-code count",
    ]),
  ) +
  fold(
    "Execution duration",
    table("analytics-execution-duration", [
      "Duration execution kind",
      "Terminal outcome",
      "Included terminal executions",
      "Total duration (ms)",
      "Median duration (ms)",
    ]),
  ) +
  fold(
    "Token counters",
    table("analytics-token-counters", [
      "Token execution kind",
      "Token counter",
      "Supplied-token sum",
      "Supplied-token median",
      "Counter coverage",
    ]),
  ) +
  "</section>";

const ERROR_MARKUP =
  '<p hidden id="analytics-error" role="alert" tabindex="-1"></p>';

const STYLE =
  "<style>" +
  "[hidden]{display:none!important}" +
  ".an-overview{padding-top:18px}" +
  ".an-stat-strip{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:0;border-top:1px solid var(--qb-line);border-bottom:1px solid var(--qb-line)}" +
  ".an-stat{display:grid;gap:9px;padding:18px 16px 18px 0;min-width:0}" +
  ".an-stat__label{color:var(--qb-muted-ink);font-size:10px;font-weight:650;letter-spacing:.07em;text-transform:uppercase}" +
  ".an-stat__value{font-family:var(--font-mono);font-size:24px;font-weight:500;line-height:1}" +
  ".an-stat[data-mark] .an-stat__value{display:inline-flex;align-items:center;gap:10px}" +
  '.an-stat[data-mark] .an-stat__value::before{content:"";width:10px;height:10px;border:1px solid var(--qb-ink);border-radius:50%;flex:0 0 10px}' +
  '.an-stat[data-mark="filled"] .an-stat__value::before{background:var(--qb-ink)}' +
  '.an-stat[data-mark="hollow"] .an-stat__value::before{background:transparent}' +
  '.an-stat[data-mark="inset"] .an-stat__value::before{background:var(--qb-ink);box-shadow:inset 0 0 0 2px var(--qb-canvas)}' +
  ".an-population{display:block;margin-top:16px;font-family:var(--font-mono);font-size:12px;color:var(--qb-muted-ink)}" +
  ".an-population:empty{display:none}" +
  ".an-trend{display:flex;align-items:flex-end;gap:2px;height:56px;margin-top:6px;overflow-x:auto}" +
  ".an-trend__col{display:flex;flex-direction:column-reverse;width:10px;height:100%;flex:0 0 10px;border-bottom:1px solid var(--qb-line)}" +
  ".an-trend__seg{display:block;width:100%}" +
  ".an-trend__seg--clear{background:var(--qb-line)}" +
  ".an-trend__seg--problem{background:var(--qb-ink)}" +
  '.an-trend:empty::after{content:"No evaluations in range";color:var(--qb-muted-ink);font-size:12px}' +
  ".an-filters-region{padding:0}" +
  ".an-filters{border:0}" +
  ".an-filters>summary{padding:14px 0;color:var(--qb-muted-ink);font-size:11px;font-weight:650;letter-spacing:.07em;text-transform:uppercase;list-style:none;cursor:pointer}" +
  ".an-filters>summary::-webkit-details-marker{display:none}" +
  '.an-filters>summary::before{content:"+";display:inline-block;width:16px;color:var(--qb-muted-ink);font-family:var(--font-mono)}' +
  '.an-filters[open]>summary::before{content:"\\2013"}' +
  ".an-filters #analytics-filters{grid-template-columns:repeat(4,max-content minmax(6rem,1fr));align-items:end;gap:12px 18px;padding:4px 0 20px}" +
  ".an-filters #analytics-filters label{color:var(--qb-muted-ink);font-size:10px;font-weight:650;letter-spacing:.06em}" +
  ".an-filters #analytics-filters input,.an-filters #analytics-filters select{border:0;border-bottom:1px solid var(--qb-line);border-radius:0;background:transparent;padding:5px 2px;min-height:1.9rem;font-family:var(--font-mono);font-size:12px}" +
  ".an-filters #analytics-filters button{grid-column:1/-1;justify-self:start;min-height:30px;padding:4px 16px;border-radius:var(--qb-radius);font-size:11px}" +
  ".an-band>h2{font-size:14px;letter-spacing:-.01em}" +
  ".an-metric{margin-top:20px}" +
  ".an-band>h2+.an-metric{margin-top:6px}" +
  ".an-metric__title{margin:0 0 8px;color:var(--qb-muted-ink);font-size:10px;font-weight:650;letter-spacing:.07em;text-transform:uppercase}" +
  ".an-fold>summary{list-style:none;cursor:pointer}" +
  ".an-fold>summary::-webkit-details-marker{display:none}" +
  '.an-fold>summary::before{content:"+";display:inline-block;width:16px;color:var(--qb-muted-ink);font-family:var(--font-mono)}' +
  '.an-fold[open]>summary::before{content:"\\2013"}' +
  ".an-scroll{overflow-x:auto}" +
  ".an-metric table{font-size:12px}" +
  ".an-metric th{font-size:10px}" +
  ".an-metric td{font-family:var(--font-mono);color:var(--qb-ink)}" +
  "@media(max-width:900px){.an-stat-strip{grid-template-columns:repeat(2,minmax(0,1fr))}.an-stat{padding-right:12px}.an-filters #analytics-filters{grid-template-columns:max-content minmax(0,1fr)}}" +
  "</style>";

const SCRIPTS =
  '<script src="/assets/analytics-contract.js"></script>' +
  '<script src="/assets/analytics-state.js"></script>' +
  '<script src="/assets/analytics.js"></script>';

/** Render the operator Analytics view. */
export function renderAnalyticsPage() {
  return Object.freeze({
    markup:
      OVERVIEW_SECTION +
      TREND_SECTION +
      FILTER_SECTION +
      OUTCOMES_SECTION +
      REVIEWS_SECTION +
      WAIVERS_SECTION +
      RELIABILITY_SECTION +
      ERROR_MARKUP +
      STYLE,
    scripts: SCRIPTS,
  });
}
