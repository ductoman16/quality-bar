{
  function readBrowserConfiguration() {
    const configuration = /** @type {HTMLScriptElement} */ (
      document.getElementById("browser-configuration")
    );
    if (configuration?.type !== "application/json") {
      throw new Error("browser_configuration_invalid");
    }
    const value = /** @type {{csrfCookieName?: unknown}} */ (
      JSON.parse(configuration.textContent)
    );
    if (
      !value ||
      typeof value.csrfCookieName !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(value.csrfCookieName)
    ) {
      throw new Error("browser_configuration_invalid");
    }
    return value.csrfCookieName;
  }

  /** @param {string} id */
  function requiredElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error("browser_control_unavailable");
    }
    return element;
  }

  /** @param {string} id */
  function controlValue(id) {
    const element = requiredElement(id);
    if (!("value" in element) || typeof element.value !== "string") {
      throw new Error("browser_control_unavailable");
    }
    return element.value;
  }

  /** @param {string} id @param {string} value */
  function setControlValue(id, value) {
    const element = requiredElement(id);
    if (!("value" in element)) {
      throw new Error("browser_control_unavailable");
    }
    element.value = value;
  }

  /** @param {unknown} value */
  function requireReview(value) {
    const review =
      /** @type {{id?: unknown, name?: unknown, active_version?: unknown}} */ (
        value
      );
    if (
      !review ||
      typeof review.id !== "string" ||
      typeof review.name !== "string" ||
      !review.active_version ||
      typeof review.active_version !== "object"
    ) {
      throw new Error("Review Version response was invalid");
    }
    const version =
      /** @type {{id?: unknown, number?: unknown, applicability_rule?: unknown, codex_configuration?: unknown, criteria?: unknown}} */ (
        review.active_version
      );
    const configuration =
      /** @type {{model?: unknown, reasoning_effort?: unknown, service_tier?: unknown}} */ (
        version.codex_configuration
      );
    if (
      typeof version.id !== "string" ||
      !Number.isSafeInteger(version.number) ||
      !(
        version.applicability_rule === null ||
        typeof version.applicability_rule === "string"
      ) ||
      !configuration ||
      typeof configuration.model !== "string" ||
      typeof configuration.reasoning_effort !== "string" ||
      typeof configuration.service_tier !== "string" ||
      !Array.isArray(version.criteria) ||
      version.criteria.length === 0 ||
      !version.criteria.every(
        (criterion) =>
          criterion &&
          typeof criterion === "object" &&
          "id" in criterion &&
          typeof criterion.id === "string" &&
          "impact" in criterion &&
          ["advisory", "blocking"].includes(
            /** @type {string} */ (criterion.impact),
          ) &&
          "instruction" in criterion &&
          typeof criterion.instruction === "string",
      )
    ) {
      throw new Error("Review Version response was invalid");
    }
    const completeReview = /** @type {{
     *   id: string,
     *   name: string,
     *   active_version: {
     *     id: string,
     *     number: number,
     *     applicability_rule: string | null,
     *     codex_configuration: {
     *       model: string,
     *       reasoning_effort: string,
     *       service_tier: string
     *     },
     *     criteria: Array<{id: string, impact: string, instruction: string}>
     *   }
     * }} */ (review);
    return completeReview;
  }

  /** @param {unknown} value */
  function requireSaveResult(value) {
    const result = /** @type {{changed?: unknown, review?: unknown}} */ (value);
    if (!result || typeof result.changed !== "boolean") {
      throw new Error("Review Version response was invalid");
    }
    return { changed: result.changed, review: requireReview(result.review) };
  }

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
  const submit = /** @type {HTMLButtonElement} */ (
    requiredElement("review-version-submit")
  );
  const result = requiredElement("review-version-result");
  const error = requiredElement("error");
  const csrfCookieName = readBrowserConfiguration();
  /** @type {Map<string, ReturnType<typeof requireReview>>} */
  const reviews = new Map();
  /** @type {{id: string, reasoning_efforts: string[], service_tiers: string[]}[]} */
  let models = [];
  let savePending = false;

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

  /** @param {ReturnType<typeof requireReview>} review */
  function openReview(review) {
    reviews.set(review.id, review);
    selector.replaceChildren(
      ...[...reviews.values()].map((candidate) => {
        const element = option(candidate.id);
        element.textContent = candidate.name;
        return element;
      }),
    );
    selector.value = review.id;
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
    form.hidden = false;
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

  /** @param {Response} response */
  async function readFailure(response) {
    const body = /** @type {{error?: {code?: unknown, message?: unknown}}} */ (
      await response.json()
    );
    const failure = body.error;
    if (
      !failure ||
      typeof failure.code !== "string" ||
      typeof failure.message !== "string"
    ) {
      throw new Error("Review Version response was invalid");
    }
    return { code: failure.code, message: failure.message };
  }

  /** @param {Response} response */
  async function redirectIfAuthenticationRequired(response) {
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
      error.textContent = failure.message;
      error.hidden = false;
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
        error.textContent = failure.message;
        error.hidden = false;
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
      error.textContent = caught.message;
      error.hidden = false;
    }
  });

  document.addEventListener("quality-bar:review-created", (event) => {
    if (!(event instanceof CustomEvent)) {
      throw new Error("review_created_event_invalid");
    }
    openReview(requireReview(event.detail));
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (savePending) {
      return;
    }
    savePending = true;
    submit.disabled = true;
    error.hidden = true;
    error.textContent = "";
    result.textContent = "";
    const reviewId = controlValue("review-version-id");
    const review = reviews.get(reviewId);
    if (!review) {
      throw new Error("review_selection_invalid");
    }
    try {
      const applicabilityRule = controlValue(
        "review-version-applicability-rule",
      );
      const response = await fetch(
        "/api/v1/reviews/" + encodeURIComponent(reviewId) + "/versions",
        {
          body: JSON.stringify({
            applicability_rule:
              applicabilityRule.length === 0 ? null : applicabilityRule,
            codex_configuration: {
              model: model.value,
              reasoning_effort: reasoningEffort.value,
              service_tier: serviceTier.value,
            },
            criteria: review.active_version.criteria.map(
              ({ id, impact, instruction }) => ({ id, impact, instruction }),
            ),
          }),
          headers: {
            "content-type": "application/json",
            "x-quality-bar-csrf": csrfToken(),
          },
          method: "POST",
        },
      );
      if (await redirectIfAuthenticationRequired(response)) {
        return;
      }
      if (!response.ok) {
        const failure = await readFailure(response);
        error.textContent = failure.message;
        error.hidden = false;
        return;
      }
      const saved = requireSaveResult(await response.json());
      if (saved.review.id !== reviewId) {
        throw new Error("Review Version response was invalid");
      }
      openReview(saved.review);
      result.textContent =
        saved.review.name +
        " v" +
        saved.review.active_version.number +
        (saved.changed ? " active." : " unchanged.");
    } catch (caught) {
      if (!(caught instanceof Error)) {
        throw caught;
      }
      error.textContent = caught.message;
      error.hidden = false;
    } finally {
      savePending = false;
      submit.disabled = false;
    }
  });
}
