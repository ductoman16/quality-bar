{
  /**
   * @typedef {{
   * id: string,
   * name: string,
   * active_version: {
   *   id: string,
   *   number: number,
   *   applicability_rule: string | null,
   *   codex_configuration: {
   *     model: string,
   *     reasoning_effort: string,
   *     service_tier: string
   *   },
   *   criteria: Array<{id: string, impact: string, instruction: string}>
   * }
   * }} Review
   * @typedef {{
   *   applicabilityRule: string,
   *   configuration: {model: string, reasoningEffort: string, serviceTier: string},
   *   criteria: Array<{id?: string, impact: string, instruction: string}>,
   *   reviewId: string
   * }} Submitted
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
    typeof contract.requireSaveResult !== "function" ||
    !("setControlValue" in contract) ||
    typeof contract.setControlValue !== "function"
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
    setControlValue,
  } = /** @type {{
   * controlValue(id: string): string,
   * csrfToken(): string,
   * readFailure(response: Response): Promise<{code: string, message: string}>,
   * requiredElement(id: string): HTMLElement,
   * requireReview(value: unknown): Review,
   * requireSaveResult(value: unknown): {changed: boolean, review: Review},
   * setControlValue(id: string, value: string): void
   * }} */ (contract);

  const form = /** @type {HTMLFormElement} */ (
    requiredElement("review-version-form")
  );
  const selector = /** @type {HTMLSelectElement} */ (
    requiredElement("review-version-review")
  );
  const model = /** @type {HTMLSelectElement} */ (
    requiredElement("review-version-model")
  );
  const reasoningEffort = /** @type {HTMLSelectElement} */ (
    requiredElement("review-version-reasoning-effort")
  );
  const serviceTier = /** @type {HTMLSelectElement} */ (
    requiredElement("review-version-service-tier")
  );
  const criteriaList = /** @type {HTMLOListElement} */ (
    requiredElement("review-version-criteria")
  );
  const addCriterion = /** @type {HTMLButtonElement} */ (
    requiredElement("review-version-add-criterion")
  );
  const submit = /** @type {HTMLButtonElement} */ (
    requiredElement("review-version-submit")
  );
  const result = requiredElement("review-version-result");
  const error = requiredElement("error");
  /** @type {Map<string, Review>} */
  const reviews = new Map();
  /** @type {{id: string, reasoning_efforts: string[], service_tiers: string[]}[]} */
  let models = [];
  /** @type {{
   * clearErrors(): void,
   * read(): Array<{id?: string, impact: string, instruction: string}>,
   * reset(criteria: Array<{id: string, impact: string, instruction: string}>): void,
   * showFailure(code: string, message: string): string | undefined,
   * validate(): {code: string, message: string} | undefined
   * } | undefined} */
  let criterionEditor;
  let mutationPending = false;

  /** @param {string} value */
  function option(value) {
    const element = document.createElement("option");
    element.value = value;
    element.textContent = value;
    return element;
  }

  /** @param {string} [reasoning] @param {string} [tier] */
  function updateConfiguration(reasoning, tier) {
    const capability = models.find((candidate) => candidate.id === model.value);
    if (!capability) {
      throw new Error("Review model capability is unavailable");
    }
    const firstReasoning = capability.reasoning_efforts[0];
    const firstTier = capability.service_tiers[0];
    if (!firstReasoning || !firstTier) {
      throw new Error("Review model capability is unavailable");
    }
    reasoningEffort.replaceChildren(
      ...capability.reasoning_efforts.map(option),
    );
    serviceTier.replaceChildren(...capability.service_tiers.map(option));
    reasoningEffort.value = firstReasoning;
    serviceTier.value = firstTier;
    if (reasoning && capability.reasoning_efforts.includes(reasoning)) {
      reasoningEffort.value = reasoning;
    }
    if (tier && capability.service_tiers.includes(tier)) {
      serviceTier.value = tier;
    }
  }

  /** @param {string} selectedId */
  function renderReviewOptions(selectedId) {
    selector.replaceChildren(
      ...[...reviews.values()].map((candidate) => {
        const element = option(candidate.id);
        element.textContent = candidate.name;
        return element;
      }),
    );
    selector.value = selectedId;
  }

  function clearErrors() {
    error.hidden = true;
    error.textContent = "";
    error.replaceChildren();
    criterionEditor?.clearErrors();
  }

  /** @param {boolean} pending */
  function announceMutation(pending) {
    document.dispatchEvent(
      new CustomEvent("quality-bar:review-version-mutation", {
        detail: { pending },
      }),
    );
  }

  /** @param {string} message @param {string} [code] */
  function showFailure(message, code) {
    error.hidden = false;
    error.replaceChildren();
    const controlId =
      code && criterionEditor
        ? criterionEditor.showFailure(code, message)
        : undefined;
    if (controlId) {
      const summaryLink = document.createElement("a");
      summaryLink.href = "#" + controlId;
      summaryLink.textContent = message;
      error.replaceChildren(summaryLink);
    } else {
      error.textContent = message;
    }
  }

  /** @param {Review} review */
  function openReview(review) {
    clearErrors();
    result.textContent = "";
    reviews.set(review.id, review);
    renderReviewOptions(review.id);
    setControlValue("review-version-id", review.id);
    setControlValue(
      "review-version-applicability-rule",
      review.active_version.applicability_rule ?? "",
    );
    model.replaceChildren(...models.map(({ id }) => option(id)));
    model.value = review.active_version.codex_configuration.model;
    updateConfiguration(
      review.active_version.codex_configuration.reasoning_effort,
      review.active_version.codex_configuration.service_tier,
    );
    const criterionAuthoring =
      /** @type {{createCriterionEditor?: unknown}} */ (
        /** @type {Document & {qualityBarReviewCriteria?: unknown}} */ (
          document
        ).qualityBarReviewCriteria
      );
    if (typeof criterionAuthoring?.createCriterionEditor !== "function") {
      throw new Error("review_criterion_authoring_unavailable");
    }
    if (criterionEditor) {
      criterionEditor.reset(review.active_version.criteria);
    } else {
      criterionEditor = criterionAuthoring.createCriterionEditor(
        criteriaList,
        addCriterion,
        review.active_version.criteria,
      );
    }
    form.hidden = false;
    document.dispatchEvent(
      new CustomEvent("quality-bar:review-opened", { detail: review }),
    );
  }

  /**
   * @param {Submitted} submitted
   */
  function matchesSubmission(submitted) {
    if (!criterionEditor) {
      throw new Error("review_criterion_authoring_unavailable");
    }
    return (
      controlValue("review-version-id") === submitted.reviewId &&
      controlValue("review-version-applicability-rule") ===
        submitted.applicabilityRule &&
      model.value === submitted.configuration.model &&
      reasoningEffort.value === submitted.configuration.reasoningEffort &&
      serviceTier.value === submitted.configuration.serviceTier &&
      JSON.stringify(criterionEditor.read()) ===
        JSON.stringify(submitted.criteria)
    );
  }

  /**
   * @param {Submitted} submitted
   * @param {{code: string, message: string}} failure
   */
  function showSubmissionFailure(submitted, failure) {
    const current = matchesSubmission(submitted);
    showFailure(
      current
        ? failure.message
        : `Review ${submitted.reviewId}: ${failure.message}`,
      current ? failure.code : undefined,
    );
  }

  /**
   * @param {Response} response
   * @param {(failure: {code: string, message: string}) => void} [show]
   */
  async function redirectIfAuthenticationRequired(
    response,
    show = (failure) => showFailure(failure.message, failure.code),
  ) {
    if (response.status !== 401) {
      return false;
    }
    const failure = await readFailure(response);
    if (failure.code === "authentication_required") {
      location.assign(
        "/?return_to=" +
          encodeURIComponent(location.pathname + location.search),
      );
    } else {
      show(failure);
    }
    return true;
  }

  model.addEventListener("change", () => updateConfiguration());
  selector.addEventListener("change", () => {
    const review = reviews.get(selector.value);
    if (!review) {
      throw new Error("review_selection_invalid");
    }
    openReview(review);
  });
  document.addEventListener("quality-bar:system-loaded", async (event) => {
    if (!(event instanceof CustomEvent)) {
      throw new Error("system_loaded_event_invalid");
    }
    const catalog = /** @type {{catalog?: {models?: unknown}}} */ (event.detail)
      .catalog;
    if (
      !catalog ||
      !Array.isArray(catalog.models) ||
      catalog.models.length === 0
    ) {
      throw new Error("system_loaded_event_invalid");
    }
    models =
      /** @type {{id: string, reasoning_efforts: string[], service_tiers: string[]}[]} */ (
        catalog.models
      );
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
        throw new Error("Review Version response was invalid");
      }
      const listed = [];
      for (const value of body.reviews) {
        listed.push(requireReview(value));
      }
      for (const review of listed) {
        reviews.set(review.id, review);
      }
      if (listed[0]) {
        openReview(listed[0]);
      }
    } catch (caught) {
      if (!(caught instanceof Error)) {
        throw caught;
      }
      showFailure(caught.message);
    }
  });

  document.addEventListener("quality-bar:review-created", (event) => {
    if (!(event instanceof CustomEvent)) {
      throw new Error("review_created_event_invalid");
    }
    openReview(requireReview(event.detail));
  });

  document.addEventListener("quality-bar:review-reactivated", (event) => {
    if (
      !(event instanceof CustomEvent) ||
      typeof event.detail?.open !== "boolean"
    ) {
      throw new Error("review_reactivated_event_invalid");
    }
    const reactivated = requireSaveResult(event.detail.reactivated);
    reviews.set(reactivated.review.id, reactivated.review);
    if (event.detail.open) {
      openReview(reactivated.review);
      result.textContent =
        reactivated.review.name +
        " v" +
        reactivated.review.active_version.number +
        (reactivated.changed ? " active." : " unchanged.");
    } else {
      renderReviewOptions(selector.value);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (mutationPending) {
      return;
    }
    mutationPending = true;
    submit.disabled = true;
    announceMutation(true);
    clearErrors();
    result.textContent = "";
    const reviewId = controlValue("review-version-id");
    const review = reviews.get(reviewId);
    if (!review) {
      throw new Error("review_selection_invalid");
    }
    /** @type {Submitted | undefined} */
    let submitted;
    try {
      if (!criterionEditor) {
        throw new Error("review_criterion_authoring_unavailable");
      }
      const criteria = criterionEditor.read();
      const applicabilityRule = controlValue(
        "review-version-applicability-rule",
      );
      const currentSubmission = {
        applicabilityRule,
        configuration: {
          model: model.value,
          reasoningEffort: reasoningEffort.value,
          serviceTier: serviceTier.value,
        },
        criteria,
        reviewId,
      };
      submitted = currentSubmission;
      const validationFailure = criterionEditor.validate();
      if (validationFailure) {
        showFailure(validationFailure.message, validationFailure.code);
        return;
      }
      const response = await fetch(
        "/api/v1/reviews/" + encodeURIComponent(reviewId) + "/versions",
        {
          body: JSON.stringify({
            applicability_rule:
              applicabilityRule.length === 0 ? null : applicabilityRule,
            codex_configuration: {
              model: currentSubmission.configuration.model,
              reasoning_effort: currentSubmission.configuration.reasoningEffort,
              service_tier: currentSubmission.configuration.serviceTier,
            },
            criteria,
          }),
          headers: {
            "content-type": "application/json",
            "x-quality-bar-csrf": csrfToken(),
          },
          method: "POST",
        },
      );
      if (
        await redirectIfAuthenticationRequired(response, (failure) =>
          showSubmissionFailure(currentSubmission, failure),
        )
      ) {
        return;
      }
      if (!response.ok) {
        const failure = await readFailure(response);
        showSubmissionFailure(currentSubmission, failure);
        return;
      }
      const saved = requireSaveResult(await response.json());
      if (saved.review.id !== reviewId) {
        throw new Error("Review Version response was invalid");
      }
      reviews.set(saved.review.id, saved.review);
      if (matchesSubmission(currentSubmission)) {
        openReview(saved.review);
        result.textContent =
          saved.review.name +
          " v" +
          saved.review.active_version.number +
          (saved.changed ? " active." : " unchanged.");
      } else {
        renderReviewOptions(selector.value);
      }
    } catch (caught) {
      if (!(caught instanceof Error)) {
        throw caught;
      }
      if (submitted && !matchesSubmission(submitted)) {
        showFailure(`Review ${reviewId}: ${caught.message}`);
      } else {
        showFailure(caught.message);
      }
    } finally {
      mutationPending = false;
      submit.disabled = false;
      announceMutation(false);
    }
  });
}
