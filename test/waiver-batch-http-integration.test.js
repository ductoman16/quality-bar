import assert from "node:assert/strict";
import test from "node:test";

import {
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.js";

test("machine waiver state conflicts use the fixed 409 mapping", async () => {
  const { application, request } = await startApplication();
  seedCompletedEvaluation(application.durableCore);
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const path = "/api/v1/evaluations/evaluation-1/waiver-adjudications";
  /**
   * @param {string} findingId
   * @param {string} rationale
   * @param {string} key
   */
  const submit = (findingId, rationale, key) =>
    request(path, {
      body: JSON.stringify({
        requests: [{ finding_id: findingId, rationale }],
      }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": key,
      },
      method: "POST",
    });

  const invalid = await request.invalidRequest(path, {
    body: JSON.stringify({ requests: [] }),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": "invalid-key",
    },
    method: "POST",
  });
  assert.equal(invalid.status, 422);
  assert.equal(await responseErrorCode(invalid), "waiver_batch_invalid");

  const ineligible = await submit(
    "finding-blocking",
    "This blocking Finding cannot be waived.",
    "ineligible-key",
  );
  assert.equal(ineligible.status, 409);
  assert.equal(
    await responseErrorCode(ineligible),
    "waiver_finding_ineligible",
  );
  for (let index = 1; index <= 3; index += 1) {
    application.durableCore.run(
      "INSERT INTO waiver_requests (id, evaluation_id, finding_id, rationale, requester_channel, created_at) VALUES (?, 'evaluation-1', 'finding-1', ?, 'browser_session', ?)",
      `prior-request-${index}`,
      `Prior rationale ${index}`,
      index,
    );
  }
  const limited = await submit(
    "finding-1",
    "A fourth distinct rationale.",
    "limit-key",
  );
  assert.equal(limited.status, 409);
  assert.equal(
    await responseErrorCode(limited),
    "waiver_request_limit_reached",
  );
});
