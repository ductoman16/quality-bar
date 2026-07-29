const operator = /** @type {any} */ (Reflect.get(window, "qualityBarOperator"));
if (
  !operator ||
  typeof operator.requiredElement !== "function" ||
  typeof operator.csrfToken !== "function" ||
  typeof operator.readRepositoryCollection !== "function"
) {
  throw new Error("evaluation_operator_boundary_unavailable");
}

const form = operator.requiredElement("evaluation-create-form");
const repositoryControl = operator.requiredElement("evaluation-repository");
const loading = operator.requiredElement("evaluation-loading");
const empty = operator.requiredElement("evaluation-empty");
const state = operator.requiredElement("evaluation-state");
const active = operator.requiredElement("evaluation-active");
const recent = operator.requiredElement("evaluation-recent");
const attention = operator.requiredElement("evaluation-attention");
const more = operator.requiredElement("evaluation-more");
const creationStatus = operator.requiredElement("evaluation-create-status");
/** @type {string | null} */
let nextCursor = null;
const focusSearch =
  typeof window.location?.search === "string" ? window.location.search : "";

/** @param {string} name */
function focusValue(name) {
  const match = new RegExp("(?:^|[?&])" + name + "=([^&]*)").exec(focusSearch);
  return match ? decodeURIComponent(match[1]) : null;
}

/** @param {string} id */
function controlValue(id) {
  const control = operator.requiredElement(id);
  if (!("value" in control) || typeof control.value !== "string") {
    throw new Error("evaluation_control_unavailable");
  }
  return control.value;
}

/** @param {any} location */
function locationText(location) {
  if (location.kind === "changeset") {
    return "Changeset";
  }
  const side = location.side + " " + location.path;
  return location.kind === "line_range"
    ? side + ":" + location.start_line + "-" + location.end_line
    : side;
}

/** @param {string} evaluationId @param {any} finding */
function findingLocation(evaluationId, finding) {
  const location = finding.location;
  const text = locationText(location);
  if (location.kind === "changeset") {
    const value = document.createElement("span");
    value.textContent = text;
    return value;
  }
  const link = document.createElement("a");
  const lineQuery =
    location.kind === "line_range"
      ? "&start_line=" +
        encodeURIComponent(location.start_line) +
        "&end_line=" +
        encodeURIComponent(location.end_line)
      : "";
  link.href =
    "/?view=evaluations&evaluation_id=" +
    encodeURIComponent(evaluationId) +
    "&file_change_id=" +
    encodeURIComponent(location.file_change_id) +
    "&side=" +
    encodeURIComponent(location.side) +
    lineQuery;
  link.textContent = text;
  return link;
}

/** @param {any} target @param {any} evaluation @param {any} result */
function renderResult(target, evaluation, result) {
  if (
    !result ||
    typeof result.outcome !== "string" ||
    !Array.isArray(result.criterion_results) ||
    !Array.isArray(result.findings) ||
    !Array.isArray(result.review_runs)
  ) {
    throw new Error("evaluation_result_invalid");
  }
  target.textContent = "Result " + result.outcome;
  for (const criterion of result.criterion_results) {
    const run = result.review_runs.find(
      /** @param {any} candidate */
      (candidate) => candidate.id === criterion.review_run_id,
    );
    if (
      typeof criterion.criterion_id !== "string" ||
      typeof criterion.outcome !== "string" ||
      typeof run?.review_id !== "string" ||
      typeof run.review_version_id !== "string"
    ) {
      throw new Error("evaluation_result_invalid");
    }
    const criterionDetails = document.createElement("details");
    const criterionSummary = document.createElement("summary");
    criterionSummary.textContent =
      "Criterion " +
      criterion.criterion_id +
      " — " +
      criterion.outcome +
      " — Review " +
      run.review_id +
      " " +
      run.review_version_id;
    criterionDetails.append(criterionSummary);
    for (const finding of result.findings.filter(
      /** @param {any} candidate */
      (candidate) =>
        candidate.review_run_id === criterion.review_run_id &&
        candidate.criterion_id === criterion.criterion_id,
    )) {
      if (
        typeof finding.id !== "string" ||
        typeof finding.impact !== "string" ||
        typeof finding.evidence !== "string" ||
        typeof finding.remediation !== "string" ||
        typeof finding.location?.kind !== "string"
      ) {
        throw new Error("evaluation_result_invalid");
      }
      const findingDetails = document.createElement("details");
      const findingSummary = document.createElement("summary");
      findingSummary.textContent =
        "Finding " + finding.id + " — " + finding.impact;
      findingDetails.append(findingSummary);
      for (const [label, value] of [
        ["Evidence", finding.evidence],
        ["Remediation", finding.remediation],
      ]) {
        const fact = document.createElement("p");
        fact.textContent = label + ": " + value;
        findingDetails.append(fact);
      }
      findingDetails.append(findingLocation(evaluation.id, finding));
      const location = finding.location;
      if (
        focusValue("evaluation_id") === evaluation.id &&
        focusValue("file_change_id") === location.file_change_id &&
        focusValue("side") === location.side &&
        (location.kind !== "line_range" ||
          (focusValue("start_line") === String(location.start_line) &&
            focusValue("end_line") === String(location.end_line)))
      ) {
        criterionDetails.open = true;
        findingDetails.open = true;
      }
      criterionDetails.append(findingDetails);
    }
    target.append(criterionDetails);
  }
}

/** @param {any} evaluation */
async function renderEvaluation(evaluation) {
  if (
    !evaluation ||
    typeof evaluation.id !== "string" ||
    typeof evaluation.repository?.url !== "string" ||
    typeof evaluation.base_selector?.type !== "string" ||
    typeof evaluation.base_selector.value !== "string" ||
    typeof evaluation.head_selector?.type !== "string" ||
    typeof evaluation.head_selector.value !== "string" ||
    typeof evaluation.base_commit !== "string" ||
    typeof evaluation.head_commit !== "string" ||
    typeof evaluation.execution_status !== "string" ||
    typeof evaluation.effective_outcome !== "string" ||
    !(
      evaluation.next_attempt_at === undefined ||
      evaluation.next_attempt_at === null ||
      typeof evaluation.next_attempt_at === "string"
    )
  ) {
    throw new Error("evaluation_collection_invalid");
  }
  const summary =
    evaluation.repository.url +
    " — explicit " +
    evaluation.base_selector.type +
    " " +
    evaluation.base_selector.value +
    " (" +
    evaluation.base_commit +
    ") → " +
    evaluation.head_selector.type +
    " " +
    evaluation.head_selector.value +
    " (" +
    evaluation.head_commit +
    ") — " +
    (evaluation.execution_status === "queued" && evaluation.next_attempt_at
      ? "delayed until " + evaluation.next_attempt_at
      : evaluation.execution_status) +
    " — " +
    evaluation.effective_outcome;
  const target = ["queued", "running"].includes(evaluation.execution_status)
    ? active
    : evaluation.execution_status === "completed" &&
        !["advisory", "blocking", "error"].includes(
          evaluation.effective_outcome,
        )
      ? recent
      : attention;
  const row = document.createElement("li");
  row.textContent = summary;
  const resultState = document.createElement("div");
  row.append(resultState);
  target.append(row);
  if (evaluation.execution_status !== "completed") {
    if (["queued", "running"].includes(evaluation.execution_status)) {
      resultState.textContent = "Result not ready";
    }
    return;
  }
  let resultResponse;
  try {
    resultResponse = await fetch(
      "/api/v1/evaluations/" + encodeURIComponent(evaluation.id) + "/result",
    );
  } catch {
    resultState.textContent = "Result failed to load";
    return;
  }
  if (resultResponse.status === 409) {
    resultState.textContent = "Result not ready";
    return;
  }
  if (!resultResponse.ok) {
    try {
      const failure = await resultResponse.json();
      resultState.textContent = failure.error.message;
    } catch {
      resultState.textContent = "Result failed to load";
    }
    return;
  }
  try {
    const result = await resultResponse.json();
    renderResult(resultState, evaluation, result);
  } catch {
    resultState.textContent = "Result failed to load";
  }
}

/** @param {string | undefined} cursor */
async function loadEvaluations(cursor = undefined) {
  const initial = cursor === undefined;
  if (initial) {
    loading.hidden = false;
    empty.hidden = true;
    state.hidden = true;
    more.hidden = true;
    active.replaceChildren();
    recent.replaceChildren();
    attention.replaceChildren();
  }
  more.disabled = true;
  let response;
  try {
    response = await fetch(
      "/api/v1/evaluations" +
        (cursor === undefined ? "" : "?cursor=" + encodeURIComponent(cursor)),
    );
  } catch {
    loading.hidden = true;
    state.hidden = false;
    state.textContent = "Evaluations failed to load";
    return;
  }
  loading.hidden = true;
  if (!response.ok) {
    const failure = await response.json();
    state.hidden = false;
    state.textContent =
      response.status === 503
        ? "Evaluations unavailable: " + failure.error.message
        : failure.error.message;
    return;
  }
  const collection = await response.json();
  if (
    !Array.isArray(collection.items) ||
    !(
      collection.next_cursor === null ||
      (typeof collection.next_cursor === "string" &&
        collection.next_cursor.length > 0)
    )
  ) {
    throw new Error("evaluation_collection_invalid");
  }
  empty.hidden = !initial || collection.items.length !== 0;
  await Promise.all(collection.items.map(renderEvaluation));
  nextCursor = collection.next_cursor;
  more.hidden = nextCursor === null;
  more.disabled = false;
}

more.addEventListener("click", async () => {
  if (nextCursor === null) {
    throw new Error("evaluation_cursor_unavailable");
  }
  await loadEvaluations(nextCursor);
});

async function loadRepositories() {
  const collection = await operator.readRepositoryCollection();
  if (collection.failure) {
    state.hidden = false;
    state.textContent = (await collection.failure.json()).error.message;
    return;
  }
  repositoryControl.replaceChildren();
  for (const repository of collection.items) {
    if (
      typeof repository?.id !== "string" ||
      typeof repository.url !== "string"
    ) {
      throw new Error("evaluation_repository_collection_invalid");
    }
    const option = document.createElement("option");
    option.value = repository.id;
    option.textContent = repository.url;
    repositoryControl.append(option);
  }
  repositoryControl.disabled = collection.items.length === 0;
}

form.addEventListener("submit", async (/** @type {SubmitEvent} */ event) => {
  event.preventDefault();
  creationStatus.textContent = "";
  const repositoryId = controlValue("evaluation-repository");
  const response = await fetch(
    "/api/v1/repositories/" + encodeURIComponent(repositoryId) + "/evaluations",
    {
      body: JSON.stringify({
        base: {
          type: controlValue("evaluation-base-type"),
          value: controlValue("evaluation-base-value"),
        },
        head: {
          type: controlValue("evaluation-head-type"),
          value: controlValue("evaluation-head-value"),
        },
      }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
        "x-quality-bar-csrf": operator.csrfToken(),
      },
      method: "POST",
    },
  );
  if (!response.ok) {
    await operator.displayMutationFailure(response);
    return;
  }
  const evaluation = await response.json();
  creationStatus.textContent = "Evaluation " + evaluation.id + " completed.";
  await loadEvaluations();
});

Promise.all([loadRepositories(), loadEvaluations()]);
