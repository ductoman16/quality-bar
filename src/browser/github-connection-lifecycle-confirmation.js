/**
 * @param {{
 *   confirmation: HTMLDialogElement,
 *   csrfToken: () => string,
 *   error: HTMLElement,
 *   fetch: typeof fetch,
 *   input: HTMLInputElement,
 *   label: HTMLElement,
 *   message: HTMLElement,
 *   remove: HTMLButtonElement,
 *   render: (value: unknown) => void,
 *   responseErrorMessage: (response: Response) => Promise<string>,
 *   retire: HTMLButtonElement,
 *   showError: (message: string) => void,
 *   status: HTMLElement,
 *   submit: HTMLButtonElement
 * }} options
 */
function createGitHubConnectionLifecycleConfirmation(options) {
  /** @type {{body: unknown, method: "PATCH" | "DELETE", source: HTMLButtonElement} | null} */
  let active = null;
  /** @param {"PATCH" | "DELETE"} method @param {unknown} body */
  async function mutate(method, body) {
    options.error.hidden = true;
    options.retire.disabled = true;
    options.remove.disabled = true;
    try {
      const response = await options.fetch(
        "/api/v1/github-connections/lifecycle",
        {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
            "x-quality-bar-csrf": options.csrfToken(),
          },
          method,
        },
      );
      if (!response.ok) {
        throw new Error(await options.responseErrorMessage(response));
      }
      if (method === "DELETE") {
        options.render(null);
        options.status.textContent = "GitHub Connection deleted.";
      } else {
        options.render(await response.json());
        options.status.textContent = "GitHub Connection retired.";
      }
      options.status.focus();
    } catch (error) {
      options.showError(
        error instanceof Error
          ? error.message
          : "GitHub Connection lifecycle failed",
      );
    } finally {
      options.retire.disabled = false;
      options.remove.disabled = false;
    }
  }
  return {
    cancel() {
      const source = active?.source;
      active = null;
      options.confirmation.close();
      source?.focus();
    },
    /** @param {"PATCH" | "DELETE"} method @param {unknown} body @param {HTMLButtonElement} source @param {string} identity */
    open(method, body, source, identity) {
      active = { body, method, source };
      const deletion = method === "DELETE";
      options.message.textContent = deletion
        ? `Delete GitHub Connection for ${identity} permanently. This cannot be undone.`
        : `Retire GitHub Connection for ${identity}. Its credential will be destroyed and reactivation requires verification.`;
      options.label.hidden = !deletion;
      options.input.hidden = !deletion;
      options.input.required = deletion;
      options.input.value = "";
      options.confirmation.showModal();
      (deletion ? options.input : options.submit).focus();
    },
    /** @param {SubmitEvent} event */
    async submit(event) {
      event.preventDefault();
      const confirmation = active;
      if (!confirmation) {
        return;
      }
      if (
        confirmation.method === "DELETE" &&
        options.input.value !== "DELETE"
      ) {
        options.showError(
          "Type DELETE to confirm permanent GitHub Connection deletion",
        );
        options.input.focus();
        return;
      }
      active = null;
      options.confirmation.close();
      await mutate(confirmation.method, confirmation.body);
    },
  };
}

/** @param {any} options */
function bindGitHubConnectionLifecycleConfirmation(options) {
  const { requiredElement } =
    /** @type {{requiredElement: (id: string) => HTMLElement}} */ (
      Reflect.get(window, "qualityBarOperator")
    );
  const confirmation = /** @type {HTMLDialogElement} */ (
    requiredElement("github-connection-confirmation")
  );
  const form = /** @type {HTMLFormElement} */ (
    requiredElement("github-connection-confirmation-form")
  );
  const input = /** @type {HTMLInputElement} */ (
    requiredElement("github-connection-confirmation-input")
  );
  const cancel = /** @type {HTMLButtonElement} */ (
    requiredElement("github-connection-confirmation-cancel")
  );
  const submit = /** @type {HTMLButtonElement} */ (
    requiredElement("github-connection-confirmation-submit")
  );
  const lifecycle = createGitHubConnectionLifecycleConfirmation({
    ...options,
    confirmation,
    input,
    label: requiredElement("github-connection-confirmation-label"),
    message: requiredElement("github-connection-confirmation-message"),
    submit,
  });
  options.retire.addEventListener("click", () =>
    lifecycle.open(
      "PATCH",
      { lifecycle: "retired" },
      options.retire,
      options.identity.textContent,
    ),
  );
  options.remove.addEventListener("click", () =>
    lifecycle.open("DELETE", {}, options.remove, options.identity.textContent),
  );
  cancel.addEventListener("click", () => lifecycle.cancel());
  confirmation.addEventListener("cancel", (event) => {
    event.preventDefault();
    lifecycle.cancel();
  });
  form.addEventListener("submit", (event) => lifecycle.submit(event));
}

Reflect.set(
  window,
  "qualityBarGitHubConnectionLifecycleConfirmation",
  bindGitHubConnectionLifecycleConfirmation,
);
