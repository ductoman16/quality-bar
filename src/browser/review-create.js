{
  const form = /** @type {HTMLFormElement} */ (
    document.getElementById("review-create-form")
  );
  const error = requiredElement("error");
  const addCriterionButton = requiredElement("review-add-criterion");
  /** @type {string | undefined} */
  let csrfCookieName;

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
    const control = document.getElementById(id);
    if (
      !control ||
      !("value" in control) ||
      typeof control.value !== "string"
    ) {
      throw new Error("browser_control_unavailable");
    }
    return control.value;
  }

  /** @param {Element} parent @param {string} selector */
  function requiredDescendant(parent, selector) {
    const element = parent.querySelector(selector);
    if (!element) {
      throw new Error("browser_control_unavailable");
    }
    return element;
  }

  /** @param {boolean} disabled */
  function setControlsDisabled(disabled) {
    form
      .querySelectorAll("button, input, select, textarea")
      .forEach((control) => {
        if ("disabled" in control) {
          control.disabled = disabled;
        }
      });
  }

  function updateCriterionLabels() {
    document.querySelectorAll("#review-criteria li").forEach((item, index) => {
      requiredDescendant(item, "label[for$='-instruction']").textContent =
        "Criterion " + (index + 1) + " instruction";
      requiredDescendant(item, "label[for$='-impact']").textContent =
        "Criterion " + (index + 1) + " impact";
      const removeButton = /** @type {HTMLButtonElement} */ (
        requiredDescendant(item, "button")
      );
      removeButton.textContent = "−";
      removeButton.ariaLabel = "Remove Criterion " + (index + 1);
      removeButton.title = "Remove Criterion " + (index + 1);
    });
  }

  function addCriterion() {
    const criteria = requiredElement("review-criteria");
    const index = criteria.children.length + 1;
    const item = document.createElement("li");
    const instructionLabel = document.createElement("label");
    const instruction = document.createElement("textarea");
    instruction.id = "review-criterion-" + index + "-instruction";
    instruction.required = true;
    instructionLabel.htmlFor = instruction.id;
    const impactLabel = document.createElement("label");
    const impact = document.createElement("select");
    impact.id = "review-criterion-" + index + "-impact";
    impact.innerHTML =
      '<option value="advisory">Advisory</option><option value="blocking">Blocking</option>';
    impactLabel.htmlFor = impact.id;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.title = "Remove criterion";
    remove.addEventListener("click", () => {
      item.remove();
      updateCriterionLabels();
    });
    item.append(instructionLabel, instruction, impactLabel, impact, remove);
    criteria.append(item);
    updateCriterionLabels();
  }

  /** @param {{models: {id: string, reasoning_efforts: string[], service_tiers: string[]}[]}} catalog */
  function configureModels(catalog) {
    const model = /** @type {HTMLSelectElement} */ (
      requiredElement("review-model")
    );
    const reasoningEffort = /** @type {HTMLSelectElement} */ (
      requiredElement("review-reasoning-effort")
    );
    const serviceTier = /** @type {HTMLSelectElement} */ (
      requiredElement("review-service-tier")
    );
    /** @param {string} value */
    function option(value) {
      const element = document.createElement("option");
      element.value = value;
      element.textContent = value;
      return element;
    }
    function updateConfiguration() {
      const capability = catalog.models.find(
        (candidate) => candidate.id === model.value,
      );
      if (!capability) {
        throw new Error("Review model capability is unavailable");
      }
      reasoningEffort.replaceChildren(
        ...capability.reasoning_efforts.map(option),
      );
      serviceTier.replaceChildren(...capability.service_tiers.map(option));
    }
    model.replaceChildren(
      ...catalog.models.map((capability) => option(capability.id)),
    );
    model.addEventListener("change", updateConfiguration);
    updateConfiguration();
    setControlsDisabled(false);
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

  document.addEventListener("quality-bar:system-loaded", (event) => {
    if (!(event instanceof CustomEvent)) {
      throw new Error("system_loaded_event_invalid");
    }
    const system =
      /** @type {{csrfCookieName?: unknown, catalog?: unknown}} */ (
        event.detail
      );
    if (
      typeof system.csrfCookieName !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(system.csrfCookieName) ||
      !system.catalog ||
      typeof system.catalog !== "object"
    ) {
      throw new Error("system_loaded_event_invalid");
    }
    csrfCookieName = system.csrfCookieName;
    configureModels(
      /** @type {{models: {id: string, reasoning_efforts: string[], service_tiers: string[]}[]}} */ (
        system.catalog
      ),
    );
  });

  addCriterionButton.addEventListener("click", addCriterion);
  setControlsDisabled(true);
  addCriterion();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    const response = await fetch("/api/v1/reviews", {
      body: JSON.stringify({
        assignment: { scope: "installation_wide" },
        codex_configuration: {
          model: controlValue("review-model"),
          reasoning_effort: controlValue("review-reasoning-effort"),
          service_tier: controlValue("review-service-tier"),
        },
        criteria: [...document.querySelectorAll("#review-criteria li")].map(
          (item) => ({
            impact: /** @type {HTMLSelectElement} */ (
              requiredDescendant(item, "select")
            ).value,
            instruction: /** @type {HTMLTextAreaElement} */ (
              requiredDescendant(item, "textarea")
            ).value,
          }),
        ),
        description: controlValue("review-description"),
        name: controlValue("review-name"),
      }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": csrfToken(),
      },
      method: "POST",
    });
    if (!response.ok) {
      const body = /** @type {{error: {message: string}}} */ (
        await response.json()
      );
      error.textContent = body.error.message;
      error.hidden = false;
      return;
    }
    const review =
      /** @type {{name: string, active_version: {number: number}}} */ (
        await response.json()
      );
    requiredElement("review-create-result").textContent =
      review.name + " v" + review.active_version.number + " created.";
    document.dispatchEvent(
      new CustomEvent("quality-bar:review-created", { detail: review }),
    );
  });
}
