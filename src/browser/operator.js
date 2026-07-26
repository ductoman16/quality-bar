function readBrowserConfiguration() {
  const configuration = /** @type {HTMLScriptElement} */ (
    document.getElementById("browser-configuration")
  );
  if (configuration?.type !== "application/json") {
    throw new Error("browser_configuration_invalid");
  }
  try {
    const value = JSON.parse(configuration.textContent);
    if (
      !value ||
      typeof value.csrfCookieName !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(value.csrfCookieName)
    ) {
      throw new Error("browser_configuration_invalid");
    }
    return value;
  } catch (error) {
    if (error.message === "browser_configuration_invalid") {
      throw error;
    }
    throw new Error("browser_configuration_invalid", { cause: error });
  }
}

const error = document.getElementById("error");
const { csrfCookieName } = readBrowserConfiguration();
let lastActivityAt = 0;
const reviewForm = document.getElementById("review-create-form");
function controlValue(id) {
  const control = document.getElementById(id);
  if (!control || !("value" in control) || typeof control.value !== "string") {
    throw new Error("browser_control_unavailable");
  }
  return control.value;
}
function setReviewControlsDisabled(disabled) {
  reviewForm
    ?.querySelectorAll("button, input, select, textarea")
    .forEach((control) => {
      if ("disabled" in control) {
        control.disabled = disabled;
      }
    });
}
function updateCriterionLabels() {
  document.querySelectorAll("#review-criteria li").forEach((item, index) => {
    const number = index + 1;
    item.querySelector("label[for$='-instruction']").textContent =
      "Criterion " + number + " instruction";
    item.querySelector("label[for$='-impact']").textContent =
      "Criterion " + number + " impact";
    item.querySelector("button").textContent = "Remove Criterion " + number;
  });
}
function addCriterion() {
  const criteria = document.getElementById("review-criteria");
  if (!criteria) {
    throw new Error("Review criteria container is unavailable");
  }
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
  remove.addEventListener("click", () => {
    item.remove();
    updateCriterionLabels();
  });
  item.append(instructionLabel, instruction, impactLabel, impact, remove);
  criteria.append(item);
  updateCriterionLabels();
}
function configureReviewModels(catalog) {
  const model = /** @type {HTMLSelectElement} */ (
    document.getElementById("review-model")
  );
  const reasoningEffort = /** @type {HTMLSelectElement} */ (
    document.getElementById("review-reasoning-effort")
  );
  const serviceTier = /** @type {HTMLSelectElement} */ (
    document.getElementById("review-service-tier")
  );
  if (!model || !reasoningEffort || !serviceTier) {
    throw new Error("Review configuration controls are unavailable");
  }
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
  setReviewControlsDisabled(false);
}
function csrfToken() {
  return document.cookie
    .split(";")
    .map((cookie) => cookie.trim().split("=", 2))
    .find(([name]) => name === csrfCookieName)?.[1];
}
async function returnToLoginAfterAuthenticationFailure(response) {
  if (response.status !== 401) {
    return null;
  }
  const body = await response.json();
  if (body.error.code !== "authentication_required") {
    return body;
  }
  location.assign(
    "/?return_to=" + encodeURIComponent(location.pathname + location.search),
  );
  return true;
}
async function submitPasswordMutation(path, body) {
  error.hidden = true;
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-quality-bar-csrf": csrfToken(),
    },
    method: "POST",
  });
  if (response.ok) {
    location.assign("/");
    return;
  }
  const authenticationFailure =
    await returnToLoginAfterAuthenticationFailure(response);
  if (authenticationFailure === true) {
    return;
  }
  error.textContent = (
    authenticationFailure ?? (await response.json())
  ).error.message;
  error.hidden = false;
}
async function submitImplementerTokenMutation(path, body) {
  error.hidden = true;
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-quality-bar-csrf": csrfToken(),
    },
    method: "POST",
  });
  if (response.ok) {
    const token = (await response.json()).token;
    if (typeof token === "string") {
      document.getElementById("implementer-token-value").textContent = token;
      /** @type {HTMLDialogElement} */ (
        document.getElementById("implementer-token-reveal")
      ).showModal();
    }
    return;
  }
  const authenticationFailure =
    await returnToLoginAfterAuthenticationFailure(response);
  if (authenticationFailure === true) {
    return;
  }
  error.textContent = (
    authenticationFailure ?? (await response.json())
  ).error.message;
  error.hidden = false;
}
async function recordBrowserActivity() {
  const now = Date.now();
  if (now - lastActivityAt < 60_000) {
    return;
  }
  lastActivityAt = now;
  const response = await fetch("/api/v1/session/activity", {
    headers: { "x-quality-bar-csrf": csrfToken() },
    method: "POST",
  });
  if (response.ok) {
    return;
  }
  const authenticationFailure =
    await returnToLoginAfterAuthenticationFailure(response);
  if (authenticationFailure === true) {
    return;
  }
  error.textContent = (
    authenticationFailure ?? (await response.json())
  ).error.message;
  error.hidden = false;
}
document.addEventListener("keydown", recordBrowserActivity);
document.addEventListener("pointerdown", recordBrowserActivity);
document
  .getElementById("password-change-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitPasswordMutation("/api/v1/session/password", {
      current_password: controlValue("password-change-current-password"),
      new_password: controlValue("password-change-new-password"),
    });
  });
document
  .getElementById("session-revocation-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitPasswordMutation("/api/v1/sessions/revoke", {
      confirmation: controlValue("session-revocation-confirmation"),
      password: controlValue("session-revocation-password"),
    });
  });
document
  .getElementById("implementer-token-create-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitImplementerTokenMutation("/api/v1/implementer-token", {
      password: controlValue("implementer-token-create-password"),
    });
  });
document
  .getElementById("implementer-token-rotate-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitImplementerTokenMutation("/api/v1/implementer-token/rotate", {
      password: controlValue("implementer-token-rotate-password"),
    });
  });
document
  .getElementById("implementer-token-revoke-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    if (
      !window.confirm(
        "Revoke implementer token? Machine access will remain disabled until a new token is created.",
      )
    ) {
      return;
    }
    await submitPasswordMutation("/api/v1/implementer-token/revoke", {
      password: controlValue("implementer-token-revoke-password"),
    });
  });
if (reviewForm) {
  const addCriterionButton = document.getElementById("review-add-criterion");
  if (!addCriterionButton) {
    throw new Error("Review Criterion control is unavailable");
  }
  addCriterionButton.addEventListener("click", addCriterion);
  setReviewControlsDisabled(true);
  addCriterion();
  reviewForm.addEventListener("submit", async (event) => {
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
            impact: item.querySelector("select").value,
            instruction: item.querySelector("textarea").value,
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
    if (response.ok) {
      const review = await response.json();
      document.getElementById("review-create-result").textContent =
        review.name + " v" + review.active_version.number + " created.";
      return;
    }
    const authenticationFailure =
      await returnToLoginAfterAuthenticationFailure(response);
    if (authenticationFailure === true) {
      return;
    }
    error.textContent = (
      authenticationFailure ?? (await response.json())
    ).error.message;
    error.hidden = false;
  });
}
document
  .getElementById("implementer-token-reveal-close")
  .addEventListener("click", () => {
    /** @type {HTMLDialogElement} */ (
      document.getElementById("implementer-token-reveal")
    ).close();
  });
document
  .getElementById("implementer-token-reveal")
  .addEventListener("close", () => {
    document.getElementById("implementer-token-value").textContent = "";
  });
document.getElementById("logout").addEventListener("click", async () => {
  error.hidden = true;
  const response = await fetch("/api/v1/session/logout", {
    headers: { "x-quality-bar-csrf": csrfToken() },
    method: "POST",
  });
  if (response.ok) {
    location.assign("/");
    return;
  }
  const authenticationFailure =
    await returnToLoginAfterAuthenticationFailure(response);
  if (authenticationFailure === true) {
    return;
  }
  error.textContent = (
    authenticationFailure ?? (await response.json())
  ).error.message;
  error.hidden = false;
});
const systemFacts = document.getElementById("system-facts");
fetch("/api/v1/system")
  .then(async (response) => {
    if (!response.ok) {
      throw new Error((await response.json()).error.message);
    }
    const system = await response.json();
    if (reviewForm) {
      configureReviewModels(system.codex.catalog);
    }
    if (systemFacts) {
      const codexModels = system.codex.catalog.models
        .map(
          (model) =>
            model.id +
            " (" +
            model.reasoning_efforts.join(", ") +
            "; " +
            model.service_tiers.join(", ") +
            ")",
        )
        .join(". ");
      systemFacts.textContent =
        "Bootstrap: " +
        system.bootstrap.status +
        ". Durable core: " +
        system.durable_core.status +
        ". Codex: " +
        system.codex.status +
        (system.codex.error ? " (" + system.codex.error + ")" : "") +
        ". Models: " +
        codexModels +
        ". Browser sessions: " +
        system.browser_sessions.active_count +
        ". Implementer token: " +
        system.implementer_token.status +
        ".";
    }
    const attention = document.getElementById("attention");
    if (system.codex.status === "unavailable") {
      attention.hidden = false;
      attention.textContent = "Codex unavailable";
    }
  })
  .catch((failure) => {
    error.textContent = failure.message;
    error.hidden = false;
  });
