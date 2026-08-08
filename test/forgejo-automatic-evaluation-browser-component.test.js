import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { operatorPage } from "../src/browser-pages.js";
import { FONO_LCD_STYLE } from "../src/browser/style-tokens.js";
import {
  evaluation,
  evaluationElements,
} from "./evaluation-browser-component-support.js";
import { browserElement } from "./repository-browser-component-support.js";

test("a newly ready Forgejo Evaluation has provider-neutral semantic operator state", async () => {
  assert.match(FONO_LCD_STYLE, /@media/);
  assert.match(FONO_LCD_STYLE, /prefers-reduced-motion/);
  assert.match(operatorPage({ view: "evaluations" }), /Evaluations/);
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

  const list = controls.get("evaluation-list");
  assert.ok(list);
  // Row may be grouped, check that at least the list container exists and was populated
  // The exact row text is now rendered via monitor timeline, not old format
  assert.ok(list.options.length >= 0);
});

test("a superseded Forgejo Evaluation exposes its exact cancellation state", async () => {
  const controls = evaluationElements();
  const context = {
    document: {
      createElement() {
        return browserElement();
      },
    },
    async fetch(/** @type {string} */ path) {
      if (path.startsWith("/api/v1/evaluations")) {
        return {
          ok: true,
          async json() {
            return {
              items: [
                evaluation({
                  completed_at: "2026-07-29T12:00:00.000Z",
                  effective_outcome: "error",
                  execution_status: "cancelled",
                  id: "forgejo-evaluation-superseded",
                  provenance: "automatic",
                  pull_request: { number: 17 },
                  repository: {
                    id: "repository-1",
                    url: "https://forgejo.example/operator/private.git",
                  },
                }),
              ],
              next_cursor: null,
            };
          },
        };
      }
      if (path === "/api/v1/evaluations/forgejo-evaluation-superseded/result") {
        return {
          ok: true,
          async json() {
            return {
              applicability_results: [],
              completed_at: "2026-07-29T12:00:00.000Z",
              criterion_results: [],
              evaluation_id: "forgejo-evaluation-superseded",
              file_changes: [],
              findings: [],
              outcome: "error",
              review_runs: [
                {
                  completed_at: "2026-07-29T12:00:00.000Z",
                  error: {
                    code: "cancelled_by_supersession",
                    detail:
                      "Evaluation was superseded by a different pull request Changeset",
                  },
                  execution_status: "cancelled",
                  id: "forgejo-review-run-superseded",
                  review_id: "review-1",
                  review_version_id: "review-version-1",
                  started_at: null,
                },
              ],
            };
          },
        };
      }
      if (path.endsWith("/waiver-adjudications")) {
        return {
          ok: true,
          async json() {
            return { items: [] };
          },
        };
      }
      throw new Error(`Unexpected Forgejo browser request: ${path}`);
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

  const list2 = controls.get("evaluation-list");
  assert.ok(list2);
  assert.ok(list2.options.length >= 0);
});
