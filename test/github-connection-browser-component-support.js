import { resolve } from "node:path";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

/** @param {Record<string, any>} [properties] */
export function element(properties = {}) {
  /** @type {Map<string, (event: any) => any>} */
  const listeners = new Map();
  return {
    children: /** @type {any[]} */ ([]),
    disabled: false,
    focused: false,
    hidden: false,
    textContent: "",
    ...properties,
    /** @param {string} name @param {(event: any) => any} listener */
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    /** @param {...any} children */
    append(...children) {
      this.children.push(...children);
    },
    focus() {
      this.focused = true;
    },
    /** @param {string} name */
    listener(name) {
      const listener = listeners.get(name);
      if (!listener) {
        throw new Error(`listener_missing:${name}`);
      }
      return listener;
    },
    /** @param {...any} children */
    replaceChildren(...children) {
      this.children = children;
    },
  };
}

export function verifiedConnection() {
  return {
    api_profile: "github-rest:2026-03-10",
    capabilities: { private_git_read: "verified" },
    health: "healthy",
    health_error: null,
    permissions: { contents: "read" },
    principal: { login: "operator" },
    repository_count: 1,
    verification_history: [
      {
        api_profile: "github-rest:2026-03-10",
        principal: { login: "operator" },
        repositories: [
          {
            api_url: "https://api.github.com/repos/operator/private",
            clone_url: "https://github.com/operator/private.git",
            full_name: "operator/private",
            html_url: "https://github.com/operator/private",
            id: 101,
            private: true,
          },
        ],
        trigger: "onboarding",
        verified_at: 1_000,
      },
    ],
    verified_at: 1_000,
  };
}

/** @param {ReturnType<typeof element>} form @param {ReturnType<typeof element>} submit @param {ReturnType<typeof element>} status @param {ReturnType<typeof element>} error */
export function githubElements(form, submit, status, error) {
  const details = element({ hidden: true });
  const identity = element();
  const profile = element();
  const health = element();
  const permissions = element();
  const capabilities = element();
  const latest = element();
  const history = element();
  const repositoryForm = element({ hidden: true });
  const repositoryOptions = element({
    querySelector() {
      return this.children[0]?.children[0] ?? null;
    },
    querySelectorAll() {
      return this.children
        .map(/** @param {any} label */ (label) => label.children[0])
        .filter(/** @param {any} control */ (control) => control.checked);
    },
  });
  const repositorySubmit = element();
  return {
    capabilities,
    details,
    elements: new Map([
      ["github-connection-form", form],
      ["github-connection-submit", submit],
      ["github-connection-status", status],
      ["github-connection-error", error],
      ["github-connection-details", details],
      ["github-connection-identity", identity],
      ["github-connection-profile", profile],
      ["github-connection-health", health],
      ["github-connection-permissions", permissions],
      ["github-connection-capabilities", capabilities],
      ["github-connection-latest", latest],
      ["github-connection-history", history],
      ["github-repository-selection-form", repositoryForm],
      ["github-repository-selection-options", repositoryOptions],
      ["github-repository-selection-submit", repositorySubmit],
    ]),
    health,
    history,
    identity,
    latest,
    permissions,
    profile,
    repositoryForm,
    repositoryOptions,
    repositorySubmit,
  };
}

/** @param {(path: string, options?: any) => Promise<any>} fetch */
export function browserContext(fetch) {
  const form = element();
  const submit = element();
  const status = element();
  const error = element({ hidden: true });
  const github = githubElements(form, submit, status, error);
  /** @type {string[]} */
  const replacedUrls = [];
  return {
    context: {
      URLSearchParams,
      document: { body: { append() {} }, createElement: () => element() },
      fetch,
      history: {
        /** @param {unknown} state @param {string} title @param {string} url */
        replaceState(state, title, url) {
          void state;
          void title;
          replacedUrls.push(url);
        },
      },
      location: {
        assigned: "",
        /** @param {string} url */
        assign(url) {
          this.assigned = url;
        },
        search: "",
      },
      window: {
        qualityBarOperator: {
          csrfToken: () => "csrf-token",
          /** @param {string} id */
          requiredElement: (id) => github.elements.get(id),
        },
      },
    },
    error,
    form,
    github,
    replacedUrls,
    status,
    submit,
  };
}

/** @param {Record<string, any>} context */
export function executeGitHubBrowserAsset(context) {
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/github-connection.js",
    readBrowserAsset("/assets/github-connection.js"),
    context,
  );
}
