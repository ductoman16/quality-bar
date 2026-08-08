import { BROWSER_CSRF_COOKIE_NAME } from "./browser-session.js";

/** @param {{ intendedDestination?: string } | { csrfCookieName: string }} value */
function browserConfiguration(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/** @param {unknown} value */
export function safeInternalDestination(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/";
  }
  try {
    const destination = new URL(value, "http://quality-bar.internal");
    if (destination.origin !== "http://quality-bar.internal") {
      return "/";
    }
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
}

/** @param {URL} requestUrl */
export function browserView(requestUrl) {
  const view = requestUrl.searchParams.get("view") ?? "evaluations";
  if (
    ![
      "evaluations",
      "evaluation-detail",
      "reviews",
      "repositories",
      "analytics",
      "system",
    ].includes(view)
  ) {
    throw Object.assign(new Error("Resource was not found"), {
      code: "not_found",
    });
  }
  return view;
}

/** @param {string} intendedDestination */
export function loginPage(intendedDestination) {
  return `<main><form id="login-form"><label for="password">Password</label><input autocomplete="current-password" id="password" name="password" required type="password"><button title="Log in" type="submit">Log in</button><p hidden id="error" role="alert"></p></form></main><script id="browser-configuration" type="application/json">${browserConfiguration({ intendedDestination })}</script><script src="/assets/login.js"></script>`;
}

/** @param {{ view: string, evaluationId?: string | null }} options */
export function operatorPage({ view, evaluationId }) {
  void evaluationId;
  const leftNavigation = ["evaluations", "reviews", "repositories"];
  const rightNavigation = ["analytics", "system"];
  /** @param {string} name */
  const renderNavLink = (name) => {
    const label = name[0].toUpperCase() + name.slice(1);
    return `<a${view === name ? ' aria-current="page"' : ""} href="/?view=${name}">${label}</a>`;
  };
  const leftLinks = leftNavigation.map(renderNavLink).join("");
  const rightLinks = rightNavigation.map(renderNavLink).join("");
  const navigationLinks = `<div class="qb-nav-group">${leftLinks}</div><div class="qb-nav-group">${rightLinks}</div>`;
  const attention = `<a hidden href="/?view=system" id="attention"></a>${
    view === "system" ? "" : "<style>main > details{display:none}</style>"
  }`;
  const heading = view[0].toUpperCase() + view.slice(1);
  let systemSection =
    view === "system"
      ? '<section aria-live="polite" id="system-facts"></section><section aria-labelledby="system-polling-title"><h2 id="system-polling-title">Polling</h2><ol id="system-polling-connections"></ol></section><section aria-labelledby="system-delivery-title"><h2 id="system-delivery-title">Delivery</h2><ol id="system-delivery-surfaces"></ol></section><section aria-labelledby="codex-execution-title"><h2 id="codex-execution-title">Codex execution</h2><dl id="codex-execution-concurrency"></dl><h3>Queued</h3><ol id="codex-execution-queue"></ol><h3>Running</h3><ol id="codex-execution-running"></ol><h3>Failures</h3><ol id="codex-execution-failures"></ol></section><section aria-labelledby="storage-reserve-title"><h2 id="storage-reserve-title">Storage reserve</h2><dl id="storage-reserve-facts"></dl></section><section aria-labelledby="system-storage-title"><h2 id="system-storage-title">Storage, backup, and migration</h2><dl id="system-storage-facts"></dl></section><section aria-labelledby="waiver-adjudicator-configuration-title"><h2 id="waiver-adjudicator-configuration-title">Waiver Adjudicator Configuration</h2><form hidden id="waiver-adjudicator-configuration-form"><label for="waiver-adjudicator-model">Model</label><select id="waiver-adjudicator-model" required></select><label for="waiver-adjudicator-reasoning-effort">Reasoning effort</label><select id="waiver-adjudicator-reasoning-effort" required></select><label for="waiver-adjudicator-service-tier">Service tier</label><select id="waiver-adjudicator-service-tier" required></select><button id="waiver-adjudicator-configuration-submit" type="submit">Save configuration</button><output aria-label="Waiver Adjudicator Configuration status" aria-live="polite" id="waiver-adjudicator-configuration-status"></output><p hidden id="waiver-adjudicator-configuration-error" role="alert" tabindex="-1"></p></form></section><script src="/assets/system-polling-delivery-contract.js"></script><script src="/assets/system-polling-delivery.js"></script><script src="/assets/system-storage.js"></script>'
      : "";
  let analyticsSection =
    view === "analytics"
      ? '<section aria-labelledby="analytics-evaluation-outcomes-title"><h2 id="analytics-evaluation-outcomes-title">Evaluation outcomes</h2><table><thead><tr><th>Clear Evaluations</th><th>Advisory Evaluations</th><th>Blocking Evaluations</th><th>Error Evaluations</th><th>Pending Evaluations</th><th>Clear Evaluation share</th><th>Advisory Evaluation share</th><th>Blocking Evaluation share</th><th>Error Evaluation share</th></tr></thead><tbody id="analytics-evaluation-outcomes"></tbody></table></section><section aria-labelledby="analytics-applicability-title"><h2 id="analytics-applicability-title">Review applicability</h2><table><thead><tr><th>Review identity</th><th>Applicable Reviews</th><th>Not-applicable Reviews</th><th>Applicability errors</th><th>Review applicability rate</th><th>Review applicability error rate</th></tr></thead><tbody id="analytics-applicability"></tbody></table></section><section aria-labelledby="analytics-criteria-title"><h2 id="analytics-criteria-title">Criterion outcomes</h2><table><thead><tr><th>Criterion identity</th><th>Triggered Criterion Results</th><th>Clear Criterion Results</th><th>Not-applicable Criterion Results</th><th>Error Criterion Results</th><th>Criterion trigger rate</th><th>Criterion clear rate</th><th>Criterion not-applicable rate</th><th>Criterion error rate</th></tr></thead><tbody id="analytics-criteria"></tbody></table></section><section aria-labelledby="analytics-finding-impact-title"><h2 id="analytics-finding-impact-title">Finding impact</h2><table><thead><tr><th>Advisory Finding count</th><th>Blocking Finding count</th><th>Findings per triggered Criterion Result</th></tr></thead><tbody id="analytics-finding-impact"></tbody></table></section><section aria-labelledby="analytics-waivers-title"><h2 id="analytics-waivers-title">Waivers</h2><table><thead><tr><th>Advisory Finding population</th><th>Findings with Waiver Requests</th><th>Waiver-request rate</th><th>Findings with accepted Decisions</th><th>Waived-Finding rate</th></tr></thead><tbody id="analytics-waivers"></tbody></table></section><section aria-labelledby="analytics-waiver-decisions-title"><h2 id="analytics-waiver-decisions-title">Decision history</h2><table><thead><tr><th>Accepted Decisions</th><th>Denied Decisions</th><th>Error Decisions</th><th>Accepted Decision share</th><th>Denied Decision share</th><th>Error Decision share</th></tr></thead><tbody id="analytics-waiver-decisions"></tbody></table></section><p hidden id="analytics-error" role="alert" tabindex="-1"></p>'
      : "";
  analyticsSection = analyticsSection.replace(
    '<p hidden id="analytics-error" role="alert" tabindex="-1"></p>',
    '<section aria-labelledby="analytics-review-run-reliability-title"><h2 id="analytics-review-run-reliability-title">Review Run reliability</h2><table><thead><tr><th>Successful Review Runs</th><th>Failed Review Runs</th><th>Operator-cancelled Review Runs</th><th>Superseded Review Runs</th><th>Active Review Runs</th><th>Successful Review Run share</th><th>Failed Review Run share</th><th>Operator-cancelled Review Run share</th><th>Superseded Review Run share</th></tr></thead><tbody id="analytics-review-run-reliability"></tbody></table></section><section aria-labelledby="analytics-waiver-adjudication-reliability-title"><h2 id="analytics-waiver-adjudication-reliability-title">Waiver Adjudication reliability</h2><table><thead><tr><th>Completed Waiver Adjudications</th><th>Failed Waiver Adjudications</th><th>Cancelled Waiver Adjudications</th><th>Active Waiver Adjudications</th><th>Completed Waiver Adjudication share</th><th>Failed Waiver Adjudication share</th><th>Cancelled Waiver Adjudication share</th></tr></thead><tbody id="analytics-waiver-adjudication-reliability"></tbody></table></section><section aria-labelledby="analytics-execution-failure-codes-title"><h2 id="analytics-execution-failure-codes-title">Execution failure codes</h2><table><thead><tr><th>Failure execution kind</th><th>Stable failure code</th><th>Failure-code count</th></tr></thead><tbody id="analytics-execution-failure-codes"></tbody></table></section><section aria-labelledby="analytics-execution-duration-title"><h2 id="analytics-execution-duration-title">Execution duration</h2><table><thead><tr><th>Duration execution kind</th><th>Terminal outcome</th><th>Included terminal executions</th><th>Total duration (ms)</th><th>Median duration (ms)</th></tr></thead><tbody id="analytics-execution-duration"></tbody></table></section><section aria-labelledby="analytics-token-counters-title"><h2 id="analytics-token-counters-title">Token counters</h2><table><thead><tr><th>Token execution kind</th><th>Token counter</th><th>Supplied-token sum</th><th>Supplied-token median</th><th>Counter coverage</th></tr></thead><tbody id="analytics-token-counters"></tbody></table></section><p hidden id="analytics-error" role="alert" tabindex="-1"></p>',
  );
  if (analyticsSection) {
    analyticsSection = analyticsSection.replace(
      /<h2 id="([^"]+)">([^<]+)<\/h2>/g,
      '<h2 id="$1"><a href="#analytics-matching-facts">$2</a></h2>',
    );
    analyticsSection =
      '<form id="analytics-filters"><label for="analytics-repository">Repository</label><input id="analytics-repository" name="repository_id"><label for="analytics-base">Base commit</label><input id="analytics-base" name="base_commit"><label for="analytics-head">Head commit</label><input id="analytics-head" name="head_commit"><label for="analytics-pull-request">Pull request</label><input id="analytics-pull-request" min="1" name="pull_request_number" type="number"><label for="analytics-review">Review</label><input id="analytics-review" name="review_id"><label for="analytics-review-version">Review Version</label><input id="analytics-review-version" name="review_version_id"><label for="analytics-criterion">Criterion</label><input id="analytics-criterion" name="criterion_id"><label for="analytics-model">Model</label><input id="analytics-model" name="model"><label for="analytics-reasoning">Reasoning effort</label><input id="analytics-reasoning" name="reasoning_effort"><label for="analytics-tier">Service tier</label><input id="analytics-tier" name="service_tier"><label for="analytics-outcome">Terminal outcome</label><select id="analytics-outcome" name="terminal_outcome"><option value="">All</option><option value="clear">Clear</option><option value="advisory">Advisory</option><option value="blocking">Blocking</option><option value="error">Error</option></select><label for="analytics-start">Start</label><input id="analytics-start" min="0" name="start" type="number"><label for="analytics-end">End</label><input id="analytics-end" min="0" name="end" type="number"><button type="submit">Filter</button></form><output aria-live="polite" id="analytics-population"></output><p hidden id="analytics-invalid-denominator" role="status">Invalid denominator</p><p hidden id="analytics-unavailable-tokens" role="status">Unavailable token counters</p><section aria-labelledby="analytics-transitions-title"><h2 id="analytics-transitions-title"><a href="#analytics-matching-facts">Pull-request Criterion transitions</a></h2><table><thead><tr><th>Triggered-to-clear transitions</th><th>No-longer-applicable transitions</th><th>Triggered-to-error transitions</th><th>Transition sample size</th></tr></thead><tbody id="analytics-transitions"></tbody></table></section>' +
      analyticsSection +
      '<section aria-labelledby="analytics-matching-facts-title" id="analytics-matching-facts"><h2 id="analytics-matching-facts-title">Matching facts</h2><h3>Evaluations</h3><table><thead><tr><th>Evaluation identity</th><th>Repository identity</th><th>Pull request number</th><th>Terminal Evaluation outcome</th><th>Evaluation created at</th></tr></thead><tbody id="analytics-matching-evaluations"></tbody></table><h3>Review Runs</h3><table><thead><tr><th>Review Run identity</th><th>Evaluation for Review Run</th><th>Review for Review Run</th><th>Review Version for Review Run</th><th>Review Run configuration</th><th>Review Run status</th><th>Criterion Result count</th><th>Finding fact count</th><th>Waiver Request fact count</th><th>Waiver Decision fact count</th><th>Review Run duration</th><th>Review Run tokens</th><th>Review Run failure code</th></tr></thead><tbody id="analytics-matching-review-runs"></tbody></table></section>';
    analyticsSection = analyticsSection
      .replace(
        "<th>Evaluation for Review Run</th>",
        "<th>Review Run Repository</th><th>Review Run Changeset</th><th>Review Run pull request</th><th>Evaluation for Review Run</th>",
      )
      .replace(
        "<th>Review Run status</th>",
        "<th>Review Run status</th><th>Review Run cancellation</th>",
      )
      .replace("<th>Criterion Result count</th>", "<th>Criterion Results</th>")
      .replace("<th>Finding fact count</th>", "<th>Finding facts</th>")
      .replace(
        "<th>Waiver Request fact count</th>",
        "<th>Waiver Request facts</th>",
      )
      .replace(
        "<th>Waiver Decision fact count</th>",
        "<th>Waiver Decision facts</th>",
      );
    analyticsSection +=
      '<script src="/assets/analytics-contract.js"></script>' +
      '<script src="/assets/analytics-matching-facts.js"></script>' +
      '<script src="/assets/analytics-state.js"></script>';
  }
  let evaluationSection =
    view === "evaluations"
      ? `<section class="evaluation-monitor" id="evaluation-monitor" aria-label="Evaluation monitor">
<section aria-label="Fleet statistics" class="qb-stat-strip">
<div class="qb-stat evaluation-stat"><span aria-hidden="true" class="evaluation-stat__icon">⠿</span><span>Workers</span><output id="evaluation-stat-workers">Loading</output></div>
<div class="qb-stat evaluation-stat"><span aria-hidden="true" class="evaluation-stat__icon">☷</span><span>Queue</span><output id="evaluation-stat-queue">Loading</output></div>
<div class="qb-stat evaluation-stat"><span aria-hidden="true" class="evaluation-stat__icon">◷</span><span>P95 Duration</span><output id="evaluation-stat-p95">Loading</output></div>
<div class="qb-stat evaluation-stat"><span aria-hidden="true" class="evaluation-stat__icon">⌁</span><span>Pass Rate</span><output id="evaluation-stat-pass-rate">Loading</output></div>
<div class="qb-stat evaluation-stat"><span aria-hidden="true" class="evaluation-stat__icon">∿</span><span>Updated</span><output id="evaluation-stat-updated">Loading</output></div>
</section>
<div class="evaluation-monitor__controls"><div aria-label="Step types" class="evaluation-monitor__legend"><span><i aria-hidden="true" class="evaluation-legend__marker evaluation-legend__marker--system"></i>System</span><span><i aria-hidden="true" class="evaluation-legend__marker evaluation-legend__marker--review"></i>Review</span></div><div aria-label="Statistics window" class="evaluation-stat-window"><button aria-pressed="true" id="evaluation-stat-window-24h" type="button">24h</button><button aria-pressed="false" id="evaluation-stat-window-7d" type="button">7d</button></div><button id="evaluation-create-toggle" type="button" aria-expanded="false" aria-controls="evaluation-create-form">+ New evaluation</button></div>
<form hidden id="evaluation-create-form">
<label for="evaluation-create-repository">Repository</label><select disabled id="evaluation-create-repository" required></select>
<label for="evaluation-create-base-type">Base type</label><select id="evaluation-create-base-type"><option value="branch">Branch</option><option value="commit">Commit</option></select>
<label for="evaluation-create-base-value">Base value</label><input id="evaluation-create-base-value" required>
<label for="evaluation-create-head-type">Head type</label><select id="evaluation-create-head-type"><option value="branch">Branch</option><option value="commit">Commit</option></select>
<label for="evaluation-create-head-value">Head value</label><input id="evaluation-create-head-value" required>
<button id="evaluation-create-submit" type="submit">Evaluate</button><output aria-live="polite" id="evaluation-create-status"></output>
</form>
<details class="evaluation-filters"><summary>Filters</summary><form class="evaluation-filter-form" id="evaluation-filter-form">
<label for="evaluation-filter-repository">Repository</label><select id="evaluation-filter-repository"><option value="">All repositories</option></select>
<label for="evaluation-filter-status">Status</label><select id="evaluation-filter-status"><option value="">All statuses</option><option value="queued">Queued</option><option value="running">Running</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select>
<label for="evaluation-filter-outcome">Outcome</label><select id="evaluation-filter-outcome"><option value="">All outcomes</option><option value="pending">Pending</option><option value="clear">Clear</option><option value="advisory">Advisory</option><option value="blocking">Blocking</option><option value="error">Error</option></select>
<label for="evaluation-filter-query">Query</label><input id="evaluation-filter-query" maxlength="200">
<label for="evaluation-filter-start">Start</label><input id="evaluation-filter-start" type="datetime-local">
<label for="evaluation-filter-end">End</label><input id="evaluation-filter-end" type="datetime-local">
<button type="submit">Apply</button><button id="evaluation-filter-reset" type="button">Reset</button>
</form></details>
<p aria-live="polite" id="evaluation-loading">Loading Evaluations</p><p hidden id="evaluation-empty">No Evaluations</p><p hidden id="evaluation-error" role="alert" tabindex="-1"></p>
<section class="evaluation-ledger" id="evaluation-list" aria-label="Evaluation ledger"></section>
<button hidden id="evaluation-new-activity" type="button">New activity available</button><button hidden id="evaluation-load-more" type="button">Load more</button>
</section><style>[hidden]{display:none!important}.qb-app-shell:has(#evaluation-monitor) .qb-main{max-width:none;margin:0;padding:0 26px 40px;display:block}.qb-app-shell:has(#evaluation-monitor) .qb-page-heading{display:none}.qb-app-shell:has(#evaluation-monitor) .qb-header{height:64px;display:grid;grid-template-columns:220px minmax(0,1fr) 120px;gap:16px;padding:0 26px;background:var(--qb-canvas);border-bottom:1px solid var(--qb-line)}.qb-app-shell:has(#evaluation-monitor) .qb-brand{display:flex;align-items:center;gap:12px;font-size:17px}.qb-app-shell:has(#evaluation-monitor) .qb-brand::before{content:"QB";display:grid;place-items:center;width:36px;height:36px;background:var(--qb-ink);color:var(--qb-canvas);font-size:16px;font-weight:800;letter-spacing:-.06em}.qb-app-shell:has(#evaluation-monitor) .qb-primary-nav{justify-content:center;gap:36px}.qb-app-shell:has(#evaluation-monitor) .qb-nav-group{display:contents}.qb-app-shell:has(#evaluation-monitor) .qb-nav-group+.qb-nav-group{margin:0;padding:0;border:0}.qb-app-shell:has(#evaluation-monitor) .qb-primary-nav a{position:relative;min-height:64px;padding:0 2px;border:0;border-radius:0;color:var(--qb-ink);font-size:14px;font-weight:500}.qb-app-shell:has(#evaluation-monitor) .qb-primary-nav a:hover{background:transparent}.qb-app-shell:has(#evaluation-monitor) .qb-primary-nav a[aria-current="page"]{background:transparent;text-decoration:none}.qb-app-shell:has(#evaluation-monitor) .qb-primary-nav a[aria-current="page"]::after{content:"";position:absolute;right:0;bottom:-1px;left:0;height:3px;background:var(--qb-ink)}.qb-app-shell:has(#evaluation-monitor) .qb-header::after{display:flex;align-items:center;justify-content:flex-end;content:"☼  AK";font-size:14px}.evaluation-monitor{display:block}.qb-stat-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0;margin:0 -26px;padding:0 26px;border:0;border-bottom:1px solid var(--qb-line);background:transparent}.qb-stat.evaluation-stat{display:grid;grid-template-columns:28px max-content;grid-template-rows:auto auto;column-gap:8px;padding:18px 24px;border:0;border-left:1px solid var(--qb-line);background:transparent}.qb-stat.evaluation-stat:first-child{border-left:0}.evaluation-stat__icon{grid-row:1/-1;display:grid;place-items:center;font-size:25px;line-height:1}.qb-stat.evaluation-stat>span:not(.evaluation-stat__icon){color:var(--qb-muted-ink);font-size:12px;font-weight:500;letter-spacing:.02em}.qb-stat.evaluation-stat output{font-family:var(--font-mono);font-size:16px;font-weight:500}.evaluation-monitor__controls{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0 12px}.evaluation-monitor__legend,.evaluation-stat-window{display:flex;align-items:center;gap:18px}.evaluation-monitor__legend>span{display:inline-flex;align-items:center;gap:7px;color:var(--qb-muted-ink);font-size:11px;letter-spacing:.04em;text-transform:uppercase}.evaluation-legend__marker{display:inline-block;width:10px;height:10px;background:var(--qb-ink)}.evaluation-legend__marker--review{border-radius:50%}.evaluation-stat-window button{min-height:26px;padding:2px 9px;border:0;border-radius:0;background:transparent;color:var(--qb-muted-ink);font-family:var(--font-mono);font-size:11px}.evaluation-stat-window button[aria-pressed="true"]{color:var(--qb-ink);font-weight:700;text-decoration:underline;text-underline-offset:4px}.evaluation-monitor__controls>#evaluation-create-toggle{min-height:32px;padding:4px 10px;border-radius:2px;background:var(--qb-ink);color:var(--qb-canvas);font-size:12px}.evaluation-monitor__controls>#evaluation-create-toggle:hover{background:var(--qb-muted-ink)}.evaluation-filters{margin:0 0 12px;border:0;border-bottom:1px solid var(--qb-line);border-radius:0;background:transparent}.evaluation-filters>summary{padding:8px 0;color:var(--qb-muted-ink);font-size:11px;letter-spacing:.06em;text-transform:uppercase}.evaluation-filters .evaluation-filter-form{margin:0 0 12px;padding:12px 0;border:0;border-top:1px solid var(--qb-line);border-radius:0;background:transparent}.evaluation-ledger{border-top:1px solid var(--qb-line)}.evaluation-date-group{margin:0}.evaluation-date-heading{display:flex;align-items:baseline;gap:16px;margin:0;padding:13px 0 8px;color:var(--qb-ink);font-size:13px;font-weight:650}.evaluation-date-heading__date{color:var(--qb-muted-ink);font-size:12px;font-weight:400}.evaluation-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(145px,190px) 22px;column-gap:14px;align-items:center;padding:10px 0;border-top:1px solid var(--qb-line)}.evaluation-row__summary{display:grid;grid-template-columns:24px 72px minmax(115px,.55fr) minmax(180px,1.45fr) 94px 66px;column-gap:12px;align-items:center;min-width:0}.evaluation-row__toggle{width:24px;min-width:24px;height:24px;padding:0;border:0;border-radius:0;background:transparent}.evaluation-row__toggle:hover{background:transparent}.evaluation-row__chevron{display:block;width:8px;height:8px;margin:0 auto;border-right:2px solid var(--qb-ink);border-bottom:2px solid var(--qb-ink);transform:rotate(45deg);transition:transform .15s}.evaluation-row__toggle[aria-expanded="true"] .evaluation-row__chevron{transform:rotate(225deg);margin-top:5px}.evaluation-row__time,.evaluation-row__source-kind,.evaluation-row__source-value,.evaluation-row__duration{font-family:var(--font-mono);font-size:12px;white-space:nowrap}.evaluation-row__repository{min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:13px;font-weight:650;text-decoration:none;white-space:nowrap}.evaluation-row__repository:hover{text-decoration:underline;text-underline-offset:3px}.evaluation-row__source{display:flex;min-width:0;gap:12px;overflow:hidden}.evaluation-row__source-kind{white-space:nowrap}.evaluation-row__source-value{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--qb-muted-ink);white-space:nowrap}.evaluation-row__outcome{display:inline-flex;align-items:center;gap:7px;min-width:0;font-size:12px;white-space:nowrap}.evaluation-status__icon{display:inline-grid;place-items:center;width:15px;height:15px;border:1px solid var(--qb-ink);border-radius:50%;font-size:10px;line-height:1}.evaluation-status--passed .evaluation-status__icon{background:var(--qb-ink);color:var(--qb-canvas)}.evaluation-status--passed .evaluation-status__icon::before{content:"✓"}.evaluation-status--skipped .evaluation-status__icon::before{content:"−"}.evaluation-status--failed .evaluation-status__icon{background:var(--qb-ink);color:var(--qb-canvas)}.evaluation-status--failed .evaluation-status__icon::before{content:"!"}.evaluation-status--active .evaluation-status__icon{border-style:dashed}.evaluation-status--pending .evaluation-status__icon{border-style:dashed}.evaluation-row__duration{font-size:12px}.evaluation-row__timeline{justify-self:stretch;align-self:center;min-width:0}.evaluation-row__timeline.qb-timeline{display:flex;align-items:center;gap:0;width:100%}.evaluation-row__timeline .qb-timeline-connector{width:auto;height:1px;flex:1 1 auto;background:var(--qb-ink);opacity:.85}.evaluation-row__timeline .qb-timeline-node{position:relative;display:block;width:12px;height:12px;flex:0 0 12px;font-size:0}.evaluation-row__timeline .qb-timeline-node::before{position:absolute;inset:2px;width:8px;height:8px;background:var(--qb-ink);border:0}.evaluation-row__timeline .qb-timeline-node--review::before{border-radius:50%}.evaluation-row__timeline .qb-timeline-node--skipped::before{background:transparent;border:1px solid var(--qb-ink)}.evaluation-row__timeline .qb-timeline-node--failed::before{background:var(--qb-muted-ink)}.evaluation-row__detail{display:grid;place-items:center;width:22px;height:26px;color:var(--qb-ink);font-size:26px;line-height:1;text-decoration:none}.evaluation-row__detail:hover{color:var(--qb-muted-ink)}.evaluation-expanded{grid-column:1/-1;margin:0;padding:12px 58px 16px 82px;background:var(--qb-surface-deep);border-top:1px solid var(--qb-line);border-bottom:1px solid var(--qb-line)}.evaluation-expanded__table{width:100%}.evaluation-expanded__row{display:grid;grid-template-columns:minmax(0,2fr) minmax(110px,.75fr) minmax(80px,.5fr) minmax(100px,.7fr);align-items:center;border-bottom:1px solid var(--qb-line)}.evaluation-expanded__row>*{min-width:0;padding:7px 12px;font-size:12px;text-align:left;vertical-align:middle}.evaluation-expanded__row--header{color:var(--qb-muted-ink);font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase}.evaluation-expanded__row:last-child{border-bottom:0}.evaluation-step{display:flex;align-items:center;gap:10px;min-width:0}.evaluation-step__number{display:grid;place-items:center;width:23px;height:23px;border:1px solid var(--qb-line);border-radius:50%;font-family:var(--font-mono);font-size:11px}.evaluation-step__marker{width:10px;height:10px;background:var(--qb-ink);flex:0 0 10px}.evaluation-step__marker--review{border-radius:50%}.evaluation-step__label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.evaluation-node-status{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.evaluation-node-status__icon{width:12px;height:12px;border:1px solid var(--qb-ink);border-radius:50%}.evaluation-node-status--complete .evaluation-node-status__icon{background:var(--qb-ink)}.evaluation-node-status--failed .evaluation-node-status__icon{background:var(--qb-ink);box-shadow:inset 0 0 0 2px var(--qb-canvas)}.evaluation-counts{display:flex;flex-wrap:wrap;gap:18px;margin:12px 0 0;color:var(--qb-muted-ink);font-size:11px}.evaluation-list-actions{justify-content:center;padding:15px 0}.evaluation-list-actions button{min-height:30px;padding:4px 12px;border-radius:2px;font-size:11px}@media(max-width:980px){.qb-stat-strip{grid-template-columns:repeat(3,minmax(0,1fr))}.qb-stat.evaluation-stat:nth-child(4){border-left:1px solid var(--qb-line)}.evaluation-row{grid-template-columns:minmax(0,1fr) minmax(145px,190px) 22px;column-gap:10px}.evaluation-row__summary{grid-template-columns:24px 70px minmax(110px,.65fr) minmax(170px,1.4fr) 100px 72px}.evaluation-row__source{gap:6px}}@media(max-width:720px){.qb-app-shell:has(#evaluation-monitor) .qb-header{padding-inline:14px;gap:12px}.qb-app-shell:has(#evaluation-monitor) .qb-primary-nav{gap:10px}.qb-app-shell:has(#evaluation-monitor) .qb-nav-group{gap:10px}.qb-app-shell:has(#evaluation-monitor) .qb-primary-nav a{font-size:12px}.qb-app-shell:has(#evaluation-monitor) .qb-header::after{min-width:44px;content:"AK";font-size:12px}.qb-stat-strip{grid-template-columns:repeat(2,minmax(0,1fr));margin-inline:-14px;padding-inline:14px}.qb-stat.evaluation-stat{padding-inline:12px}.evaluation-monitor__header{align-items:flex-start;flex-direction:column;padding-block:10px}.evaluation-monitor__tools{width:100%;justify-content:space-between}.evaluation-filter-form{position:static;grid-template-columns:max-content minmax(0,1fr);width:100%;margin-top:8px}.evaluation-filter-form>button{grid-column:auto}.evaluation-row{grid-template-columns:minmax(0,1fr) 22px;align-items:start;padding:10px 0}.evaluation-row__summary{grid-template-columns:24px 70px minmax(0,1fr);gap:5px 9px}.evaluation-row__summary>*:nth-child(n+4){grid-column:3}.evaluation-row__timeline{grid-column:1/-1;grid-row:2;width:100%;padding-left:33px}.evaluation-row__detail{grid-column:2;grid-row:1}.evaluation-expanded{padding:12px}.evaluation-expanded__row>:nth-child(n+3){display:none}}</style>`
      : "";
  let reviewSection =
    view === "reviews"
      ? '<section aria-labelledby="review-create-title"><h2 id="review-create-title">Create Review</h2><form id="review-create-form"><label for="review-name">Name</label><input id="review-name" name="name" required type="text"><label for="review-description">Description</label><textarea id="review-description" name="description" required></textarea><ol id="review-criteria"></ol><button aria-label="Add another Criterion" id="review-add-criterion" title="Add another Criterion" type="button">+</button><label for="review-model">Codex model</label><select id="review-model" name="model" required></select><label for="review-reasoning-effort">Reasoning effort</label><select id="review-reasoning-effort" name="reasoning_effort" required></select><label for="review-service-tier">Service tier</label><select id="review-service-tier" name="service_tier" required></select><button id="review-create-submit" title="Create Review" type="submit">Create Review</button><output aria-live="polite" id="review-create-result"></output></form></section><section aria-labelledby="review-list-title"><h2 id="review-list-title">Reviews</h2><div id="review-list"></div></section><section aria-labelledby="review-metadata-title"><h2 id="review-metadata-title">Review Metadata</h2><form hidden id="review-metadata-form"><label for="review-metadata-review">Review</label><select id="review-metadata-review"></select><input id="review-metadata-id" type="hidden"><label for="review-metadata-name">Lineage name</label><input aria-describedby="review-metadata-name-error" aria-required="true" id="review-metadata-name" type="text"><p hidden id="review-metadata-name-error"></p><label for="review-metadata-description">Lineage description</label><textarea aria-describedby="review-metadata-description-error" aria-required="true" id="review-metadata-description"></textarea><p hidden id="review-metadata-description-error"></p><button id="review-metadata-submit" title="Save metadata" type="submit">Save metadata</button><output aria-live="polite" id="review-metadata-result"></output></form></section><section aria-labelledby="review-version-title"><h2 id="review-version-title">Review Versions</h2><form hidden id="review-version-form"><label for="review-version-review">Executable snapshot</label><select id="review-version-review"></select><input id="review-version-id" type="hidden"><label for="review-version-activation">Prior Version</label><select id="review-version-activation"></select><button id="review-version-activate" title="Reactivate" type="button">Reactivate</button><ol id="review-version-criteria"></ol><button aria-label="Add Criterion" id="review-version-add-criterion" title="Add Criterion" type="button">+</button><label for="review-version-applicability-rule">Applicability Rule</label><textarea id="review-version-applicability-rule"></textarea><label for="review-version-model">Version Codex model</label><select id="review-version-model" required></select><label for="review-version-reasoning-effort">Version reasoning effort</label><select id="review-version-reasoning-effort" required></select><label for="review-version-service-tier">Version service tier</label><select id="review-version-service-tier" required></select><button id="review-version-submit" title="Save Review Version" type="submit">Save Review Version</button><output aria-live="polite" id="review-version-result"></output></form></section><section aria-labelledby="review-assignment-title"><h2 id="review-assignment-title">Review Assignment</h2><form hidden id="review-assignment-form"><label for="review-assignment-review">Review Assignment</label><select id="review-assignment-review"></select><label for="review-assignment-scope">Scope</label><select id="review-assignment-scope"><option value="installation_wide">Installation-wide</option><option value="repository_set">Repository-specific</option></select><label for="review-assignment-repositories">Repositories</label><select id="review-assignment-repositories" multiple required></select><button id="review-assignment-submit" title="Save Assignment" type="submit">Save Assignment</button><output aria-live="polite" id="review-assignment-result"></output></form></section><section aria-labelledby="review-archival-title"><h2 id="review-archival-title">Review Archival</h2><form hidden id="review-archival-form"><label for="review-archival-state">State</label><select id="review-archival-state"><option value="active">Active</option><option value="archived">Archived</option></select><label for="review-archival-review">Lineage</label><select id="review-archival-review"></select><button id="review-archival-submit" title="Archive or restore review" type="button"></button><output aria-live="polite" id="review-archival-result"></output></form>'
      : "";
  reviewSection = reviewSection.replace(
    '<button id="review-archival-submit" title="Archive or restore review" type="button"></button>',
    '<button id="review-archival-submit" type="button"></button>',
  );
  reviewSection = reviewSection.replace(
    '<button id="review-archival-submit" type="button"></button><output aria-live="polite" id="review-archival-result"></output></form>',
    '<button id="review-archival-submit" type="button"></button><button disabled id="review-delete" title="Delete Review" type="button">Delete Review</button><output aria-live="polite" id="review-archival-result" tabindex="-1"></output></form></section><dialog aria-labelledby="review-delete-confirmation-title" id="review-delete-confirmation"><form id="review-delete-confirmation-form"><h2 id="review-delete-confirmation-title">Delete Review permanently</h2><p id="review-delete-confirmation-message"></p><label for="review-delete-confirmation-input">Review name</label><input autocomplete="off" id="review-delete-confirmation-input" required type="text"><button id="review-delete-confirmation-cancel" title="Cancel" type="button">Cancel</button><button title="Delete permanently" type="submit">Delete permanently</button></form></dialog>',
  );
  reviewSection = reviewSection.replace(
    '<button id="review-archival-submit" type="button"></button>',
    '<button id="review-archival-submit" title="Archive or restore review" type="button"></button>',
  );
  let repositorySection =
    view === "repositories"
      ? '<section aria-labelledby="github-connection-title"><h2 id="github-connection-title">GitHub Connection</h2><form id="github-connection-form"><label hidden id="github-connection-pem-label" for="github-connection-pem">Replacement private key</label><textarea hidden id="github-connection-pem"></textarea><button id="github-connection-submit" title="Connect GitHub App" type="submit">Connect GitHub App</button></form><section aria-labelledby="github-connection-state-title" hidden id="github-connection-details"><h3 id="github-connection-state-title">Connection state</h3><dl><dt>Identity</dt><dd id="github-connection-identity"></dd><dt>API profile</dt><dd id="github-connection-profile"></dd><dt>Health</dt><dd id="github-connection-health"></dd><dt>Permissions</dt><dd id="github-connection-permissions"></dd><dt>Capabilities</dt><dd id="github-connection-capabilities"></dd><dt>Latest verification</dt><dd id="github-connection-latest"></dd></dl><h4>Verification history</h4><ol id="github-connection-history"></ol><h4>Polling</h4><ul aria-live="polite" id="github-connection-polling"></ul><form hidden id="github-repository-selection-form"><fieldset id="github-repository-selection-fieldset"><legend>GitHub Repositories</legend><div id="github-repository-selection-options"></div></fieldset><button id="github-repository-selection-submit" type="submit">Register selected Repositories</button></form></section><form hidden id="github-connection-rotation-form"><label for="github-connection-rotation-pem">Replacement private key</label><textarea autocomplete="off" id="github-connection-rotation-pem" required></textarea><button id="github-connection-rotation-submit" type="submit">Rotate GitHub App credentials</button></form><output aria-live="polite" id="github-connection-status" tabindex="-1"></output><p hidden id="github-connection-error" role="alert" tabindex="-1"></p></section><table><thead><tr><th>Provider and Connection</th><th>Identity</th><th>Lifecycle</th><th>Health</th><th>Assignments</th><th>Latest verification</th></tr></thead><tbody id="repository-inventory"></tbody></table><section><h2>Repository Guidance</h2><label for="repository-guidance-repository">Repository</label><select disabled id="repository-guidance-repository"></select><pre aria-live="polite" id="repository-guidance-document"></pre></section><form id="repository-lifecycle-form"><label for="repository-lifecycle-repository">Repository lifecycle</label><select disabled id="repository-lifecycle-repository" required></select><label for="repository-lifecycle-state">State</label><select id="repository-lifecycle-state" required><option value="enabled">Enabled</option><option value="disabled">Disabled</option><option value="retired">Retired</option></select><button disabled id="repository-lifecycle-submit" type="submit">Apply lifecycle</button><button disabled id="repository-delete" type="button">Delete Repository</button><output aria-live="polite" id="repository-lifecycle-result"></output></form><dialog aria-labelledby="repository-delete-confirmation-title" id="repository-delete-confirmation"><form id="repository-delete-confirmation-form"><h2 id="repository-delete-confirmation-title">Delete Repository permanently</h2><p id="repository-delete-confirmation-message"></p><label for="repository-delete-confirmation-input">Repository identity</label><input autocomplete="off" id="repository-delete-confirmation-input" required type="text"><button id="repository-delete-confirmation-cancel" type="button">Cancel</button><button id="repository-delete-confirmation-submit" type="submit">Delete permanently</button></form></dialog><form id="repository-create-form"><label for="repository-url">HTTPS URL</label><input id="repository-url" name="url" required type="url"><label for="repository-username">Username</label><input autocomplete="off" id="repository-username" name="username" type="text"><label for="repository-token">Token</label><input autocomplete="off" id="repository-token" name="token" type="password"><button type="submit">Register Repository</button><output aria-live="polite" id="repository-create-result"></output></form><form id="repository-credential-rotate-form"><label for="repository-credential-rotate-repository">Credential Repository</label><select disabled id="repository-credential-rotate-repository" required></select><label for="repository-credential-rotate-username">Replacement username</label><input autocomplete="off" id="repository-credential-rotate-username" required type="text"><label for="repository-credential-rotate-token">Replacement token</label><input autocomplete="off" id="repository-credential-rotate-token" required type="password"><button disabled id="repository-credential-rotate-submit" type="submit">Rotate credential</button><output aria-live="polite" id="repository-credential-rotate-result"></output></form>'
      : "";
  repositorySection = repositorySection
    .replace(
      '<dt>Health</dt><dd id="github-connection-health"></dd>',
      '<dt>Lifecycle</dt><dd id="github-connection-lifecycle"></dd><dt>Health</dt><dd id="github-connection-health"></dd>',
    )
    .replace(
      '<form hidden id="github-repository-selection-form">',
      '<form id="github-connection-lifecycle-form"><button id="github-connection-retire" title="Retire GitHub Connection" type="button">Retire GitHub Connection</button><button id="github-connection-delete" title="Delete GitHub Connection" type="button">Delete GitHub Connection</button></form><dialog aria-labelledby="github-connection-confirmation-title" id="github-connection-confirmation"><form id="github-connection-confirmation-form"><h4 id="github-connection-confirmation-title">Confirm GitHub Connection change</h4><p id="github-connection-confirmation-message"></p><label hidden id="github-connection-confirmation-label" for="github-connection-confirmation-input">Type DELETE to confirm permanent deletion</label><input hidden id="github-connection-confirmation-input" type="text"><button id="github-connection-confirmation-cancel" title="Cancel" type="button">Cancel</button><button id="github-connection-confirmation-submit" type="submit">Confirm</button></form></dialog><form hidden id="github-repository-selection-form">',
    )
    .replace(
      "</section><table>",
      '</section><section aria-labelledby="forgejo-connection-title"><h2 id="forgejo-connection-title">Forgejo Connection</h2><form hidden id="forgejo-connection-form"><label for="forgejo-connection-base-url">Forgejo URL</label><input id="forgejo-connection-base-url" required type="url"><label for="forgejo-connection-token">Repository-scoped PAT</label><input autocomplete="off" id="forgejo-connection-token" required type="password"><label for="forgejo-connection-repositories">Selected Repository IDs</label><input id="forgejo-connection-repositories" required type="text"><button id="forgejo-connection-submit" title="Verify and register Forgejo Repositories" type="submit">Verify and register Forgejo Repositories</button></form><form id="forgejo-connection-rotation-form"><label for="forgejo-connection-rotation-token">Replacement Repository-scoped PAT</label><input autocomplete="off" id="forgejo-connection-rotation-token" required type="password"><button id="forgejo-connection-rotation-submit" title="Rotate Forgejo PAT" type="submit">Rotate Forgejo PAT</button></form><output aria-live="polite" id="forgejo-connection-status" tabindex="-1"></output><p hidden id="forgejo-connection-error" role="alert" tabindex="-1"></p></section><script src="/assets/forgejo-connection-contract.js"></script><script src="/assets/forgejo-connection-lifecycle-confirmation.js"></script><script src="/assets/forgejo-connection.js"></script><table>',
    );
  repositorySection = repositorySection.replace(
    '<label for="forgejo-connection-repositories">Selected Repository IDs</label><input id="forgejo-connection-repositories" required type="text">',
    '<fieldset disabled id="forgejo-connection-repository-fieldset"><legend>Forgejo Repositories</legend><div id="forgejo-connection-repositories"></div></fieldset>',
  );
  repositorySection = repositorySection.replace(
    '<form id="forgejo-connection-rotation-form"><label for="forgejo-connection-rotation-token">Replacement Repository-scoped PAT</label><input autocomplete="off" id="forgejo-connection-rotation-token" required type="password"><button id="forgejo-connection-rotation-submit" type="submit">Rotate Forgejo PAT</button></form><output aria-live="polite" id="forgejo-connection-status" tabindex="-1"></output>',
    '<section aria-labelledby="forgejo-connection-state-title" hidden id="forgejo-connection-details"><h3 id="forgejo-connection-state-title">Connection state</h3><dl><dt>Repository owner</dt><dd id="forgejo-connection-identity"></dd><dt>Lifecycle</dt><dd id="forgejo-connection-lifecycle"></dd><dt>Health</dt><dd id="forgejo-connection-health"></dd><dt>Profile</dt><dd id="forgejo-connection-profile"></dd><dt>Required authorities</dt><dd id="forgejo-connection-scopes"></dd><dt>Capabilities</dt><dd id="forgejo-connection-capabilities"></dd><dt>Latest verification</dt><dd id="forgejo-connection-latest"></dd></dl><h4>Verification history</h4><ol id="forgejo-connection-history"></ol><h4>Polling</h4><ul aria-live="polite" id="forgejo-connection-polling"></ul></section><form hidden id="forgejo-connection-rotation-form"><label for="forgejo-connection-rotation-token">Replacement Repository-scoped PAT</label><input autocomplete="off" id="forgejo-connection-rotation-token" required type="password"><button id="forgejo-connection-rotation-submit" type="submit">Rotate Forgejo PAT</button></form><form hidden id="forgejo-connection-reactivation-form"><label for="forgejo-connection-reactivation-token">Reactivation PAT</label><input autocomplete="off" id="forgejo-connection-reactivation-token" required type="password"><button id="forgejo-connection-reactivation-submit" type="submit">Reactivate Forgejo Connection</button></form><form hidden id="forgejo-connection-lifecycle-form"><button id="forgejo-connection-retire" type="button">Retire Forgejo Connection</button><button id="forgejo-connection-delete" type="button">Delete Forgejo Connection</button></form><dialog aria-labelledby="forgejo-connection-confirmation-title" id="forgejo-connection-confirmation"><form id="forgejo-connection-confirmation-form"><h4 id="forgejo-connection-confirmation-title">Confirm Forgejo Connection change</h4><p id="forgejo-connection-confirmation-message"></p><label hidden id="forgejo-connection-confirmation-label" for="forgejo-connection-confirmation-input">Type DELETE to confirm permanent deletion</label><input hidden id="forgejo-connection-confirmation-input" type="text"><button id="forgejo-connection-confirmation-cancel" type="button">Cancel</button><button id="forgejo-connection-confirmation-submit" type="submit">Confirm</button></form></dialog><output aria-live="polite" id="forgejo-connection-status" tabindex="-1"></output>',
  );
  repositorySection = repositorySection.replace(
    '<output aria-live="polite" id="repository-lifecycle-result"></output>',
    '<output aria-live="polite" id="repository-lifecycle-result" tabindex="-1"></output>',
  );
  const evaluationDetailSection =
    view === "evaluation-detail"
      ? `<section id="evaluation-detail"><a id="evaluation-detail-back" href="/?view=evaluations">Back to evaluations</a><div class="qb-evaluation-detail-meta"><h1 id="evaluation-detail-title">Evaluation</h1><dl><dt>Repository</dt><dd id="evaluation-detail-repository"></dd><dt>Source</dt><dd id="evaluation-detail-source"></dd><dt>Status</dt><dd id="evaluation-detail-status"></dd><dt>Outcome</dt><dd id="evaluation-detail-outcome"></dd><dt>Duration</dt><dd id="evaluation-detail-duration"></dd><dt>Last refreshed</dt><dd id="evaluation-detail-updated"></dd></dl><div hidden id="evaluation-detail-error" role="alert" tabindex="-1"></div><p id="evaluation-detail-loading">Loading evaluation…</p><div><button hidden id="evaluation-detail-cancel" type="button">Cancel</button><button hidden id="evaluation-detail-retry" type="button">Retry</button></div></div><section class="qb-deep-surface qb-evaluation-detail-panel" aria-label="Evaluation detail"><div class="qb-evaluation-detail-grid"><ol id="evaluation-detail-timeline"></ol><section id="evaluation-detail-preview" aria-label="Evaluation summary"><h2>Summary</h2><dl><dt>Review counts</dt><dd id="evaluation-detail-review-counts"></dd><dt>Outcome counts</dt><dd id="evaluation-detail-outcome-counts"></dd><dt>Finding counts</dt><dd id="evaluation-detail-finding-counts"></dd></dl></section></div><section id="evaluation-detail-result" aria-label="Evaluation result"></section></section><style>.qb-evaluation-detail-meta{display:grid;gap:1rem;margin-block:1rem}.qb-evaluation-detail-meta dl,.qb-evaluation-detail-meta dl+div{margin:0}.qb-evaluation-detail-meta dl{display:grid;gap:.3rem 1rem;grid-template-columns:max-content minmax(0,1fr)}.qb-evaluation-detail-meta dt{color:var(--qb-muted-ink)}.qb-evaluation-detail-panel{margin-top:1.5rem;padding:clamp(1rem,3vw,2rem)}.qb-evaluation-detail-grid{display:grid;gap:2rem;grid-template-columns:minmax(14rem,1fr) minmax(18rem,1fr)}#evaluation-detail-timeline{display:grid;gap:.9rem;list-style:none;margin:0;padding:0}.qb-timeline-node{align-items:center;display:grid;gap:.65rem;grid-template-columns:1rem minmax(0,1fr);position:relative}.qb-timeline-node:not(:last-child)::after{background:var(--qb-line);content:"";height:calc(100% + .9rem);left:.45rem;position:absolute;top:.75rem;width:1px}.qb-timeline-node__marker{background:var(--qb-system-marker);height:.9rem;width:.9rem;z-index:1}.qb-timeline-node--review .qb-timeline-node__marker{border-radius:50%;background:var(--qb-review-marker)}.qb-timeline-node__status{color:var(--qb-muted-ink);font-size:.9em}@media(max-width:760px){.qb-evaluation-detail-grid{grid-template-columns:1fr}.qb-evaluation-detail-meta dl{grid-template-columns:1fr}.qb-evaluation-detail-meta dt{margin-top:.5rem}}</style></section>`
      : "";
  evaluationSection += evaluationDetailSection;
  evaluationSection +=
    view === "evaluation-detail"
      ? '<script src="/assets/evaluation-result.js"></script><script src="/assets/evaluation-detail.js"></script>'
      : "";
  /** @param {string} markup */
  const compactRegions = (markup) =>
    markup
      .replaceAll("<section ", '<section class="qb-region" ')
      .replaceAll("<section>", '<section class="qb-region">');
  /** @param {string} markup @param {string[]} titles */
  const deepDetailRegions = (markup, titles) =>
    titles.reduce(
      /** @param {string} result @param {string} title */
      (result, title) =>
        result.replace(
          `class="qb-region" aria-labelledby="${title}"`,
          `class="qb-region qb-deep-surface" aria-labelledby="${title}"`,
        ),
      markup,
    );
  if (systemSection) {
    const systemScripts = systemSection.slice(systemSection.indexOf("<script"));
    const systemFacts = systemSection.match(
      /<section aria-live="polite" id="system-facts"><\/section>/,
    )?.[0];
    /** @param {string} title */
    const systemRegion = (title) =>
      systemSection.match(
        new RegExp(
          `<section aria-labelledby="${title}">[\\s\\S]*?<\\/section>`,
        ),
      )?.[0];
    const orderedSystemRegions = [
      systemRegion("codex-execution-title"),
      systemFacts,
      systemRegion("storage-reserve-title"),
      systemRegion("system-storage-title"),
      systemRegion("system-polling-title"),
      systemRegion("system-delivery-title"),
      systemRegion("waiver-adjudicator-configuration-title"),
    ];
    if (orderedSystemRegions.some((region) => region === undefined)) {
      throw new Error("system_region_markup_missing");
    }
    systemSection = deepDetailRegions(
      compactRegions(orderedSystemRegions.join("") + systemScripts),
      ["waiver-adjudicator-configuration-title"],
    );
  }
  if (reviewSection) {
    reviewSection = deepDetailRegions(compactRegions(reviewSection), [
      "review-metadata-title",
      "review-version-title",
      "review-assignment-title",
      "review-archival-title",
    ]);
  }
  if (repositorySection) {
    repositorySection = deepDetailRegions(compactRegions(repositorySection), [
      "github-connection-state-title",
      "forgejo-connection-state-title",
    ])
      .replace(
        '<section class="qb-region"><h2>Repository Guidance</h2>',
        '<section class="qb-region qb-deep-surface" aria-labelledby="repository-guidance-title"><h2 id="repository-guidance-title">Repository Guidance</h2>',
      )
      .replace(
        "<table><thead><tr><th>Provider and Connection</th>",
        '<section class="qb-region" aria-labelledby="repository-inventory-title"><h2 id="repository-inventory-title">Repository inventory</h2><table><thead><tr><th>Provider and Connection</th>',
      )
      .replace(
        '</tbody></table><section class="qb-region qb-deep-surface" aria-labelledby="repository-guidance-title">',
        '</tbody></table></section><section class="qb-region qb-deep-surface" aria-labelledby="repository-guidance-title">',
      )
      .replace(
        '<form id="repository-lifecycle-form">',
        '<section class="qb-region qb-deep-surface" aria-labelledby="repository-lifecycle-title"><h2 id="repository-lifecycle-title">Repository lifecycle</h2><form id="repository-lifecycle-form">',
      )
      .replace(
        '</form><dialog aria-labelledby="repository-delete-confirmation-title"',
        '</form></section><dialog aria-labelledby="repository-delete-confirmation-title"',
      )
      .replace(
        '<output aria-live="polite" id="github-connection-status"',
        '<output class="qb-status" aria-live="polite" id="github-connection-status"',
      )
      .replace(
        '<output aria-live="polite" id="forgejo-connection-status"',
        '<output class="qb-status" aria-live="polite" id="forgejo-connection-status"',
      );
  }
  if (analyticsSection) {
    analyticsSection = deepDetailRegions(compactRegions(analyticsSection), [
      "analytics-matching-facts-title",
    ]).replace(
      '<form id="analytics-filters">',
      '<form class="qb-filter-bar" id="analytics-filters">',
    );
  }
  return `<div class="qb-app-shell"><header class="qb-header"><a class="qb-brand" href="/?view=evaluations">Quality Bar</a><nav aria-label="Primary" class="qb-primary-nav">${navigationLinks}</nav>${attention}</header><main class="qb-main"><h1 class="qb-page-heading">${heading}</h1>${evaluationSection}${reviewSection}${repositorySection}${analyticsSection}${systemSection}<details><summary>Operator</summary><form id="password-change-form"><label for="password-change-current-password">Current password for password change</label><input autocomplete="current-password" id="password-change-current-password" name="current_password" required type="password"><label for="password-change-new-password">New password</label><input autocomplete="new-password" id="password-change-new-password" name="new_password" required type="password"><button title="Change password" type="submit">Change password</button></form><form id="session-revocation-form"><label for="session-revocation-password">Current password for session revocation</label><input autocomplete="current-password" id="session-revocation-password" name="password" required type="password"><label for="session-revocation-confirmation">Confirmation: REVOKE ALL SESSIONS</label><input id="session-revocation-confirmation" name="confirmation" required type="text"><button title="Revoke all sessions" type="submit">Revoke all sessions</button></form><form id="implementer-token-create-form"><label for="implementer-token-create-password">Current password for implementer token creation</label><input autocomplete="current-password" id="implementer-token-create-password" name="password" required type="password"><button title="Create implementer token" type="submit">Create implementer token</button></form><form id="implementer-token-rotate-form"><label for="implementer-token-rotate-password">Current password for implementer token rotation</label><input autocomplete="current-password" id="implementer-token-rotate-password" name="password" required type="password"><button title="Rotate implementer token" type="submit">Rotate implementer token</button></form><form id="implementer-token-revoke-form"><label for="implementer-token-revoke-password">Current password for implementer token revocation</label><input autocomplete="current-password" id="implementer-token-revoke-password" name="password" required type="password"><button title="Revoke implementer token" type="submit">Revoke implementer token</button></form><button id="logout" title="Log out" type="button">Log out</button></details><dialog aria-labelledby="implementer-token-reveal-title" id="implementer-token-reveal"><h2 id="implementer-token-reveal-title">Implementer token</h2><output id="implementer-token-value"></output><button id="implementer-token-reveal-close" title="Done" type="button">Done</button></dialog><p hidden id="error" role="alert" tabindex="-1"></p></main></div><script id="browser-configuration" type="application/json">${browserConfiguration({ csrfCookieName: BROWSER_CSRF_COOKIE_NAME })}</script><script src="/assets/system-attention.js"></script><script src="/assets/operator.js"></script>${view === "evaluations" ? '<script src="/assets/evaluation.js"></script>' : ""}${view === "repositories" ? '<script src="/assets/github-connection-contract.js"></script><script src="/assets/github-connection-lifecycle-confirmation.js"></script><script src="/assets/github-connection-submission.js"></script><script src="/assets/github-connection.js"></script><script src="/assets/repository.js"></script><script src="/assets/repository-delete.js"></script><script src="/assets/repository-guidance.js"></script>' : ""}${view === "reviews" ? '<script src="/assets/review-create.js"></script><script src="/assets/review-metadata.js"></script><script src="/assets/review-criteria.js"></script><script src="/assets/review-version-contract.js"></script><script src="/assets/review-version.js"></script><script src="/assets/review-reactivation.js"></script><script src="/assets/review-assignment.js"></script><script src="/assets/review-archival.js"></script><script src="/assets/review-delete.js"></script>' : ""}${view === "analytics" ? '<script src="/assets/analytics.js"></script>' : ""}${view === "system" ? '<script src="/assets/system-execution.js"></script><script src="/assets/storage-reserve.js"></script><script src="/assets/waiver-adjudicator-configuration.js"></script>' : ""}`;
}
