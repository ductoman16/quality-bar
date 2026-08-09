import { BROWSER_CSRF_COOKIE_NAME } from "./browser-session.js";
import { renderEvaluationMonitorPage } from "./evaluation-monitor-page.js";

const REVIEWS_PAGE_STYLE = `<style>.reviews-catalog__summary{display:block;margin:0 0 6px;color:var(--qb-muted-ink);font-family:var(--font-mono);font-size:12px}#review-catalog-loading,#review-catalog-empty,#review-catalog-error{margin:2px 0 0;color:var(--qb-muted-ink);font-size:12px}#review-catalog{border-top:1px solid var(--qb-line)}.review-row{border-top:1px solid var(--qb-line)}.review-row:first-child{border-top:0}.review-row__summary{display:grid;grid-template-columns:22px minmax(0,1.7fr) minmax(120px,.8fr) minmax(96px,.7fr) 46px minmax(110px,.9fr);align-items:center;column-gap:16px;padding:13px 0}.review-row__toggle{width:22px;height:22px;padding:0;border:0;border-radius:0;background:transparent}.review-row__toggle:hover{background:transparent}.review-row__chevron{display:block;width:7px;height:7px;margin:-3px auto 0;border-right:1.8px solid var(--qb-ink);border-bottom:1.8px solid var(--qb-ink);transform:rotate(45deg);transition:transform .15s}.review-row__toggle[aria-expanded="true"] .review-row__chevron{transform:rotate(-135deg);margin:3px auto 0}.review-row__identity{display:flex;align-items:center;gap:11px;min-width:0}.review-row__mark{width:10px;height:10px;flex:0 0 10px;border:1px solid var(--qb-ink);border-radius:50%}.review-row__mark--active{background:var(--qb-ink)}.review-row__mark--archived{background:transparent}.review-row__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:650}.review-row__state{flex:0 0 auto;color:var(--qb-muted-ink);font-size:10px;font-weight:650;letter-spacing:.07em;text-transform:uppercase}.review-row--archived .review-row__name{color:var(--qb-muted-ink)}.review-row__scope{color:var(--qb-muted-ink);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.review-row__criteria{display:flex;flex-direction:column;gap:1px;min-width:0}.review-row__criteria-total{font-size:13px}.review-row__criteria-split{color:var(--qb-muted-ink);font-size:10px}.review-row__version{font-family:var(--font-mono);font-size:12px;color:var(--qb-muted-ink)}.review-row__model{font-family:var(--font-mono);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.review-expanded{padding:4px 0 22px 38px;display:grid;gap:20px}.review-criteria-read{list-style:none;margin:0;padding:0;display:grid;gap:14px;max-width:74ch}.review-criteria-read__item{display:grid;gap:5px}.review-criteria-read__head{display:flex;align-items:center;gap:8px}.review-impact{width:9px;height:9px;flex:0 0 9px;border:1px solid var(--qb-ink);border-radius:50%}.review-impact--blocking{background:var(--qb-ink)}.review-impact--advisory{background:transparent}.review-impact-label{color:var(--qb-muted-ink);font-size:10px;font-weight:650;letter-spacing:.07em;text-transform:uppercase}.review-criteria-read__text{margin:0;font-size:13px;line-height:1.5}.review-criteria-read__empty{color:var(--qb-muted-ink);font-size:12px}.review-applicability-read{display:grid;gap:6px}.review-fact__label{color:var(--qb-muted-ink);font-size:10px;font-weight:650;letter-spacing:.07em;text-transform:uppercase}.review-applicability-read__rule{margin:0;padding:10px 12px;border:1px solid var(--qb-line);background:transparent;font-family:var(--font-mono);font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-x:auto;max-width:74ch}.review-applicability-read__always{color:var(--qb-muted-ink);font-size:12px}.review-facts{display:flex;flex-wrap:wrap;gap:28px}.review-fact{display:grid;gap:3px}.review-fact__value{font-size:13px}.review-edit{justify-self:start;min-height:31px;padding:5px 15px;border:1px solid var(--qb-ink);border-radius:6px;background:transparent;font-size:12px;font-weight:650}.review-edit:hover{background:var(--qb-ink);color:var(--qb-canvas)}.review-owner{display:grid;gap:12px}.review-owner__title{display:flex;align-items:center;font-size:10px;font-weight:650;letter-spacing:.07em;text-transform:uppercase;color:var(--qb-muted-ink)}.review-owner--version{padding-left:24px}.review-owner--version .review-owner__title::before{content:"";display:inline-block;width:8px;height:8px;margin-right:8px;border:1px solid var(--qb-ink);border-radius:50%;background:var(--qb-ink)}.reviews-authoring{display:block;border:0;border-top:1px solid var(--qb-line);border-bottom:1px solid var(--qb-line);padding:0}.reviews-authoring>summary{padding:14px 0;color:var(--qb-ink);font-size:11px;font-weight:650;letter-spacing:.07em;text-transform:uppercase;list-style:none;cursor:pointer}.reviews-authoring>summary::-webkit-details-marker{display:none}.reviews-authoring>summary::before{content:"+";display:inline-block;width:16px;font-family:var(--font-mono);color:var(--qb-muted-ink)}.reviews-authoring[open]>summary::before{content:"–"}.reviews-authoring[open]>summary{border-bottom:1px solid var(--qb-line)}.reviews-authoring #review-create-form{padding:20px 0 24px}#review-criteria,#review-version-criteria{list-style:none;margin:0;padding:0;justify-self:stretch;width:100%;border-top:1px solid var(--qb-line)}#review-criteria>li,#review-version-criteria>li{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:12px 0;border-bottom:1px solid var(--qb-line)}#review-criteria>li>textarea,#review-version-criteria>li>textarea{flex:1 1 100%;min-height:2.6rem;border:1px solid var(--qb-line);border-radius:6px;padding:6px 8px;font-family:inherit;font-size:13px;line-height:1.5;resize:vertical}#review-criteria>li>select,#review-version-criteria>li>select{flex:0 0 auto;min-width:9rem;font-family:var(--font-mono);font-size:12px}#review-criteria>li>button,#review-version-criteria>li>button{flex:0 0 auto;width:32px;min-height:30px;padding:0;border:1px solid var(--qb-line);border-radius:6px;font-size:13px;line-height:1}#review-criteria>li>button:hover:not(:disabled),#review-version-criteria>li>button:hover:not(:disabled){border-color:var(--qb-ink)}#review-criteria>li>p,#review-version-criteria>li>p{flex:1 1 100%;margin:0;color:var(--qb-muted-ink);font-size:11px}#review-add-criterion,#review-version-add-criterion{justify-self:start;width:auto;min-width:0;min-height:30px;padding:4px 15px;border-radius:6px;font-size:12px}#review-version-applicability-rule{font-family:var(--font-mono);font-size:12px;min-height:4rem;line-height:1.5;resize:vertical}label[for="review-metadata-review"],#review-metadata-review,label[for="review-version-review"],#review-version-review,label[for="review-assignment-review"],#review-assignment-review,label[for="review-archival-review"],#review-archival-review,label[for="review-archival-state"],#review-archival-state{display:none!important}.reviews-context{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:2px 0 4px}.reviews-context__label{color:var(--qb-muted-ink);font-size:11px;font-weight:650;letter-spacing:.07em;text-transform:uppercase}#review-editor-review{min-width:16rem;font-size:15px;font-weight:650;border:1px solid var(--qb-ink);border-radius:6px;padding:7px 12px}.review-group{margin-top:30px}.review-group__title{display:flex;align-items:center;margin:0 0 4px;padding:0 0 9px;border-bottom:1px solid var(--qb-line);font-size:12px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--qb-ink)}.review-group--version{margin-top:34px;padding-left:26px}.review-group--version .review-group__title::before{content:"";display:inline-block;width:9px;height:9px;margin-right:9px;border:1px solid var(--qb-ink);border-radius:50%;background:var(--qb-ink)}#review-editor-active-version{margin-left:1px;font-family:var(--font-mono);font-size:12px;font-weight:400;letter-spacing:0;text-transform:none;color:var(--qb-muted-ink)}.review-band{margin-top:20px}.review-band__title{margin:0 0 12px;font-size:10px;font-weight:650;letter-spacing:.07em;text-transform:uppercase;color:var(--qb-muted-ink)}.review-band form{padding:0}</style>`;

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
  const evaluationPage = ["evaluations", "evaluation-detail"].includes(view)
    ? renderEvaluationMonitorPage(
        /** @type {"evaluations" | "evaluation-detail"} */ (view),
      )
    : { markup: "", scripts: "" };
  let reviewSection =
    view === "reviews"
      ? '<section class="qb-region" aria-labelledby="reviews-catalog-title"><h2 class="qb-visually-hidden" id="reviews-catalog-title">Configured Reviews</h2><output class="reviews-catalog__summary" aria-live="polite" id="review-catalog-summary"></output><p aria-live="polite" id="review-catalog-loading">Loading Reviews</p><p hidden id="review-catalog-empty">No Reviews configured</p><p hidden id="review-catalog-error" role="alert" tabindex="-1"></p><div id="review-catalog"></div></section><details class="reviews-authoring" id="reviews-authoring"><summary class="reviews-authoring__summary">New Review</summary><form id="review-create-form"><label for="review-name">Name</label><input id="review-name" name="name" required type="text"><label for="review-description">Description</label><textarea id="review-description" name="description" required></textarea><ol id="review-criteria"></ol><button aria-label="Add another Criterion" id="review-add-criterion" title="Add another Criterion" type="button">+</button><label for="review-model">Codex model</label><select id="review-model" name="model" required></select><label for="review-reasoning-effort">Reasoning effort</label><select id="review-reasoning-effort" name="reasoning_effort" required></select><label for="review-service-tier">Service tier</label><select id="review-service-tier" name="service_tier" required></select><button id="review-create-submit" title="Create Review" type="submit">Create Review</button><output aria-live="polite" id="review-create-result"></output></form></details><span aria-hidden="true" id="reviews-editor"></span><section class="qb-region reviews-editor" aria-labelledby="reviews-editor-title"><div class="reviews-context"><h2 class="qb-visually-hidden" id="reviews-editor-title">Configure Review</h2><label class="reviews-context__label" for="review-editor-review">Editing</label><select id="review-editor-review"></select></div><div class="review-group review-group--lineage"><h3 class="review-group__title">Review</h3><div class="review-band"><h4 class="review-band__title">Identity</h4><form hidden id="review-metadata-form"><label for="review-metadata-review">Review</label><select id="review-metadata-review"></select><input id="review-metadata-id" type="hidden"><label for="review-metadata-name">Name</label><input aria-describedby="review-metadata-name-error" aria-required="true" id="review-metadata-name" type="text"><p hidden id="review-metadata-name-error"></p><label for="review-metadata-description">Description</label><textarea aria-describedby="review-metadata-description-error" aria-required="true" id="review-metadata-description"></textarea><p hidden id="review-metadata-description-error"></p><button id="review-metadata-submit" title="Save metadata" type="submit">Save metadata</button><output aria-live="polite" id="review-metadata-result"></output></form></div><div class="review-band"><h4 class="review-band__title">Assignment</h4><form hidden id="review-assignment-form"><label for="review-assignment-review">Review</label><select id="review-assignment-review"></select><label for="review-assignment-scope">Scope</label><select id="review-assignment-scope"><option value="installation_wide">Installation-wide</option><option value="repository_set">Repository-specific</option></select><label for="review-assignment-repositories">Repositories</label><select id="review-assignment-repositories" multiple required></select><button id="review-assignment-submit" title="Save Assignment" type="submit">Save Assignment</button><output aria-live="polite" id="review-assignment-result"></output></form></div><div class="review-band"><h4 class="review-band__title">Lifecycle</h4><form hidden id="review-archival-form"><label for="review-archival-state">State</label><select id="review-archival-state"><option value="active">Active</option><option value="archived">Archived</option></select><label for="review-archival-review">Review</label><select id="review-archival-review"></select><button id="review-archival-submit" title="Archive or restore review" type="button"></button><button disabled id="review-delete" title="Delete Review" type="button">Delete Review</button><output aria-live="polite" id="review-archival-result" tabindex="-1"></output></form><dialog aria-labelledby="review-delete-confirmation-title" id="review-delete-confirmation"><form id="review-delete-confirmation-form"><h2 id="review-delete-confirmation-title">Delete Review permanently</h2><p id="review-delete-confirmation-message"></p><label for="review-delete-confirmation-input">Review name</label><input autocomplete="off" id="review-delete-confirmation-input" required type="text"><button id="review-delete-confirmation-cancel" title="Cancel" type="button">Cancel</button><button title="Delete permanently" type="submit">Delete permanently</button></form></dialog></div></div><div class="review-group review-group--version qb-deep-surface"><h3 class="review-group__title">Active version<output aria-live="polite" id="review-editor-active-version"></output></h3><div class="review-band"><form hidden id="review-version-form"><label for="review-version-review">Executable snapshot</label><select id="review-version-review"></select><input id="review-version-id" type="hidden"><label for="review-version-activation">Prior Version</label><select id="review-version-activation"></select><button id="review-version-activate" title="Reactivate" type="button">Reactivate</button><ol id="review-version-criteria"></ol><button aria-label="Add Criterion" id="review-version-add-criterion" title="Add Criterion" type="button">+</button><label for="review-version-applicability-rule">Applicability rule</label><textarea id="review-version-applicability-rule"></textarea><label for="review-version-model">Codex model</label><select id="review-version-model" required></select><label for="review-version-reasoning-effort">Reasoning effort</label><select id="review-version-reasoning-effort" required></select><label for="review-version-service-tier">Service tier</label><select id="review-version-service-tier" required></select><button id="review-version-submit" title="Save Review Version" type="submit">Save Review Version</button><output aria-live="polite" id="review-version-result"></output></form></div></div></section>'
      : "";
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
    reviewSection += REVIEWS_PAGE_STYLE;
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
  return `<div class="qb-app-shell"><header class="qb-header"><a class="qb-brand" href="/?view=evaluations" aria-label="Quality Bar">QB</a><span class="qb-brand-title">Quality Bar</span><nav aria-label="Primary" class="qb-primary-nav">${navigationLinks}</nav><div class="qb-header-actions"><button class="qb-theme-toggle" aria-label="Toggle theme" type="button">☼</button></div>${attention}</header><main class="qb-main"><h1 class="qb-page-heading">${heading}</h1>${evaluationPage.markup}${reviewSection}${repositorySection}${analyticsSection}${systemSection}<details><summary>Operator</summary><form id="password-change-form"><label for="password-change-current-password">Current password for password change</label><input autocomplete="current-password" id="password-change-current-password" name="current_password" required type="password"><label for="password-change-new-password">New password</label><input autocomplete="new-password" id="password-change-new-password" name="new_password" required type="password"><button title="Change password" type="submit">Change password</button></form><form id="session-revocation-form"><label for="session-revocation-password">Current password for session revocation</label><input autocomplete="current-password" id="session-revocation-password" name="password" required type="password"><label for="session-revocation-confirmation">Confirmation: REVOKE ALL SESSIONS</label><input id="session-revocation-confirmation" name="confirmation" required type="text"><button title="Revoke all sessions" type="submit">Revoke all sessions</button></form><form id="implementer-token-create-form"><label for="implementer-token-create-password">Current password for implementer token creation</label><input autocomplete="current-password" id="implementer-token-create-password" name="password" required type="password"><button title="Create implementer token" type="submit">Create implementer token</button></form><form id="implementer-token-rotate-form"><label for="implementer-token-rotate-password">Current password for implementer token rotation</label><input autocomplete="current-password" id="implementer-token-rotate-password" name="password" required type="password"><button title="Rotate implementer token" type="submit">Rotate implementer token</button></form><form id="implementer-token-revoke-form"><label for="implementer-token-revoke-password">Current password for implementer token revocation</label><input autocomplete="current-password" id="implementer-token-revoke-password" name="password" required type="password"><button title="Revoke implementer token" type="submit">Revoke implementer token</button></form><button id="logout" title="Log out" type="button">Log out</button></details><dialog aria-labelledby="implementer-token-reveal-title" id="implementer-token-reveal"><h2 id="implementer-token-reveal-title">Implementer token</h2><output id="implementer-token-value"></output><button id="implementer-token-reveal-close" title="Done" type="button">Done</button></dialog><p hidden id="error" role="alert" tabindex="-1"></p></main></div><script id="browser-configuration" type="application/json">${browserConfiguration({ csrfCookieName: BROWSER_CSRF_COOKIE_NAME })}</script><script src="/assets/system-attention.js"></script><script src="/assets/operator.js"></script>${evaluationPage.scripts}${view === "repositories" ? '<script src="/assets/github-connection-contract.js"></script><script src="/assets/github-connection-lifecycle-confirmation.js"></script><script src="/assets/github-connection-submission.js"></script><script src="/assets/github-connection.js"></script><script src="/assets/repository.js"></script><script src="/assets/repository-delete.js"></script><script src="/assets/repository-guidance.js"></script>' : ""}${view === "reviews" ? '<script src="/assets/review-catalog.js"></script><script src="/assets/review-editor.js"></script><script src="/assets/review-create.js"></script><script src="/assets/review-metadata.js"></script><script src="/assets/review-criteria.js"></script><script src="/assets/review-version-contract.js"></script><script src="/assets/review-version.js"></script><script src="/assets/review-reactivation.js"></script><script src="/assets/review-assignment.js"></script><script src="/assets/review-archival.js"></script><script src="/assets/review-delete.js"></script>' : ""}${view === "analytics" ? '<script src="/assets/analytics.js"></script>' : ""}${view === "system" ? '<script src="/assets/system-execution.js"></script><script src="/assets/storage-reserve.js"></script><script src="/assets/waiver-adjudicator-configuration.js"></script>' : ""}`;
}
