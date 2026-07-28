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
const creationStatus = operator.requiredElement("evaluation-create-status");

/** @param {string} id */
function controlValue(id) {
  const control = operator.requiredElement(id);
  if (!("value" in control) || typeof control.value !== "string") {
    throw new Error("evaluation_control_unavailable");
  }
  return control.value;
}

/** @param {HTMLElement} parent @param {string} value */
function appendText(parent, value) {
  const item = document.createElement("li");
  item.textContent = value;
  parent.append(item);
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
    typeof evaluation.effective_outcome !== "string"
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
    (evaluation.execution_status === "queued"
      ? "delayed"
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
  appendText(target, summary);
  if (evaluation.execution_status !== "completed") {
    if (["queued", "running"].includes(evaluation.execution_status)) {
      appendText(target, "Result not ready");
    }
    return;
  }
  const resultResponse = await fetch(
    "/api/v1/evaluations/" + encodeURIComponent(evaluation.id) + "/result",
  );
  if (resultResponse.status === 409) {
    appendText(target, "Result not ready");
    return;
  }
  if (!resultResponse.ok) {
    const failure = await resultResponse.json();
    appendText(target, failure.error.message);
    return;
  }
  const result = await resultResponse.json();
  appendText(target, "Result " + JSON.stringify(result));
}

async function loadEvaluations() {
  loading.hidden = false;
  empty.hidden = true;
  state.hidden = true;
  active.replaceChildren();
  recent.replaceChildren();
  attention.replaceChildren();
  let response;
  try {
    response = await fetch("/api/v1/evaluations");
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
  if (!Array.isArray(collection.items) || collection.next_cursor !== null) {
    throw new Error("evaluation_collection_invalid");
  }
  empty.hidden = collection.items.length !== 0;
  for (const evaluation of collection.items) {
    await renderEvaluation(evaluation);
  }
}

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
