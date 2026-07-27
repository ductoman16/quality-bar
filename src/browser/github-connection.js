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
const githubDetails = githubOperator.requiredElement(
  "github-connection-details",
);
const githubIdentity = githubOperator.requiredElement(
  "github-connection-identity",
);
const githubProfile = githubOperator.requiredElement(
  "github-connection-profile",
);
const githubHealth = githubOperator.requiredElement("github-connection-health");
const githubPermissions = githubOperator.requiredElement(
  "github-connection-permissions",
);
const githubCapabilities = githubOperator.requiredElement(
  "github-connection-capabilities",
);
const githubLatest = githubOperator.requiredElement("github-connection-latest");
const githubHistory = githubOperator.requiredElement(
  "github-connection-history",
);

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

/** @param {number} timestamp */
function verificationTime(timestamp) {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    throw new Error("github_connection_response_invalid");
  }
  return value.toISOString();
}

/** @param {unknown} value */
function renderGitHubConnection(value) {
  if (value === null) {
    githubDetails.hidden = true;
    githubForm.hidden = false;
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
    !("api_profile" in value) ||
    typeof value.api_profile !== "string" ||
    !("permissions" in value) ||
    !value.permissions ||
    Array.isArray(value.permissions) ||
    typeof value.permissions !== "object" ||
    !("capabilities" in value) ||
    !value.capabilities ||
    Array.isArray(value.capabilities) ||
    typeof value.capabilities !== "object" ||
    !("repository_count" in value) ||
    !Number.isSafeInteger(value.repository_count) ||
    !("verified_at" in value) ||
    !Number.isSafeInteger(value.verified_at) ||
    !("verification_history" in value) ||
    !Array.isArray(value.verification_history) ||
    value.verification_history.length === 0 ||
    value.verification_history.some(
      (verification) =>
        !verification ||
        typeof verification !== "object" ||
        !("trigger" in verification) ||
        typeof verification.trigger !== "string" ||
        !("api_profile" in verification) ||
        typeof verification.api_profile !== "string" ||
        !("principal" in verification) ||
        !verification.principal ||
        typeof verification.principal !== "object" ||
        !("login" in verification.principal) ||
        typeof verification.principal.login !== "string" ||
        !("repositories" in verification) ||
        !Array.isArray(verification.repositories) ||
        !("verified_at" in verification) ||
        !Number.isSafeInteger(verification.verified_at),
    )
  ) {
    throw new Error("github_connection_response_invalid");
  }
  const permissions = Object.entries(value.permissions);
  const capabilities = Object.entries(value.capabilities);
  if (
    permissions.length === 0 ||
    permissions.some(([, permission]) => typeof permission !== "string") ||
    capabilities.length === 0 ||
    capabilities.some(([, state]) => state !== "verified")
  ) {
    throw new Error("github_connection_response_invalid");
  }
  githubIdentity.textContent = value.principal.login;
  githubProfile.textContent = `${value.api_profile}; compatible`;
  githubHealth.textContent = "Verified";
  githubPermissions.textContent = permissions
    .map(([name, permission]) => `${name}: ${permission}`)
    .join("; ");
  githubCapabilities.textContent = capabilities
    .map(([name]) => name.replaceAll("_", " "))
    .join("; ");
  githubLatest.textContent = verificationTime(
    /** @type {number} */ (value.verified_at),
  );
  githubHistory.textContent = "";
  for (const verification of value.verification_history) {
    const item = document.createElement("li");
    item.textContent = `${verification.trigger}; ${verification.api_profile}; ${verification.principal.login}; ${verification.repositories.length} Repositories; ${verificationTime(verification.verified_at)}`;
    githubHistory.append(item);
  }
  githubDetails.hidden = false;
  githubForm.hidden = true;
  githubStatus.textContent = "GitHub Connection verified.";
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
    const query = new URLSearchParams(location.search);
    const callbackError = query.get("github_connection_error");
    if (callbackError !== null) {
      showGitHubError(callbackError);
    } else if (query.get("github_connection") === "connected") {
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
      typeof start.action !== "string" ||
      start.method !== "POST" ||
      typeof start.state !== "string" ||
      start.action !==
        `https://github.com/settings/apps/new?state=${start.state}` ||
      !start.manifest ||
      Array.isArray(start.manifest) ||
      typeof start.manifest !== "object"
    ) {
      throw new Error("github_manifest_start_invalid");
    }
    const continuation = document.createElement("form");
    continuation.action = start.action;
    continuation.method = "POST";
    const control = document.createElement("input");
    control.name = "manifest";
    control.type = "hidden";
    control.value = JSON.stringify(start.manifest);
    continuation.append(control);
    document.body.append(continuation);
    continuation.submit();
  } catch {
    showGitHubError("GitHub App Manifest response is invalid");
    githubSubmit.disabled = false;
  }
});

loadGitHubConnection();
