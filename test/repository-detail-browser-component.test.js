import assert from "node:assert/strict";
import { resolve } from "node:path";
import { URLSearchParams } from "node:url";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import {
  browserElement,
  findByText,
  repositoryBrowserElements,
} from "./repository-browser-component-support.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("the Repository detail view owns identity, guidance, and its own scripts", () => {
  const page = operatorPage({ view: "repository-detail" });
  assert.match(page, /id="repository-detail-name"/);
  assert.match(page, /id="repository-detail-meta"/);
  assert.match(page, /id="repository-detail-actions"/);
  assert.match(page, /id="repository-detail-guidance"/);
  assert.match(page, /qb-deep-surface/);
  assert.match(page, /id="repository-inventory"/);
  assert.match(page, /id="repository-lifecycle-form"/);
  assert.match(page, /id="repository-create-form"/);
  assert.match(
    page,
    /<script src="\/assets\/repository-detail\.js"><\/script>/,
  );
  assert.doesNotMatch(page, /id="repository-overview-total"/);
});

test("the Repository detail view renders the repository, its reviews, and drives actions", async () => {
  const detailIds = [
    "repository-detail-name",
    "repository-detail-state",
    "repository-detail-error",
    "repository-detail-meta",
    "repository-detail-actions",
    "repository-detail-result",
    "repository-detail-guidance",
    "repository-detail-guidance-empty",
    "repository-detail-guidance-raw",
  ];
  const lifecycleRepository = browserElement();
  const lifecycleState = browserElement({ value: "enabled" });
  const elements = repositoryBrowserElements([
    ["repository-lifecycle-repository", lifecycleRepository],
    ["repository-lifecycle-state", lifecycleState],
    ...detailIds.map(
      (id) =>
        /** @type {[string, ReturnType<typeof browserElement>]} */ ([
          id,
          browserElement(),
        ]),
    ),
  ]);
  /** @type {string[]} */
  const confirmations = [];
  /** @type {string[]} */
  const requestedPaths = [];
  const repository = {
    credential_type: "username_token",
    deletion_eligible: true,
    health: "healthy",
    health_error: null,
    id: "repository-row",
    lifecycle: "enabled",
    url: "https://example.com/row.git",
  };
  const guidance = {
    schema_version: 1,
    guidance_revision: "guidance-1",
    repository: { id: "repository-row", url: repository.url },
    reviews: [
      {
        id: "review-1",
        name: "Security Review",
        description: "Checks for security regressions.",
        active_version: { id: "version-1", number: 1 },
        applicability: { type: "unconditional" },
        assignment: { scope: "installation_wide" },
        criteria: [
          {
            id: "criterion-1",
            impact: "blocking",
            instruction: "Flag security issues.",
          },
        ],
      },
    ],
  };
  const browserContext = {
    Date,
    URLSearchParams,
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
    /** @param {string} path @param {any} [options] */
    async fetch(path, options) {
      requestedPaths.push(path);
      if (path === "/api/v1/repositories" && !options) {
        return {
          ok: true,
          async json() {
            return { items: [{ ...repository }], next_cursor: null };
          },
        };
      }
      if (path.endsWith("/guidance")) {
        return {
          ok: true,
          async json() {
            return guidance;
          },
        };
      }
      if (path.endsWith("/lifecycle")) {
        return {
          ok: true,
          async json() {
            return { ...repository, lifecycle: "disabled" };
          },
        };
      }
      throw new Error(`unexpected request: ${path}`);
    },
    window: {
      /** @param {string} message */
      confirm(message) {
        confirmations.push(message);
        return true;
      },
      location: { search: "?repository_id=repository-row", assign() {} },
    },
  };
  for (const module of [
    "src/browser/operator.js",
    "src/browser/repository.js",
    "src/browser/repository-delete.js",
    "src/browser/repository-detail.js",
  ]) {
    executeServedBrowserAsset(
      repositoryRoot,
      module,
      readBrowserAsset(`/assets/${module.slice("src/browser/".length)}`),
      browserContext,
    );
  }
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    elements.get("repository-detail-name")?.textContent,
    "https://example.com/row.git",
  );
  assert.equal(
    elements.get("repository-detail-state")?.textContent,
    "Enabled · Healthy",
  );
  assert.ok(requestedPaths.some((path) => path.endsWith("/guidance")));
  const guidanceList = /** @type {any} */ (
    elements.get("repository-detail-guidance")
  );
  assert.equal(
    findByText(guidanceList, "Security Review")?.textContent,
    "Security Review",
  );
  assert.equal(
    findByText(guidanceList, "Flag security issues.")?.textContent,
    "Flag security issues.",
  );

  const actions = /** @type {any} */ (
    elements.get("repository-detail-actions")
  );
  findByText(actions, "Disable").listener("click")({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lifecycleRepository.value, "repository-row");
  assert.equal(
    confirmations.at(-1),
    "Disable https://example.com/row.git? New work will be rejected; already-created work may finish.",
  );
  assert.ok(requestedPaths.some((path) => path.endsWith("/lifecycle")));
});
