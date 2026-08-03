/**
 * @param {{
 *   csrfToken: () => string,
 *   error: HTMLElement,
 *   fetch: typeof fetch,
 *   form: HTMLFormElement,
 *   pem: HTMLTextAreaElement,
 *   render: (value: unknown) => void,
 *   responseErrorMessage: (response: Response) => Promise<string>,
 *   showError: (message: string) => void,
 *   status: HTMLElement,
 *   submit: HTMLButtonElement
 * }} options
 */
function bindGitHubConnectionSubmission(options) {
  options.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    options.error.hidden = true;
    const reactivating = !options.pem.hidden;
    options.status.textContent = reactivating
      ? "Reactivating GitHub Connection."
      : "Starting GitHub Connection.";
    options.submit.disabled = true;
    let response;
    try {
      response = await options.fetch.call(
        window,
        reactivating
          ? "/api/v1/github-connections/reactivate"
          : "/api/v1/github-connections/manifest",
        {
          body: reactivating
            ? JSON.stringify({ pem: options.pem.value })
            : "{}",
          headers: {
            "content-type": "application/json",
            "x-quality-bar-csrf": options.csrfToken(),
          },
          method: "POST",
        },
      );
    } catch {
      options.showError(
        reactivating
          ? "GitHub Connection reactivation could not start"
          : "GitHub App Manifest flow could not start",
      );
      options.submit.disabled = false;
      return;
    }
    if (!response.ok) {
      options.showError(await options.responseErrorMessage(response));
      options.submit.disabled = false;
      return;
    }
    if (reactivating) {
      try {
        options.render(await response.json());
        options.status.textContent = "GitHub Connection reactivated.";
        options.status.focus();
      } catch {
        options.showError("GitHub Connection reactivation response is invalid");
      } finally {
        options.submit.disabled = false;
      }
      return;
    }
    try {
      const start = /** @type {{
       *   action?: unknown,
       *   manifest?: unknown,
       *   method?: unknown,
       *   state?: unknown
       * }} */ (await response.json());
      if (
        typeof start.action !== "string" ||
        start.method !== "POST" ||
        typeof start.state !== "string" ||
        start.action !==
          `https://github.com/settings/apps/new?state=${start.state}` ||
        !start.manifest ||
        Array.isArray(start.manifest) ||
        typeof start.manifest !== "object"
      ) {
        throw new Error("github_manifest_start_invalid");
      }
      const continuation = document.createElement("form");
      continuation.action = start.action;
      continuation.method = "POST";
      const control = document.createElement("input");
      control.name = "manifest";
      control.type = "hidden";
      control.value = JSON.stringify(start.manifest);
      continuation.append(control);
      document.body.append(continuation);
      continuation.submit();
    } catch {
      options.showError("GitHub App Manifest response is invalid");
      options.submit.disabled = false;
    }
  });
}

Reflect.set(
  window,
  "qualityBarGitHubConnectionSubmission",
  bindGitHubConnectionSubmission,
);
