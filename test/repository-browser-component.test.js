import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

/** @param {Record<string, unknown>} [properties] */
function browserElement(properties = {}) {
  /** @type {Map<string, (event: any) => unknown>} */
  const listeners = new Map();
  return {
    disabled: false,
    hidden: false,
    options: /** @type {{textContent: string, value: string}[]} */ ([]),
    resetCalled: false,
    textContent: "",
    value: "",
    ...properties,
    /** @param {string} name @param {(event: any) => unknown} listener */
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    /** @param {{textContent: string, value: string}} option */
    append(option) {
      this.options.push(option);
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

test("the Repository component rotates write-only credentials and surfaces the exact owning error", async () => {
  const form = browserElement();
  const url = browserElement({
    value: "https://EXAMPLE.com:443/team/repository.git/",
  });
  const username = browserElement({ value: "operator" });
  const token = browserElement({ value: "private-token-value" });
  const result = browserElement();
  const rotationForm = browserElement();
  const rotationRepository = browserElement({
    disabled: true,
    value: "repository/private",
  });
  const rotationUsername = browserElement({ value: "replacement-operator" });
  const rotationToken = browserElement({ value: "replacement-private-token" });
  const rotationResult = browserElement();
  const rotationSubmit = browserElement({ disabled: true });
  const error = browserElement({ hidden: true });
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
    ["error", error],
    ["repository-create-form", form],
    ["repository-token", token],
    ["repository-url", url],
    ["repository-username", username],
    ["repository-create-result", result],
    ["repository-credential-rotate-form", rotationForm],
    ["repository-credential-rotate-repository", rotationRepository],
    ["repository-credential-rotate-username", rotationUsername],
    ["repository-credential-rotate-token", rotationToken],
    ["repository-credential-rotate-result", rotationResult],
    ["repository-credential-rotate-submit", rotationSubmit],
    ["password-change-form", browserElement()],
    ["session-revocation-form", browserElement()],
    ["implementer-token-create-form", browserElement()],
    ["implementer-token-rotate-form", browserElement()],
    ["implementer-token-revoke-form", browserElement()],
    ["implementer-token-reveal", browserElement()],
    ["implementer-token-reveal-close", browserElement()],
    ["implementer-token-value", browserElement()],
    ["logout", browserElement()],
  ]);
  /** @type {{path: string, options: object}[]} */
  const requests = [];
  /** @type {(response: object) => void} */
  let resolveRepositoryList = () => {
    throw new Error("repository_list_resolver_unavailable");
  };
  const repositoryListResponse = new Promise((resolve) => {
    resolveRepositoryList = resolve;
  });
  let registrationAttempt = 0;
  let rotationAttempt = 0;

  const browserContext = {
    Date,
    document: {
      cookie: "quality_bar_configured_csrf=csrf-token",
      addEventListener() {},
      createElement() {
        return browserElement();
      },
      /** @param {string} id */
      getElementById(id) {
        return elements.get(id) ?? null;
      },
    },
    /** @param {string} path @param {object} options */
    async fetch(path, options) {
      if (path === "/api/v1/system") {
        return {
          ok: true,
          async json() {
            return {
              bootstrap: { status: "ready" },
              browser_sessions: { active_count: 1 },
              codex: { catalog: { models: [] }, status: "available" },
              durable_core: { status: "ready" },
              implementer_token: { status: "revoked" },
            };
          },
        };
      }
      if (path === "/api/v1/repositories" && !options) {
        return repositoryListResponse;
      }
      requests.push({ options, path });
      if (path === "/api/v1/repositories") {
        registrationAttempt += 1;
      } else {
        rotationAttempt += 1;
      }
      if (registrationAttempt === 1 && rotationAttempt === 0) {
        return {
          ok: true,
          async json() {
            return {
              id: "repository-1",
              url: "https://example.com/team/repository.git",
            };
          },
        };
      }
      if (registrationAttempt === 2 && rotationAttempt === 0) {
        return {
          ok: true,
          async json() {
            return {
              id: "repository-public",
              url: "https://example.com/team/public.git",
            };
          },
        };
      }
      if (rotationAttempt === 1) {
        return {
          ok: true,
          async json() {
            return {
              id: "repository/private",
              url: "https://example.com/team/repository.git",
            };
          },
        };
      }
      if (rotationAttempt === 3) {
        throw new Error("simulated browser network failure");
      }
      return {
        ok: false,
        async json() {
          return {
            error: {
              code: "repository_git_read_failed",
              message: "Repository Git read verification failed",
            },
          };
        },
      };
    },
    window: {},
  };
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/operator.js",
    readBrowserAsset("/assets/operator.js"),
    browserContext,
  );
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/repository.js",
    readBrowserAsset("/assets/repository.js"),
    browserContext,
  );
  const registration = form.listener("submit")({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  resolveRepositoryList({
    ok: true,
    async json() {
      assert.equal(rotationRepository.disabled, true);
      assert.equal(rotationSubmit.disabled, true);
      return { repositories: [] };
    },
  });
  await registration;
  assert.deepEqual(
    rotationRepository.options.map(({ textContent, value }) => ({
      textContent,
      value,
    })),
    [
      {
        textContent: "https://example.com/team/repository.git",
        value: "repository-1",
      },
    ],
  );
  assert.equal(rotationRepository.disabled, false);
  assert.equal(rotationSubmit.disabled, false);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), {
    options: {
      body: JSON.stringify({
        url: "https://EXAMPLE.com:443/team/repository.git/",
        token: "private-token-value",
        username: "operator",
      }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "POST",
    },
    path: "/api/v1/repositories",
  });
  assert.equal(
    result.textContent,
    "https://example.com/team/repository.git registered as repository-1.",
  );
  assert.equal(form.resetCalled, true);
  assert.equal(token.value, "");
  assert.equal(username.value, "");

  url.value = "https://example.com/team/public.git";
  await form.listener("submit")({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), {
    options: {
      body: JSON.stringify({
        url: "https://example.com/team/public.git",
      }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "POST",
    },
    path: "/api/v1/repositories",
  });
  assert.equal(rotationRepository.options.length, 1);

  token.value = "replacement-private-token";
  username.value = "replacement-operator";
  await form.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Repository Git read verification failed");
  assert.equal(error.hidden, false);
  assert.equal(result.textContent, "");
  assert.equal(token.value, "");
  assert.equal(username.value, "");
  assert.doesNotMatch(
    `${error.textContent} ${result.textContent}`,
    /replacement-private-token|replacement-operator/,
  );

  await rotationForm.listener("submit")({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(requests[3])), {
    options: {
      body: JSON.stringify({
        token: "replacement-private-token",
        username: "replacement-operator",
      }),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": "csrf-token",
      },
      method: "POST",
    },
    path: "/api/v1/repositories/repository%2Fprivate/credential/rotate",
  });
  assert.equal(
    rotationResult.textContent,
    "https://example.com/team/repository.git credential rotated.",
  );
  assert.equal(rotationForm.resetCalled, true);
  assert.equal(rotationToken.value, "");
  assert.equal(rotationUsername.value, "");

  rotationRepository.value = "repository/private";
  rotationToken.value = "second-replacement-private-token";
  rotationUsername.value = "second-replacement-operator";
  await rotationForm.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Repository Git read verification failed");
  assert.equal(error.hidden, false);
  assert.equal(rotationResult.textContent, "");
  assert.equal(rotationToken.value, "");
  assert.equal(rotationUsername.value, "");
  assert.doesNotMatch(
    `${error.textContent} ${rotationResult.textContent}`,
    /second-replacement-private-token|second-replacement-operator/,
  );

  rotationRepository.value = "repository/private";
  rotationToken.value = "third-replacement-private-token";
  rotationUsername.value = "third-replacement-operator";
  await rotationForm.listener("submit")({ preventDefault() {} });
  assert.equal(error.textContent, "Repository credential rotation failed");
  assert.equal(error.hidden, false);
  assert.equal(rotationResult.textContent, "");
  assert.equal(rotationToken.value, "");
  assert.equal(rotationUsername.value, "");
  assert.doesNotMatch(
    `${error.textContent} ${rotationResult.textContent}`,
    /third-replacement-private-token|third-replacement-operator/,
  );
});

test("the Repositories page keeps credential rotation on its owning resource surface", () => {
  const page = operatorPage({ view: "repositories" });
  assert.match(page, /id="repository-create-form"/);
  assert.match(page, /id="repository-credential-rotate-form"/);
  assert.match(page, /id="repository-credential-rotate-repository"/);
  assert.match(page, /id="repository-credential-rotate-submit"/);
  assert.match(page, /id="repository-credential-rotate-username"/);
  assert.match(page, /id="repository-credential-rotate-token"/);
  assert.doesNotMatch(
    page,
    /provider.{0,20}(?:revoke|revoked)|(?:revoke|revoked).{0,20}provider/i,
  );
});
