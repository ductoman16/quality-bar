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
  })
  .catch((failure) => {
    error.textContent =
      failure instanceof Error ? failure.message : "Unexpected failure";
    error.hidden = false;
  });
