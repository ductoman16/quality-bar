const {
  displayMutationFailure: displayRepositoryGuidanceFailure,
  error: repositoryGuidanceError,
  requiredElement: requiredRepositoryGuidanceElement,
} = /** @type {{
 *   displayMutationFailure: (response: Response) => Promise<void>,
 *   error: HTMLElement,
 *   requiredElement: (id: string) => HTMLElement
 * }} */ (Reflect.get(window, "qualityBarOperator"));

const repositoryGuidanceSelect = /** @type {HTMLSelectElement} */ (
  requiredRepositoryGuidanceElement("repository-guidance-repository")
);
const repositoryGuidanceDocument = requiredRepositoryGuidanceElement(
  "repository-guidance-document",
);

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
  repositoryGuidanceDocument.textContent = "";
  repositoryGuidanceError.hidden = true;
  let response;
  try {
    response = await fetch(
      `/api/v1/repositories/${encodeURIComponent(repositoryGuidanceSelect.value)}/guidance`,
    );
  } catch {
    repositoryGuidanceError.textContent = "Repository Guidance failed";
    repositoryGuidanceError.hidden = false;
    return;
  }
  if (!response.ok) {
    await displayRepositoryGuidanceFailure(response);
    return;
  }
  try {
    repositoryGuidanceDocument.textContent = JSON.stringify(
      requireRepositoryGuidance(await response.json()),
      null,
      2,
    );
  } catch {
    repositoryGuidanceDocument.textContent = "";
    repositoryGuidanceError.textContent = "Repository Guidance failed";
    repositoryGuidanceError.hidden = false;
  }
}

repositoryGuidanceSelect.addEventListener("change", loadRepositoryGuidance);

async function loadRepositoryGuidanceOptions() {
  repositoryGuidanceSelect.replaceChildren();
  repositoryGuidanceSelect.disabled = true;
  let response;
  try {
    response = await fetch("/api/v1/repositories");
  } catch {
    repositoryGuidanceError.textContent = "Repository listing failed";
    repositoryGuidanceError.hidden = false;
    return;
  }
  if (!response.ok) {
    await displayRepositoryGuidanceFailure(response);
    return;
  }
  const body = /** @type {{repositories?: unknown}} */ (await response.json());
  if (!Array.isArray(body.repositories)) {
    throw new Error("repository_list_invalid");
  }
  for (const repository of body.repositories) {
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
    repositoryGuidanceSelect.disabled = false;
    await loadRepositoryGuidance();
  }
}

loadRepositoryGuidanceOptions();
