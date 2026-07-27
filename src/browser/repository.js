const {
  csrfToken: repositoryCsrfToken,
  displayMutationFailure: displayRepositoryMutationFailure,
  error: repositoryError,
  requiredElement: requiredRepositoryElement,
} = /** @type {{
 *   csrfToken: () => string,
 *   displayMutationFailure: (response: Response) => Promise<void>,
 *   error: HTMLElement,
 *   requiredElement: (id: string) => HTMLElement
 * }} */ (Reflect.get(window, "qualityBarOperator"));

/**
 * @param {HTMLFormElement} form
 * @param {HTMLElement} result
 * @param {string} path
 * @param {Record<string, string>} body
 * @param {(repository: {id: string, url: string}) => Promise<string> | string} successMessage
 * @param {string} networkFailureMessage
 */
async function submitRepositoryMutation(
  form,
  result,
  path,
  body,
  successMessage,
  networkFailureMessage,
) {
  repositoryError.hidden = true;
  result.textContent = "";
  let response;
  try {
    response = await fetch(path, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": repositoryCsrfToken(),
      },
      method: "POST",
    });
  } catch {
    repositoryError.textContent = networkFailureMessage;
    repositoryError.hidden = false;
    return;
  }
  if (!response.ok) {
    await displayRepositoryMutationFailure(response);
    return;
  }
  const repository = /** @type {{id: string, url: string}} */ (
    await response.json()
  );
  result.textContent = await successMessage(repository);
  form.reset();
}

/** @param {{id: string, url: string}} repository */
function addRepositoryOption(repository) {
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

async function loadRepositoryOptions() {
  let response;
  try {
    response = await fetch("/api/v1/repositories");
  } catch {
    repositoryError.textContent = "Repository listing failed";
    repositoryError.hidden = false;
    return false;
  }
  if (!response.ok) {
    await displayRepositoryMutationFailure(response);
    return false;
  }
  const body = /** @type {{repositories: {id: string, url: string}[]}} */ (
    await response.json()
  );
  /** @type {HTMLSelectElement} */ (
    requiredRepositoryElement("repository-credential-rotate-repository")
  ).replaceChildren();
  for (const repository of body.repositories) {
    addRepositoryOption(repository);
  }
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
      if (username && token && (await repositoryOptionsLoaded)) {
        addRepositoryOption(repository);
      }
      return `${repository.url} registered as ${repository.id}.`;
    },
    "Repository registration failed",
  );
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
    (repository) => repository.url + " credential rotated.",
    "Repository credential rotation failed",
  );
});
