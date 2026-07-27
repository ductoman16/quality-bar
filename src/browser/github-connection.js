const githubOperator = /** @type {{
 * csrfToken: () => string,
 * requiredElement: (id: string) => HTMLElement
 * }} */ (Reflect.get(window, "qualityBarOperator"));
const { csrfToken, requiredElement } = githubOperator;
const {
  consumeCallbackFailure: consumeGitHubCallback,
  historyText: githubHistoryText,
  responseErrorMessage,
  validConnection: validateGitHubConnection,
  verificationTime,
} = /** @type {{
 * consumeCallbackFailure: (query: URLSearchParams, showError: (message: string) => void) => Promise<boolean>,
 * historyText: (verification: any) => string,
 * responseErrorMessage: (response: Response) => Promise<string>,
 * validConnection: (connection: unknown) => boolean,
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
/** @type {{affected_repository_ids: number[], id: string, outcome: string, trigger: string, verified_at: number}[]} */
let githubVerificationHistory = [];

/** @param {string} message */
function showGitHubError(message) {
  githubStatus.textContent = "";
  githubError.textContent = message;
  githubError.hidden = false;
  githubError.focus();
}

/** @param {any} value */
function renderGitHubConnection(value) {
  if (value === null) {
    githubVerificationHistory = [];
    githubRepositoryOptions.replaceChildren();
    githubDetails.hidden = true;
    githubForm.hidden = false;
    githubRepositoryForm.hidden = true;
    githubStatus.textContent = "";
    return;
  }
  if (!validateGitHubConnection(value)) {
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
  const permissions = Object.entries(value.permissions);
  const capabilities = Object.entries(value.capabilities);
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
  const latestVerification = value.verification_history.at(-1);
  githubVerificationHistory = value.verification_history;
  if (latestVerification) {
    const options =
      latestVerification.repositories.length > 0
        ? latestVerification.repositories.map(
            /** @param {{full_name: string, id: number, private: boolean}} repository */ (
              repository,
            ) => ({
              id: repository.id,
              label: `${repository.full_name}; ${
                repository.private ? "private" : "public"
              }`,
            }),
          )
        : latestVerification.affected_repository_ids.map(
            /** @param {number} id */ (id) => ({
              id,
              label: `Forge Repository ${id}; verification required`,
            }),
          );
    for (const option of options) {
      const label = document.createElement("label");
      const control = document.createElement("input");
      control.name = "repository_ids";
      control.type = "checkbox";
      control.value = String(option.id);
      const identity = document.createElement("span");
      identity.textContent = option.label;
      label.append(control, identity);
      githubRepositoryOptions.append(label);
    }
  }
  githubRepositoryForm.hidden = githubRepositoryOptions.children.length === 0;
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
  const requestId = crypto.randomUUID();
  let response;
  try {
    response = await fetch("/api/v1/github-connections/repositories", {
      body: JSON.stringify({
        repository_ids: selected,
        request_id: requestId,
      }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": csrfToken(),
      },
      method: "POST",
    });
  } catch {
    await reconcileGitHubRepositorySelection(selected, requestId);
    return;
  }
  if (!response.ok) {
    const message = await responseErrorMessage(response);
    const refreshed = await refreshGitHubRepositoryState();
    showGitHubError(message);
    githubRepositoryForm.hidden = !refreshed;
    githubRepositorySubmit.disabled = !refreshed;
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
    await reconcileGitHubRepositorySelection(selected, requestId);
  }
});

/** @param {number[]} selected @param {string} requestId */
async function reconcileGitHubRepositorySelection(selected, requestId) {
  const repositories = /** @type {{
   *   hasVerifiedForgeRepositoryIds: (ids: number[], verifiedAt: number) => boolean,
   *   refresh: () => Promise<boolean>
   * }} */ (Reflect.get(window, "qualityBarRepositories"));
  const connectionLoaded = await loadGitHubConnection();
  const repositoriesLoaded = await repositories.refresh();
  if (!connectionLoaded || !repositoriesLoaded) {
    githubRepositoryForm.hidden = true;
    showGitHubError("GitHub Repository selection reconciliation failed");
    return;
  }
  const verification = githubVerificationHistory.find(
    ({ id }) => id === requestId,
  );
  if (
    verification?.trigger === "repository_selection" &&
    verification.outcome === "success" &&
    selected.every((id) => verification.affected_repository_ids.includes(id)) &&
    repositories.hasVerifiedForgeRepositoryIds(
      selected,
      verification.verified_at,
    )
  ) {
    githubStatus.textContent = "GitHub Repositories registered.";
    githubStatus.focus();
    location.assign("/?view=repositories");
    return;
  }
  showGitHubError("GitHub Repository selection result is unavailable");
  githubRepositorySubmit.disabled = false;
}

async function refreshGitHubRepositoryState() {
  const connectionLoaded = await loadGitHubConnection();
  const repositoriesLoaded = await /** @type {{
   *   refresh: () => Promise<boolean>
   * }} */ (Reflect.get(window, "qualityBarRepositories")).refresh();
  return connectionLoaded && repositoriesLoaded;
}

async function loadGitHubConnection() {
  let response;
  try {
    response = await fetch("/api/v1/github-connections");
  } catch {
    showGitHubError("GitHub Connection loading failed");
    return false;
  }
  if (!response.ok) {
    showGitHubError(await responseErrorMessage(response));
    return false;
  }
  try {
    const connection = await response.json();
    renderGitHubConnection(connection);
    const query = new URLSearchParams(location.search);
    if (await consumeGitHubCallback(query, showGitHubError)) {
      return false;
    }
    if (query.get("github_connection") === "connected") {
      githubStatus.focus();
    }
    return connection !== null;
  } catch {
    showGitHubError("GitHub Connection response is invalid");
    return false;
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
    showGitHubError(await responseErrorMessage(response));
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
