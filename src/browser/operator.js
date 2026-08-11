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

const error = requiredElement("error");
const { csrfCookieName } = readBrowserConfiguration();
let lastActivityAt = 0;
/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function requiredElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error("browser_control_unavailable");
  }
  return element;
}
/**
 * @param {string} id
 * @returns {string}
 */
function controlValue(id) {
  const control = document.getElementById(id);
  if (!control || !("value" in control) || typeof control.value !== "string") {
    throw new Error("browser_control_unavailable");
  }
  return control.value;
}
/**
 * @typedef {{
 *   id: string,
 *   reasoning_efforts: string[],
 *   service_tiers: string[]
 * }} ModelCapability
 */

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
/**
 * @typedef {{ error: { code: string, message: string } }} ApiErrorResponse
 */

/** @param {Response} response */
async function returnToLoginAfterAuthenticationFailure(response) {
  if (response.status !== 401) {
    return null;
  }
  const body = /** @type {ApiErrorResponse} */ (await response.json());
  if (body.error.code !== "authentication_required") {
    return body;
  }
  location.assign(
    "/?return_to=" + encodeURIComponent(location.pathname + location.search),
  );
  return true;
}
/** @param {Response} response */
async function displayMutationFailure(response) {
  const authenticationFailure =
    await returnToLoginAfterAuthenticationFailure(response);
  if (authenticationFailure === true) {
    return;
  }
  const body =
    authenticationFailure ??
    /** @type {ApiErrorResponse} */ (await response.json());
  error.textContent = body.error.message;
  error.hidden = false;
}

async function readRepositoryCollection() {
  /** @type {unknown[]} */
  const items = [];
  const seenCursors = new Set();
  let path = "/api/v1/repositories";
  while (true) {
    const response = await fetch(path);
    if (!response.ok) {
      return { failure: response, items: [] };
    }
    const body = /** @type {{
     *   items?: unknown,
     *   next_cursor?: unknown
     * }} */ (await response.json());
    if (
      !Array.isArray(body.items) ||
      (body.next_cursor !== null &&
        (typeof body.next_cursor !== "string" || body.next_cursor.length === 0))
    ) {
      throw new Error("repository_collection_invalid");
    }
    items.push(...body.items);
    if (body.next_cursor === null) {
      return { failure: null, items };
    }
    if (seenCursors.has(body.next_cursor)) {
      throw new Error("repository_collection_invalid");
    }
    seenCursors.add(body.next_cursor);
    path =
      "/api/v1/repositories?cursor=" + encodeURIComponent(body.next_cursor);
  }
}

Object.assign(window, {
  qualityBarOperator: Object.freeze({
    csrfToken,
    displayMutationFailure,
    error,
    readRepositoryCollection,
    requiredElement,
  }),
});
/**
 * @param {string} path
 * @param {{
 *   confirmation?: string,
 *   current_password?: string,
 *   new_password?: string,
 *   password?: string
 * }} body
 */
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
  await displayMutationFailure(response);
}
/**
 * @param {string} path
 * @param {{ password: string }} body
 */
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
    const { token } = /** @type {{ token?: unknown }} */ (
      await response.json()
    );
    if (typeof token === "string") {
      requiredElement("implementer-token-value").textContent = token;
      /** @type {HTMLDialogElement} */ (
        document.getElementById("implementer-token-reveal")
      ).showModal();
    }
    return;
  }
  await displayMutationFailure(response);
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
  await displayMutationFailure(response);
}
/**
 * @param {string} id
 * @param {() => Promise<void>} submit
 */
function onSubmit(id, submit) {
  requiredElement(id).addEventListener("submit", async (event) => {
    event.preventDefault();
    await submit();
  });
}
document.addEventListener("keydown", recordBrowserActivity);
document.addEventListener("pointerdown", recordBrowserActivity);
onSubmit("password-change-form", () =>
  submitPasswordMutation("/api/v1/session/password", {
    current_password: controlValue("password-change-current-password"),
    new_password: controlValue("password-change-new-password"),
  }),
);
onSubmit("session-revocation-form", () =>
  submitPasswordMutation("/api/v1/sessions/revoke", {
    confirmation: controlValue("session-revocation-confirmation"),
    password: controlValue("session-revocation-password"),
  }),
);
onSubmit("implementer-token-create-form", () =>
  submitImplementerTokenMutation("/api/v1/implementer-token", {
    password: controlValue("implementer-token-create-password"),
  }),
);
onSubmit("implementer-token-rotate-form", () =>
  submitImplementerTokenMutation("/api/v1/implementer-token/rotate", {
    password: controlValue("implementer-token-rotate-password"),
  }),
);
requiredElement("implementer-token-revoke-form").addEventListener(
  "submit",
  async (event) => {
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
  },
);
requiredElement("implementer-token-reveal-close").addEventListener(
  "click",
  () => {
    /** @type {HTMLDialogElement} */ (
      document.getElementById("implementer-token-reveal")
    ).close();
  },
);
requiredElement("implementer-token-reveal").addEventListener("close", () => {
  requiredElement("implementer-token-value").textContent = "";
});

function createOnboardingControls() {
  const logout = requiredElement("logout");
  if (typeof (/** @type {any} */ (logout).before) !== "function") {
    return;
  }
  const section = document.createElement("section");
  const heading = document.createElement("h2");
  heading.id = "onboarding-tokens-title";
  heading.textContent = "Onboarding tokens";
  section.setAttribute("aria-labelledby", heading.id);
  const form = document.createElement("form");
  form.id = "onboarding-token-create-form";
  const label = document.createElement("label");
  label.htmlFor = "onboarding-token-repository-url";
  label.textContent = "Repository URL";
  const input = document.createElement("input");
  input.id = label.htmlFor;
  input.name = "repository_url";
  input.required = true;
  input.type = "url";
  const submit = document.createElement("button");
  submit.textContent = "Create onboarding token";
  submit.type = "submit";
  form.append(label, input, submit);
  const table = document.createElement("table");
  const header = table.createTHead().insertRow();
  for (const name of ["Repository", "Expires", "Action"]) {
    const cell = document.createElement("th");
    cell.textContent = name;
    header.append(cell);
  }
  const list = table.createTBody();
  list.id = "onboarding-token-list";
  section.append(heading, form, table);
  logout.before(section);

  const dialog = document.createElement("dialog");
  dialog.id = "onboarding-token-reveal";
  const dialogHeading = document.createElement("h2");
  dialogHeading.id = "onboarding-token-reveal-title";
  dialogHeading.textContent = "Onboarding token";
  dialog.setAttribute("aria-labelledby", dialogHeading.id);
  const value = document.createElement("output");
  value.id = "onboarding-token-value";
  const warning = document.createElement("p");
  warning.role = "status";
  warning.textContent = "Shown once.";
  const close = document.createElement("button");
  close.textContent = "Done";
  close.type = "button";
  dialog.append(dialogHeading, value, warning, close);
  requiredElement("implementer-token-reveal").after(dialog);
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    value.textContent = "";
  });

  async function loadTokens() {
    const response = await fetch("/api/v1/onboarding-tokens");
    if (!response.ok) {
      await displayMutationFailure(response);
      return;
    }
    const body =
      /** @type {{onboarding_tokens: Array<{id: string, repository_url: string, expires_at: number}>}} */ (
        await response.json()
      );
    list.replaceChildren();
    for (const token of body.onboarding_tokens) {
      const row = list.insertRow();
      row.insertCell().textContent = token.repository_url;
      row.insertCell().textContent = new Date(
        token.expires_at,
      ).toLocaleString();
      const revoke = document.createElement("button");
      revoke.textContent = "Revoke";
      revoke.type = "button";
      revoke.addEventListener("click", async () => {
        const response = await fetch(
          `/api/v1/onboarding-tokens/${encodeURIComponent(token.id)}`,
          {
            body: "{}",
            headers: {
              "content-type": "application/json",
              "x-quality-bar-csrf": csrfToken(),
            },
            method: "DELETE",
          },
        );
        if (response.ok) {
          await loadTokens();
        } else {
          await displayMutationFailure(response);
        }
      });
      row.insertCell().append(revoke);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const response = await fetch("/api/v1/onboarding-tokens", {
      body: JSON.stringify({ repository_url: input.value }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": csrfToken(),
      },
      method: "POST",
    });
    if (!response.ok) {
      await displayMutationFailure(response);
      return;
    }
    value.textContent = /** @type {{token: string}} */ (
      await response.json()
    ).token;
    form.reset();
    dialog.showModal();
    await loadTokens();
  });
  void loadTokens();
}

requiredElement("logout").addEventListener("click", async () => {
  error.hidden = true;
  const response = await fetch("/api/v1/session/logout", {
    headers: { "x-quality-bar-csrf": csrfToken() },
    method: "POST",
  });
  if (response.ok) {
    location.assign("/");
    return;
  }
  await displayMutationFailure(response);
});
const systemFacts = document.getElementById("system-facts");
if (systemFacts) {
  createOnboardingControls();
}

/** @param {string} value */
function humanizeStatus(value) {
  if (typeof value !== "string" || value.length === 0) {
    return "Unknown";
  }
  const spaced = value.replace(/_/g, " ");
  return spaced[0].toUpperCase() + spaced.slice(1);
}

/**
 * Populate the System health strip with status marks. Runs on every operator
 * page but no-ops unless the strip is present (the System view), reading the
 * same /api/v1/system payload the detail bands consume.
 * @param {any} system
 */
function renderSystemHealth(system) {
  const strip = document.getElementById("system-health");
  if (!strip) {
    return;
  }
  const providers = Array.isArray(system?.execution_providers)
    ? system.execution_providers
    : [];
  const codexOk =
    providers.length > 0 &&
    providers.every(
      (/** @type {any} */ provider) => provider?.status === "available",
    );
  const backupStatus = system?.backup?.status;
  const migrationStatus = system?.migration?.status;
  /** @type {Array<[string, "ok" | "warn" | "idle", string]>} */
  const tiles = [
    ["codex", codexOk ? "ok" : "warn", codexOk ? "Available" : "Unavailable"],
    [
      "durable",
      system?.durable_core?.status === "ready" ? "ok" : "warn",
      humanizeStatus(system?.durable_core?.status),
    ],
    [
      "storage",
      system?.storage?.status === "available" ? "ok" : "warn",
      humanizeStatus(system?.storage?.status),
    ],
    [
      "backups",
      backupStatus === "current"
        ? "ok"
        : backupStatus === "empty"
          ? "idle"
          : "warn",
      humanizeStatus(backupStatus),
    ],
    [
      "migration",
      migrationStatus === "completed" || migrationStatus === "not_required"
        ? "ok"
        : "warn",
      humanizeStatus(migrationStatus),
    ],
    [
      "bootstrap",
      system?.bootstrap?.status === "complete" ? "ok" : "warn",
      humanizeStatus(system?.bootstrap?.status),
    ],
  ];
  for (const [id, state, value] of tiles) {
    const tile = document.getElementById(`system-health-${id}`);
    const output = document.getElementById(`system-health-${id}-value`);
    if (tile) {
      tile.setAttribute("data-state", state);
    }
    if (output) {
      output.textContent = value;
    }
  }
}
fetch("/api/v1/system")
  .then(async (response) => {
    if (!response.ok) {
      throw new Error((await response.json()).error.message);
    }
    const system = /** @type {{
     *   bootstrap: { status: string },
     *   browser_sessions: { active_count: number },
     *   codex: {
     *     catalog: { models: ModelCapability[] },
     *     error?: string,
     *     status: string
     *   },
     *   execution_providers: Array<{
     *     error?: {code: string, message: string, recovery: string},
     *     id: string,
     *     name: string,
     *     status: string
     *   }>,
     *   durable_core: { status: string },
     *   implementer_token: { status: string },
     *   storage: unknown
     * }} */ (await response.json());
    document.dispatchEvent(
      new CustomEvent("quality-bar:system-loaded", {
        detail: {
          ...system,
          catalog: system.codex.catalog,
          csrfCookieName,
        },
      }),
    );
    renderSystemHealth(system);
    if (systemFacts) {
      const heading = document.createElement("h2");
      heading.textContent = "System status";
      const facts = document.createElement("dl");
      /** @param {string} name @param {string | Node} value */
      const addFact = (name, value) => {
        const term = document.createElement("dt");
        term.textContent = name;
        const description = document.createElement("dd");
        description.append(value);
        facts.append(term, description);
      };
      addFact("Bootstrap", system.bootstrap.status);
      addFact("Durable core", system.durable_core.status);
      const models = document.createElement("ul");
      models.className = "system-model-list";
      for (const model of system.codex.catalog.models) {
        const item = document.createElement("li");
        item.textContent =
          model.id +
          " (" +
          model.reasoning_efforts.join(", ") +
          "; " +
          model.service_tiers.join(", ") +
          ")";
        models.append(item);
      }
      addFact("Codex models", models);
      addFact("Browser sessions", String(system.browser_sessions.active_count));
      addFact("Implementer token", system.implementer_token.status);
      systemFacts.replaceChildren(heading, facts);
    }
  })
  .catch((failure) => {
    error.textContent =
      failure instanceof Error ? failure.message : "Unexpected failure";
    error.hidden = false;
  });
