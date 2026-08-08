(() => {
  "use strict";

  const operator = /** @type {any} */ (
    Reflect.get(window, "qualityBarOperator")
  );
  const monitor = /** @type {any} */ (
    Reflect.get(window, "qualityBarEvaluationMonitor")
  );
  if (
    !operator ||
    typeof operator.requiredElement !== "function" ||
    typeof operator.csrfToken !== "function" ||
    typeof operator.readRepositoryCollection !== "function" ||
    !monitor ||
    typeof monitor.isTerminalStatus !== "function" ||
    typeof monitor.mutate !== "function" ||
    typeof monitor.validCollection !== "function"
  ) {
    throw new Error("evaluation_monitor_boundary_unavailable");
  }

  /** @param {string} id */
  const control = (id) => operator.requiredElement(id);
  const createForm = control("evaluation-create-form");
  const createToggle = control("evaluation-create-toggle");
  const createRepository = control("evaluation-create-repository");
  const createStatus = control("evaluation-create-status");
  const filterForm = control("evaluation-filter-form");
  const filterReset = control("evaluation-filter-reset");
  const loading = control("evaluation-loading");
  const empty = control("evaluation-empty");
  const error = control("evaluation-error");
  const ledger = control("evaluation-list");
  const newActivity = control("evaluation-new-activity");
  const loadMore = control("evaluation-load-more");
  const stat24h = control("evaluation-stat-window-24h");
  const stat7d = control("evaluation-stat-window-7d");
  const statWorkers = control("evaluation-stat-workers");
  const statQueue = control("evaluation-stat-queue");
  const statPassRate = control("evaluation-stat-pass-rate");
  const statP95 = control("evaluation-stat-p95");
  const statUpdated = control("evaluation-stat-updated");

  const FILTER_IDS = Object.freeze({
    effective_outcome: "evaluation-filter-outcome",
    end: "evaluation-filter-end",
    execution_status: "evaluation-filter-status",
    query: "evaluation-filter-query",
    repository_id: "evaluation-filter-repository",
    start: "evaluation-filter-start",
  });
  /** @type {Array<keyof typeof FILTER_IDS>} */
  const FILTER_NAMES = /** @type {Array<keyof typeof FILTER_IDS>} */ (
    Object.keys(FILTER_IDS)
  );
  const known = new Map();
  const evaluations = new Map();
  const expanded = new Set();
  /** @type {string[]} */
  let visibleIds = [];
  /** @type {string | null} */
  let nextCursor = null;
  let firstListResponse = true;
  let statsFailed = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let pollTimer = null;

  /** @param {unknown} value */
  const text = (value) => (typeof value === "string" ? value : "");

  /** @param {string} message */
  function showError(message) {
    error.hidden = false;
    error.textContent = message;
  }

  function clearError() {
    error.hidden = true;
    error.textContent = "";
  }

  function resetListState() {
    known.clear();
    evaluations.clear();
    visibleIds = [];
    expanded.clear();
    nextCursor = null;
    firstListResponse = true;
  }

  /** @param {string} search @param {string} name */
  function searchValue(search, name) {
    return new URLSearchParams(search).get(name);
  }

  /** @param {string | null} value */
  function localDateTime(value) {
    const date = value === null ? null : new Date(Number(value));
    if (!date || !/^\d+$/.test(value ?? "") || Number.isNaN(date.getTime())) {
      return "";
    }
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  /** @param {string} value */
  function epochMilliseconds(value) {
    const parsed = value === "" ? NaN : new Date(value).getTime();
    return Number.isSafeInteger(parsed) && parsed >= 0 ? String(parsed) : null;
  }

  function readFilters() {
    /** @type {Record<string, string>} */
    const result = {};
    for (const name of FILTER_NAMES) {
      const value = control(FILTER_IDS[name]).value;
      if (typeof value !== "string" || value === "") {
        continue;
      }
      const normalized =
        name === "start" || name === "end" ? epochMilliseconds(value) : value;
      if (normalized !== null) {
        result[name] = normalized;
      }
    }
    return result;
  }

  function setFiltersFromLocation() {
    const search = window.location?.search ?? "";
    for (const name of FILTER_NAMES) {
      const element = control(FILTER_IDS[name]);
      const value = searchValue(search, name);
      element.value =
        name === "start" || name === "end"
          ? localDateTime(value)
          : (value ?? "");
    }
  }

  /** @param {Array<[string, string]>} entries */
  function queryString(entries) {
    return entries
      .map(([name, value]) => name + "=" + encodeURIComponent(value))
      .join("&");
  }

  /** @param {Record<string, string>} filters @param {Array<[string, string]>} entries */
  function appendFilterEntries(filters, entries) {
    for (const name of FILTER_NAMES) {
      if (filters[name]) {
        entries.push([name, filters[name]]);
      }
    }
    return entries;
  }

  /** @param {Record<string, string>} filters */
  function replaceFilterUrl(filters) {
    /** @type {Array<[string, string]>} */
    const entries = appendFilterEntries(filters, [["view", "evaluations"]]);
    if (window.history?.replaceState) {
      window.history.replaceState(null, "", "/?" + queryString(entries));
    }
  }

  /** @param {Record<string, string>} filters @param {string | null} cursor */
  function listUrl(filters, cursor) {
    /** @type {Array<[string, string]>} */
    const entries = appendFilterEntries(filters, [["limit", "50"]]);
    if (cursor !== null) {
      entries.push(["cursor", cursor]);
    }
    return "/api/v1/evaluations?" + queryString(entries);
  }

  /** @param {any} evaluation */
  function timestamp(evaluation) {
    const value = new Date(text(evaluation?.created_at)).getTime();
    return Number.isNaN(value) ? 0 : value;
  }

  /** @param {any} left @param {any} right */
  function newestFirst(left, right) {
    return (
      timestamp(right) - timestamp(left) ||
      text(right.id).localeCompare(text(left.id))
    );
  }

  /** @param {any} evaluation */
  function monitorSignature(evaluation) {
    const nodes = Array.isArray(evaluation?.monitor?.nodes)
      ? evaluation.monitor.nodes.map((/** @type {any} */ node) => [
          node.kind,
          node.status,
        ])
      : [];
    return JSON.stringify([
      evaluation?.execution_status,
      evaluation?.effective_outcome,
      nodes,
    ]);
  }

  /** @param {any} evaluation */
  function formatDuration(evaluation) {
    const duration = evaluation?.monitor?.duration_ms;
    if (Number.isSafeInteger(duration) && duration >= 0) {
      return formatMilliseconds(duration);
    }
    if (!monitor.isTerminalStatus(evaluation?.execution_status)) {
      const started = timestamp(evaluation);
      if (started > 0) {
        return formatMilliseconds(Math.max(0, Date.now() - started));
      }
    }
    return "—";
  }

  /** @param {number} milliseconds */
  function formatMilliseconds(milliseconds) {
    if (milliseconds < 1_000) {
      return milliseconds + " ms";
    }
    const seconds = Math.floor(milliseconds / 1_000);
    if (seconds < 60) {
      return seconds + "s";
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return minutes + "m " + (seconds % 60) + "s";
    }
    return Math.floor(minutes / 60) + "h " + (minutes % 60) + "m";
  }

  /** @param {number} millis */
  function localTime(millis) {
    return new Intl.DateTimeFormat(undefined, {
      hour12: false,
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(millis));
  }

  /** @param {number} millis */
  function localDay(millis) {
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(millis));
  }

  /** @param {number} millis */
  const dateKey = (millis) => new Date(millis).toLocaleDateString();

  /** @param {number} millis */
  function dayLabel(millis) {
    const date = new Date(millis);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return "Today";
    }
    today.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) {
      return "Yesterday";
    }
    return localDay(millis);
  }

  /** @param {string} tag @param {string} className @param {string} value @param {Node[]} [children] */
  function element(tag, className, value, children = []) {
    const valueElement = document.createElement(tag);
    if (className) {
      valueElement.className = className;
    }
    valueElement.textContent = value;
    children.forEach((child) => valueElement.append(child));
    return valueElement;
  }

  /** @param {string} id */
  const evaluationUrl = (id) =>
    "/?view=evaluation-detail&evaluation_id=" + encodeURIComponent(id);

  /** @param {string} value */
  function shortSelector(value) {
    return /^[0-9a-f]{12,}$/.test(value) ? value.slice(0, 7) : value;
  }

  /** @param {any} evaluation */
  function repositoryLabel(evaluation) {
    const id = text(evaluation?.repository?.id);
    if (id && !/^repository-[a-z0-9-]+$/i.test(id)) {
      return id;
    }
    try {
      const path = new URL(text(evaluation?.repository?.url)).pathname;
      const last = path.split("/").filter(Boolean).at(-1) ?? "";
      return last.replace(/\.git$/i, "") || id || "Repository";
    } catch {
      return id || "Repository";
    }
  }

  const NODE_STATUS = /** @type {Record<string, string[]>} */ ({
    cancelled: ["skipped", "Skipped"],
    completed: ["complete", "OK"],
    failed: ["failed", "Failed"],
    queued: ["pending", "Queued"],
    running: ["pending", "Running"],
  });
  const EXECUTION_STATUS = /** @type {Record<string, string[]>} */ ({
    cancelled: ["Skipped", "skipped"],
    failed: ["Failed", "failed"],
    queued: ["Queued", "pending"],
    running: ["Running", "active"],
  });

  /** @param {string} value */
  function nodeStatus(value) {
    return NODE_STATUS[value] ?? ["pending", "Unknown"];
  }

  /** @param {any} evaluation */
  function evaluationStatus(evaluation) {
    const execution = EXECUTION_STATUS[evaluation?.execution_status];
    if (execution) {
      return { label: execution[0], tone: execution[1] };
    }
    const outcome = evaluation?.effective_outcome;
    const result = /** @type {Record<string, string[]>} */ ({
      clear: ["Passed", "passed"],
      pending: ["Pending", "pending"],
    })[outcome] ?? [
      text(outcome).replace(/^./, (value) => value.toUpperCase()) ||
        "Completed",
      "failed",
    ];
    return { label: result[0], tone: result[1] };
  }

  /** @param {any[]} nodes @param {boolean} withStatus */
  function timeline(nodes, withStatus) {
    const value = document.createElement("div");
    value.className = "qb-timeline";
    value.setAttribute(
      "aria-label",
      withStatus ? "Evaluation steps" : "Step progress",
    );
    for (const [index, node] of nodes.entries()) {
      if (index > 0) {
        value.append(element("span", "qb-timeline-connector", ""));
      }
      const kind = node?.kind === "system" ? "system" : "review";
      const label =
        text(node?.label) || (kind === "system" ? "System" : "Review");
      const status = text(node?.status) || "unknown";
      const statusState = nodeStatus(status);
      const nodeElement = element(
        "span",
        "qb-timeline-node qb-timeline-node--" +
          kind +
          " qb-timeline-node--" +
          statusState[0],
        withStatus ? label + " " + statusState[1] : "",
      );
      nodeElement.setAttribute("aria-label", label + ": " + statusState[1]);
      nodeElement.title = label + ": " + statusState[1];
      value.append(nodeElement);
    }
    return value;
  }

  /** @param {HTMLElement} row @param {any} evaluation */
  function appendActions(row, evaluation) {
    const actions = document.createElement("div");
    actions.className = "evaluation-actions";
    let hasAction = false;
    if (["queued", "running"].includes(evaluation.execution_status)) {
      actions.append(mutationButton("Cancel", evaluation, "cancel"));
      hasAction = true;
    }
    if (
      evaluation.execution_status === "queued" &&
      evaluation.retry_state === "exhausted"
    ) {
      actions.append(mutationButton("Retry", evaluation, "retry"));
      hasAction = true;
    }
    if (hasAction) {
      row.append(actions);
    }
  }

  /** @param {string} label @param {any} evaluation @param {"cancel" | "retry"} action */
  function mutationButton(label, evaluation, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", async () => {
      let response;
      try {
        response = await monitor.mutate({
          action,
          csrfToken: operator.csrfToken(),
          evaluationId: evaluation.id,
        });
      } catch {
        showError("Evaluation action failed");
        await refreshList({ replace: true });
        return;
      }
      if (!response.ok) {
        await operator.displayMutationFailure(response);
        showError("Evaluation action failed");
        await refreshList({ replace: true });
        return;
      }
      await refreshList({ replace: true });
    });
    return button;
  }

  /** @param {number} index @param {any} node */
  function expandedStep(index, node) {
    const kind = node?.kind === "system" ? "system" : "review";
    const status = text(node?.status) || "unknown";
    const label =
      text(node?.label) || (kind === "system" ? "System" : "Review");
    const finished = text(node?.completed_at || node?.finished_at);
    const statusState = nodeStatus(status);
    return element("div", "evaluation-expanded__row evaluation-node", "", [
      element("div", "evaluation-step", "", [
        element("span", "evaluation-step__number", String(index + 1)),
        element(
          "span",
          "evaluation-step__marker evaluation-step__marker--" + kind,
          "",
        ),
        element("span", "evaluation-step__label", label),
      ]),
      element(
        "span",
        "evaluation-node-status evaluation-node-status--" + statusState[0],
        "",
        [
          element("span", "evaluation-node-status__icon", ""),
          element("span", "", statusState[1]),
        ],
      ),
      element(
        "span",
        "",
        Number.isSafeInteger(node?.duration_ms)
          ? formatMilliseconds(node.duration_ms)
          : "—",
      ),
      element(
        "time",
        "",
        finished && !Number.isNaN(new Date(finished).getTime())
          ? localTime(new Date(finished).getTime())
          : "—",
      ),
    ]);
  }

  /** @param {string} label @param {Record<string, unknown>} values */
  function countLine(label, values) {
    const counts = Object.entries(values)
      .map(([key, value]) => " " + key + " " + value)
      .join(",");
    return element("div", "evaluation-counts", label + counts);
  }

  /** @param {any} evaluation */
  function row(evaluation) {
    const article = document.createElement("article");
    article.className = "evaluation-row";
    article.setAttribute("data-evaluation-id", evaluation.id);
    const expandedId = "evaluation-expanded-" + evaluation.id;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "evaluation-row__toggle";
    toggle.setAttribute("aria-controls", expandedId);
    toggle.setAttribute("aria-expanded", String(expanded.has(evaluation.id)));
    toggle.setAttribute(
      "aria-label",
      (expanded.has(evaluation.id) ? "Collapse" : "Expand") +
        " evaluation " +
        evaluation.id,
    );
    toggle.append(element("span", "evaluation-row__chevron", ""));

    const summary = document.createElement("div");
    summary.className = "evaluation-row__summary";
    const created = timestamp(evaluation);
    summary.append(
      toggle,
      element(
        "time",
        "evaluation-row__time",
        created ? localTime(created) : "—",
      ),
    );
    const link = document.createElement("a");
    link.href = evaluationUrl(evaluation.id);
    link.className = "evaluation-row__repository";
    link.textContent = repositoryLabel(evaluation);
    const sourceKind =
      evaluation?.provenance === "automatic" &&
      Number.isSafeInteger(evaluation?.pull_request?.number)
        ? "PR #" + evaluation.pull_request.number
        : shortSelector(text(evaluation?.base_selector?.value));
    const sourceValue = shortSelector(text(evaluation?.head_selector?.value));
    const sourceElement = element("span", "evaluation-row__source", "", [
      element("span", "evaluation-row__source-kind", sourceKind || "—"),
      element("span", "evaluation-row__source-value", sourceValue || "—"),
    ]);
    const status = evaluationStatus(evaluation);
    const statusElement = element(
      "span",
      "evaluation-row__outcome evaluation-status--" + status.tone,
      "",
      [
        element("span", "evaluation-status__icon", ""),
        element("span", "evaluation-status__label", status.label),
      ],
    );
    summary.append(
      link,
      sourceElement,
      statusElement,
      element("span", "evaluation-row__duration", formatDuration(evaluation)),
    );
    /** @type {any[]} */
    const nodes = Array.isArray(evaluation.monitor?.nodes)
      ? evaluation.monitor.nodes
      : [];
    const compactTimeline = timeline(nodes, false);
    compactTimeline.className += " evaluation-row__timeline";
    const detailLink = document.createElement("a");
    detailLink.className = "evaluation-row__detail";
    detailLink.href = evaluationUrl(evaluation.id);
    detailLink.setAttribute("aria-label", "Open evaluation " + evaluation.id);
    detailLink.textContent = "›";
    article.append(summary, compactTimeline, detailLink);
    appendActions(article, evaluation);

    const expand = () => {
      const isExpanded = !expanded.has(evaluation.id);
      if (isExpanded) {
        expanded.add(evaluation.id);
      } else {
        expanded.delete(evaluation.id);
      }
      renderLedger();
    };
    toggle.addEventListener("click", expand);
    if (expanded.has(evaluation.id)) {
      const preview = document.createElement("section");
      preview.id = expandedId;
      preview.className = "evaluation-expanded";
      const table = document.createElement("div");
      table.className = "evaluation-expanded__table";
      table.append(
        element(
          "div",
          "evaluation-expanded__row evaluation-expanded__row--header",
          "",
          ["Step", "Status", "Duration", "Finished"].map((label) =>
            element("span", "", label),
          ),
        ),
      );
      nodes.forEach((node, index) => table.append(expandedStep(index, node)));
      preview.append(table);
      for (const [label, counts] of [
        ["Outcomes:", evaluation.monitor?.outcome_counts],
        ["Findings:", evaluation.monitor?.finding_counts],
      ]) {
        if (counts !== null && typeof counts === "object") {
          preview.append(countLine(label, counts));
        }
      }
      article.append(preview);
    }
    return article;
  }

  function renderLedger() {
    const scrollY = window.scrollY;
    ledger.replaceChildren();
    const grouped = new Map();
    for (const id of visibleIds) {
      const evaluation = evaluations.get(id);
      if (!evaluation) {
        continue;
      }
      const key = dateKey(timestamp(evaluation));
      const group = grouped.get(key) ?? [];
      group.push(evaluation);
      grouped.set(key, group);
    }
    const groups = [...grouped.values()].sort((left, right) =>
      newestFirst(left[0], right[0]),
    );
    for (const group of groups) {
      group.sort(newestFirst);
      const section = document.createElement("section");
      section.className = "evaluation-date-group";
      const groupTimestamp = timestamp(group[0]);
      const relativeDate = dayLabel(groupTimestamp);
      const dateHeading = element(
        "h2",
        "evaluation-date-heading",
        relativeDate,
      );
      if (relativeDate === "Today" || relativeDate === "Yesterday") {
        dateHeading.append(
          element(
            "span",
            "evaluation-date-heading__date",
            localDay(groupTimestamp),
          ),
        );
      }
      section.append(dateHeading);
      section.append(...group.map(row));
      ledger.append(section);
    }
    empty.hidden = visibleIds.length !== 0;
    if (typeof window.scrollTo === "function" && typeof scrollY === "number") {
      window.scrollTo(0, scrollY);
    }
  }

  /** @param {{items: any[], next_cursor: string | null}} collection @param {boolean} replace */
  function acceptCollection(collection, replace) {
    const items = collection.items.slice().sort(newestFirst);
    for (const evaluation of items) {
      known.set(evaluation.id, evaluation);
      evaluations.set(evaluation.id, evaluation);
    }
    if (replace) {
      visibleIds = items.map((evaluation) => evaluation.id);
    } else {
      const existing = new Set(visibleIds);
      visibleIds.push(
        ...items
          .filter((evaluation) => !existing.has(evaluation.id))
          .map((evaluation) => evaluation.id),
      );
    }
    nextCursor = collection.next_cursor;
    loadMore.hidden = nextCursor === null;
    loadMore.disabled = false;
    renderLedger();
  }

  /** @param {{replace?: boolean, poll?: boolean, cursor?: string | null}} [options] */
  async function refreshList(options = {}) {
    const replace = options.replace === true;
    const poll = options.poll === true;
    const cursor = options.cursor ?? null;
    const firstPage = cursor === null;
    const filters = readFilters();
    if (firstPage && !poll) {
      loading.hidden = false;
    }
    loadMore.disabled = true;
    let response;
    try {
      response = await fetch(listUrl(filters, cursor));
    } catch {
      loading.hidden = true;
      loadMore.disabled = false;
      showError("Evaluations failed to load");
      return;
    }
    loading.hidden = true;
    if (!response.ok) {
      loadMore.disabled = false;
      try {
        const failure = await response.json();
        showError(
          text(failure?.error?.message) || "Evaluations failed to load",
        );
      } catch {
        showError("Evaluations failed to load");
      }
      return;
    }
    const collection = await response.json();
    if (!monitor.validCollection(collection)) {
      showError("Evaluations returned an invalid response");
      return;
    }
    if (!statsFailed) {
      clearError();
    }
    if (poll && firstPage) {
      let changed = false;
      for (const evaluation of collection.items) {
        const previous = known.get(evaluation.id);
        if (
          !previous ||
          monitorSignature(previous) !== monitorSignature(evaluation)
        ) {
          changed = true;
        }
        known.set(evaluation.id, evaluation);
      }
      if (!firstListResponse && changed) {
        newActivity.hidden = false;
      }
      loadMore.disabled = false;
      firstListResponse = false;
      return;
    }
    acceptCollection(collection, replace || firstPage);
    firstListResponse = false;
  }

  async function revealActivity() {
    newActivity.disabled = true;
    await refreshList({ replace: true });
    newActivity.hidden = true;
    newActivity.disabled = false;
  }

  /** @param {number} hours */
  async function refreshStats(hours) {
    const now = Date.now();
    const [systemResult, analyticsResult] = await Promise.allSettled([
      fetch("/api/v1/system"),
      fetch(
        "/api/v1/analytics?" +
          queryString([
            ["start", String(now - hours * 3_600_000)],
            ["end", String(now)],
          ]),
      ),
    ]);
    let failed = false;
    if (systemResult.status === "fulfilled" && systemResult.value.ok) {
      try {
        const system = await systemResult.value.json();
        const concurrency = system?.codex_execution?.concurrency;
        const queue = system?.codex_execution?.queue;
        if (
          Number.isSafeInteger(concurrency?.running_count) &&
          Number.isSafeInteger(concurrency?.maximum_running) &&
          Number.isSafeInteger(queue?.count)
        ) {
          statWorkers.textContent =
            concurrency.running_count + " / " + concurrency.maximum_running;
          statQueue.textContent = String(queue.count);
        } else {
          failed = true;
        }
      } catch {
        failed = true;
      }
    } else {
      failed = true;
    }
    if (analyticsResult.status === "fulfilled" && analyticsResult.value.ok) {
      try {
        const analytics = await analyticsResult.value.json();
        const overview = analytics?.evaluation_overview;
        const numerator = overview?.pass_rate?.numerator;
        const denominator = overview?.pass_rate?.denominator;
        if (
          Number.isSafeInteger(numerator) &&
          Number.isSafeInteger(denominator)
        ) {
          statPassRate.textContent =
            denominator === 0
              ? "No data"
              : ((numerator / denominator) * 100).toFixed(1) + "%";
        } else {
          failed = true;
        }
        statP95.textContent = Number.isSafeInteger(overview?.p95_duration_ms)
          ? formatMilliseconds(overview.p95_duration_ms)
          : "No data";
      } catch {
        failed = true;
      }
    } else {
      failed = true;
    }
    if (failed) {
      statsFailed = true;
      showError("Evaluation statistics failed to load");
    } else {
      statsFailed = false;
      statUpdated.textContent = "Just now";
    }
  }

  async function loadRepositories() {
    const collection = await operator.readRepositoryCollection();
    if (collection.failure) {
      try {
        showError(
          text((await collection.failure.json())?.error?.message) ||
            "Repositories failed to load",
        );
      } catch {
        showError("Repositories failed to load");
      }
      return;
    }
    const repositoryFilter = searchValue(
      window.location?.search ?? "",
      "repository_id",
    );
    for (const repository of collection.items) {
      if (
        typeof repository?.id !== "string" ||
        typeof repository?.url !== "string"
      ) {
        continue;
      }
      for (const select of [
        createRepository,
        control("evaluation-filter-repository"),
      ]) {
        const option = document.createElement("option");
        option.value = repository.id;
        option.textContent = repository.url;
        select.append(option);
      }
    }
    if (repositoryFilter !== null) {
      control("evaluation-filter-repository").value = repositoryFilter;
    }
    createRepository.disabled = collection.items.length === 0;
  }

  /** @param {string} type @param {string} value */
  function validSelector(type, value) {
    return type === "branch"
      ? value.trim().length > 0
      : /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
  }

  createToggle.addEventListener("click", () => {
    createForm.hidden = !createForm.hidden;
    createToggle.setAttribute("aria-expanded", String(!createForm.hidden));
    if (!createForm.hidden && typeof createRepository.focus === "function") {
      createRepository.focus();
    }
  });
  createForm.addEventListener(
    "submit",
    async (/** @type {SubmitEvent} */ event) => {
      event.preventDefault();
      createStatus.textContent = "";
      const baseType = control("evaluation-create-base-type").value;
      const baseValue = control("evaluation-create-base-value").value;
      const headType = control("evaluation-create-head-type").value;
      const headValue = control("evaluation-create-head-value").value;
      if (
        !validSelector(baseType, baseValue) ||
        !validSelector(headType, headValue)
      ) {
        createStatus.textContent =
          "Branch values must be non-empty. Commit values must be 40 or 64 lowercase hexadecimal characters.";
        return;
      }
      let response;
      try {
        response = await fetch(
          "/api/v1/repositories/" +
            encodeURIComponent(createRepository.value) +
            "/evaluations",
          {
            body: JSON.stringify({
              base: { type: baseType, value: baseValue },
              head: { type: headType, value: headValue },
            }),
            headers: {
              "content-type": "application/json",
              "idempotency-key": crypto.randomUUID(),
              "x-quality-bar-csrf": operator.csrfToken(),
            },
            method: "POST",
          },
        );
      } catch {
        createStatus.textContent = "Evaluation request failed";
        showError("Evaluation request failed");
        await refreshList({ replace: true });
        return;
      }
      if (!response.ok) {
        await operator.displayMutationFailure(response);
        createStatus.textContent = "Evaluation request failed";
        await refreshList({ replace: true });
        return;
      }
      const evaluation = await response.json();
      createStatus.textContent =
        "Evaluation " + text(evaluation?.id) + " requested.";
      await refreshList({ replace: true });
    },
  );
  filterForm.addEventListener(
    "submit",
    async (/** @type {SubmitEvent} */ event) => {
      event.preventDefault();
      replaceFilterUrl(readFilters());
      resetListState();
      await refreshList({ replace: true });
    },
  );
  filterReset.addEventListener("click", async () => {
    for (const name of FILTER_NAMES) {
      control(FILTER_IDS[name]).value = "";
    }
    replaceFilterUrl({});
    resetListState();
    await refreshList({ replace: true });
  });
  loadMore.addEventListener("click", async () => {
    if (nextCursor !== null) {
      await refreshList({ cursor: nextCursor });
    }
  });
  newActivity.addEventListener("click", revealActivity);
  stat24h.addEventListener("click", async () => {
    stat24h.setAttribute("aria-pressed", "true");
    stat7d.setAttribute("aria-pressed", "false");
    await refreshStats(24);
  });
  stat7d.addEventListener("click", async () => {
    stat24h.setAttribute("aria-pressed", "false");
    stat7d.setAttribute("aria-pressed", "true");
    await refreshStats(24 * 7);
  });
  if (typeof window.addEventListener === "function") {
    window.addEventListener("popstate", async () => {
      setFiltersFromLocation();
      resetListState();
      await refreshList({ replace: true });
    });
  }
  if (typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", async () => {
      if (document.hidden) {
        if (pollTimer !== null) {
          clearInterval(pollTimer);
        }
        pollTimer = null;
        return;
      }
      await refreshList({ poll: true });
      if (pollTimer === null && typeof setInterval === "function") {
        pollTimer = setInterval(() => refreshList({ poll: true }), 5_000);
      }
    });
  }

  setFiltersFromLocation();
  newActivity.hidden = true;
  loadMore.hidden = true;
  Promise.all([loadRepositories(), refreshStats(24)]).then(() =>
    refreshList({ replace: true }),
  );
  if (!document.hidden && typeof setInterval === "function") {
    pollTimer = setInterval(() => refreshList({ poll: true }), 5_000);
  }
})();
