import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";
import { evaluationElements } from "./evaluation-browser-component-support.js";
import { browserElement } from "./repository-browser-component-support.js";

test("Evaluations distinguishes an empty workspace from a hard dependency gate", async () => {
  for (const scenario of ["empty", "gated"]) {
    const controls = evaluationElements();
    const context = {
      document: {
        createElement() {
          return browserElement();
        },
      },
      async fetch(/** @type {string} */ path) {
        assert.equal(path, "/api/v1/evaluations");
        return scenario === "empty"
          ? {
              ok: true,
              async json() {
                return { items: [], next_cursor: null };
              },
            }
          : {
              ok: false,
              status: 503,
              async json() {
                return {
                  error: {
                    message:
                      "A required runtime filesystem is below the free-space reserve",
                  },
                };
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
    if (scenario === "empty") {
      assert.equal(controls.get("evaluation-empty").hidden, false);
      assert.equal(controls.get("evaluation-state").hidden, true);
    } else {
      assert.equal(controls.get("evaluation-empty").hidden, true);
      assert.equal(controls.get("evaluation-state").hidden, false);
      assert.equal(
        controls.get("evaluation-state").textContent,
        "Evaluations unavailable: A required runtime filesystem is below the free-space reserve",
      );
    }
  }
});
