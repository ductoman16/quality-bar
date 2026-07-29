{
  /**
   * @typedef {{
   *   id: string,
   *   name: string,
   *   archived: boolean,
   *   deletion_eligible: boolean,
   *   active_version: {id: string},
   *   versions: Array<{id: string}>
   * }} Review
   */
  const contract =
    /** @type {Document & {qualityBarReviewVersionContract?: unknown}} */ (
      document
    ).qualityBarReviewVersionContract;
  if (
    !contract ||
    typeof contract !== "object" ||
    !("csrfToken" in contract) ||
    typeof contract.csrfToken !== "function" ||
    !("requiredElement" in contract) ||
    typeof contract.requiredElement !== "function" ||
    !("requireReview" in contract) ||
    typeof contract.requireReview !== "function"
  ) {
    throw new Error("review_archival_contract_unavailable");
  }
  const { csrfToken, requiredElement, requireReview } = /** @type {{
   * csrfToken(): string,
   * requiredElement(id: string): HTMLElement,
   * requireReview(value: unknown): Review
   * }} */ (contract);
  const form = /** @type {HTMLFormElement} */ (
    requiredElement("review-archival-form")
  );
  const state = /** @type {HTMLSelectElement} */ (
    requiredElement("review-archival-state")
  );
  const selector = /** @type {HTMLSelectElement} */ (
    requiredElement("review-archival-review")
  );
  const submit = /** @type {HTMLButtonElement} */ (
    requiredElement("review-archival-submit")
  );
  const result = requiredElement("review-archival-result");
  const error = requiredElement("error");
  /** @type {Map<string, Review>} */
  const reviews = new Map();
  let pending = false;
  let ready = Promise.resolve(false);

  function syncDeleteAvailability() {
    const review = reviews.get(selector.value);
    /** @type {HTMLButtonElement} */ (
      requiredElement("review-delete")
    ).disabled = pending || review?.deletion_eligible !== true;
  }

  /** @param {string} message */
  function showFailure(message) {
    error.hidden = false;
    error.replaceChildren();
    error.textContent = message;
    result.textContent = "";
  }

  function clearFeedback() {
    error.hidden = true;
    error.textContent = "";
    error.replaceChildren();
    result.textContent = "";
  }

  /**
   * @param {Response} response
   * @param {{code: string}} failure
   */
  function redirectForAuthentication(response, failure) {
    if (response.status !== 401 || failure.code !== "authentication_required") {
      return false;
    }
    location.assign(
      "/?return_to=" + encodeURIComponent(location.pathname + location.search),
    );
    return true;
  }

  /** @param {Response} response */
  async function readFailure(response) {
    const body = /** @type {{error?: {code?: unknown, message?: unknown}}} */ (
      await response.json()
    );
    if (
      !body.error ||
      typeof body.error.code !== "string" ||
      typeof body.error.message !== "string"
    ) {
      throw new Error("Review archival response was invalid");
    }
    return /** @type {{code: string, message: string}} */ (body.error);
  }

  function updateAction() {
    const review = reviews.get(selector.value);
    submit.disabled = pending || !review;
    submit.textContent = state.value === "archived" ? "Restore" : "Archive";
    syncDeleteAvailability();
  }

  /** @param {Review[]} listed */
  function render(listed) {
    reviews.clear();
    selector.replaceChildren(
      ...listed.map((review) => {
        reviews.set(review.id, review);
        const option = document.createElement("option");
        option.value = review.id;
        option.textContent = review.name;
        return option;
      }),
    );
    selector.value = listed[0]?.id ?? "";
    form.hidden = false;
    updateAction();
  }

  async function load() {
    pending = true;
    updateAction();
    clearFeedback();
    try {
      const response = await fetch(
        state.value === "archived"
          ? "/api/v1/reviews?state=archived"
          : "/api/v1/reviews",
      );
      if (!response.ok) {
        const failure = await readFailure(response);
        if (redirectForAuthentication(response, failure)) {
          return false;
        }
        showFailure(failure.message);
        return false;
      }
      const body = /** @type {{reviews?: unknown}} */ (await response.json());
      if (!Array.isArray(body.reviews)) {
        throw new Error("Review archival response was invalid");
      }
      const listed = body.reviews.map(requireReview);
      const archived = state.value === "archived";
      if (listed.some((review) => review.archived !== archived)) {
        throw new Error("Review archival response was invalid");
      }
      render(listed);
      return true;
    } finally {
      pending = false;
      updateAction();
    }
  }

  state.addEventListener("change", load);
  selector.addEventListener("change", updateAction);
  submit.addEventListener("click", async (event) => {
    event.preventDefault();
    const review = reviews.get(selector.value);
    if (pending || !review) {
      return;
    }
    const archived = !review.archived;
    const confirmation = archived
      ? `Archive Review "${review.name}"? It will be excluded from new Evaluations.`
      : `Restore Review "${review.name}"?`;
    if (!confirm(confirmation)) {
      return;
    }
    pending = true;
    updateAction();
    clearFeedback();
    try {
      const response = await fetch(
        "/api/v1/reviews/" + encodeURIComponent(review.id) + "/archival",
        {
          body: JSON.stringify({ archived }),
          headers: {
            "content-type": "application/json",
            "x-quality-bar-csrf": csrfToken(),
          },
          method: "PATCH",
        },
      );
      if (!response.ok) {
        const failure = await readFailure(response);
        if (redirectForAuthentication(response, failure)) {
          return;
        }
        showFailure(failure.message);
        return;
      }
      const body = /** @type {{changed?: unknown, review?: unknown}} */ (
        await response.json()
      );
      if (typeof body.changed !== "boolean") {
        throw new Error("Review archival response was invalid");
      }
      const updatedReview = requireReview(body.review);
      if (
        updatedReview.id !== review.id ||
        updatedReview.archived !== archived
      ) {
        throw new Error("Review archival response was invalid");
      }
      state.value = archived ? "archived" : "active";
      render([updatedReview]);
      result.textContent = `${updatedReview.name} ${archived ? "archived" : "restored"}.`;
    } finally {
      pending = false;
      updateAction();
    }
  });
  Reflect.set(
    window,
    "qualityBarReviewLifecycle",
    Object.freeze({
      /** @param {string} id */
      find: (id) => reviews.get(id),
      ready: () => ready,
      refresh: load,
      syncDeleteAvailability,
    }),
  );
  document.addEventListener("quality-bar:system-loaded", (event) => {
    if (!(event instanceof CustomEvent)) {
      throw new Error("system_loaded_event_invalid");
    }
    ready = load();
    return ready;
  });
}
