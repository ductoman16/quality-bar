const {
  csrfToken: repositoryCsrfToken,
  displayMutationFailure: displayRepositoryMutationFailure,
  error: repositoryError,
  readRepositoryCollection: readRepositoryPages,
  requiredElement: requiredRepositoryElement,
} = /** @type {{
 *   csrfToken: () => string,
 *   displayMutationFailure: (response: Response) => Promise<void>,
 *   error: HTMLElement,
 *   readRepositoryCollection: () => Promise<{
 *     failure: Response | null,
 *     items: unknown[]
 *   }>,
 *   requiredElement: (id: string) => HTMLElement
 * }} */ (Reflect.get(window, "qualityBarOperator"));

/**
 * @param {HTMLFormElement} form
 * @param {HTMLElement} result
 * @param {string} path
 * @param {Record<string, string>} body
 * @param {(repository: RepositoryResource) => Promise<string> | string} successMessage
 * @param {string} networkFailureMessage
 * @param {"PATCH" | "POST"} [method]
 * @param {string} [pendingMessage]
 * @returns {Promise<"network_failure" | "response_failure" | "success">}
 */
async function submitRepositoryMutation(
  form,
  result,
  path,
  body,
  successMessage,
  networkFailureMessage,
  method = "POST",
  pendingMessage = "",
) {
  repositoryError.hidden = true;
  result.textContent = pendingMessage;
  let response;
  try {
    response = await fetch(path, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": repositoryCsrfToken(),
      },
      method,
    });
  } catch {
    result.textContent = "";
    repositoryError.textContent = networkFailureMessage;
    repositoryError.hidden = false;
    return "network_failure";
  }
  if (!response.ok) {
    result.textContent = "";
    await displayRepositoryMutationFailure(response);
    return "response_failure";
  }
  const repository = /** @type {RepositoryResource} */ (await response.json());
  result.textContent = await successMessage(repository);
  form.reset();
  return "success";
}

/**
 * @typedef {{
 *   api_url?: string,
 *   assignment_count?: number,
 *   credential_type: "forge_connection" | "none" | "username_token",
 *   forge_connection_id?: string,
 *   forge_repository_id?: number,
 *   health: "healthy" | "error",
 *   health_error: null | {code: string, message: string},
 *   id: string,
 *   lifecycle: "enabled" | "disabled" | "retired",
 *   name?: string,
 *   provider?: "forgejo" | "github",
 *   url: string,
 *   verification_id?: string,
 *   verified_at?: number,
 *   web_url?: string
 * }} RepositoryResource
 */

/** @type {Map<string, HTMLElement>} */
const repositoryRows = new Map();
/** @type {Map<string, RepositoryResource>} */
const repositoryResources = new Map();
/** @type {Set<(repositories: RepositoryResource[]) => unknown>} */
const repositorySubscribers = new Set();

function publishRepositoryResources() {
  const repositories = [...repositoryResources.values()];
  for (const subscriber of repositorySubscribers) {
    subscriber(repositories);
  }
}

Reflect.set(
  window,
  "qualityBarRepositories",
  Object.freeze({
    /** @param {number[]} ids @param {string} verificationId */
    hasVerifiedForgeRepositoryIds(ids, verificationId) {
      return ids.every((id) =>
        [...repositoryResources.values()].some(
          (repository) =>
            repository.forge_repository_id === id &&
            repository.verification_id === verificationId,
        ),
      );
    },
    refresh: loadRepositoryOptions,
    /** @param {(repositories: RepositoryResource[]) => unknown} subscriber */
    subscribe(subscriber) {
      if (typeof subscriber !== "function") {
        throw new TypeError("Repository subscriber must be a function");
      }
      repositorySubscribers.add(subscriber);
      subscriber([...repositoryResources.values()]);
    },
  }),
);

/** @param {RepositoryResource} repository */
function renderRepository(repository) {
  let observedHealth;
  if (repository.health === "healthy") {
    observedHealth = "healthy";
  } else if (repository.health === "error") {
    const healthError = repository.health_error;
    if (!healthError) {
      throw new Error("repository_health_error_missing");
    }
    observedHealth = `error: ${healthError.message}`;
  } else {
    throw new Error("repository_health_invalid");
  }
  if (!["enabled", "disabled", "retired"].includes(repository.lifecycle)) {
    throw new Error("repository_lifecycle_invalid");
  }
  repositoryResources.set(repository.id, repository);
  let row = repositoryRows.get(repository.id);
  if (!row) {
    row = document.createElement("tr");
    repositoryRows.set(repository.id, row);
    requiredRepositoryElement("repository-inventory").append(row);
  }
  row.replaceChildren();
  let provider = "Generic HTTPS Git";
  let identity = repository.url;
  let assignments = "Unavailable";
  let latestVerification = "Unavailable";
  if (repository.provider === "github" || repository.provider === "forgejo") {
    if (
      repository.credential_type !== "forge_connection" ||
      typeof repository.forge_connection_id !== "string" ||
      !Number.isSafeInteger(repository.forge_repository_id) ||
      /** @type {number} */ (repository.forge_repository_id) <= 0 ||
      typeof repository.name !== "string" ||
      typeof repository.api_url !== "string" ||
      typeof repository.web_url !== "string" ||
      !Number.isSafeInteger(repository.assignment_count) ||
      typeof repository.verification_id !== "string" ||
      !Number.isSafeInteger(repository.verified_at)
    ) {
      throw new Error("forge_repository_response_invalid");
    }
    provider = `${repository.provider === "github" ? "GitHub" : "Forgejo"}; ${repository.forge_connection_id}`;
    identity = `${repository.name}; Forge Repository ${repository.forge_repository_id}; ${repository.url}; ${repository.web_url}; ${repository.api_url}`;
    assignments = String(/** @type {number} */ (repository.assignment_count));
    latestVerification = new Date(
      /** @type {number} */ (repository.verified_at),
    ).toISOString();
  }
  const values = [
    ["Provider and Connection", provider],
    ["Identity", identity],
    ["Lifecycle", repository.lifecycle],
    ["Health", observedHealth],
    ["Assignments", assignments],
    ["Latest verification", latestVerification],
  ];
  for (const [label, value] of values) {
    const cell = document.createElement("td");
    cell.setAttribute("data-label", label);
    cell.textContent = value;
    row.append(cell);
  }
}

/** @param {RepositoryResource} repository */
function addLifecycleOption(repository) {
  if (repository.lifecycle === "retired") {
    return;
  }
  const select = /** @type {HTMLSelectElement} */ (
    requiredRepositoryElement("repository-lifecycle-repository")
  );
  for (const option of select.options) {
    if (option.value === repository.id) {
      return;
    }
  }
  const option = document.createElement("option");
  option.textContent = repository.url;
  option.value = repository.id;
  select.append(option);
  select.disabled = false;
  /** @type {HTMLButtonElement} */ (
    requiredRepositoryElement("repository-lifecycle-submit")
  ).disabled = false;
}

/** @param {RepositoryResource} repository */
function addRepositoryOption(repository) {
  if (repository.credential_type !== "username_token") {
    return;
  }
  const select = /** @type {HTMLSelectElement} */ (
    requiredRepositoryElement("repository-credential-rotate-repository")
  );
  for (const option of select.options) {
    if (option.value === repository.id) {
      return;
    }
  }
  const option = document.createElement("option");
  option.textContent = repository.url;
  option.value = repository.id;
  select.append(option);
  select.disabled = false;
  /** @type {HTMLButtonElement} */ (
    requiredRepositoryElement("repository-credential-rotate-submit")
  ).disabled = false;
}

function clearRepositoryOptions() {
  requiredRepositoryElement("repository-inventory").replaceChildren();
  repositoryRows.clear();
  repositoryResources.clear();
  publishRepositoryResources();
  const lifecycleSelect = /** @type {HTMLSelectElement} */ (
    requiredRepositoryElement("repository-lifecycle-repository")
  );
  lifecycleSelect.replaceChildren();
  lifecycleSelect.disabled = true;
  /** @type {HTMLButtonElement} */ (
    requiredRepositoryElement("repository-lifecycle-submit")
  ).disabled = true;
  const credentialSelect = /** @type {HTMLSelectElement} */ (
    requiredRepositoryElement("repository-credential-rotate-repository")
  );
  credentialSelect.replaceChildren();
  credentialSelect.disabled = true;
  /** @type {HTMLButtonElement} */ (
    requiredRepositoryElement("repository-credential-rotate-submit")
  ).disabled = true;
}

async function loadRepositoryOptions() {
  clearRepositoryOptions();
  let collection;
  try {
    collection = await readRepositoryPages();
  } catch {
    repositoryError.textContent = "Repository listing failed";
    repositoryError.hidden = false;
    return false;
  }
  if (collection.failure) {
    await displayRepositoryMutationFailure(collection.failure);
    return false;
  }
  for (const repository of /** @type {RepositoryResource[]} */ (
    collection.items
  )) {
    renderRepository(repository);
    addLifecycleOption(repository);
    addRepositoryOption(repository);
  }
  publishRepositoryResources();
  return true;
}

const repositoryOptionsLoaded = loadRepositoryOptions();
const repositoryCreateForm = /** @type {HTMLFormElement} */ (
  requiredRepositoryElement("repository-create-form")
);
repositoryCreateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const usernameControl = /** @type {HTMLInputElement} */ (
    requiredRepositoryElement("repository-username")
  );
  const tokenControl = /** @type {HTMLInputElement} */ (
    requiredRepositoryElement("repository-token")
  );
  const username = usernameControl.value;
  const token = tokenControl.value;
  const body = {
    url: /** @type {HTMLInputElement} */ (
      requiredRepositoryElement("repository-url")
    ).value,
  };
  if (username || token) {
    Object.assign(body, { token, username });
  }
  usernameControl.value = "";
  tokenControl.value = "";
  await submitRepositoryMutation(
    repositoryCreateForm,
    requiredRepositoryElement("repository-create-result"),
    "/api/v1/repositories",
    body,
    async (repository) => {
      if (await repositoryOptionsLoaded) {
        renderRepository(repository);
        addLifecycleOption(repository);
        addRepositoryOption(repository);
        publishRepositoryResources();
      }
      return `${repository.url} registered as ${repository.id}.`;
    },
    "Repository registration failed",
  );
});

const repositoryLifecycleForm = /** @type {HTMLFormElement} */ (
  requiredRepositoryElement("repository-lifecycle-form")
);
repositoryLifecycleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!(await repositoryOptionsLoaded)) {
    return;
  }
  const repositoryId = /** @type {HTMLSelectElement} */ (
    requiredRepositoryElement("repository-lifecycle-repository")
  ).value;
  const lifecycle = /** @type {HTMLSelectElement} */ (
    requiredRepositoryElement("repository-lifecycle-state")
  ).value;
  if (!["enabled", "disabled"].includes(lifecycle)) {
    throw new Error("repository_lifecycle_invalid");
  }
  const repository = repositoryResources.get(repositoryId);
  if (!repository) {
    throw new Error("repository_lifecycle_target_missing");
  }
  const consequence =
    lifecycle === "disabled"
      ? "New work will be rejected; already-created work may finish."
      : "Complete current verification must succeed before new work is accepted.";
  if (
    !window.confirm(
      `${lifecycle === "disabled" ? "Disable" : "Enable"} ${repository.url}? ${consequence}`,
    )
  ) {
    return;
  }
  const lifecycleSubmit = /** @type {HTMLButtonElement} */ (
    requiredRepositoryElement("repository-lifecycle-submit")
  );
  lifecycleSubmit.disabled = true;
  try {
    const outcome = await submitRepositoryMutation(
      repositoryLifecycleForm,
      requiredRepositoryElement("repository-lifecycle-result"),
      `/api/v1/repositories/${encodeURIComponent(repositoryId)}/lifecycle`,
      { lifecycle },
      (repository) => {
        renderRepository(repository);
        return `${repository.url} is ${repository.lifecycle}.`;
      },
      "Repository lifecycle change failed",
      "PATCH",
      "Applying lifecycle.",
    );
    if (outcome !== "success") {
      await loadRepositoryOptions();
    }
  } finally {
    lifecycleSubmit.disabled =
      /** @type {HTMLSelectElement} */ (
        requiredRepositoryElement("repository-lifecycle-repository")
      ).options.length === 0;
  }
});

const repositoryCredentialRotateForm = /** @type {HTMLFormElement} */ (
  requiredRepositoryElement("repository-credential-rotate-form")
);
repositoryCredentialRotateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!(await repositoryOptionsLoaded)) {
    return;
  }
  const repositoryId = /** @type {HTMLSelectElement} */ (
    requiredRepositoryElement("repository-credential-rotate-repository")
  ).value;
  const usernameControl = /** @type {HTMLInputElement} */ (
    requiredRepositoryElement("repository-credential-rotate-username")
  );
  const tokenControl = /** @type {HTMLInputElement} */ (
    requiredRepositoryElement("repository-credential-rotate-token")
  );
  const body = {
    token: tokenControl.value,
    username: usernameControl.value,
  };
  usernameControl.value = "";
  tokenControl.value = "";
  await submitRepositoryMutation(
    repositoryCredentialRotateForm,
    requiredRepositoryElement("repository-credential-rotate-result"),
    `/api/v1/repositories/${encodeURIComponent(repositoryId)}/credential/rotate`,
    body,
    (repository) => {
      renderRepository(repository);
      return repository.url + " credential rotated.";
    },
    "Repository credential rotation failed",
  );
});
