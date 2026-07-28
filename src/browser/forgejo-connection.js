window.addEventListener("DOMContentLoaded", () => {
  const forgejoOperator =
    /** @type {{ csrfToken: () => string, requiredElement: (id: string) => HTMLElement }} */ (
      Reflect.get(window, "qualityBarOperator")
    );
  const forgejoForm = /** @type {HTMLFormElement} */ (
    forgejoOperator.requiredElement("forgejo-connection-form")
  );
  const forgejoRotationForm = /** @type {HTMLFormElement} */ (
    forgejoOperator.requiredElement("forgejo-connection-rotation-form")
  );
  const forgejoBaseUrl = /** @type {HTMLInputElement} */ (
    forgejoOperator.requiredElement("forgejo-connection-base-url")
  );
  const forgejoToken = /** @type {HTMLInputElement} */ (
    forgejoOperator.requiredElement("forgejo-connection-token")
  );
  const forgejoRotationToken = /** @type {HTMLInputElement} */ (
    forgejoOperator.requiredElement("forgejo-connection-rotation-token")
  );
  const forgejoRepositories = forgejoOperator.requiredElement(
    "forgejo-connection-repositories",
  );
  const forgejoRepositoryFieldset = /** @type {HTMLFieldSetElement} */ (
    forgejoOperator.requiredElement("forgejo-connection-repository-fieldset")
  );
  const forgejoStatus = forgejoOperator.requiredElement(
    "forgejo-connection-status",
  );
  const forgejoError = forgejoOperator.requiredElement(
    "forgejo-connection-error",
  );

  /** @param {string} message */
  function showForgejoError(message) {
    forgejoStatus.textContent = "";
    forgejoError.textContent = message;
    forgejoError.hidden = false;
    forgejoError.focus();
  }

  /** @param {Response} response */
  async function forgejoRotationResponse(response) {
    try {
      return /** @type {unknown} */ (await response.json());
    } catch {
      throw new Error("Forgejo PAT rotation response is invalid");
    }
  }

  /** @param {unknown} value */
  function validRotatedForgejoConnection(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const connection = /** @type {Record<string, unknown>} */ (value);
    const principal =
      connection.principal &&
      typeof connection.principal === "object" &&
      !Array.isArray(connection.principal)
        ? /** @type {Record<string, unknown>} */ (connection.principal)
        : null;
    return (
      connection.api_profile === "forgejo-v16" &&
      typeof connection.base_url === "string" &&
      connection.base_url.length > 0 &&
      connection.capabilities !== null &&
      typeof connection.capabilities === "object" &&
      !Array.isArray(connection.capabilities) &&
      connection.health === "healthy" &&
      connection.health_error === null &&
      typeof connection.id === "string" &&
      connection.id.length > 0 &&
      Number.isSafeInteger(principal?.id) &&
      typeof principal?.login === "string" &&
      principal.login.length > 0 &&
      typeof connection.reported_version === "string" &&
      /^16\./.test(connection.reported_version) &&
      Array.isArray(connection.scopes) &&
      connection.scopes.every((scope) => typeof scope === "string") &&
      Number.isSafeInteger(connection.verified_at) &&
      Object.keys(connection).length === 10
    );
  }

  forgejoForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    forgejoError.hidden = true;
    if (!forgejoBaseUrl.value || !forgejoToken.value) {
      showForgejoError("Forgejo URL and Repository-scoped PAT are required");
      (!forgejoBaseUrl.value ? forgejoBaseUrl : forgejoToken).focus();
      return;
    }
    const repositoryIds = [
      ...forgejoRepositories.querySelectorAll("input:checked"),
    ].map((control) => Number(/** @type {HTMLInputElement} */ (control).value));
    const discovering = forgejoRepositoryFieldset.disabled;
    if (!discovering && repositoryIds.length === 0) {
      showForgejoError("Select at least one Forgejo Repository");
      /** @type {HTMLElement | null} */ (
        forgejoRepositories.querySelector("input")
      )?.focus();
      return;
    }
    forgejoStatus.textContent = discovering
      ? "Verifying Forgejo Connection."
      : "Registering selected Forgejo Repositories.";
    const submit = /** @type {HTMLButtonElement} */ (
      forgejoOperator.requiredElement("forgejo-connection-submit")
    );
    submit.disabled = true;
    try {
      const response = await fetch(
        discovering
          ? "/api/v1/forgejo-connections/discover"
          : "/api/v1/forgejo-connections",
        {
          body: JSON.stringify({
            base_url: forgejoBaseUrl.value,
            token: forgejoToken.value,
            ...(discovering ? {} : { repository_ids: repositoryIds }),
          }),
          headers: {
            "content-type": "application/json",
            "x-quality-bar-csrf": forgejoOperator.csrfToken(),
          },
          method: "POST",
        },
      );
      if (!response.ok) {
        const body = /** @type {{error?: {message?: unknown}}} */ (
          await response.json()
        );
        showForgejoError(
          typeof body.error?.message === "string"
            ? body.error.message
            : "Forgejo Connection response is invalid",
        );
        return;
      }
      if (discovering) {
        const repositories = /** @type {unknown} */ (await response.json());
        if (!Array.isArray(repositories) || repositories.length === 0) {
          showForgejoError("Forgejo Repository discovery response is invalid");
          return;
        }
        forgejoRepositories.replaceChildren();
        for (const repository of repositories) {
          if (
            !repository ||
            typeof repository !== "object" ||
            !("id" in repository) ||
            !Number.isSafeInteger(repository.id) ||
            !("full_name" in repository) ||
            typeof repository.full_name !== "string"
          ) {
            showForgejoError(
              "Forgejo Repository discovery response is invalid",
            );
            return;
          }
          const label = document.createElement("label");
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.value = String(repository.id);
          const name = document.createElement("span");
          name.textContent = repository.full_name;
          label.append(checkbox, name);
          forgejoRepositories.append(label);
        }
        forgejoRepositoryFieldset.disabled = false;
        forgejoStatus.textContent = "Forgejo Repositories verified.";
        /** @type {HTMLElement | null} */ (
          forgejoRepositories.querySelector("input")
        )?.focus();
        return;
      }
      forgejoToken.value = "";
      forgejoStatus.textContent = "Forgejo Connection verified.";
      forgejoStatus.focus();
    } catch {
      showForgejoError("Forgejo Connection verification failed");
    } finally {
      submit.disabled = false;
    }
  });
  forgejoRotationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    forgejoError.hidden = true;
    if (!forgejoRotationToken.value) {
      showForgejoError("Replacement Forgejo PAT is required");
      forgejoRotationToken.focus();
      return;
    }
    if (
      !window.confirm(
        "Rotate Forgejo PAT? Quality Bar will replace its old copy after verification. Revoke the predecessor in Forgejo.",
      )
    ) {
      forgejoRotationToken.focus();
      return;
    }
    forgejoStatus.textContent = "Verifying replacement Forgejo PAT.";
    const submit = /** @type {HTMLButtonElement} */ (
      forgejoOperator.requiredElement("forgejo-connection-rotation-submit")
    );
    submit.disabled = true;
    try {
      const response = await fetch(
        "/api/v1/forgejo-connections/credential/rotate",
        {
          body: JSON.stringify({ token: forgejoRotationToken.value }),
          headers: {
            "content-type": "application/json",
            "x-quality-bar-csrf": forgejoOperator.csrfToken(),
          },
          method: "POST",
        },
      );
      if (!response.ok) {
        const body = /** @type {{error?: {message?: unknown}}} */ (
          await forgejoRotationResponse(response)
        );
        showForgejoError(
          typeof body.error?.message === "string"
            ? body.error.message
            : "Forgejo PAT rotation response is invalid",
        );
        return;
      }
      const connection = await forgejoRotationResponse(response);
      if (!validRotatedForgejoConnection(connection)) {
        showForgejoError("Forgejo PAT rotation response is invalid");
        return;
      }
      forgejoRotationToken.value = "";
      forgejoStatus.textContent =
        "Forgejo PAT rotated. Revoke its predecessor in Forgejo.";
      forgejoStatus.focus();
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      showForgejoError(error.message);
    } finally {
      submit.disabled = false;
    }
  });
});
