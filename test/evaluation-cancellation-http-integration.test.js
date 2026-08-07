import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

test("only the operator browser can cancel an active Evaluation", async () => {
  const { application, request } = await startApplication();
  await createQueuedReviewRun(application.durableCore);
  const operatorHeaders = await authenticatedOperatorHeaders(request);
  const path = "/api/v1/evaluations/evaluation-1/cancel";
  const missingCsrf = await request(path, {
    headers: { cookie: operatorHeaders.cookie },
    method: "POST",
  });
  assert.equal(missingCsrf.status, 403);
  assert.equal(await responseErrorCode(missingCsrf), "origin_invalid");

  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const machine = await request(path, {
    headers: { authorization: `Bearer ${token}` },
    method: "POST",
  });
  assert.equal(machine.status, 403);
  assert.equal(await responseErrorCode(machine), "authorization_forbidden");

  const cancelled = await request(path, {
    headers: operatorHeaders,
    method: "POST",
  });
  assert.equal(cancelled.status, 200);
  const cancelledResource = /** @type {any} */ (await cancelled.json());
  assert.deepEqual(
    (({ effective_outcome, execution_status }) => ({
      effective_outcome,
      execution_status,
    }))(cancelledResource),
    { effective_outcome: "error", execution_status: "cancelled" },
  );
  const result = await request("/api/v1/evaluations/evaluation-1/result", {
    headers: { cookie: operatorHeaders.cookie },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(
    /** @type {{review_runs: any[]}} */ (await result.json()).review_runs.map(
      ({ error, execution_status: status }) => ({ error, status }),
    ),
    [
      {
        error: {
          code: "cancelled_by_operator",
          detail: "Evaluation was cancelled by the operator",
        },
        status: "cancelled",
      },
    ],
  );

  const repeated = await request(path, {
    headers: operatorHeaders,
    method: "POST",
  });
  assert.equal(repeated.status, 409);
  assert.equal(await responseErrorCode(repeated), "evaluation_not_cancellable");
});
