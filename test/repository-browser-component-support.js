/** @param {Record<string, unknown>} [properties] */
export function browserElement(properties = {}) {
  /** @type {Map<string, (event: any) => unknown>} */
  const listeners = new Map();
  return {
    disabled: false,
    hidden: false,
    options: /** @type {any[]} */ ([]),
    resetCalled: false,
    textContent: "",
    value: "",
    ...properties,
    /** @param {string} name @param {(event: any) => unknown} listener */
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    /** @param {any} child */
    append(child) {
      this.options.push(child);
    },
    /** @param {string} name */
    listener(name) {
      const listener = listeners.get(name);
      if (!listener) {
        throw new Error(`repository_listener_missing: ${name}`);
      }
      return listener;
    },
    querySelectorAll() {
      return [];
    },
    replaceChildren() {
      this.options = [];
    },
    reset() {
      this.resetCalled = true;
    },
  };
}

/**
 * @param {[string, ReturnType<typeof browserElement>][]} overrides
 */
export function repositoryBrowserElements(overrides) {
  const elements = new Map([
    [
      "browser-configuration",
      browserElement({
        textContent: JSON.stringify({
          csrfCookieName: "quality_bar_configured_csrf",
        }),
        type: "application/json",
      }),
    ],
  ]);
  for (const id of [
    "error",
    "repository-inventory",
    "repository-lifecycle-form",
    "repository-lifecycle-repository",
    "repository-lifecycle-state",
    "repository-lifecycle-result",
    "repository-lifecycle-submit",
    "repository-create-form",
    "repository-token",
    "repository-url",
    "repository-username",
    "repository-create-result",
    "repository-credential-rotate-form",
    "repository-credential-rotate-repository",
    "repository-credential-rotate-username",
    "repository-credential-rotate-token",
    "repository-credential-rotate-result",
    "repository-credential-rotate-submit",
    "password-change-form",
    "session-revocation-form",
    "implementer-token-create-form",
    "implementer-token-rotate-form",
    "implementer-token-revoke-form",
    "implementer-token-reveal",
    "implementer-token-reveal-close",
    "implementer-token-value",
    "logout",
  ]) {
    elements.set(id, browserElement());
  }
  for (const [id, element] of overrides) {
    elements.set(id, element);
  }
  return elements;
}
