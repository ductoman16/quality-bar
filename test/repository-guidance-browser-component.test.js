import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import {
  browserElement,
  repositoryBrowserElements,
} from "./repository-browser-component-support.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("the Repository Guidance component renders the complete canonical document and clears stale failure state", async () => {
  const select = browserElement({ disabled: true });
  const documentElement = browserElement();
  const error = browserElement({ hidden: true });
  const elements = repositoryBrowserElements([
    ["error", error],
    ["repository-guidance-repository", select],
    ["repository-guidance-document", documentElement],
  ]);
  let guidanceAttempt = 0;
  const canonicalGuidance = {
    guidance_revision:
      "guidance-v1-0123456789012345678901234567890123456789012",
    repository: {
      id: "repository/1",
      url: "https://example.com/repository.git",
    },
    reviews: [
      {
        active_version: { id: "version-2", number: 2 },
        applicability: {
          expression: "true",
          profile: "quality-bar-restricted-cel-v1",
          type: "conditional",
        },
        assignment: { scope: "repository_specific" },
        criteria: [
          {
            id: "criterion-1",
            impact: "blocking",
            instruction: "Preserve exact behavior.",
          },
        ],
        description: "Repository-specific standards.",
        id: "review-1",
        name: "Repository standards",
      },
    ],
    schema_version: 1,
  };
  const browserContext = {
    document: {
      createElement() {
        return browserElement();
      },
      /** @param {string} id */
      getElementById(id) {
        return elements.get(id) ?? null;
      },
    },
    async fetch() {
      guidanceAttempt += 1;
      if (guidanceAttempt === 1) {
        return {
          ok: true,
          async json() {
            return canonicalGuidance;
          },
        };
      }
      return {
        ok: false,
        async json() {
          return {
            error: {
              code: "repository_guidance_failed",
              message: "Repository Guidance failed",
            },
          };
        },
      };
    },
    window: {
      qualityBarOperator: {
        error,
        /** @param {string} id */
        requiredElement(id) {
          const element = elements.get(id);
          if (!element) {
            throw new Error(`browser_element_missing: ${id}`);
          }
          return element;
        },
      },
      qualityBarRepositories: {
        /** @param {(repositories: Array<{id: string, url: string}>) => unknown} subscriber */
        subscribe(subscriber) {
          subscriber([
            {
              id: "repository/1",
              url: "https://example.com/repository.git",
            },
          ]);
        },
      },
    },
  };

  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/repository-guidance.js",
    readBrowserAsset("/assets/repository-guidance.js"),
    browserContext,
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(select.disabled, false);
  assert.deepEqual(
    select.options.map(({ textContent, value }) => ({ textContent, value })),
    [
      {
        textContent: "https://example.com/repository.git",
        value: "repository/1",
      },
    ],
  );
  assert.equal(
    documentElement.textContent,
    JSON.stringify(canonicalGuidance, null, 2),
  );

  await select.listener("change")({});
  assert.equal(error.textContent, "Repository Guidance failed");
  assert.equal(error.hidden, false);
  assert.equal(documentElement.textContent, "");
});

test("the Repository Guidance component fences an older Repository response", async () => {
  const select = browserElement({ disabled: true });
  const documentElement = browserElement();
  const error = browserElement({ hidden: true });
  const elements = repositoryBrowserElements([
    ["error", error],
    ["repository-guidance-repository", select],
    ["repository-guidance-document", documentElement],
  ]);
  /** @type {(response: object) => void} */
  let resolveFirst = () => {
    throw new Error("first_guidance_resolver_unavailable");
  };
  const firstResponse = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  /** @param {string} id */
  const guidance = (id) => ({
    guidance_revision: `guidance-v1-${id.padEnd(43, "0")}`,
    repository: { id, url: `https://example.com/${id}.git` },
    reviews: [],
    schema_version: 1,
  });
  const browserContext = {
    document: {
      createElement() {
        return browserElement();
      },
      /** @param {string} id */
      getElementById(id) {
        return elements.get(id) ?? null;
      },
    },
    /** @param {string} path */
    async fetch(path) {
      if (path.includes("repository-a")) {
        return firstResponse;
      }
      return {
        ok: true,
        async json() {
          return guidance("repository-b");
        },
      };
    },
    window: {
      qualityBarOperator: {
        error,
        /** @param {string} id */
        requiredElement(id) {
          const element = elements.get(id);
          if (!element) {
            throw new Error(`browser_element_missing: ${id}`);
          }
          return element;
        },
      },
      qualityBarRepositories: {
        /** @param {(repositories: Array<{id: string, url: string}>) => unknown} subscriber */
        subscribe(subscriber) {
          subscriber([
            {
              id: "repository-a",
              url: "https://example.com/repository-a.git",
            },
            {
              id: "repository-b",
              url: "https://example.com/repository-b.git",
            },
          ]);
        },
      },
    },
  };
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/repository-guidance.js",
    readBrowserAsset("/assets/repository-guidance.js"),
    browserContext,
  );
  select.value = "repository-b";
  await select.listener("change")({});
  assert.equal(
    documentElement.textContent,
    JSON.stringify(guidance("repository-b"), null, 2),
  );

  resolveFirst({
    ok: true,
    async json() {
      return guidance("repository-a");
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    documentElement.textContent,
    JSON.stringify(guidance("repository-b"), null, 2),
  );
  assert.equal(error.hidden, true);
});

test("the Repository Guidance component hard-fails an incomplete canonical document", async () => {
  const elements = repositoryBrowserElements([
    ["repository-guidance-repository", browserElement({ disabled: true })],
    ["repository-guidance-document", browserElement()],
  ]);
  /** @type {(repositories: Array<{id: string, url: string}>) => Promise<unknown>} */
  let publishRepositories = () => {
    throw new Error("repository_subscriber_unavailable");
  };
  const browserContext = {
    document: {
      createElement() {
        return browserElement();
      },
      /** @param {string} id */
      getElementById(id) {
        return elements.get(id) ?? null;
      },
    },
    async fetch() {
      return {
        ok: true,
        async json() {
          return {};
        },
      };
    },
    window: {
      qualityBarOperator: {
        error: elements.get("error"),
        /** @param {string} id */
        requiredElement(id) {
          const element = elements.get(id);
          if (!element) {
            throw new Error(`browser_element_missing: ${id}`);
          }
          return element;
        },
      },
      qualityBarRepositories: {
        /** @param {(repositories: Array<{id: string, url: string}>) => unknown} subscriber */
        subscribe(subscriber) {
          publishRepositories = /** @type {typeof publishRepositories} */ (
            subscriber
          );
          subscriber([]);
        },
      },
    },
  };
  executeServedBrowserAsset(
    repositoryRoot,
    "src/browser/repository-guidance.js",
    readBrowserAsset("/assets/repository-guidance.js"),
    browserContext,
  );

  await assert.rejects(
    () =>
      publishRepositories([
        {
          id: "repository-invalid",
          url: "https://example.com/invalid.git",
        },
      ]),
    /repository_guidance_document_invalid/,
  );
});

test("the Repositories page owns one complete Guidance surface", () => {
  const page = operatorPage({ view: "repositories" });

  assert.match(page, /<h2>Repository Guidance<\/h2>/);
  assert.match(page, /id="repository-guidance-repository"/);
  assert.match(page, /id="repository-guidance-document"/);
  assert.match(
    page,
    /<script src="\/assets\/repository-guidance\.js"><\/script>/,
  );
});
