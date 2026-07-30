const operator = /** @type {any} */ (Reflect.get(window, "qualityBarOperator"));
const resultRenderer = /** @type {any} */ (
  Reflect.get(window, "qualityBarEvaluationResult")
);
const feedbackRenderer = /** @type {any} */ (
  Reflect.get(window, "qualityBarEvaluationFeedback")
);
if (
  !operator ||
  typeof operator.requiredElement !== "function" ||
  typeof operator.csrfToken !== "function" ||
  typeof operator.readRepositoryCollection !== "function"
) {
  throw new Error("evaluation_operator_boundary_unavailable");
}
if (!resultRenderer || typeof resultRenderer.render !== "function") {
  throw new Error("evaluation_result_boundary_unavailable");
}
if (
  !feedbackRenderer ||
  typeof feedbackRenderer.valid !== "function" ||
  typeof feedbackRenderer.hasUnavailable !== "function" ||
  typeof feedbackRenderer.render !== "function"
) {
  throw new Error("evaluation_feedback_boundary_unavailable");
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
const renderedEvaluationIds = new Set();
const focusSearch =
  typeof window.location?.search === "string" ? window.location.search : "";

/** @param {string} name */
function focusValue(name) {
  const match = new RegExp("(?:^|[?&])" + name + "=([^&]*)").exec(focusSearch);
  return match ? decodeURIComponent(match[1]) : null;
}

/** @param {unknown} value */
const nullableString = (value) => value === null || typeof value === "string";

/** @param {string} id */
function controlValue(id) {
  const control = operator.requiredElement(id);
  if (!("value" in control) || typeof control.value !== "string") {
    throw new Error("evaluation_control_unavailable");
  }
  return control.value;
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
    !feedbackRenderer.validCommitStatus(
      evaluation.commit_status,
      evaluation.head_commit,
    ) ||
    !feedbackRenderer.valid(evaluation.feedback) ||
    !["automatic", "explicit"].includes(evaluation.provenance) ||
    !(
      (evaluation.provenance === "explicit" &&
        evaluation.pull_request === undefined) ||
      (evaluation.provenance === "automatic" &&
        Number.isSafeInteger(evaluation.pull_request?.number) &&
        evaluation.pull_request.number > 0)
    ) ||
    typeof evaluation.execution_status !== "string" ||
    typeof evaluation.effective_outcome !== "string" ||
    !nullableString(evaluation.next_attempt_at ?? null)
  ) {
    throw new Error("evaluation_collection_invalid");
  }
  if (renderedEvaluationIds.has(evaluation.id)) {
    return;
  }
  renderedEvaluationIds.add(evaluation.id);
  const summary =
    evaluation.repository.url +
    " — " +
    evaluation.provenance +
    (evaluation.provenance === "automatic"
      ? " pull request #" + evaluation.pull_request.number
      : "") +
    " " +
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
  const target =
    evaluation.commit_status?.publication_status === "unavailable" ||
    evaluation.commit_status?.error ||
    evaluation.commit_status?.reconciliation_required ||
    feedbackRenderer.hasUnavailable(evaluation.feedback)
      ? attention
      : ["queued", "running"].includes(evaluation.execution_status)
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
  if (evaluation.commit_status) {
    const commitStatus = document.createElement("div");
    commitStatus.setAttribute("aria-live", "polite");
    commitStatus.setAttribute("role", "status");
    commitStatus.textContent =
      "Commit status — " +
      evaluation.commit_status.context +
      " — intended state " +
      evaluation.commit_status.state +
      " — " +
      evaluation.commit_status.publication_status +
      " — Source " +
      evaluation.commit_status.source_identity +
      " — Target " +
      evaluation.commit_status.target +
      " — Attempts " +
      evaluation.commit_status.attempt_count +
      (evaluation.commit_status.last_attempt_at
        ? " — Last attempt " + evaluation.commit_status.last_attempt_at
        : "") +
      (evaluation.commit_status.reconciliation_required
        ? " — Reconciliation required"
        : "") +
      (evaluation.commit_status.provider_gate_until
        ? " — Provider gate until " +
          evaluation.commit_status.provider_gate_until
        : "") +
      (evaluation.commit_status.next_attempt_at
        ? " — Next attempt " + evaluation.commit_status.next_attempt_at
        : "") +
      (evaluation.commit_status.external_id !== null
        ? " — GitHub status " + evaluation.commit_status.external_id
        : "") +
      (evaluation.commit_status.error
        ? " — Error " +
          evaluation.commit_status.error.code +
          ": " +
          evaluation.commit_status.error.detail
        : evaluation.commit_status.published_at
          ? " — Published " + evaluation.commit_status.published_at
          : "");
    row.append(commitStatus);
  }
  if (evaluation.feedback) {
    feedbackRenderer.render(row, evaluation.feedback);
  }
  target.append(row);
  if (["queued", "running"].includes(evaluation.execution_status)) {
    resultState.textContent = "Result not ready";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel " + evaluation.id;
    cancel.addEventListener("click", async () => {
      const response = await fetch(
        "/api/v1/evaluations/" + encodeURIComponent(evaluation.id) + "/cancel",
        {
          headers: { "x-quality-bar-csrf": operator.csrfToken() },
          method: "POST",
        },
      );
      if (!response.ok) {
        await operator.displayMutationFailure(response);
        return;
      }
      await loadEvaluations();
    });
    row.append(cancel);
    return;
  }
  if (!["completed", "cancelled"].includes(evaluation.execution_status)) {
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
  let result;
  try {
    result = await resultResponse.json();
  } catch {
    resultState.textContent = "Result failed to load";
    return;
  }
  await resultRenderer.render(resultState, evaluation, result, focusSearch);
}

async function loadFocusedEvaluation() {
  const evaluationId = focusValue("evaluation_id");
  if (evaluationId === null || renderedEvaluationIds.has(evaluationId)) {
    return;
  }
  const response = await fetch(
    "/api/v1/evaluations/" + encodeURIComponent(evaluationId),
  );
  if (!response.ok) {
    const failure = await response.json();
    state.hidden = false;
    state.textContent = failure.error.message;
    return;
  }
  await renderEvaluation(await response.json());
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
    renderedEvaluationIds.clear();
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
  if (initial) {
    await loadFocusedEvaluation();
  }
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
