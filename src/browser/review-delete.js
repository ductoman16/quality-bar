{
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
    typeof contract.requiredElement !== "function"
  ) {
    throw new Error("review_deletion_contract_unavailable");
  }
  const { csrfToken, readFailure, requiredElement } = /** @type {{
   * csrfToken(): string,
   * readFailure(response: Response): Promise<{code: string, message: string}>,
   * requiredElement(id: string): HTMLElement
   * }} */ (contract);
  const lifecycle = /** @type {{
   * find(id: string): {deletion_eligible: boolean, id: string, name: string} | undefined,
   * ready(): Promise<unknown>,
   * refresh(): Promise<boolean>,
   * syncDeleteAvailability(): void
   * }} */ (Reflect.get(window, "qualityBarReviewLifecycle"));
  const deleteButton = /** @type {HTMLButtonElement} */ (
    requiredElement("review-delete")
  );
  const confirmation = /** @type {HTMLDialogElement} */ (
    requiredElement("review-delete-confirmation")
  );
  const confirmationForm = /** @type {HTMLFormElement} */ (
    requiredElement("review-delete-confirmation-form")
  );
  const confirmationInput = /** @type {HTMLInputElement} */ (
    requiredElement("review-delete-confirmation-input")
  );
  const confirmationMessage = requiredElement(
    "review-delete-confirmation-message",
  );
  const confirmationCancel = /** @type {HTMLButtonElement} */ (
    requiredElement("review-delete-confirmation-cancel")
  );
  const error = requiredElement("error");
  const result = requiredElement("review-archival-result");
  /** @type {{id: string, name: string} | null} */
  let pending = null;

  /**
   * @param {{id: string, name: string}} review
   * @param {{allowSuccess?: boolean, failureMessage?: string}} [options]
   */
  async function reconcile(
    review,
    { allowSuccess = false, failureMessage } = {},
  ) {
    let refreshed;
    try {
      refreshed = await lifecycle.refresh();
    } catch (refreshFailure) {
      if (!failureMessage) {
        if (
          !refreshFailure ||
          typeof refreshFailure !== "object" ||
          !("message" in refreshFailure) ||
          typeof refreshFailure.message !== "string"
        ) {
          throw new Error("review_deletion_refresh_failure_invalid");
        }
        failureMessage = refreshFailure.message;
      }
      error.textContent = failureMessage;
      error.hidden = false;
      error.focus();
      return;
    }
    if (allowSuccess && refreshed && !lifecycle.find(review.id)) {
      error.hidden = true;
      result.textContent = `${review.name} deleted.`;
      result.focus();
      return;
    }
    if (failureMessage) {
      error.textContent = failureMessage;
      error.hidden = false;
    } else if (refreshed) {
      error.textContent = "Review deletion was not observed";
      error.hidden = false;
    }
    error.focus();
  }

  async function deletePendingReview() {
    const review = pending;
    if (!review) {
      return;
    }
    if (confirmationInput.value !== review.name) {
      error.textContent = "Type the Review name to confirm permanent deletion";
      error.hidden = false;
      confirmationInput.focus();
      return;
    }
    pending = null;
    confirmation.close();
    error.hidden = true;
    deleteButton.disabled = true;
    try {
      let response;
      try {
        response = await fetch(
          "/api/v1/reviews/" + encodeURIComponent(review.id),
          {
            body: "{}",
            headers: {
              "content-type": "application/json",
              "x-quality-bar-csrf": csrfToken(),
            },
            method: "DELETE",
          },
        );
      } catch {
        await reconcile(review, { failureMessage: "Review deletion failed" });
        return;
      }
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
        await reconcile(review, { failureMessage: failure.message });
        return;
      }
      await reconcile(review, { allowSuccess: true });
    } finally {
      lifecycle.syncDeleteAvailability();
    }
  }

  function cancel() {
    pending = null;
    confirmation.close();
    deleteButton.focus();
  }

  deleteButton.addEventListener("click", async () => {
    if (!(await lifecycle.ready())) {
      return;
    }
    const reviewId = /** @type {HTMLSelectElement} */ (
      requiredElement("review-archival-review")
    ).value;
    const review = lifecycle.find(reviewId);
    if (!review) {
      throw new Error("review_delete_target_missing");
    }
    if (!review.deletion_eligible) {
      return;
    }
    pending = review;
    error.hidden = true;
    confirmationMessage.textContent = `Delete Review "${review.name}" permanently. This cannot be undone.`;
    confirmationInput.value = "";
    confirmation.showModal();
    confirmationInput.focus();
  });
  confirmationCancel.addEventListener("click", cancel);
  confirmation.addEventListener("cancel", (event) => {
    event.preventDefault();
    cancel();
  });
  confirmationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await deletePendingReview();
  });
}
