const {
  error: repositoryGuidanceError,
  requiredElement: requiredRepositoryGuidanceElement,
} = /** @type {{
 *   error: HTMLElement,
 *   requiredElement: (id: string) => HTMLElement
 * }} */ (Reflect.get(window, "qualityBarOperator"));

const repositoryGuidanceSelect = /** @type {HTMLSelectElement} */ (
  requiredRepositoryGuidanceElement("repository-guidance-repository")
);
const repositoryGuidanceDocument = requiredRepositoryGuidanceElement(
  "repository-guidance-document",
);
const repositoryCollection = /** @type {{
 *   subscribe: (
 *     subscriber: (repositories: Array<{id: string, url: string}>) => unknown
 *   ) => void
 * }} */ (Reflect.get(window, "qualityBarRepositories"));
if (typeof repositoryCollection?.subscribe !== "function") {
  throw new TypeError(
    "qualityBarRepositories must provide the Repository collection",
  );
}

let guidanceRequestIdentity = 0;

/** @param {unknown} value */
function requireRepositoryGuidance(value) {
  const guidance =
    value && typeof value === "object"
      ? /** @type {Record<string, unknown>} */ (value)
      : null;
  if (
    guidance?.schema_version !== 1 ||
    typeof guidance.guidance_revision !== "string" ||
    !guidance.repository ||
    typeof guidance.repository !== "object" ||
    !Array.isArray(guidance.reviews)
  ) {
    throw new Error("repository_guidance_document_invalid");
  }
  return guidance;
}

async function loadRepositoryGuidance() {
  const requestIdentity = ++guidanceRequestIdentity;
  repositoryGuidanceDocument.textContent = "";
  repositoryGuidanceError.hidden = true;
  let response;
  try {
    response = await fetch(
      `/api/v1/repositories/${encodeURIComponent(repositoryGuidanceSelect.value)}/guidance`,
    );
  } catch {
    if (requestIdentity !== guidanceRequestIdentity) {
      return;
    }
    repositoryGuidanceError.textContent = "Repository Guidance failed";
    repositoryGuidanceError.hidden = false;
    return;
  }
  if (requestIdentity !== guidanceRequestIdentity) {
    return;
  }
  if (!response.ok) {
    const failure = /** @type {{error?: {message?: unknown}}} */ (
      await response.json()
    );
    if (requestIdentity !== guidanceRequestIdentity) {
      return;
    }
    if (typeof failure.error?.message !== "string") {
      throw new Error("repository_guidance_error_invalid");
    }
    repositoryGuidanceError.textContent = failure.error.message;
    repositoryGuidanceError.hidden = false;
    return;
  }
  let decoded;
  try {
    decoded = await response.json();
  } catch (cause) {
    throw new Error("repository_guidance_document_invalid", { cause });
  }
  if (requestIdentity !== guidanceRequestIdentity) {
    return;
  }
  repositoryGuidanceDocument.textContent = JSON.stringify(
    requireRepositoryGuidance(decoded),
    null,
    2,
  );
}

repositoryGuidanceSelect.addEventListener("change", loadRepositoryGuidance);

/** @param {Array<{id: string, url: string}>} repositories */
function useRepositoryCollection(repositories) {
  const selectedRepositoryId = repositoryGuidanceSelect.value;
  ++guidanceRequestIdentity;
  repositoryGuidanceDocument.textContent = "";
  repositoryGuidanceSelect.replaceChildren();
  repositoryGuidanceSelect.disabled = true;
  for (const repository of repositories) {
    if (
      !repository ||
      typeof repository.id !== "string" ||
      typeof repository.url !== "string"
    ) {
      throw new Error("repository_list_invalid");
    }
    const option = document.createElement("option");
    option.textContent = repository.url;
    option.value = repository.id;
    repositoryGuidanceSelect.append(option);
  }
  if (repositoryGuidanceSelect.options.length > 0) {
    if (repositories.some(({ id }) => id === selectedRepositoryId)) {
      repositoryGuidanceSelect.value = selectedRepositoryId;
    }
    repositoryGuidanceSelect.disabled = false;
    return loadRepositoryGuidance();
  }
}

repositoryCollection.subscribe(useRepositoryCollection);
