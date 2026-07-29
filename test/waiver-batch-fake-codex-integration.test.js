import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateCodexLogin } from "../src/installation-environment.js";
import {
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.js";

const fakeCodexPath = fileURLToPath(
  new URL("../fixtures/test-probes/fake-codex-login.mjs", import.meta.url),
);

test("the application preserves fake Codex authentication failure before waiver admission", async () => {
  const { application, request } = await startApplication({
    validateCodexAuthentication() {
      validateCodexLogin({
        runTool(_command, arguments_) {
          assert.equal(_command, "codex");
          const result = spawnSync(
            process.execPath,
            [fakeCodexPath, ...arguments_],
            { encoding: "utf8" },
          );
          if (result.status !== 0) {
            throw new Error(result.stderr);
          }
          return result.stdout;
        },
      });
    },
  });
  seedCompletedEvaluation(application.durableCore);
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const response = await request(
    "/api/v1/evaluations/evaluation-1/waiver-adjudications",
    {
      body: JSON.stringify({
        requests: [
          {
            finding_id: "finding-1",
            rationale: "Scenario-specific reason",
          },
        ],
      }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": "dependency-key",
      },
      method: "POST",
    },
  );
  assert.equal(response.status, 503);
  assert.equal(
    await responseErrorCode(response),
    "codex_authentication_unavailable",
  );
  for (const table of [
    "waiver_requests",
    "waiver_adjudications",
    "waiver_batch_idempotency",
    "codex_execution_queue",
  ]) {
    assert.equal(
      application.durableCore.get(`SELECT count(*) AS count FROM ${table}`)
        ?.count,
      0,
    );
  }
});
