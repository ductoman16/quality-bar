const githubOperator = /** @type {{
 * csrfToken: () => string,
 * requiredElement: (id: string) => HTMLElement
 * }} */ (Reflect.get(window, "qualityBarOperator"));

const githubForm = /** @type {HTMLFormElement} */ (
  githubOperator.requiredElement("github-connection-form")
);
const githubSubmit = /** @type {HTMLButtonElement} */ (
  githubOperator.requiredElement("github-connection-submit")
);
const githubStatus = githubOperator.requiredElement("github-connection-status");
const githubError = githubOperator.requiredElement("github-connection-error");

/** @param {string} message */
function showGitHubError(message) {
  githubStatus.textContent = "";
  githubError.textContent = message;
  githubError.hidden = false;
  githubError.focus();
}

/** @param {Response} response */
async function showGitHubResponseError(response) {
  try {
    const body = /** @type {{error?: {message?: unknown}}} */ (
      await response.json()
    );
    if (typeof body.error?.message !== "string") {
      throw new Error("github_error_response_invalid");
    }
    showGitHubError(body.error.message);
  } catch {
    showGitHubError("GitHub Connection response is invalid");
  }
}

/** @param {unknown} value */
function renderGitHubConnection(value) {
  if (value === null) {
    githubStatus.textContent = "";
    return;
  }
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    !("principal" in value) ||
    !value.principal ||
    typeof value.principal !== "object" ||
    !("login" in value.principal) ||
    typeof value.principal.login !== "string" ||
    !("repository_count" in value) ||
    !Number.isSafeInteger(value.repository_count) ||
    !("verification_history" in value) ||
    !Array.isArray(value.verification_history) ||
    value.verification_history.length === 0
  ) {
    throw new Error("github_connection_response_invalid");
  }
  githubStatus.textContent = `${value.principal.login} connected; ${value.repository_count} accessible Repositories; ${value.verification_history.length} verified history record.`;
}

async function loadGitHubConnection() {
  let response;
  try {
    response = await fetch("/api/v1/github-connections");
  } catch {
    showGitHubError("GitHub Connection loading failed");
    return;
  }
  if (!response.ok) {
    await showGitHubResponseError(response);
    return;
  }
  try {
    renderGitHubConnection(await response.json());
    if (
      new URLSearchParams(location.search).get("github_connection") ===
      "connected"
    ) {
      githubStatus.focus();
    }
  } catch {
    showGitHubError("GitHub Connection response is invalid");
  }
}

githubForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  githubError.hidden = true;
  githubStatus.textContent = "Starting GitHub Connection.";
  githubSubmit.disabled = true;
  let response;
  try {
    response = await fetch("/api/v1/github-connections/manifest", {
      body: "{}",
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": githubOperator.csrfToken(),
      },
      method: "POST",
    });
  } catch {
    showGitHubError("GitHub App Manifest flow could not start");
    githubSubmit.disabled = false;
    return;
  }
  if (!response.ok) {
    await showGitHubResponseError(response);
    githubSubmit.disabled = false;
    return;
  }
  try {
    const start = /** @type {{
     *   action?: unknown,
     *   manifest?: unknown,
     *   method?: unknown,
     *   state?: unknown
     * }} */ (await response.json());
    if (
      start.action !== "https://github.com/settings/apps/new" ||
      start.method !== "POST" ||
      typeof start.state !== "string" ||
      !start.manifest ||
      Array.isArray(start.manifest) ||
      typeof start.manifest !== "object"
    ) {
      throw new Error("github_manifest_start_invalid");
    }
    const continuation = document.createElement("form");
    continuation.action = start.action;
    continuation.method = "POST";
    for (const [name, value] of [
      ["manifest", JSON.stringify(start.manifest)],
      ["state", start.state],
    ]) {
      const control = document.createElement("input");
      control.name = name;
      control.type = "hidden";
      control.value = value;
      continuation.append(control);
    }
    document.body.append(continuation);
    continuation.submit();
  } catch {
    showGitHubError("GitHub App Manifest response is invalid");
    githubSubmit.disabled = false;
  }
});

loadGitHubConnection();
