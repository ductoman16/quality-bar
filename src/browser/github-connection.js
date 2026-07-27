const githubOperator = /** @type {{
 * csrfToken: () => string,
 * requiredElement: (id: string) => HTMLElement
 * }} */ (Reflect.get(window, "qualityBarOperator"));
const { csrfToken, requiredElement } = githubOperator;
const {
  consumeCallbackFailure: consumeGitHubCallback,
  historyText: githubHistoryText,
  responseErrorMessage,
  validOutcome: validGitHubOutcome,
  verificationTime,
} = /** @type {{
 * consumeCallbackFailure: (query: URLSearchParams, showError: (message: string) => void) => Promise<boolean>,
 * historyText: (verification: any) => string,
 * responseErrorMessage: (response: Response) => Promise<string>,
 * validOutcome: (verification: unknown) => boolean,
 * verificationTime: (timestamp: number) => string
 * }} */ (Reflect.get(window, "qualityBarGitHubConnectionContract"));

const githubForm = /** @type {HTMLFormElement} */ (
  requiredElement("github-connection-form")
);
const githubSubmit = /** @type {HTMLButtonElement} */ (
  requiredElement("github-connection-submit")
);
const githubStatus = requiredElement("github-connection-status");
const githubError = requiredElement("github-connection-error");
const githubDetails = requiredElement("github-connection-details");
const githubIdentity = requiredElement("github-connection-identity");
const githubProfile = requiredElement("github-connection-profile");
const githubHealth = requiredElement("github-connection-health");
const githubPermissions = requiredElement("github-connection-permissions");
const githubCapabilities = requiredElement("github-connection-capabilities");
const githubLatest = requiredElement("github-connection-latest");
const githubHistory = requiredElement("github-connection-history");
const githubRepositoryForm = /** @type {HTMLFormElement} */ (
  requiredElement("github-repository-selection-form")
);
const githubRepositoryOptions = requiredElement(
  "github-repository-selection-options",
);
const githubRepositorySubmit = /** @type {HTMLButtonElement} */ (
  requiredElement("github-repository-selection-submit")
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
  showGitHubError(await responseErrorMessage(response));
}

/** @param {unknown} value */
function renderGitHubConnection(value) {
  if (value === null) {
    githubDetails.hidden = true;
    githubForm.hidden = false;
    githubRepositoryForm.hidden = true;
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
    !("health" in value) ||
    !["healthy", "error"].includes(/** @type {string} */ (value.health)) ||
    !("health_error" in value) ||
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
        !validGitHubOutcome(verification) ||
        !("api_profile" in verification) ||
        typeof verification.api_profile !== "string" ||
        !("principal" in verification) ||
        !verification.principal ||
        typeof verification.principal !== "object" ||
        !("login" in verification.principal) ||
        typeof verification.principal.login !== "string" ||
        !("repositories" in verification) ||
        !Array.isArray(verification.repositories) ||
        verification.repositories.length === 0 ||
        verification.repositories.some(
          /** @param {unknown} repository */ (repository) =>
            !repository ||
            typeof repository !== "object" ||
            !("id" in repository) ||
            !Number.isSafeInteger(repository.id) ||
            !("full_name" in repository) ||
            typeof repository.full_name !== "string" ||
            !("private" in repository) ||
            typeof repository.private !== "boolean",
        ) ||
        !("verified_at" in verification) ||
        !Number.isSafeInteger(verification.verified_at),
    )
  ) {
    throw new Error("github_connection_response_invalid");
  }
  const healthError =
    value.health === "error" &&
    value.health_error &&
    typeof value.health_error === "object" &&
    "code" in value.health_error &&
    typeof value.health_error.code === "string" &&
    "message" in value.health_error &&
    typeof value.health_error.message === "string"
      ? value.health_error
      : null;
  if (
    (value.health === "healthy" && value.health_error !== null) ||
    (value.health === "error" && healthError === null)
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
  githubHealth.textContent =
    value.health === "healthy"
      ? "Verified"
      : `${healthError?.message} (${healthError?.code})`;
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
    item.textContent = githubHistoryText(verification);
    githubHistory.append(item);
  }
  githubRepositoryOptions.replaceChildren();
  const latest =
    value.verification_history[value.verification_history.length - 1];
  for (const repository of latest.repositories) {
    const label = document.createElement("label");
    const control = document.createElement("input");
    control.name = "repository_ids";
    control.type = "checkbox";
    control.value = String(repository.id);
    const identity = document.createElement("span");
    identity.textContent = `${repository.full_name}; ${
      repository.private ? "private" : "public"
    }`;
    label.append(control, identity);
    githubRepositoryOptions.append(label);
  }
  githubRepositoryForm.hidden = false;
  githubDetails.hidden = false;
  githubForm.hidden = true;
  githubStatus.textContent =
    value.health === "healthy"
      ? "GitHub Connection verified."
      : "GitHub Connection verification failed.";
}

githubRepositoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  githubError.hidden = true;
  const selected = [
    ...githubRepositoryOptions.querySelectorAll(
      'input[name="repository_ids"]:checked',
    ),
  ].map((control) => Number(/** @type {HTMLInputElement} */ (control).value));
  if (selected.length === 0) {
    showGitHubError("Select at least one GitHub Repository");
    const first = /** @type {HTMLInputElement | null} */ (
      githubRepositoryOptions.querySelector('input[name="repository_ids"]')
    );
    first?.focus();
    return;
  }
  githubStatus.textContent = "Registering selected GitHub Repositories.";
  githubRepositorySubmit.disabled = true;
  let response;
  try {
    response = await fetch("/api/v1/github-connections/repositories", {
      body: JSON.stringify({ repository_ids: selected }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": csrfToken(),
      },
      method: "POST",
    });
  } catch {
    showGitHubError("GitHub Repository selection failed");
    githubRepositorySubmit.disabled = false;
    return;
  }
  if (!response.ok) {
    await showGitHubResponseError(response);
    await loadGitHubConnection();
    await /** @type {{refresh: () => Promise<boolean>}} */ (
      Reflect.get(window, "qualityBarRepositories")
    ).refresh();
    githubRepositorySubmit.disabled = false;
    return;
  }
  try {
    const repositories = /** @type {unknown} */ (await response.json());
    const registeredIds = new Set(
      Array.isArray(repositories)
        ? repositories.map((repository) =>
            repository &&
            typeof repository === "object" &&
            "forge_repository_id" in repository
              ? repository.forge_repository_id
              : undefined,
          )
        : [],
    );
    if (
      !Array.isArray(repositories) ||
      repositories.length !== selected.length ||
      registeredIds.size !== selected.length ||
      selected.some((id) => !registeredIds.has(id))
    ) {
      throw new Error("github_repository_selection_response_invalid");
    }
    githubStatus.textContent = "GitHub Repositories registered.";
    githubStatus.focus();
    location.assign("/?view=repositories");
  } catch {
    showGitHubError("GitHub Repository selection response is invalid");
    githubRepositorySubmit.disabled = false;
  }
});

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
    if (await consumeGitHubCallback(query, showGitHubError)) {
      return;
    }
    if (query.get("github_connection") === "connected") {
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
        "x-quality-bar-csrf": csrfToken(),
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
