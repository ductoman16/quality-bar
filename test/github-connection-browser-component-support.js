import { resolve } from "node:path";

import { executeServedBrowserAsset } from "./browser-asset-execution.js";
import { readBrowserAsset } from "../src/browser-assets.js";

const repositoryRoot = resolve(import.meta.dirname, "..");
export const selectionRequestId = "00000000-0000-4000-8000-000000000001";

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
    lifecycle: "enabled",
    permissions: { contents: "read" },
    polling: [],
    polling_failure: null,
    principal: { login: "operator" },
    repository_count: 1,
    verification_history: [
      {
        affected_repository_ids: [101],
        api_profile: "github-rest:2026-03-10",
        capabilities: { private_git_read: "verified" },
        error: null,
        id: "verification-1",
        outcome: "success",
        permissions: { contents: "read" },
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
        repository_checks: [{ outcome: "success", repository_id: 101 }],
        trigger: "onboarding",
        verified_at: 1_000,
      },
    ],
    verified_at: 1_000,
  };
}

/** @param {ReturnType<typeof element>} form @param {ReturnType<typeof element>} submit @param {ReturnType<typeof element>} status @param {ReturnType<typeof element>} error */
export function githubElements(form, submit, status, error) {
  const pem = element({ hidden: true, value: "" });
  const pemLabel = element({ hidden: true });
  const details = element({ hidden: true });
  const identity = element();
  const profile = element();
  const health = element();
  const lifecycle = element();
  const permissions = element();
  const capabilities = element();
  const latest = element();
  const history = element();
  const polling = element();
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
  const rotationForm = element({ hidden: true });
  const rotationPem = element({ value: "" });
  const rotationSubmit = element();
  const retire = element();
  const remove = element();
  const confirmation = element({
    close() {
      this.open = false;
    },
    open: false,
    showModal() {
      this.open = true;
    },
  });
  const confirmationForm = element();
  const confirmationMessage = element();
  const confirmationLabel = element({ hidden: true });
  const confirmationInput = element({
    hidden: true,
    required: false,
    value: "",
  });
  const confirmationCancel = element();
  const confirmationSubmit = element();
  return {
    capabilities,
    details,
    elements: new Map([
      ["github-connection-form", form],
      ["github-connection-submit", submit],
      ["github-connection-pem", pem],
      ["github-connection-pem-label", pemLabel],
      ["github-connection-status", status],
      ["github-connection-error", error],
      ["github-connection-details", details],
      ["github-connection-identity", identity],
      ["github-connection-profile", profile],
      ["github-connection-health", health],
      ["github-connection-lifecycle", lifecycle],
      ["github-connection-permissions", permissions],
      ["github-connection-capabilities", capabilities],
      ["github-connection-latest", latest],
      ["github-connection-history", history],
      ["github-connection-polling", polling],
      ["github-connection-retire", retire],
      ["github-connection-delete", remove],
      ["github-connection-confirmation", confirmation],
      ["github-connection-confirmation-form", confirmationForm],
      ["github-connection-confirmation-message", confirmationMessage],
      ["github-connection-confirmation-label", confirmationLabel],
      ["github-connection-confirmation-input", confirmationInput],
      ["github-connection-confirmation-cancel", confirmationCancel],
      ["github-connection-confirmation-submit", confirmationSubmit],
      ["github-repository-selection-form", repositoryForm],
      ["github-repository-selection-options", repositoryOptions],
      ["github-repository-selection-submit", repositorySubmit],
      ["github-connection-rotation-form", rotationForm],
      ["github-connection-rotation-pem", rotationPem],
      ["github-connection-rotation-submit", rotationSubmit],
    ]),
    health,
    history,
    identity,
    latest,
    permissions,
    polling,
    profile,
    repositoryForm,
    repositoryOptions,
    repositorySubmit,
    rotationForm,
    rotationPem,
    rotationSubmit,
  };
}

/**
 * @param {(path: string, options?: any) => Promise<any>} fetch
 * @param {number[]} [registeredForgeRepositoryIds]
 * @param {boolean} [repositoryRefreshResult]
 * @param {string} [registeredVerificationId]
 * @param {boolean} [confirmResult]
 */
export function browserContext(
  fetch,
  registeredForgeRepositoryIds = [],
  repositoryRefreshResult = true,
  registeredVerificationId = selectionRequestId,
  confirmResult = true,
) {
  const form = element();
  const submit = element();
  const status = element();
  const error = element({ hidden: true });
  const github = githubElements(form, submit, status, error);
  /** @type {string[]} */
  const replacedUrls = [];
  let repositoryRefreshes = 0;
  return {
    context: {
      URLSearchParams,
      crypto: { randomUUID: () => selectionRequestId },
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
        confirm: () => confirmResult,
        qualityBarOperator: {
          csrfToken: () => "csrf-token",
          /** @param {string} id */
          requiredElement: (id) => github.elements.get(id),
        },
        qualityBarRepositories: {
          /** @param {number[]} ids @param {string} verificationId */
          hasVerifiedForgeRepositoryIds(ids, verificationId) {
            return (
              verificationId === registeredVerificationId &&
              ids.every((id) => registeredForgeRepositoryIds.includes(id))
            );
          },
          async refresh() {
            repositoryRefreshes += 1;
            return repositoryRefreshResult;
          },
        },
      },
    },
    error,
    form,
    github,
    replacedUrls,
    repositoryRefreshes: () => repositoryRefreshes,
    status,
    submit,
  };
}

/** @param {Record<string, any>} context */
export function executeGitHubBrowserAsset(context) {
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/github-connection-contract.js",
    readBrowserAsset("/assets/github-connection-contract.js"),
    context,
  );
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/github-connection-lifecycle-confirmation.js",
    readBrowserAsset("/assets/github-connection-lifecycle-confirmation.js"),
    context,
  );
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/github-connection-submission.js",
    readBrowserAsset("/assets/github-connection-submission.js"),
    context,
  );
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/github-connection.js",
    readBrowserAsset("/assets/github-connection.js"),
    context,
  );
}
