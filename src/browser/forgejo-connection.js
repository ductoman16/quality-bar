window.addEventListener("DOMContentLoaded", () => {
  const forgejoOperator =
    /** @type {{ csrfToken: () => string, requiredElement: (id: string) => HTMLElement }} */ (
      Reflect.get(window, "qualityBarOperator")
    );
  const forgejoContract =
    /** @type {{forgejoResponseErrorMessage: (response: Response) => Promise<string>, forgejoVerificationText: (verification: any) => string, validForgejoConnection: (value: unknown) => boolean}} */ (
      Reflect.get(window, "qualityBarForgejoConnectionContract")
    );
  /** @param {string} id */
  const form = (id) =>
    /** @type {HTMLFormElement} */ (forgejoOperator.requiredElement(id));
  /** @param {string} id */
  const input = (id) =>
    /** @type {HTMLInputElement} */ (forgejoOperator.requiredElement(id));
  const forgejoForm = form("forgejo-connection-form");
  const forgejoRotationForm = form("forgejo-connection-rotation-form");
  const forgejoReactivationForm = form("forgejo-connection-reactivation-form");
  const forgejoLifecycleForm = form("forgejo-connection-lifecycle-form");
  const forgejoBaseUrl = input("forgejo-connection-base-url");
  const forgejoToken = input("forgejo-connection-token");
  const forgejoRotationToken = input("forgejo-connection-rotation-token");
  const forgejoReactivationToken = input(
    "forgejo-connection-reactivation-token",
  );
  const forgejoDetails = forgejoOperator.requiredElement(
    "forgejo-connection-details",
  );
  const forgejoIdentity = forgejoOperator.requiredElement(
    "forgejo-connection-identity",
  );
  const forgejoLifecycle = forgejoOperator.requiredElement(
    "forgejo-connection-lifecycle",
  );
  const forgejoHealth = forgejoOperator.requiredElement(
    "forgejo-connection-health",
  );
  const forgejoLatest = forgejoOperator.requiredElement(
    "forgejo-connection-latest",
  );
  const forgejoProfile = forgejoOperator.requiredElement(
    "forgejo-connection-profile",
  );
  const forgejoScopes = forgejoOperator.requiredElement(
    "forgejo-connection-scopes",
  );
  const forgejoCapabilities = forgejoOperator.requiredElement(
    "forgejo-connection-capabilities",
  );
  const forgejoHistory = forgejoOperator.requiredElement(
    "forgejo-connection-history",
  );
  const forgejoRetire = /** @type {HTMLButtonElement} */ (
    forgejoOperator.requiredElement("forgejo-connection-retire")
  );
  const forgejoDelete = /** @type {HTMLButtonElement} */ (
    forgejoOperator.requiredElement("forgejo-connection-delete")
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
  function renderForgejoConnection(value) {
    if (value === null) {
      forgejoDetails.hidden = true;
      forgejoForm.hidden = false;
      forgejoRotationForm.hidden = true;
      forgejoReactivationForm.hidden = true;
      forgejoLifecycleForm.hidden = true;
      return;
    }
    if (!forgejoContract.validForgejoConnection(value)) {
      throw new Error("Forgejo Connection response is invalid");
    }
    const connection = /** @type {any} */ (value);
    forgejoIdentity.textContent = connection.principal.login;
    forgejoLifecycle.textContent =
      connection.lifecycle === "retired" ? "Retired" : "Enabled";
    forgejoHealth.textContent =
      connection.health === "healthy"
        ? "Verified"
        : `${connection.health_error.message} (${connection.health_error.code})`;
    forgejoProfile.textContent = `${connection.api_profile}; compatible; ${connection.reported_version}`;
    forgejoScopes.textContent = connection.scopes.join(", ");
    forgejoCapabilities.textContent = Object.entries(connection.capabilities)
      .map(
        ([name, outcome]) => `${name.replaceAll("_", " ")}: ${String(outcome)}`,
      )
      .join("; ");
    forgejoLatest.textContent = new Date(connection.verified_at).toISOString();
    forgejoHistory.replaceChildren();
    for (const verification of connection.verification_history) {
      const item = document.createElement("li");
      item.textContent = forgejoContract.forgejoVerificationText(verification);
      forgejoHistory.append(item);
    }
    forgejoDetails.hidden = false;
    forgejoForm.hidden = true;
    forgejoRotationForm.hidden = connection.lifecycle === "retired";
    forgejoReactivationForm.hidden = connection.lifecycle !== "retired";
    forgejoLifecycleForm.hidden = false;
    forgejoRetire.hidden = connection.lifecycle === "retired";
    forgejoDelete.hidden = false;
  }

  async function loadForgejoConnection() {
    try {
      const response = await fetch("/api/v1/forgejo-connections");
      if (!response.ok) {
        showForgejoError(
          await forgejoContract.forgejoResponseErrorMessage(response),
        );
        return;
      }
      renderForgejoConnection(await response.json());
    } catch (error) {
      showForgejoError(
        error instanceof Error
          ? error.message
          : "Forgejo Connection loading failed",
      );
    }
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
      const connection = /** @type {unknown} */ (await response.json());
      renderForgejoConnection(connection);
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
      if (
        !forgejoContract.validForgejoConnection(connection) ||
        /** @type {any} */ (connection).health !== "healthy"
      ) {
        showForgejoError("Forgejo PAT rotation response is invalid");
        return;
      }
      renderForgejoConnection(connection);
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
  forgejoReactivationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    forgejoError.hidden = true;
    if (!forgejoReactivationToken.value) {
      showForgejoError("Reactivation PAT is required");
      forgejoReactivationToken.focus();
      return;
    }
    const submit = /** @type {HTMLButtonElement} */ (
      forgejoOperator.requiredElement("forgejo-connection-reactivation-submit")
    );
    submit.disabled = true;
    try {
      const response = await fetch("/api/v1/forgejo-connections/reactivate", {
        body: JSON.stringify({ token: forgejoReactivationToken.value }),
        headers: {
          "content-type": "application/json",
          "x-quality-bar-csrf": forgejoOperator.csrfToken(),
        },
        method: "POST",
      });
      if (!response.ok) {
        showForgejoError(
          await forgejoContract.forgejoResponseErrorMessage(response),
        );
        return;
      }
      renderForgejoConnection(await response.json());
      forgejoReactivationToken.value = "";
      forgejoStatus.textContent = "Forgejo Connection reactivated.";
      forgejoStatus.focus();
    } catch (error) {
      showForgejoError(
        error instanceof Error
          ? error.message
          : "Forgejo Connection reactivation failed",
      );
    } finally {
      submit.disabled = false;
    }
  });

  const bindLifecycleConfirmation = /** @type {(options: any) => void} */ (
    Reflect.get(window, "qualityBarForgejoConnectionLifecycleConfirmation")
  );
  bindLifecycleConfirmation({
    csrfToken: forgejoOperator.csrfToken,
    identity: forgejoIdentity,
    remove: forgejoDelete,
    render: renderForgejoConnection,
    responseMessage: forgejoContract.forgejoResponseErrorMessage,
    retire: forgejoRetire,
    showError: showForgejoError,
    status: forgejoStatus,
  });
  void loadForgejoConnection();
});
