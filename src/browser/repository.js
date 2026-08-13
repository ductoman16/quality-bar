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
 *   deletion_eligible: boolean,
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

const repositoryRows = new Map(),
  repositoryResources = new Map();
/** @type {Set<string>} */
const expandedRepositoryIds = new Set();
const repositorySubscribers = new Set();

function publishRepositoryResources() {
  const resources = [...repositoryResources.values()];
  renderRepositoryOverview(resources);
  repositorySubscribers.forEach((subscriber) => subscriber(resources));
}

/** @param {RepositoryResource[]} resources */
function renderRepositoryOverview(resources) {
  let enabled = 0;
  let disabled = 0;
  let retired = 0;
  let errors = 0;
  for (const repository of resources) {
    if (repository.lifecycle === "enabled") {
      enabled += 1;
    } else if (repository.lifecycle === "disabled") {
      disabled += 1;
    } else if (repository.lifecycle === "retired") {
      retired += 1;
    }
    if (repository.health === "error") {
      errors += 1;
    }
  }
  /** @type {[string, number][]} */
  const counters = [
    ["repository-overview-total", resources.length],
    ["repository-overview-enabled", enabled],
    ["repository-overview-disabled", disabled],
    ["repository-overview-retired", retired],
    ["repository-overview-errors", errors],
  ];
  for (const [id, value] of counters) {
    const element = document.getElementById?.(id);
    if (element) {
      element.textContent = String(value);
    }
  }
  const empty = document.getElementById?.("repository-inventory-empty");
  if (empty) {
    empty.hidden = resources.length > 0;
  }
}

Reflect.set(
  window,
  "qualityBarRepositories",
  Object.freeze({
    /** @param {string} id */
    find: (id) => repositoryResources.get(id),
    /** @param {string} id */
    confirmationIdentity(id) {
      const repository = repositoryResources.get(id);
      return repository && repositoryConfirmationIdentity(repository);
    },
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
    ready: () => repositoryOptionsLoaded,
    syncDeleteAvailability: syncRepositoryDeleteAvailability,
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

/**
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 */
function repositoryElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.setAttribute("class", className);
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

/** @param {RepositoryResource["credential_type"]} credentialType */
function repositoryCredentialLabel(credentialType) {
  if (credentialType === "forge_connection") {
    return "Provider connection";
  }
  if (credentialType === "username_token") {
    return "Username and token";
  }
  return "None";
}

/** @param {RepositoryResource} repository */
/**
 * A compact display name for a repository URL — `owner/repo`, without the
 * scheme or the trailing `.git`. Falls back to the raw URL if it can't parse.
 * @param {string} url
 */
function repositoryDisplayName(url) {
  const path = url
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split(/[?#]/)[0]
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 3) {
    return segments.slice(-2).join("/");
  }
  return segments[segments.length - 1] || url;
}

/** @param {any} repository */
function renderRepository(repository) {
  if (typeof repository.deletion_eligible !== "boolean") {
    throw new Error("repository_deletion_eligibility_invalid");
  }
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
  let provider = "Generic HTTPS Git";
  let identity = repository.url;
  const assignments = Number.isSafeInteger(repository.assignment_count)
    ? String(/** @type {number} */ (repository.assignment_count))
    : "—";
  const latestVerification = Number.isSafeInteger(repository.verified_at)
    ? new Date(/** @type {number} */ (repository.verified_at)).toISOString()
    : "—";
  if (repository.provider === "github" || repository.provider === "forgejo") {
    if (
      repository.credential_type !== "forge_connection" ||
      typeof repository.forge_connection_id !== "string" ||
      !Number.isSafeInteger(repository.forge_repository_id) ||
      /** @type {number} */ (repository.forge_repository_id) <= 0 ||
      typeof repository.name !== "string" ||
      typeof repository.api_url !== "string" ||
      typeof repository.web_url !== "string" ||
      typeof repository.verification_id !== "string"
    ) {
      throw new Error("forge_repository_response_invalid");
    }
    provider = `${repository.provider === "github" ? "GitHub" : "Forgejo"}; ${repository.forge_connection_id}`;
    identity = `${repository.name}; Forge Repository ${repository.forge_repository_id}; ${repository.url}; ${repository.web_url}; ${repository.api_url}`;
  }

  let row = repositoryRows.get(repository.id);
  if (!row) {
    row = repositoryElement("div", "repo-row");
    row.id = `repository-${repository.id}`;
    repositoryRows.set(repository.id, row);
    requiredRepositoryElement("repository-inventory").append(row);
  }
  row.replaceChildren();
  row.setAttribute("data-lifecycle", repository.lifecycle);
  row.setAttribute("data-health", repository.health);

  const expanded = expandedRepositoryIds.has(repository.id);
  const detailHref = `/?view=repository-detail&repository_id=${encodeURIComponent(repository.id)}`;
  const summary = repositoryElement("div", "repo-row__summary");

  const toggle = /** @type {HTMLButtonElement} */ (
    repositoryElement("button", "repo-row__toggle")
  );
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggle.setAttribute("aria-label", "Toggle repository details");
  toggle.append(repositoryElement("span", "repo-row__caret"));
  toggle.addEventListener("click", () => toggleRepositoryRow(repository.id));
  summary.append(toggle);

  const mark = repositoryElement("span", "repo-row__mark");
  mark.setAttribute("data-lifecycle", repository.lifecycle);
  mark.setAttribute("data-health", repository.health);
  summary.append(mark);

  const primaryName =
    repository.provider === "github" || repository.provider === "forgejo"
      ? /** @type {string} */ (repository.name)
      : repositoryDisplayName(repository.url);
  const name = /** @type {HTMLAnchorElement} */ (
    repositoryElement("a", "repo-row__name", primaryName)
  );
  name.href = detailHref;
  summary.append(name);

  /** @type {[string, string, string][]} */
  const fields = [
    ["Provider and Connection", "repo-row__provider", provider],
    ["Identity", "repo-row__identity", identity],
    ["Lifecycle", "repo-row__lifecycle", repository.lifecycle],
    ["Health", "repo-row__health", observedHealth],
    ["Assignments", "repo-row__assignments", assignments],
    ["Latest verification", "repo-row__verified", latestVerification],
  ];
  for (const [label, className, value] of fields) {
    const cell = repositoryElement("span", className, value);
    cell.setAttribute("data-label", label);
    if (label === "Lifecycle") {
      cell.setAttribute("data-lifecycle", repository.lifecycle);
    } else if (label === "Health") {
      cell.setAttribute("data-health", repository.health);
    }
    summary.append(cell);
  }

  const open = /** @type {HTMLAnchorElement} */ (
    repositoryElement("a", "repo-row__open", "›")
  );
  open.href = detailHref;
  open.setAttribute("aria-label", "Open repository");
  summary.append(open);
  row.append(summary);

  const detail = repositoryElement("div", "repo-row__detail");
  detail.hidden = !expanded;
  renderRepositoryDetail(repository, detail);
  row.append(detail);
}

/**
 * @param {RepositoryResource} repository
 * @param {HTMLElement} detail
 */
function renderRepositoryDetail(repository, detail) {
  detail.replaceChildren();

  const definitions = document.createElement("dl");
  definitions.setAttribute("class", "repo-row__facts");
  /** @type {[string, string][]} */
  const facts = [];
  if (repository.provider === "github" || repository.provider === "forgejo") {
    facts.push(
      ["Provider", repository.provider === "github" ? "GitHub" : "Forgejo"],
      ["Connection", /** @type {string} */ (repository.forge_connection_id)],
      ["Forge repository", `#${repository.forge_repository_id}`],
      ["Clone URL", repository.url],
      ["Web URL", /** @type {string} */ (repository.web_url)],
      ["API URL", /** @type {string} */ (repository.api_url)],
    );
  } else {
    facts.push(
      ["Provider", "Generic HTTPS Git"],
      ["Clone URL", repository.url],
    );
  }
  facts.push([
    "Credential",
    repositoryCredentialLabel(repository.credential_type),
  ]);
  if (repository.health === "error" && repository.health_error) {
    facts.push(["Health error", repository.health_error.message]);
  }
  for (const [term, value] of facts) {
    definitions.append(repositoryElement("dt", "", term));
    const description = repositoryElement("dd", "", value);
    if (term.endsWith("URL") || term === "Clone URL") {
      description.setAttribute("class", "repo-row__mono");
    }
    definitions.append(description);
  }
  detail.append(definitions);

  const actions = repositoryElement("div", "repo-row__actions");
  /** @type {[RepositoryResource["lifecycle"], string][]} */
  const lifecycleActions = [
    ["enabled", "Enable"],
    ["disabled", "Disable"],
    ["retired", "Retire"],
  ];
  for (const [lifecycle, label] of lifecycleActions) {
    if (lifecycle === repository.lifecycle) {
      continue;
    }
    const button = /** @type {HTMLButtonElement} */ (
      repositoryElement("button", "repo-row__action", label)
    );
    button.type = "button";
    button.addEventListener("click", () =>
      driveRepositoryLifecycle(repository.id, lifecycle),
    );
    actions.append(button);
  }

  if (repository.credential_type === "username_token") {
    const rotate = /** @type {HTMLButtonElement} */ (
      repositoryElement("button", "repo-row__action", "Rotate credential")
    );
    rotate.type = "button";
    actions.append(rotate);
    const credential = repositoryElement("div", "repo-row__credential");
    credential.hidden = true;
    const username = /** @type {HTMLInputElement} */ (
      document.createElement("input")
    );
    username.setAttribute("autocomplete", "off");
    username.setAttribute("aria-label", "Replacement username");
    username.setAttribute("placeholder", "Username");
    const token = /** @type {HTMLInputElement} */ (
      document.createElement("input")
    );
    token.type = "password";
    token.setAttribute("autocomplete", "off");
    token.setAttribute("aria-label", "Replacement token");
    token.setAttribute("placeholder", "Token");
    const confirm = /** @type {HTMLButtonElement} */ (
      repositoryElement("button", "repo-row__action", "Save credential")
    );
    confirm.type = "button";
    confirm.addEventListener("click", () => {
      driveRepositoryCredential(repository.id, username.value, token.value);
      username.value = "";
      token.value = "";
      credential.hidden = true;
    });
    credential.append(username);
    credential.append(token);
    credential.append(confirm);
    rotate.addEventListener("click", () => {
      credential.hidden = !credential.hidden;
    });
    detail.append(actions);
    detail.append(credential);
  } else {
    detail.append(actions);
  }

  if (repository.deletion_eligible) {
    const remove = /** @type {HTMLButtonElement} */ (
      repositoryElement(
        "button",
        "repo-row__action repo-row__action--danger",
        "Delete",
      )
    );
    remove.type = "button";
    remove.addEventListener("click", () => driveRepositoryDeletion(repository));
    actions.append(remove);
  }
}

/** @param {string} repositoryId */
function toggleRepositoryRow(repositoryId) {
  if (expandedRepositoryIds.has(repositoryId)) {
    expandedRepositoryIds.delete(repositoryId);
  } else {
    expandedRepositoryIds.add(repositoryId);
  }
  const repository = repositoryResources.get(repositoryId);
  if (repository) {
    renderRepository(repository);
  }
}

/**
 * Drive the (hidden) lifecycle form for a specific Repository so a row action
 * reuses the exact confirmation, request, and reconciliation behavior.
 * @param {string} repositoryId
 * @param {RepositoryResource["lifecycle"]} lifecycle
 */
function driveRepositoryLifecycle(repositoryId, lifecycle) {
  /** @type {HTMLSelectElement} */ (
    requiredRepositoryElement("repository-lifecycle-repository")
  ).value = repositoryId;
  /** @type {HTMLSelectElement} */ (
    requiredRepositoryElement("repository-lifecycle-state")
  ).value = lifecycle;
  /** @type {HTMLFormElement} */ (
    requiredRepositoryElement("repository-lifecycle-form")
  ).requestSubmit();
}

/**
 * @param {string} repositoryId
 * @param {string} username
 * @param {string} token
 */
function driveRepositoryCredential(repositoryId, username, token) {
  /** @type {HTMLSelectElement} */ (
    requiredRepositoryElement("repository-credential-rotate-repository")
  ).value = repositoryId;
  /** @type {HTMLInputElement} */ (
    requiredRepositoryElement("repository-credential-rotate-username")
  ).value = username;
  /** @type {HTMLInputElement} */ (
    requiredRepositoryElement("repository-credential-rotate-token")
  ).value = token;
  /** @type {HTMLFormElement} */ (
    requiredRepositoryElement("repository-credential-rotate-form")
  ).requestSubmit();
}

/** @param {RepositoryResource} repository */
function driveRepositoryDeletion(repository) {
  /** @type {HTMLSelectElement} */ (
    requiredRepositoryElement("repository-lifecycle-repository")
  ).value = repository.id;
  syncRepositoryDeleteAvailability();
  /** @type {HTMLButtonElement} */ (
    requiredRepositoryElement("repository-delete")
  ).click();
}

/** @param {RepositoryResource} repository */
function repositoryConfirmationIdentity(repository) {
  if (
    !["github", "forgejo"].includes(repository.provider ?? "") ||
    typeof repository.forge_connection_id !== "string" ||
    !Number.isSafeInteger(repository.forge_repository_id)
  ) {
    return repository.url;
  }
  const provider = repository.provider === "github" ? "GitHub" : "Forgejo";
  return `${provider} Repository ${repository.forge_repository_id} on Connection ${repository.forge_connection_id}`;
}

/** @param {RepositoryResource} repository */
function addLifecycleOption(repository) {
  const select = /** @type {HTMLSelectElement} */ (
    requiredRepositoryElement("repository-lifecycle-repository")
  );
  if ([...select.options].some(({ value }) => value === repository.id)) {
    return;
  }
  const option = document.createElement("option");
  option.textContent = repository.url;
  option.value = repository.id;
  select.append(option);
  select.disabled = false;
  /** @type {HTMLButtonElement} */ (
    requiredRepositoryElement("repository-lifecycle-submit")
  ).disabled = false;
  syncRepositoryDeleteAvailability();
}

function syncRepositoryDeleteAvailability() {
  const repositoryId = /** @type {HTMLSelectElement} */ (
    requiredRepositoryElement("repository-lifecycle-repository")
  ).value;
  /** @type {HTMLButtonElement} */ (
    requiredRepositoryElement("repository-delete")
  ).disabled =
    repositoryResources.get(repositoryId)?.deletion_eligible !== true;
}

function rebuildRepositoryCredentialOptions() {
  const select = /** @type {HTMLSelectElement} */ (
    requiredRepositoryElement("repository-credential-rotate-repository")
  );
  select.replaceChildren();
  const repositories = [...repositoryResources.values()].filter(
    (repository) => repository.credential_type === "username_token",
  );
  for (const repository of repositories) {
    const option = document.createElement("option");
    option.textContent = repository.url;
    option.value = repository.id;
    select.append(option);
  }
  select.disabled = repositories.length === 0;
  /** @type {HTMLButtonElement} */ (
    requiredRepositoryElement("repository-credential-rotate-submit")
  ).disabled = repositories.length === 0;
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
  /** @type {HTMLButtonElement} */ (
    requiredRepositoryElement("repository-delete")
  ).disabled = true;
  rebuildRepositoryCredentialOptions();
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
  }
  publishRepositoryResources();
  rebuildRepositoryCredentialOptions();
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
        publishRepositoryResources();
        rebuildRepositoryCredentialOptions();
      }
      return `${repository.url} registered as ${repository.id}.`;
    },
    "Repository registration failed",
  );
});

const repositoryLifecycleForm = /** @type {HTMLFormElement} */ (
  requiredRepositoryElement("repository-lifecycle-form")
);
requiredRepositoryElement("repository-lifecycle-repository").addEventListener(
  "change",
  syncRepositoryDeleteAvailability,
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
  if (!["enabled", "disabled", "retired"].includes(lifecycle)) {
    throw new Error("repository_lifecycle_invalid");
  }
  const repository = repositoryResources.get(repositoryId);
  if (!repository) {
    throw new Error("repository_lifecycle_target_missing");
  }
  const consequence = {
    disabled: "New work will be rejected; already-created work may finish.",
    enabled:
      "Complete current verification must succeed before new work is accepted.",
    retired: "Repository-bound credentials will be destroyed.",
  }[lifecycle];
  const action = {
    disabled: "Disable",
    enabled: "Enable",
    retired: "Retire",
  }[lifecycle];
  if (
    !window.confirm(
      `${action} ${repositoryConfirmationIdentity(repository)}? ${consequence}`,
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
        publishRepositoryResources();
        rebuildRepositoryCredentialOptions();
        syncRepositoryDeleteAvailability();
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
