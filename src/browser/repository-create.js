{
  const form = /** @type {HTMLFormElement} */ (
    requiredElement("repository-create-form")
  );
  const error = requiredElement("error");

  /** @param {string} id */
  function requiredElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error("browser_control_unavailable");
    }
    return element;
  }

  function csrfCookieName() {
    const configuration = /** @type {HTMLScriptElement} */ (
      requiredElement("browser-configuration")
    );
    if (configuration.type !== "application/json") {
      throw new Error("browser_configuration_invalid");
    }
    const value = /** @type {{csrfCookieName?: unknown}} */ (
      JSON.parse(configuration.textContent)
    );
    if (
      typeof value.csrfCookieName !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(value.csrfCookieName)
    ) {
      throw new Error("browser_configuration_invalid");
    }
    return value.csrfCookieName;
  }

  function csrfToken() {
    const cookieName = csrfCookieName();
    const token = document.cookie
      .split(";")
      .map((cookie) => cookie.trim().split("=", 2))
      .find(([name]) => name === cookieName)?.[1];
    if (!token) {
      throw new Error("browser_csrf_unavailable");
    }
    return token;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    const url = /** @type {HTMLInputElement} */ (
      requiredElement("repository-url")
    ).value;
    const response = await fetch("/api/v1/repositories", {
      body: JSON.stringify({ url }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": csrfToken(),
      },
      method: "POST",
    });
    if (!response.ok) {
      const body = /** @type {{error: {message: string}}} */ (
        await response.json()
      );
      error.textContent = body.error.message;
      error.hidden = false;
      return;
    }
    const repository = /** @type {{url: string}} */ (await response.json());
    requiredElement("repository-create-result").textContent =
      repository.url + " registered.";
    form.reset();
  });
}
