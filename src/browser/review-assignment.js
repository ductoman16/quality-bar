{
  /**
   * @typedef {{
   *   id: string,
   *   name: string,
   *   assignment:
   *     | {scope: "installation_wide"}
   *     | {scope: "repository_set", repository_ids: string[]}
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
    !("readFailure" in contract) ||
    typeof contract.readFailure !== "function" ||
    !("requiredElement" in contract) ||
    typeof contract.requiredElement !== "function" ||
    !("requireReview" in contract) ||
    typeof contract.requireReview !== "function"
  ) {
    throw new Error("review_assignment_contract_unavailable");
  }
  const { csrfToken, readFailure, requiredElement, requireReview } =
    /** @type {{
     * csrfToken(): string,
     * readFailure(response: Response): Promise<{code: string, message: string}>,
     * requiredElement(id: string): HTMLElement,
     * requireReview(value: unknown): Review
     * }} */ (contract);
  const form = /** @type {HTMLFormElement} */ (
    requiredElement("review-assignment-form")
  );
  const reviewSelector = /** @type {HTMLSelectElement} */ (
    requiredElement("review-assignment-review")
  );
  const scope = /** @type {HTMLSelectElement} */ (
    requiredElement("review-assignment-scope")
  );
  const repositorySelector = /** @type {HTMLSelectElement} */ (
    requiredElement("review-assignment-repositories")
  );
  const submit = /** @type {HTMLButtonElement} */ (
    requiredElement("review-assignment-submit")
  );
  const result = requiredElement("review-assignment-result");
  const error = requiredElement("error");
  /** @type {Map<string, Review>} */
  const reviews = new Map();
  let pending = false;

  /** @param {Review["assignment"] | unknown} assignment */
  function requireAssignment(assignment) {
    if (
      assignment &&
      typeof assignment === "object" &&
      "scope" in assignment &&
      assignment.scope === "installation_wide" &&
      Object.keys(assignment).length === 1
    ) {
      return /** @type {{scope: "installation_wide"}} */ (assignment);
    }
    if (
      assignment &&
      typeof assignment === "object" &&
      "scope" in assignment &&
      assignment.scope === "repository_set" &&
      "repository_ids" in assignment &&
      Array.isArray(assignment.repository_ids) &&
      assignment.repository_ids.length > 0 &&
      assignment.repository_ids.every(
        (repositoryId) =>
          typeof repositoryId === "string" && repositoryId.length > 0,
      ) &&
      new Set(assignment.repository_ids).size ===
        assignment.repository_ids.length &&
      Object.keys(assignment).length === 2
    ) {
      return /** @type {{scope: "repository_set", repository_ids: string[]}} */ (
        assignment
      );
    }
    throw new Error("Review Assignment response was invalid");
  }

  function clearFeedback() {
    error.hidden = true;
    error.textContent = "";
    result.textContent = "";
  }

  /** @param {string} message */
  function showFailure(message) {
    error.hidden = false;
    error.textContent = message;
    result.textContent = "";
  }

  function updateDisabledState() {
    repositorySelector.disabled =
      pending || scope.value === "installation_wide";
    reviewSelector.disabled = pending;
    scope.disabled = pending;
    submit.disabled = pending || reviews.size === 0;
  }

  function showSelectedReview() {
    const review = reviews.get(reviewSelector.value);
    if (!review) {
      updateDisabledState();
      return;
    }
    const assignment = requireAssignment(review.assignment);
    scope.value = assignment.scope;
    const selectedRepositories =
      assignment.scope === "repository_set"
        ? new Set(assignment.repository_ids)
        : new Set();
    for (const option of repositorySelector.options) {
      option.selected = selectedRepositories.has(option.value);
    }
    updateDisabledState();
  }

  /** @param {unknown[]} values */
  function renderReviews(values) {
    reviews.clear();
    reviewSelector.replaceChildren(
      ...values.map((value) => {
        const review = requireReview(value);
        review.assignment = requireAssignment(review.assignment);
        reviews.set(review.id, review);
        const option = document.createElement("option");
        option.value = review.id;
        option.textContent = review.name;
        return option;
      }),
    );
    reviewSelector.value = reviews.keys().next().value ?? "";
  }

  /** @param {unknown[]} values */
  function renderRepositories(values) {
    repositorySelector.replaceChildren(
      ...values.map((value) => {
        const repository = /** @type {{id?: unknown, url?: unknown} | null} */ (
          value
        );
        if (
          !repository ||
          typeof repository.id !== "string" ||
          typeof repository.url !== "string"
        ) {
          throw new Error("Review Assignment response was invalid");
        }
        const option = document.createElement("option");
        option.value = repository.id;
        option.textContent = repository.url;
        return option;
      }),
    );
  }

  async function load() {
    pending = true;
    form.hidden = true;
    reviews.clear();
    reviewSelector.replaceChildren();
    updateDisabledState();
    clearFeedback();
    try {
      const [reviewResponse, repositoryResponse] = await Promise.all([
        fetch("/api/v1/reviews"),
        fetch("/api/v1/repositories"),
      ]);
      for (const response of [reviewResponse, repositoryResponse]) {
        if (!response.ok) {
          const failure = await readFailure(response);
          if (
            response.status === 401 &&
            failure.code === "authentication_required"
          ) {
            location.assign(
              "/?return_to=" +
                encodeURIComponent(location.pathname + location.search),
            );
            return false;
          }
          showFailure(failure.message);
          return false;
        }
      }
      const reviewBody = /** @type {{reviews?: unknown}} */ (
        await reviewResponse.json()
      );
      const repositoryBody = /** @type {{repositories?: unknown}} */ (
        await repositoryResponse.json()
      );
      if (
        !Array.isArray(reviewBody.reviews) ||
        !Array.isArray(repositoryBody.repositories)
      ) {
        throw new Error("Review Assignment response was invalid");
      }
      renderReviews(reviewBody.reviews);
      renderRepositories(repositoryBody.repositories);
      form.hidden = false;
      showSelectedReview();
      return true;
    } catch {
      showFailure("Review Assignment refresh failed");
      return false;
    } finally {
      pending = false;
      updateDisabledState();
    }
  }

  reviewSelector.addEventListener("change", showSelectedReview);
  scope.addEventListener("change", updateDisabledState);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const review = reviews.get(reviewSelector.value);
    if (pending || !review) {
      return;
    }
    const assignment =
      scope.value === "installation_wide"
        ? { scope: "installation_wide" }
        : {
            repository_ids: [...repositorySelector.selectedOptions]
              .map(({ value }) => value)
              .toSorted(),
            scope: "repository_set",
          };
    pending = true;
    updateDisabledState();
    clearFeedback();
    try {
      const response = await fetch(
        "/api/v1/reviews/" + encodeURIComponent(review.id) + "/assignment",
        {
          body: JSON.stringify(assignment),
          headers: {
            "content-type": "application/json",
            "x-quality-bar-csrf": csrfToken(),
          },
          method: "PATCH",
        },
      );
      if (!response.ok) {
        const failure = await readFailure(response);
        if (
          response.status === 401 &&
          failure.code === "authentication_required"
        ) {
          location.assign(
            "/?return_to=" +
              encodeURIComponent(location.pathname + location.search),
          );
          return;
        }
        showFailure(failure.message);
        return;
      }
      const body = /** @type {{changed?: unknown, review?: unknown}} */ (
        await response.json()
      );
      if (typeof body.changed !== "boolean") {
        throw new Error("Review Assignment response was invalid");
      }
      let updated;
      try {
        updated = requireReview(body.review);
      } catch {
        throw new Error("Review Assignment response was invalid");
      }
      updated.assignment = requireAssignment(updated.assignment);
      if (
        updated.id !== review.id ||
        JSON.stringify(updated.assignment) !== JSON.stringify(assignment)
      ) {
        throw new Error("Review Assignment response was invalid");
      }
      reviews.set(updated.id, updated);
      result.textContent = `${updated.name} Assignment ${body.changed ? "changed" : "unchanged"}.`;
      showSelectedReview();
    } catch (cause) {
      const message =
        cause instanceof Error &&
        [
          "Review Assignment response was invalid",
          "browser_csrf_unavailable",
        ].includes(cause.message)
          ? cause.message
          : "Review Assignment change failed";
      if (await load()) {
        showFailure(message);
      }
    } finally {
      pending = false;
      updateDisabledState();
    }
  });
  document.addEventListener("quality-bar:system-loaded", (event) => {
    if (!(event instanceof CustomEvent)) {
      throw new Error("system_loaded_event_invalid");
    }
    return load();
  });
}
