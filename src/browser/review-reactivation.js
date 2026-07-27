{
  /**
   * @typedef {{
   *   id: string,
   *   active_version: {id: string},
   *   versions: Array<{id: string, number: number}>
   * }} Review
   */
  const contract =
    /** @type {Document & {qualityBarReviewVersionContract?: unknown}} */ (
      document
    ).qualityBarReviewVersionContract;
  if (
    !contract ||
    typeof contract !== "object" ||
    !("controlValue" in contract) ||
    typeof contract.controlValue !== "function" ||
    !("csrfToken" in contract) ||
    typeof contract.csrfToken !== "function" ||
    !("readFailure" in contract) ||
    typeof contract.readFailure !== "function" ||
    !("requiredElement" in contract) ||
    typeof contract.requiredElement !== "function" ||
    !("requireReview" in contract) ||
    typeof contract.requireReview !== "function" ||
    !("requireSaveResult" in contract) ||
    typeof contract.requireSaveResult !== "function"
  ) {
    throw new Error("review_version_contract_unavailable");
  }
  const {
    controlValue,
    csrfToken,
    readFailure,
    requiredElement,
    requireReview,
    requireSaveResult,
  } = /** @type {{
   * controlValue(id: string): string,
   * csrfToken(): string,
   * readFailure(response: Response): Promise<{code: string, message: string}>,
   * requiredElement(id: string): HTMLElement,
   * requireReview(value: unknown): Review,
   * requireSaveResult(value: unknown): {changed: boolean, review: Review}
   * }} */ (contract);
  const selector = /** @type {HTMLSelectElement} */ (
    requiredElement("review-version-activation")
  );
  const activate = /** @type {HTMLButtonElement} */ (
    requiredElement("review-version-activate")
  );
  const submit = /** @type {HTMLButtonElement} */ (
    requiredElement("review-version-submit")
  );
  const result = requiredElement("review-version-result");
  const error = requiredElement("error");
  /** @type {Map<string, Review>} */
  const reviews = new Map();
  let pending = false;
  let siblingMutationPending = false;

  /** @param {Review} review */
  function render(review) {
    selector.replaceChildren(
      ...review.versions.map((version) => {
        const option = document.createElement("option");
        option.value = version.id;
        option.textContent =
          "v" +
          version.number +
          (version.id === review.active_version.id ? " (active)" : "");
        return option;
      }),
    );
    selector.value = review.active_version.id;
    activate.disabled = true;
  }

  function updateAvailability() {
    const review = reviews.get(controlValue("review-version-id"));
    activate.disabled =
      pending ||
      siblingMutationPending ||
      !review ||
      selector.value === review.active_version.id;
  }

  /** @param {string} message */
  function showFailure(message) {
    error.hidden = false;
    error.replaceChildren();
    error.textContent = message;
  }

  selector.addEventListener("change", updateAvailability);
  document.addEventListener("quality-bar:review-opened", (event) => {
    if (!(event instanceof CustomEvent)) {
      throw new Error("review_opened_event_invalid");
    }
    const review = requireReview(event.detail);
    reviews.set(review.id, review);
    render(review);
  });
  document.addEventListener("quality-bar:review-version-mutation", (event) => {
    if (
      !(event instanceof CustomEvent) ||
      typeof event.detail?.pending !== "boolean"
    ) {
      throw new Error("review_version_mutation_event_invalid");
    }
    siblingMutationPending = event.detail.pending;
    updateAvailability();
  });

  activate.addEventListener("click", async () => {
    if (pending || siblingMutationPending) {
      return;
    }
    pending = true;
    activate.disabled = true;
    submit.disabled = true;
    error.hidden = true;
    error.textContent = "";
    error.replaceChildren();
    result.textContent = "";
    const reviewId = controlValue("review-version-id");
    const reviewVersionId = selector.value;
    try {
      const response = await fetch(
        "/api/v1/reviews/" + encodeURIComponent(reviewId) + "/active-version",
        {
          body: JSON.stringify({ review_version_id: reviewVersionId }),
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
        showFailure(
          controlValue("review-version-id") === reviewId
            ? failure.message
            : `Review ${reviewId}: ${failure.message}`,
        );
        return;
      }
      const reactivated = requireSaveResult(await response.json());
      if (reactivated.review.id !== reviewId) {
        throw new Error("Review Version response was invalid");
      }
      reviews.set(reviewId, reactivated.review);
      const open =
        controlValue("review-version-id") === reviewId &&
        selector.value === reviewVersionId;
      document.dispatchEvent(
        new CustomEvent("quality-bar:review-reactivated", {
          detail: { open, reactivated },
        }),
      );
      if (!open) {
        updateAvailability();
      }
    } catch (caught) {
      if (!(caught instanceof Error)) {
        throw caught;
      }
      showFailure(
        controlValue("review-version-id") === reviewId
          ? caught.message
          : `Review ${reviewId}: ${caught.message}`,
      );
    } finally {
      pending = false;
      submit.disabled = false;
      updateAvailability();
    }
  });
}
