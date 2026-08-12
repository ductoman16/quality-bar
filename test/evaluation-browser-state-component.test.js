import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evaluationElements,
  executeEvaluationMonitorPageAsset,
} from "./evaluation-browser-component-support.js";
import { browserElement } from "./repository-browser-component-support.js";

/** @param {any} body @param {boolean} [ok] */
const response = (body, ok = true) => ({
  ok,
  async json() {
    return body;
  },
});

test("Evaluation monitor distinguishes an empty ledger from a list dependency failure", async () => {
  for (const scenario of ["empty", "gated"]) {
    const controls = evaluationElements();
    const context = {
      URLSearchParams,
      document: { createElement: () => browserElement() },
      async fetch(/** @type {string} */ path) {
        if (path === "/api/v1/system") {
          return response({
            codex_execution: {
              concurrency: { maximum_running: 0, running_count: 0 },
              queue: { count: 0 },
            },
          });
        }
        if (path.startsWith("/api/v1/analytics?")) {
          return response({
            evaluation_overview: {
              p95_duration_ms: null,
              clear_rate: { denominator: 0, numerator: 0 },
            },
          });
        }
        assert.match(path, /^\/api\/v1\/evaluations\?limit=50$/);
        return scenario === "empty"
          ? response({ items: [], next_cursor: null })
          : response(
              {
                error: {
                  message:
                    "A required runtime filesystem is below the free-space reserve",
                },
              },
              false,
            );
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
    executeEvaluationMonitorPageAsset(context, "/assets/evaluation.js");
    for (let index = 0; index < 24; index += 1) {
      await Promise.resolve();
    }
    if (scenario === "empty") {
      assert.equal(controls.get("evaluation-empty").hidden, false);
      assert.equal(controls.get("evaluation-error").hidden, true);
    } else {
      assert.equal(controls.get("evaluation-empty").hidden, true);
      assert.equal(controls.get("evaluation-error").hidden, false);
      assert.equal(
        controls.get("evaluation-error").textContent,
        "A required runtime filesystem is below the free-space reserve",
      );
    }
  }
});
