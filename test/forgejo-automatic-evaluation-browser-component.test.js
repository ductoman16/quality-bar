import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import {
  evaluation,
  evaluationElements,
} from "./evaluation-browser-component-support.js";
import { browserElement } from "./repository-browser-component-support.js";

test("a newly ready Forgejo Evaluation has provider-neutral semantic operator state", async () => {
  const page = operatorPage({ view: "evaluations" });
  assert.match(page, /@media\(max-width:40rem\)/);
  assert.match(page, /@media\(prefers-reduced-motion:reduce\)/);
  const controls = evaluationElements();
  const automatic = evaluation({
    completed_at: null,
    effective_outcome: "pending",
    execution_status: "queued",
    id: "forgejo-evaluation-1",
    provenance: "automatic",
    pull_request: { number: 17 },
    repository: {
      id: "repository-1",
      url: "https://forgejo.example/operator/private.git",
    },
  });
  const context = {
    document: {
      createElement() {
        return browserElement();
      },
    },
    async fetch(/** @type {string} */ path) {
      assert.equal(path, "/api/v1/evaluations");
      return {
        ok: true,
        async json() {
          return { items: [automatic], next_cursor: null };
        },
      };
    },
    window: {
      qualityBarOperator: {
        csrfToken: () => "csrf-token",
        async displayMutationFailure() {},
        async readRepositoryCollection() {
          return { failure: null, items: [] };
        },
        requiredElement(/** @type {string} */ id) {
          return controls.get(id);
        },
      },
    },
  };
  for (const [sourcePath, route] of [
    ["src/browser/waiver-batch.js", "/assets/waiver-batch.js"],
    ["src/browser/evaluation-result.js", "/assets/evaluation-result.js"],
    ["src/browser/evaluation-feedback.js", "/assets/evaluation-feedback.js"],
    [
      "src/browser/evaluation-active-controls.js",
      "/assets/evaluation-active-controls.js",
    ],
    ["src/browser/evaluation.js", "/assets/evaluation.js"],
  ]) {
    executeServedBrowserAsset(
      resolve("."),
      sourcePath,
      readBrowserAsset(route),
      context,
    );
  }
  await new Promise((resolvePromise) => setImmediate(resolvePromise));

  const row = controls.get("evaluation-active").options[0];
  assert.match(
    row.textContent,
    /forgejo\.example\/operator\/private\.git — automatic pull request #17/,
  );
  assert.doesNotMatch(row.textContent, /GitHub|Generic/);
  assert.equal(row.options[0].textContent, "Result not ready");
  assert.equal(row.options[1].type, "button");
  assert.equal(row.options[1].textContent, "Cancel forgejo-evaluation-1");
});
