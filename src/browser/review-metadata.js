{
  function readBrowserConfiguration() {
    const configuration = /** @type {HTMLScriptElement} */ (
      document.getElementById("browser-configuration")
    );
    if (configuration?.type !== "application/json") {
      throw new Error("browser_configuration_invalid");
    }
    try {
      const value = /** @type {{ csrfCookieName?: unknown }} */ (
        JSON.parse(configuration.textContent)
      );
      if (
        !value ||
        typeof value.csrfCookieName !== "string" ||
        !/^[A-Za-z0-9_-]+$/.test(value.csrfCookieName)
      ) {
        throw new Error("browser_configuration_invalid");
      }
      return { csrfCookieName: value.csrfCookieName };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "browser_configuration_invalid"
      ) {
        throw error;
      }
      throw new Error("browser_configuration_invalid", { cause: error });
    }
  }

  const form = /** @type {HTMLFormElement} */ (
    document.getElementById("review-metadata-form")
  );
  const error = requiredElement("error");
  const result = requiredElement("review-metadata-result");
  const selector = /** @type {HTMLSelectElement} */ (
    requiredElement("review-metadata-review")
  );
  const submit = /** @type {HTMLButtonElement} */ (
    requiredElement("review-metadata-submit")
  );
  const { csrfCookieName } = readBrowserConfiguration();
  let savePending = false;
  /** @type {Map<string, {id: string, name: string, description: string}>} */
  const reviews = new Map();

  /** @param {string} id */
  function requiredElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error("browser_control_unavailable");
    }
    return element;
  }

  /** @param {string} id @returns {HTMLInputElement | HTMLTextAreaElement} */
  function control(id) {
    const element = document.getElementById(id);
    if (
      !element ||
      !("value" in element) ||
      typeof element.value !== "string"
    ) {
      throw new Error("browser_control_unavailable");
    }
    return /** @type {HTMLInputElement | HTMLTextAreaElement} */ (element);
  }

  function csrfToken() {
    const token = document.cookie
      .split(";")
      .map((cookie) => cookie.trim().split("=", 2))
      .find(([name]) => name === csrfCookieName)?.[1];
    if (!token) {
      throw new Error("browser_csrf_unavailable");
    }
    return token;
  }

  /** @param {unknown} value */
  function isCompleteCriterion(value) {
    if (!value || typeof value !== "object") {
      return false;
    }
    return (
      "id" in value &&
      typeof value.id === "string" &&
      "instruction" in value &&
      typeof value.instruction === "string" &&
      "impact" in value &&
      ["advisory", "blocking"].includes(/** @type {string} */ (value.impact)) &&
      "position" in value &&
      typeof value.position === "number" &&
      Number.isSafeInteger(value.position)
    );
  }

  /** @param {unknown} value */
  function isCompleteCodexConfiguration(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      "model" in value &&
      typeof value.model === "string" &&
      "reasoning_effort" in value &&
      typeof value.reasoning_effort === "string" &&
      "service_tier" in value &&
      typeof value.service_tier === "string"
    );
  }

  /** @param {unknown} value */
  function requireReview(value) {
    const review =
      /** @type {{id?: unknown, name?: unknown, description?: unknown, assignment?: unknown, active_version?: unknown}} */ (
        value
      );
    if (
      !review ||
      typeof review.id !== "string" ||
      typeof review.name !== "string" ||
      typeof review.description !== "string" ||
      !review.assignment ||
      typeof review.assignment !== "object" ||
      !("scope" in review.assignment) ||
      typeof review.assignment.scope !== "string" ||
      !review.active_version ||
      typeof review.active_version !== "object" ||
      !("id" in review.active_version) ||
      typeof review.active_version.id !== "string" ||
      !("number" in review.active_version) ||
      !Number.isSafeInteger(review.active_version.number) ||
      !("criteria" in review.active_version) ||
      !Array.isArray(review.active_version.criteria) ||
      review.active_version.criteria.length === 0 ||
      !review.active_version.criteria.every(isCompleteCriterion) ||
      !("codex_configuration" in review.active_version) ||
      !isCompleteCodexConfiguration(review.active_version.codex_configuration)
    ) {
      throw new Error("Review metadata response was invalid");
    }
    return {
      description: review.description,
      id: review.id,
      name: review.name,
    };
  }

  /** @param {string} selectedId */
  function renderOptions(selectedId) {
    const options = [...reviews.values()].map((candidate) => {
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = candidate.name;
      return option;
    });
    selector.replaceChildren(...options);
    selector.value = selectedId;
  }

  /** @param {{id: string, name: string, description: string}} review */
  function openReview(review) {
    reviews.set(review.id, review);
    renderOptions(review.id);
    control("review-metadata-id").value = review.id;
    control("review-metadata-name").value = review.name;
    control("review-metadata-description").value = review.description;
    form.hidden = false;
  }

  /** @param {{id: string, name: string, description: string}} submitted */
  function matchesSubmission(submitted) {
    return (
      control("review-metadata-id").value === submitted.id &&
      control("review-metadata-name").value === submitted.name &&
      control("review-metadata-description").value === submitted.description
    );
  }

  function clearErrors() {
    error.hidden = true;
    error.textContent = "";
    error.replaceChildren();
    for (const id of [
      "review-metadata-name-error",
      "review-metadata-description-error",
    ]) {
      const fieldError = requiredElement(id);
      fieldError.textContent = "";
      fieldError.hidden = true;
    }
  }

  /** @param {string} message @param {string} [code] */
  function showFailure(message, code) {
    error.hidden = false;
    const affectedControl = code
      ? new Map([
          ["review_name_invalid", "review-metadata-name"],
          ["review_name_conflict", "review-metadata-name"],
          ["review_description_invalid", "review-metadata-description"],
        ]).get(code)
      : undefined;
    if (affectedControl) {
      const summaryLink = document.createElement("a");
      summaryLink.href = "#" + affectedControl;
      summaryLink.textContent = message;
      error.replaceChildren(summaryLink);
      const fieldError = requiredElement(affectedControl + "-error");
      fieldError.textContent = message;
      fieldError.hidden = false;
      control(affectedControl).focus();
    } else {
      error.textContent = message;
    }
  }

  /** @param {unknown} caught */
  function caughtMessage(caught) {
    if (
      !caught ||
      typeof caught !== "object" ||
      !("message" in caught) ||
      typeof caught.message !== "string"
    ) {
      throw caught;
    }
    return caught.message;
  }

  /** @param {unknown} caught */
  function showCaughtFailure(caught) {
    showFailure(caughtMessage(caught));
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
      throw new Error("Review metadata response was invalid");
    }
    return { code: body.error.code, message: body.error.message };
  }

  /** @param {Response} response */
  async function redirectIfAuthenticationRequired(response) {
    if (response.status !== 401) {
      return false;
    }
    const failure = await readFailure(response);
    if (failure.code !== "authentication_required") {
      showFailure(failure.message, failure.code);
      return true;
    }
    location.assign(
      "/?return_to=" + encodeURIComponent(location.pathname + location.search),
    );
    return true;
  }

  document.addEventListener("quality-bar:system-loaded", async () => {
    try {
      const response = await fetch("/api/v1/reviews");
      if (await redirectIfAuthenticationRequired(response)) {
        return;
      }
      if (!response.ok) {
        const failure = await readFailure(response);
        showFailure(failure.message, failure.code);
        return;
      }
      const body = /** @type {{reviews?: unknown}} */ (await response.json());
      if (!Array.isArray(body.reviews)) {
        throw new Error("Review metadata response was invalid");
      }
      const listedReviews = body.reviews.map(requireReview);
      for (const review of listedReviews) {
        reviews.set(review.id, review);
      }
      if (listedReviews.length > 0) {
        openReview(listedReviews[0]);
      }
    } catch (caught) {
      showCaughtFailure(caught);
    }
  });

  document.addEventListener("quality-bar:review-created", (event) => {
    if (!(event instanceof CustomEvent)) {
      throw new Error("review_created_event_invalid");
    }
    try {
      openReview(requireReview(event.detail));
    } catch (cause) {
      throw new Error("review_created_event_invalid", { cause });
    }
  });

  selector.addEventListener("change", () => {
    const review = reviews.get(selector.value);
    if (!review) {
      throw new Error("review_selection_invalid");
    }
    openReview(review);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (savePending) {
      return;
    }
    savePending = true;
    submit.disabled = true;
    clearErrors();
    result.textContent = "";
    const submitted = {
      description: control("review-metadata-description").value,
      id: control("review-metadata-id").value,
      name: control("review-metadata-name").value,
    };
    try {
      const response = await fetch(
        "/api/v1/reviews/" + encodeURIComponent(submitted.id) + "/metadata",
        {
          body: JSON.stringify({
            description: submitted.description,
            name: submitted.name,
          }),
          headers: {
            "content-type": "application/json",
            "x-quality-bar-csrf": csrfToken(),
          },
          method: "PATCH",
        },
      );
      if (await redirectIfAuthenticationRequired(response)) {
        return;
      }
      if (response.ok) {
        const review = requireReview(await response.json());
        if (review.id !== submitted.id) {
          throw new Error("Review metadata response was invalid");
        }
        reviews.set(review.id, review);
        document.dispatchEvent(
          new CustomEvent("quality-bar:review-updated", {
            detail: { review },
          }),
        );
        if (matchesSubmission(submitted)) {
          openReview(review);
          result.textContent = review.name + " metadata saved.";
        } else {
          renderOptions(selector.value);
        }
        return;
      }
      const failure = await readFailure(response);
      const isCurrentSubmission = matchesSubmission(submitted);
      showFailure(
        isCurrentSubmission
          ? failure.message
          : `Review ${submitted.id}: ${failure.message}`,
        isCurrentSubmission ? failure.code : undefined,
      );
    } catch (caught) {
      const message = caughtMessage(caught);
      showFailure(
        matchesSubmission(submitted)
          ? message
          : `Review ${submitted.id}: ${message}`,
      );
    } finally {
      savePending = false;
      submit.disabled = false;
    }
  });
}
