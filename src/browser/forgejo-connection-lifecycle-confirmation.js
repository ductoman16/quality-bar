/**
 * @param {{
 *   csrfToken: () => string,
 *   identity: HTMLElement,
 *   remove: HTMLButtonElement,
 *   render: (value: unknown) => void,
 *   responseMessage: (response: Response) => Promise<string>,
 *   retire: HTMLButtonElement,
 *   showCaughtError: (error: unknown) => string,
 *   showError: (message: string) => void,
 *   status: HTMLElement
 * }} options
 */
function bindForgejoConnectionLifecycleConfirmation(options) {
  const { requiredElement } =
    /** @type {{requiredElement: (id: string) => HTMLElement}} */ (
      Reflect.get(window, "qualityBarOperator")
    );
  const confirmation = /** @type {HTMLDialogElement} */ (
    requiredElement("forgejo-connection-confirmation")
  );
  const form = /** @type {HTMLFormElement} */ (
    requiredElement("forgejo-connection-confirmation-form")
  );
  const message = requiredElement("forgejo-connection-confirmation-message");
  const label = requiredElement("forgejo-connection-confirmation-label");
  const input = /** @type {HTMLInputElement} */ (
    requiredElement("forgejo-connection-confirmation-input")
  );
  const cancel = /** @type {HTMLButtonElement} */ (
    requiredElement("forgejo-connection-confirmation-cancel")
  );
  const submit = /** @type {HTMLButtonElement} */ (
    requiredElement("forgejo-connection-confirmation-submit")
  );
  /** @type {{method: "PATCH" | "DELETE", source: HTMLButtonElement} | null} */
  let active = null;

  /** @param {"PATCH" | "DELETE"} method @param {HTMLButtonElement} source */
  function open(method, source) {
    active = { method, source };
    const deletion = method === "DELETE";
    message.textContent = deletion
      ? `Delete Forgejo Connection for ${options.identity.textContent} permanently. This cannot be undone.`
      : `Retire Forgejo Connection for ${options.identity.textContent}. Its PAT will be destroyed and reactivation requires verification.`;
    label.hidden = !deletion;
    input.hidden = !deletion;
    input.required = deletion;
    input.value = "";
    confirmation.showModal();
    (deletion ? input : submit).focus();
  }

  function close() {
    const source = active?.source;
    active = null;
    confirmation.close();
    source?.focus();
  }

  options.retire.addEventListener("click", () => open("PATCH", options.retire));
  options.remove.addEventListener("click", () =>
    open("DELETE", options.remove),
  );
  cancel.addEventListener("click", close);
  confirmation.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selected = active;
    if (!selected) {
      return;
    }
    if (selected.method === "DELETE" && input.value !== "DELETE") {
      options.showError(
        "Type DELETE to confirm permanent Forgejo Connection deletion",
      );
      input.focus();
      return;
    }
    active = null;
    confirmation.close();
    selected.source.disabled = true;
    options.status.textContent =
      selected.method === "DELETE"
        ? "Deleting Forgejo Connection."
        : "Retiring Forgejo Connection.";
    try {
      const response = await fetch("/api/v1/forgejo-connections/lifecycle", {
        body: JSON.stringify(
          selected.method === "DELETE" ? {} : { lifecycle: "retired" },
        ),
        headers: {
          "content-type": "application/json",
          "x-quality-bar-csrf": options.csrfToken(),
        },
        method: selected.method,
      });
      if (!response.ok) {
        options.showError(await options.responseMessage(response));
        selected.source.focus();
        return;
      }
      if (selected.method === "DELETE") {
        options.render(null);
        options.status.textContent = "Forgejo Connection deleted.";
      } else {
        options.render(await response.json());
        options.status.textContent = "Forgejo Connection retired.";
      }
      options.status.focus();
    } catch (error) {
      options.showError(options.showCaughtError(error));
      selected.source.focus();
    } finally {
      selected.source.disabled = false;
    }
  });
}

Reflect.set(
  window,
  "qualityBarForgejoConnectionLifecycleConfirmation",
  bindForgejoConnectionLifecycleConfirmation,
);
