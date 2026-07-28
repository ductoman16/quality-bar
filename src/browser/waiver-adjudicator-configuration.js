{
  const browserConfigurationElement = /** @type {HTMLScriptElement} */ (
    document.getElementById("browser-configuration")
  );
  if (browserConfigurationElement?.type !== "application/json") {
    throw new Error("browser_configuration_invalid");
  }
  /** @type {{csrfCookieName: string}} */
  let browserConfiguration;
  try {
    const parsed = /** @type {{csrfCookieName?: unknown}} */ (
      JSON.parse(browserConfigurationElement.textContent)
    );
    if (typeof parsed.csrfCookieName !== "string") {
      throw new Error("browser_configuration_invalid");
    }
    browserConfiguration = { csrfCookieName: parsed.csrfCookieName };
  } catch (error) {
    throw new Error("browser_configuration_invalid", { cause: error });
  }
  /** @param {string} id */
  function requiredElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(
        `waiver_adjudicator_configuration_element_missing: ${id}`,
      );
    }
    return element;
  }

  const form = /** @type {HTMLFormElement} */ (
    requiredElement("waiver-adjudicator-configuration-form")
  );
  const model = /** @type {HTMLSelectElement} */ (
    requiredElement("waiver-adjudicator-model")
  );
  const reasoningEffort = /** @type {HTMLSelectElement} */ (
    requiredElement("waiver-adjudicator-reasoning-effort")
  );
  const serviceTier = /** @type {HTMLSelectElement} */ (
    requiredElement("waiver-adjudicator-service-tier")
  );
  const submit = /** @type {HTMLButtonElement} */ (
    requiredElement("waiver-adjudicator-configuration-submit")
  );
  const status = /** @type {HTMLOutputElement} */ (
    requiredElement("waiver-adjudicator-configuration-status")
  );
  const error = /** @type {HTMLParagraphElement} */ (
    requiredElement("waiver-adjudicator-configuration-error")
  );

  /** @type {{id: string, reasoning_efforts: string[], service_tiers: string[]}[]} */
  let capabilities = [];

  /** @param {string} value */
  function option(value) {
    const element = document.createElement("option");
    element.value = value;
    element.textContent = value;
    return element;
  }

  /**
   * @param {unknown} value
   * @returns {value is {models: {id: string, reasoning_efforts: string[], service_tiers: string[]}[]}}
   */
  function isCatalog(value) {
    if (!value || typeof value !== "object" || !("models" in value)) {
      return false;
    }
    const models = /** @type {{models?: unknown}} */ (value).models;
    return (
      Array.isArray(models) &&
      models.length > 0 &&
      models.every(
        (capability) =>
          capability &&
          typeof capability === "object" &&
          "id" in capability &&
          typeof capability.id === "string" &&
          "reasoning_efforts" in capability &&
          Array.isArray(capability.reasoning_efforts) &&
          capability.reasoning_efforts.length > 0 &&
          capability.reasoning_efforts.every(
            (/** @type {unknown} */ effort) => typeof effort === "string",
          ) &&
          "service_tiers" in capability &&
          Array.isArray(capability.service_tiers) &&
          capability.service_tiers.length > 0 &&
          capability.service_tiers.every(
            (/** @type {unknown} */ tier) => typeof tier === "string",
          ),
      )
    );
  }

  function clearCompatibility() {
    reasoningEffort.replaceChildren(option(""));
    reasoningEffort.value = "";
    reasoningEffort.disabled = true;
    serviceTier.replaceChildren(option(""));
    serviceTier.value = "";
    serviceTier.disabled = true;
  }

  /** @param {string} [reasoning] @param {string} [tier] */
  function updateCompatibility(reasoning, tier) {
    const capability = capabilities.find(({ id }) => id === model.value);
    if (!capability) {
      throw new Error("waiver_adjudicator_model_invalid");
    }
    reasoningEffort.replaceChildren(
      option(""),
      ...capability.reasoning_efforts.map((effort) => option(effort)),
    );
    serviceTier.replaceChildren(
      option(""),
      ...capability.service_tiers.map((tier) => option(tier)),
    );
    reasoningEffort.disabled = false;
    serviceTier.disabled = false;
    if (reasoning === undefined && tier === undefined) {
      reasoningEffort.value = "";
      serviceTier.value = "";
      return;
    }
    if (
      reasoning === undefined ||
      tier === undefined ||
      !capability.reasoning_efforts.includes(reasoning) ||
      !capability.service_tiers.includes(tier)
    ) {
      throw new Error("waiver_adjudicator_configuration_response_invalid");
    }
    reasoningEffort.value = reasoning;
    serviceTier.value = tier;
  }

  model.addEventListener("change", () => {
    if (model.value === "") {
      clearCompatibility();
      return;
    }
    updateCompatibility();
  });

  function csrfToken() {
    const prefix = browserConfiguration.csrfCookieName + "=";
    const value = document.cookie
      .split(";")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(prefix))
      ?.slice(prefix.length);
    if (!value) {
      throw new Error("csrf_token_missing");
    }
    return value;
  }

  /** @param {Response} response */
  async function responseBody(response) {
    let body;
    try {
      body = /** @type {unknown} */ (await response.json());
    } catch (cause) {
      throw new Error("waiver_adjudicator_configuration_response_invalid", {
        cause,
      });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("waiver_adjudicator_configuration_response_invalid");
    }
    return /** @type {Record<string, any>} */ (body);
  }

  /** @param {Record<string, any>} body */
  function responseFailure(body) {
    if (
      !body.error ||
      typeof body.error !== "object" ||
      typeof body.error.code !== "string" ||
      typeof body.error.message !== "string"
    ) {
      throw new Error("waiver_adjudicator_configuration_response_invalid");
    }
    return /** @type {{code: string, message: string}} */ (body.error);
  }

  /** @param {string} code */
  function owningControl(code) {
    if (code === "codex_model_unsupported") {
      return model;
    }
    if (code === "codex_reasoning_effort_unsupported") {
      return reasoningEffort;
    }
    if (code === "codex_service_tier_unsupported") {
      return serviceTier;
    }
    return null;
  }

  /** @param {string} code */
  function focusOwningControl(code) {
    (owningControl(code) ?? error).focus();
  }

  /**
   * @param {string} code
   * @param {string} message
   * @param {HTMLElement} [focusTarget]
   */
  function displayFailure(code, message, focusTarget) {
    status.textContent = "Failed";
    error.textContent = `${code}: ${message}`;
    error.hidden = false;
    if (focusTarget) {
      focusTarget.focus();
    } else {
      focusOwningControl(code);
    }
  }

  /** @param {unknown} caught */
  function displayRequestFailure(caught) {
    const message =
      caught &&
      typeof caught === "object" &&
      "message" in caught &&
      typeof caught.message === "string"
        ? caught.message
        : "Waiver Adjudicator Configuration request failed";
    displayFailure(
      message === "waiver_adjudicator_configuration_response_invalid"
        ? message
        : "waiver_adjudicator_configuration_request_failed",
      message,
    );
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = "Saving";
    error.hidden = true;
    try {
      const response = await fetch("/api/v1/waiver-adjudicator-configuration", {
        body: JSON.stringify({
          model: model.value,
          reasoning_effort: reasoningEffort.value,
          service_tier: serviceTier.value,
        }),
        headers: {
          "content-type": "application/json",
          "x-quality-bar-csrf": csrfToken(),
        },
        method: "PATCH",
      });
      const body = await responseBody(response);
      if (!response.ok) {
        const failure = responseFailure(body);
        displayFailure(failure.code, failure.message);
        return;
      }
      if (
        typeof body.changed !== "boolean" ||
        !body.configuration ||
        typeof body.configuration !== "object"
      ) {
        throw new Error("waiver_adjudicator_configuration_response_invalid");
      }
      model.value = body.configuration.model;
      updateCompatibility(
        body.configuration.reasoning_effort,
        body.configuration.service_tier,
      );
      status.textContent = body.changed ? "Saved" : "Unchanged";
    } catch (caught) {
      displayRequestFailure(caught);
    } finally {
      submit.disabled = false;
    }
  });

  document.addEventListener("quality-bar:system-loaded", async (event) => {
    if (
      !(event instanceof CustomEvent) ||
      !event.detail ||
      typeof event.detail !== "object" ||
      !("catalog" in event.detail) ||
      !isCatalog(event.detail.catalog)
    ) {
      throw new Error("system_loaded_event_invalid");
    }
    capabilities = event.detail.catalog.models;
    model.replaceChildren(
      option(""),
      ...capabilities.map(({ id }) => option(id)),
    );
    model.value = "";
    model.disabled = true;
    submit.disabled = true;
    clearCompatibility();
    form.hidden = false;
    status.textContent = "Loading";
    error.hidden = true;
    try {
      const response = await fetch("/api/v1/waiver-adjudicator-configuration");
      const body = await responseBody(response);
      if (!response.ok) {
        const failure = responseFailure(body);
        if (owningControl(failure.code)) {
          model.disabled = false;
          submit.disabled = false;
          displayFailure(failure.code, failure.message, model);
        } else {
          displayFailure(failure.code, failure.message);
        }
        return;
      }
      if (body.configured === true && body.configuration) {
        model.value = body.configuration.model;
        updateCompatibility(
          body.configuration.reasoning_effort,
          body.configuration.service_tier,
        );
        status.textContent = "Configured";
      } else if (body.configured === false) {
        status.textContent = "Not configured";
      } else {
        throw new Error("waiver_adjudicator_configuration_response_invalid");
      }
      model.disabled = false;
      submit.disabled = false;
    } catch (caught) {
      displayRequestFailure(caught);
    }
  });
}
