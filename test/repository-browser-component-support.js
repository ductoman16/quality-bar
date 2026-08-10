/** @param {Record<string, unknown>} [properties] */
export function browserElement(properties = {}) {
  /** @type {Map<string, (event: any) => unknown>} */
  const listeners = new Map();
  return {
    disabled: false,
    focused: false,
    hidden: false,
    open: false,
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
    click() {
      const listener = listeners.get("click");
      return listener ? listener({}) : undefined;
    },
    requestSubmit() {
      const listener = listeners.get("submit");
      return listener ? listener({ preventDefault() {} }) : undefined;
    },
    close() {
      this.open = false;
    },
    focus() {
      this.focused = true;
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
    /** @param {string} name @param {unknown} value */
    setAttribute(name, value) {
      Reflect.set(this, name, value);
    },
    showModal() {
      this.open = true;
    },
  };
}

/**
 * Depth-first collect the `data-label` cells rendered inside an inventory row,
 * regardless of how deeply the ledger nests them.
 * @param {{options?: any[], [key: string]: any}} node
 * @returns {{label: string, textContent: string}[]}
 */
export function labeledCells(node) {
  const cells = [];
  for (const child of node.options ?? []) {
    if (typeof child?.["data-label"] === "string") {
      cells.push({
        label: child["data-label"],
        textContent: child.textContent,
      });
    }
    cells.push(...labeledCells(child));
  }
  return cells;
}

/**
 * Depth-first find the first descendant whose textContent matches `text`.
 * @param {{options?: any[], textContent?: string}} node
 * @param {string} text
 * @returns {any}
 */
export function findByText(node, text) {
  for (const child of node.options ?? []) {
    if (child?.textContent === text) {
      return child;
    }
    const found = findByText(child, text);
    if (found) {
      return found;
    }
  }
  return null;
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
    "repository-inventory-empty",
    "repository-overview-total",
    "repository-overview-enabled",
    "repository-overview-disabled",
    "repository-overview-retired",
    "repository-overview-errors",
    "repository-lifecycle-form",
    "repository-lifecycle-repository",
    "repository-lifecycle-state",
    "repository-lifecycle-result",
    "repository-lifecycle-submit",
    "repository-delete",
    "repository-delete-confirmation",
    "repository-delete-confirmation-form",
    "repository-delete-confirmation-input",
    "repository-delete-confirmation-message",
    "repository-delete-confirmation-cancel",
    "repository-delete-confirmation-submit",
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
    "repository-guidance-repository",
    "repository-guidance-document",
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
