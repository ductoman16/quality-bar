window.addEventListener("DOMContentLoaded", () => {
  const forgejoOperator =
    /** @type {{ csrfToken: () => string, requiredElement: (id: string) => HTMLElement }} */ (
      Reflect.get(window, "qualityBarOperator")
    );
  const forgejoForm = /** @type {HTMLFormElement} */ (
    forgejoOperator.requiredElement("forgejo-connection-form")
  );
  const forgejoBaseUrl = /** @type {HTMLInputElement} */ (
    forgejoOperator.requiredElement("forgejo-connection-base-url")
  );
  const forgejoToken = /** @type {HTMLInputElement} */ (
    forgejoOperator.requiredElement("forgejo-connection-token")
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
});
