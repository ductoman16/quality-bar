import { BROWSER_CSRF_COOKIE_NAME } from "./browser-session.js";
import { renderEvaluationMonitorPage } from "./evaluation-monitor-page.js";
import { renderReviewPage } from "./review-page.js";

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
      "review-detail",
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
    const active =
      view === name || (name === "reviews" && view === "review-detail");
    return `<a${active ? ' aria-current="page"' : ""} href="/?view=${name}">${label}</a>`;
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
      ? '<section aria-live="polite" id="system-facts"></section><section aria-labelledby="execution-providers-title"><h2 id="execution-providers-title">Execution providers</h2><dl id="execution-provider-facts"></dl></section><section aria-labelledby="system-polling-title"><h2 id="system-polling-title">Polling</h2><ol id="system-polling-connections"></ol></section><section aria-labelledby="system-delivery-title"><h2 id="system-delivery-title">Delivery</h2><ol id="system-delivery-surfaces"></ol></section><section aria-labelledby="codex-execution-title"><h2 id="codex-execution-title">Codex execution</h2><dl id="codex-execution-concurrency"></dl><h3>Queued</h3><ol id="codex-execution-queue"></ol><h3>Running</h3><ol id="codex-execution-running"></ol><h3>Failures</h3><ol id="codex-execution-failures"></ol></section><section aria-labelledby="storage-reserve-title"><h2 id="storage-reserve-title">Storage reserve</h2><dl id="storage-reserve-facts"></dl></section><section aria-labelledby="system-storage-title"><h2 id="system-storage-title">Storage, backup, and migration</h2><dl id="system-storage-facts"></dl></section><section aria-labelledby="waiver-adjudicator-configuration-title"><h2 id="waiver-adjudicator-configuration-title">Waiver Adjudicator Configuration</h2><form hidden id="waiver-adjudicator-configuration-form"><label for="waiver-adjudicator-model">Model</label><select id="waiver-adjudicator-model" required></select><label for="waiver-adjudicator-reasoning-effort">Reasoning effort</label><select id="waiver-adjudicator-reasoning-effort" required></select><label for="waiver-adjudicator-service-tier">Service tier</label><select id="waiver-adjudicator-service-tier" required></select><button id="waiver-adjudicator-configuration-submit" type="submit">Save configuration</button><output aria-label="Waiver Adjudicator Configuration status" aria-live="polite" id="waiver-adjudicator-configuration-status"></output><p hidden id="waiver-adjudicator-configuration-error" role="alert" tabindex="-1"></p></form></section><script src="/assets/system-polling-delivery-contract.js"></script><script src="/assets/system-polling-delivery.js"></script><script src="/assets/system-storage.js"></script>'
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
  const reviewPage = ["reviews", "review-detail"].includes(view)
    ? renderReviewPage(/** @type {"reviews" | "review-detail"} */ (view))
    : { markup: "", scripts: "" };
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
      systemRegion("execution-providers-title"),
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
  return `<div class="qb-app-shell"><header class="qb-header"><a class="qb-brand" href="/?view=evaluations" aria-label="Quality Bar">QB</a><span class="qb-brand-title">Quality Bar</span><nav aria-label="Primary" class="qb-primary-nav">${navigationLinks}</nav><div class="qb-header-actions"><button class="qb-theme-toggle" aria-label="Toggle theme" type="button">☼</button></div>${attention}</header><main class="qb-main">${view === "review-detail" ? "" : `<h1 class="qb-page-heading">${heading}</h1>`}${evaluationPage.markup}${reviewPage.markup}${repositorySection}${analyticsSection}${systemSection}<details><summary>Operator</summary><form id="password-change-form"><label for="password-change-current-password">Current password for password change</label><input autocomplete="current-password" id="password-change-current-password" name="current_password" required type="password"><label for="password-change-new-password">New password</label><input autocomplete="new-password" id="password-change-new-password" name="new_password" required type="password"><button title="Change password" type="submit">Change password</button></form><form id="session-revocation-form"><label for="session-revocation-password">Current password for session revocation</label><input autocomplete="current-password" id="session-revocation-password" name="password" required type="password"><label for="session-revocation-confirmation">Confirmation: REVOKE ALL SESSIONS</label><input id="session-revocation-confirmation" name="confirmation" required type="text"><button title="Revoke all sessions" type="submit">Revoke all sessions</button></form><form id="implementer-token-create-form"><label for="implementer-token-create-password">Current password for implementer token creation</label><input autocomplete="current-password" id="implementer-token-create-password" name="password" required type="password"><button title="Create implementer token" type="submit">Create implementer token</button></form><form id="implementer-token-rotate-form"><label for="implementer-token-rotate-password">Current password for implementer token rotation</label><input autocomplete="current-password" id="implementer-token-rotate-password" name="password" required type="password"><button title="Rotate implementer token" type="submit">Rotate implementer token</button></form><form id="implementer-token-revoke-form"><label for="implementer-token-revoke-password">Current password for implementer token revocation</label><input autocomplete="current-password" id="implementer-token-revoke-password" name="password" required type="password"><button title="Revoke implementer token" type="submit">Revoke implementer token</button></form><button id="logout" title="Log out" type="button">Log out</button></details><dialog aria-labelledby="implementer-token-reveal-title" id="implementer-token-reveal"><h2 id="implementer-token-reveal-title">Implementer token</h2><output id="implementer-token-value"></output><button id="implementer-token-reveal-close" title="Done" type="button">Done</button></dialog><p hidden id="error" role="alert" tabindex="-1"></p></main></div><script id="browser-configuration" type="application/json">${browserConfiguration({ csrfCookieName: BROWSER_CSRF_COOKIE_NAME })}</script><script src="/assets/system-attention.js"></script><script src="/assets/operator.js"></script>${evaluationPage.scripts}${view === "repositories" ? '<script src="/assets/github-connection-contract.js"></script><script src="/assets/github-connection-lifecycle-confirmation.js"></script><script src="/assets/github-connection-submission.js"></script><script src="/assets/github-connection.js"></script><script src="/assets/repository.js"></script><script src="/assets/repository-delete.js"></script><script src="/assets/repository-guidance.js"></script>' : ""}${reviewPage.scripts}${view === "analytics" ? '<script src="/assets/analytics.js"></script>' : ""}${view === "system" ? '<script src="/assets/system-execution.js"></script><script src="/assets/storage-reserve.js"></script><script src="/assets/waiver-adjudicator-configuration.js"></script>' : ""}`;
}
