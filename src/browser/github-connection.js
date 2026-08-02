const githubOperator = /** @type {{
 * csrfToken: () => string,
 * requiredElement: (id: string) => HTMLElement
 * }} */ (Reflect.get(window, "qualityBarOperator"));
// prettier-ignore
const { csrfToken: githubCsrf, requiredElement: githubElement } = githubOperator;
const {
  consumeCallbackFailure: consumeGitHubCallback,
  historyText: githubHistoryText,
  pollingFailureText: formatGitHubPollingFailure,
  pollingText: formatGitHubPolling,
  responseErrorMessage,
  validConnection: validateGitHubConnection,
  verificationTime,
} = /** @type {{
 * consumeCallbackFailure: (query: URLSearchParams, showError: (message: string) => void) => Promise<boolean>,
 * historyText: (verification: any) => string,
 * pollingFailureText: (failure: any) => string,
 * pollingText: (state: any) => string,
 * responseErrorMessage: (response: Response) => Promise<string>,
 * validConnection: (connection: unknown) => boolean,
 * verificationTime: (timestamp: number) => string
 * }} */ (Reflect.get(window, "qualityBarGitHubConnectionContract"));
const githubForm = /** @type {HTMLFormElement} */ (
  githubElement("github-connection-form")
);
const githubSubmit = /** @type {HTMLButtonElement} */ (
  githubElement("github-connection-submit")
);
const githubPem = /** @type {HTMLTextAreaElement} */ (
  githubElement("github-connection-pem")
);
const githubPemLabel = githubElement("github-connection-pem-label");
const githubStatus = githubElement("github-connection-status");
const githubError = githubElement("github-connection-error");
const githubDetails = githubElement("github-connection-details");
const githubIdentity = githubElement("github-connection-identity");
const githubProfile = githubElement("github-connection-profile");
const githubHealth = githubElement("github-connection-health");
const githubLifecycle = githubElement("github-connection-lifecycle");
const githubPermissions = githubElement("github-connection-permissions");
const githubCapabilities = githubElement("github-connection-capabilities");
const githubLatest = githubElement("github-connection-latest");
const githubHistory = githubElement("github-connection-history");
const githubPolling = githubElement("github-connection-polling");
const githubRetire = /** @type {HTMLButtonElement} */ (
  githubElement("github-connection-retire")
);
const githubDelete = /** @type {HTMLButtonElement} */ (
  githubElement("github-connection-delete")
);
const githubRepositoryForm = /** @type {HTMLFormElement} */ (
  githubElement("github-repository-selection-form")
);
const githubRepositoryOptions = githubElement(
  "github-repository-selection-options",
);
const githubRepositorySubmit = /** @type {HTMLButtonElement} */ (
  githubElement("github-repository-selection-submit")
);
// prettier-ignore
const githubRotationForm = /** @type {HTMLFormElement} */ (githubElement("github-connection-rotation-form")), githubRotationPem = /** @type {HTMLTextAreaElement} */ (githubElement("github-connection-rotation-pem")), githubRotationSubmit = /** @type {HTMLButtonElement} */ (githubElement("github-connection-rotation-submit"));
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
    githubSubmit.textContent = "Connect GitHub App";
    githubPem.hidden = true;
    githubPemLabel.hidden = true;
    githubPem.required = false;
    githubPem.value = "";
    githubRetire.hidden = true;
    githubDelete.hidden = true;
    githubRepositoryForm.hidden = true;
    githubRotationForm.hidden = true;
    githubRotationPem.value = "";
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
  githubLifecycle.textContent =
    value.lifecycle === "retired" ? "Retired" : "Enabled";
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
  githubPolling.textContent = "";
  if (value.polling_failure !== null) {
    const item = document.createElement("li");
    item.textContent = formatGitHubPollingFailure(value.polling_failure);
    githubPolling.append(item);
  }
  for (const state of value.polling) {
    const item = document.createElement("li");
    item.textContent = formatGitHubPolling(state);
    githubPolling.append(item);
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
  githubRepositoryForm.hidden =
    value.lifecycle === "retired" ||
    githubRepositoryOptions.children.length === 0;
  githubRotationForm.hidden = value.lifecycle === "retired";
  githubDetails.hidden = false;
  githubForm.hidden = value.lifecycle !== "retired";
  githubPem.hidden = value.lifecycle !== "retired";
  githubPemLabel.hidden = value.lifecycle !== "retired";
  githubPem.required = value.lifecycle === "retired";
  if (value.lifecycle !== "retired") {
    githubPem.value = "";
  }
  githubSubmit.textContent =
    value.lifecycle === "retired"
      ? "Reactivate GitHub App"
      : "Connect GitHub App";
  githubRetire.hidden = value.lifecycle === "retired";
  githubDelete.hidden = false;
  githubStatus.textContent =
    value.health === "healthy"
      ? "GitHub Connection verified."
      : "GitHub Connection verification failed.";
}

const bindLifecycleConfirmation = /** @type {(options: any) => void} */ (
  Reflect.get(window, "qualityBarGitHubConnectionLifecycleConfirmation")
);
bindLifecycleConfirmation({
  csrfToken: githubCsrf,
  error: githubError,
  fetch,
  identity: githubIdentity,
  remove: githubDelete,
  render: renderGitHubConnection,
  responseErrorMessage,
  retire: githubRetire,
  showError: showGitHubError,
  status: githubStatus,
});
githubRotationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  githubError.hidden = true;
  if (!githubRotationPem.value) {
    showGitHubError("Replacement GitHub App private key is required");
    githubRotationPem.focus();
    return;
  }
  if (
    !window.confirm(
      "Rotate GitHub App credentials? Quality Bar will replace its old copy after verification. Revoke the predecessor in GitHub.",
    )
  ) {
    githubRotationPem.focus();
    return;
  }
  githubStatus.textContent = "Verifying replacement GitHub App credentials.";
  githubRotationSubmit.disabled = true;
  try {
    const response = await fetch(
      "/api/v1/github-connections/credential/rotate",
      {
        body: JSON.stringify({ pem: githubRotationPem.value }),
        headers: {
          "content-type": "application/json",
          "x-quality-bar-csrf": githubCsrf(),
        },
        method: "POST",
      },
    );
    if (!response.ok) {
      showGitHubError(await responseErrorMessage(response));
      return;
    }
    const connection = /** @type {unknown} */ (await response.json());
    if (
      !validateGitHubConnection(connection) ||
      /** @type {any} */ (connection).health !== "healthy"
    ) {
      showGitHubError("GitHub App credential rotation response is invalid");
      return;
    }
    renderGitHubConnection(connection);
    githubRotationPem.value = "";
    githubStatus.textContent =
      "GitHub App credentials rotated. Revoke the predecessor in GitHub.";
    githubStatus.focus();
  } catch {
    showGitHubError("GitHub App credential rotation failed");
  } finally {
    githubRotationSubmit.disabled = false;
  }
});

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
        "x-quality-bar-csrf": githubCsrf(),
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
   *   hasVerifiedForgeRepositoryIds: (ids: number[], verificationId: string) => boolean,
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
    repositories.hasVerifiedForgeRepositoryIds(selected, verification.id)
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

const bindGitHubSubmission = /** @type {(options: any) => void} */ (
  Reflect.get(window, "qualityBarGitHubConnectionSubmission")
);
bindGitHubSubmission({
  csrfToken: githubCsrf,
  error: githubError,
  fetch,
  form: githubForm,
  pem: githubPem,
  render: renderGitHubConnection,
  responseErrorMessage,
  showError: showGitHubError,
  status: githubStatus,
  submit: githubSubmit,
});

loadGitHubConnection();
