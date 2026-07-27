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

/**
 * @param {HTMLFormElement} form
 * @param {HTMLElement} result
 * @param {string} path
 * @param {Record<string, string>} body
 * @param {(repository: {id: string, url: string}) => string} successMessage
 */
async function submitRepositoryMutation(
  form,
  result,
  path,
  body,
  successMessage,
) {
  error.hidden = true;
  result.textContent = "";
  const response = await fetch(path, {
    body: JSON.stringify(body),
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
  const repository = /** @type {{id: string, url: string}} */ (
    await response.json()
  );
  result.textContent = successMessage(repository);
  form.reset();
}
/** @param {{id: string, url: string}} repository */
function addRepositoryOption(repository) {
  const select = /** @type {HTMLSelectElement | null} */ (
    document.getElementById("repository-credential-rotate-repository")
  );
  if (!select) {
    return;
  }
  const option = document.createElement("option");
  option.textContent = repository.url;
  option.value = repository.id;
  select.append(option);
}
async function loadRepositoryOptions() {
  const select = /** @type {HTMLSelectElement | null} */ (
    document.getElementById("repository-credential-rotate-repository")
  );
  if (!select) {
    return true;
  }
  let response;
  try {
    response = await fetch("/api/v1/repositories");
  } catch {
    error.textContent = "Repository listing failed";
    error.hidden = false;
    return false;
  }
  if (!response.ok) {
    await displayMutationFailure(response);
    return false;
  }
  const body = /** @type {{repositories: {id: string, url: string}[]}} */ (
    await response.json()
  );
  select.replaceChildren();
  for (const repository of body.repositories) {
    addRepositoryOption(repository);
  }
  select.disabled = false;
  /** @type {HTMLButtonElement} */ (
    requiredElement("repository-credential-rotate-submit")
  ).disabled = false;
  return true;
}
const repositoryOptionsLoaded = loadRepositoryOptions();
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
const repositoryCreateForm = document.getElementById("repository-create-form");
if (repositoryCreateForm) {
  repositoryCreateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await repositoryOptionsLoaded)) {
      return;
    }
    const usernameControl = /** @type {HTMLInputElement} */ (
      requiredElement("repository-username")
    );
    const tokenControl = /** @type {HTMLInputElement} */ (
      requiredElement("repository-token")
    );
    const username = usernameControl.value;
    const token = tokenControl.value;
    const body = { url: controlValue("repository-url") };
    if (username || token) {
      Object.assign(body, { token, username });
    }
    usernameControl.value = "";
    tokenControl.value = "";
    await submitRepositoryMutation(
      /** @type {HTMLFormElement} */ (repositoryCreateForm),
      requiredElement("repository-create-result"),
      "/api/v1/repositories",
      body,
      (repository) => {
        if (username && token) {
          addRepositoryOption(repository);
        }
        return `${repository.url} registered as ${repository.id}.`;
      },
    );
  });
}
const repositoryCredentialRotateForm = document.getElementById(
  "repository-credential-rotate-form",
);
if (repositoryCredentialRotateForm) {
  repositoryCredentialRotateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await repositoryOptionsLoaded)) {
      return;
    }
    const result = requiredElement("repository-credential-rotate-result");
    const repositoryId = controlValue(
      "repository-credential-rotate-repository",
    );
    const usernameControl = /** @type {HTMLInputElement} */ (
      requiredElement("repository-credential-rotate-username")
    );
    const tokenControl = /** @type {HTMLInputElement} */ (
      requiredElement("repository-credential-rotate-token")
    );
    const body = {
      token: tokenControl.value,
      username: usernameControl.value,
    };
    usernameControl.value = "";
    tokenControl.value = "";
    await submitRepositoryMutation(
      /** @type {HTMLFormElement} */ (repositoryCredentialRotateForm),
      result,
      `/api/v1/repositories/${encodeURIComponent(repositoryId)}/credential/rotate`,
      body,
      (repository) => repository.url + " credential rotated.",
    );
  });
}
const systemFacts = document.getElementById("system-facts");
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
     *   durable_core: { status: string },
     *   implementer_token: { status: string }
     * }} */ (await response.json());
    if (document.getElementById("review-create-form")) {
      document.dispatchEvent(
        new CustomEvent("quality-bar:system-loaded", {
          detail: { catalog: system.codex.catalog, csrfCookieName },
        }),
      );
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
    if (system.codex.status === "unavailable" && attention) {
      attention.hidden = false;
      attention.textContent = "Codex unavailable";
    }
  })
  .catch((failure) => {
    error.textContent =
      failure instanceof Error ? failure.message : "Unexpected failure";
    error.hidden = false;
  });
