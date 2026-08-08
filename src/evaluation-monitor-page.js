const monitorScript = '<script src="/assets/evaluation-monitor.js"></script>';

const evaluationList = `<section class="evaluation-monitor" id="evaluation-monitor" aria-label="Evaluation monitor">
<header class="qb-toolbar evaluation-monitor__header"><button id="evaluation-create-toggle" type="button" aria-expanded="false" aria-controls="evaluation-create-form">New evaluation</button></header>
<section aria-label="Fleet statistics" class="qb-stat-strip">
<div class="qb-stat"><span>Workers</span><output id="evaluation-stat-workers">Loading</output></div>
<div class="qb-stat"><span>Queue</span><output id="evaluation-stat-queue">Loading</output></div>
<div class="qb-stat"><span>Pass Rate</span><output id="evaluation-stat-pass-rate">Loading</output></div>
<div class="qb-stat"><span>P95 Duration</span><output id="evaluation-stat-p95">Loading</output></div>
<div class="qb-stat"><span>Updated</span><output id="evaluation-stat-updated">Loading</output></div>
</section>
<div class="qb-toolbar evaluation-stat-window" aria-label="Statistics window"><button aria-pressed="true" id="evaluation-stat-window-24h" type="button">24h</button><button aria-pressed="false" id="evaluation-stat-window-7d" type="button">7d</button></div>
<form hidden id="evaluation-create-form">
<label for="evaluation-create-repository">Repository</label><select disabled id="evaluation-create-repository" required></select>
<label for="evaluation-create-base-type">Base type</label><select id="evaluation-create-base-type"><option value="branch">Branch</option><option value="commit">Commit</option></select>
<label for="evaluation-create-base-value">Base value</label><input id="evaluation-create-base-value" required>
<label for="evaluation-create-head-type">Head type</label><select id="evaluation-create-head-type"><option value="branch">Branch</option><option value="commit">Commit</option></select>
<label for="evaluation-create-head-value">Head value</label><input id="evaluation-create-head-value" required>
<button id="evaluation-create-submit" type="submit">Evaluate</button><output aria-live="polite" id="evaluation-create-status"></output>
</form>
<form class="qb-filter-bar" id="evaluation-filter-form">
<label for="evaluation-filter-repository">Repository</label><select id="evaluation-filter-repository"><option value="">All repositories</option></select>
<label for="evaluation-filter-status">Status</label><select id="evaluation-filter-status"><option value="">All statuses</option><option value="queued">Queued</option><option value="running">Running</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select>
<label for="evaluation-filter-outcome">Outcome</label><select id="evaluation-filter-outcome"><option value="">All outcomes</option><option value="pending">Pending</option><option value="clear">Clear</option><option value="advisory">Advisory</option><option value="blocking">Blocking</option><option value="error">Error</option></select>
<label for="evaluation-filter-query">Query</label><input id="evaluation-filter-query" maxlength="200">
<label for="evaluation-filter-start">Start</label><input id="evaluation-filter-start" type="datetime-local">
<label for="evaluation-filter-end">End</label><input id="evaluation-filter-end" type="datetime-local">
<button type="submit">Apply</button><button id="evaluation-filter-reset" type="button">Reset</button>
</form>
<p aria-live="polite" id="evaluation-loading">Loading Evaluations</p><p hidden id="evaluation-empty">No Evaluations</p><p hidden id="evaluation-error" role="alert" tabindex="-1"></p>
<section class="evaluation-ledger" id="evaluation-list" aria-label="Evaluation ledger"></section>
<button hidden id="evaluation-new-activity" type="button">New activity available</button><button hidden id="evaluation-load-more" type="button">Load more</button>
</section><style>.evaluation-monitor{display:grid;gap:12px}.evaluation-monitor__header{justify-content:flex-end}.evaluation-stat-window button[aria-pressed="true"]{font-weight:800;text-decoration:underline;text-underline-offset:3px}.evaluation-stat-window button[aria-pressed="true"]::after{content:" selected";font-size:11px}.qb-stat{display:grid;gap:3px}.qb-stat span{color:var(--qb-muted-ink);font-size:12px;font-weight:650;letter-spacing:.04em;text-transform:uppercase}.evaluation-ledger{border-top:1px solid var(--qb-line)}.evaluation-date-group{margin:0}.evaluation-date-heading{margin:0;padding:10px 0 5px;color:var(--qb-muted-ink);font-size:12px;letter-spacing:.06em;text-transform:uppercase}.evaluation-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;padding:10px 0;border-top:1px solid var(--qb-line)}.evaluation-row__summary{display:grid;grid-template-columns:auto minmax(5.5rem,auto) minmax(0,1fr);gap:5px 10px;align-items:baseline}.evaluation-row__meta{grid-column:1/-1;color:var(--qb-muted-ink);font-size:12px}.evaluation-row__timeline{justify-self:end;align-self:center}.evaluation-expanded{grid-column:1/-1;margin-top:4px;padding:10px;background:var(--qb-surface-deep);border:1px solid var(--qb-line)}.evaluation-node{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px}.evaluation-node .qb-timeline-node{min-width:0}.evaluation-counts{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0;font-size:12px}.evaluation-actions{display:flex;flex-wrap:wrap;gap:6px}.evaluation-row__toggle{min-width:auto;padding:2px 6px}@media(max-width:40rem){.evaluation-row{grid-template-columns:1fr}.evaluation-row__timeline{justify-self:start}.evaluation-row__summary{grid-template-columns:auto 1fr}.evaluation-row__summary>a{grid-column:1/-1}}</style>`;

const evaluationDetail = `<section id="evaluation-detail"><a id="evaluation-detail-back" href="/?view=evaluations">Back to evaluations</a><div class="qb-evaluation-detail-meta"><h1 id="evaluation-detail-title">Evaluation</h1><dl><dt>Repository</dt><dd id="evaluation-detail-repository"></dd><dt>Source</dt><dd id="evaluation-detail-source"></dd><dt>Status</dt><dd id="evaluation-detail-status"></dd><dt>Outcome</dt><dd id="evaluation-detail-outcome"></dd><dt>Duration</dt><dd id="evaluation-detail-duration"></dd><dt>Last refreshed</dt><dd id="evaluation-detail-updated"></dd></dl><div hidden id="evaluation-detail-error" role="alert" tabindex="-1"></div><p id="evaluation-detail-loading">Loading evaluation…</p><div><button hidden id="evaluation-detail-cancel" type="button">Cancel</button><button hidden id="evaluation-detail-retry" type="button">Retry</button></div></div><section class="qb-deep-surface qb-evaluation-detail-panel" aria-label="Evaluation detail"><div class="qb-evaluation-detail-grid"><ol id="evaluation-detail-timeline"></ol><section id="evaluation-detail-preview" aria-label="Evaluation summary"><h2>Summary</h2><dl><dt>Review counts</dt><dd id="evaluation-detail-review-counts"></dd><dt>Outcome counts</dt><dd id="evaluation-detail-outcome-counts"></dd><dt>Finding counts</dt><dd id="evaluation-detail-finding-counts"></dd></dl></section></div><section id="evaluation-detail-result" aria-label="Evaluation result"></section></section><style>.qb-evaluation-detail-meta{display:grid;gap:1rem;margin-block:1rem}.qb-evaluation-detail-meta dl,.qb-evaluation-detail-meta dl+div{margin:0}.qb-evaluation-detail-meta dl{display:grid;gap:.3rem 1rem;grid-template-columns:max-content minmax(0,1fr)}.qb-evaluation-detail-meta dt{color:var(--qb-muted-ink)}.qb-evaluation-detail-panel{margin-top:1.5rem;padding:clamp(1rem,3vw,2rem)}.qb-evaluation-detail-grid{display:grid;gap:2rem;grid-template-columns:minmax(14rem,1fr) minmax(18rem,1fr)}#evaluation-detail-timeline{display:grid;gap:.9rem;list-style:none;margin:0;padding:0}.qb-timeline-node{align-items:center;display:grid;gap:.65rem;grid-template-columns:1rem minmax(0,1fr);position:relative}.qb-timeline-node:not(:last-child)::after{background:var(--qb-line);content:"";height:calc(100% + .9rem);left:.45rem;position:absolute;top:.75rem;width:1px}.qb-timeline-node__marker{background:var(--qb-system-marker);height:.9rem;width:.9rem;z-index:1}.qb-timeline-node--review .qb-timeline-node__marker{border-radius:50%;background:var(--qb-review-marker)}.qb-timeline-node__status{color:var(--qb-muted-ink);font-size:.9em}@media(max-width:760px){.qb-evaluation-detail-grid{grid-template-columns:1fr}.qb-evaluation-detail-meta dl{grid-template-columns:1fr}.qb-evaluation-detail-meta dt{margin-top:.5rem}}</style></section>`;

/** @param {"evaluations" | "evaluation-detail"} view */
export function renderEvaluationMonitorPage(view) {
  if (view === "evaluations") {
    return Object.freeze({
      markup: evaluationList,
      scripts: monitorScript + '<script src="/assets/evaluation.js"></script>',
    });
  }
  if (view === "evaluation-detail") {
    return Object.freeze({
      markup: evaluationDetail,
      scripts:
        monitorScript +
        '<script src="/assets/evaluation-result.js"></script>' +
        '<script src="/assets/evaluation-detail.js"></script>',
    });
  }
  throw new TypeError("Evaluation monitor view is invalid");
}
