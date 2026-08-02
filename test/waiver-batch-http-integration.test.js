import assert from "node:assert/strict";
import test from "node:test";

import { createWaiverAdjudicationResultService } from "../src/waiver-adjudication-result-service.js";
import { createWaiverBatchService } from "../src/waiver-batch.js";
import {
  authenticatedOperatorHeaders,
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
    const adjudicationId = `prior-adjudication-${index}`;
    const requestId = `prior-request-${index}`;
    const workerId = `prior-worker-${index}`;
    createWaiverBatchService(application.durableCore, {
      createAdjudicationId: () => adjudicationId,
      createRequestId: () => requestId,
      now: () => index,
      readCodexCapabilityFailure: () => null,
      storageReserve: { assertWorkAdmissionAvailable() {} },
    }).submit({
      channel: "browser_session",
      evaluationId: "evaluation-1",
      idempotencyKey: `prior-key-${index}`,
      request: {
        requests: [
          {
            finding_id: "finding-1",
            rationale: `Prior rationale ${index}`,
          },
        ],
      },
    });
    application.durableCore.run(
      `UPDATE codex_execution_queue
       SET worker_id = ?, fencing_token = 1,
           lease_expires_at = 100, started_at = ?
       WHERE work_id = ?`,
      workerId,
      index,
      adjudicationId,
    );
    application.durableCore.run(
      `UPDATE waiver_adjudications
       SET execution_status = 'running', started_at = ?,
           codex_cli_version = '0.145.0'
       WHERE id = ?`,
      index,
      adjudicationId,
    );
    createWaiverAdjudicationResultService(application.durableCore, {
      createDecisionId: () => `prior-decision-${index}`,
      now: () => index,
    }).prepare(
      {
        fencingToken: 1,
        workerId,
        workId: adjudicationId,
      },
      {
        decisions: [
          {
            explanation: "The prior rationale did not justify an exception.",
            outcome: "denied",
            request_id: requestId,
          },
        ],
      },
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

test("only the browser operator can queue an errored immutable Request retry", async () => {
  const { application, request } = await startApplication();
  seedCompletedEvaluation(application.durableCore);
  createWaiverBatchService(application.durableCore, {
    createAdjudicationId: () => "adjudication-error",
    createRequestId: () => "request-error",
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: "initial-error",
    request: {
      requests: [
        {
          finding_id: "finding-1",
          rationale: "The required generated evidence is unavailable.",
        },
      ],
    },
  });
  application.durableCore.run(
    `UPDATE codex_execution_queue
     SET worker_id = 'error-worker', fencing_token = 1,
         lease_expires_at = 100, started_at = 11
     WHERE work_id = 'adjudication-error'`,
  );
  application.durableCore.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'running', started_at = 11,
         codex_cli_version = '0.145.0'
     WHERE id = 'adjudication-error'`,
  );
  createWaiverAdjudicationResultService(application.durableCore, {
    createDecisionId: () => "decision-error",
    now: () => 12,
  }).prepare(
    {
      fencingToken: 1,
      workerId: "error-worker",
      workId: "adjudication-error",
    },
    {
      decisions: [
        {
          error: {
            code: "required_evidence_unavailable",
            detail: "The generated evidence cannot be inspected.",
          },
          outcome: "error",
          request_id: "request-error",
        },
      ],
    },
  );
  const path =
    "/api/v1/evaluations/evaluation-1/waiver-adjudications/error-retries";
  const body = JSON.stringify({ request_ids: ["request-error"] });
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const forbidden = await request(path, {
    body,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": "machine-retry",
    },
    method: "POST",
  });
  assert.equal(forbidden.status, 403);
  assert.equal(await responseErrorCode(forbidden), "authorization_forbidden");

  const retried = await request(path, {
    body,
    headers: {
      ...(await authenticatedOperatorHeaders(request)),
      "idempotency-key": "operator-retry",
    },
    method: "POST",
  });
  assert.equal(retried.status, 201);
  const resource = /** @type {any} */ (await retried.json());
  assert.deepEqual(resource.adjudication.request_ids, ["request-error"]);
  assert.deepEqual(
    resource.requests.map(
      (/** @type {{id: string}} */ requestValue) => requestValue.id,
    ),
    ["request-error"],
  );
  assert.equal(
    application.durableCore.get("SELECT count(*) AS count FROM waiver_requests")
      ?.count,
    1,
  );
  const retryStartedAt = /** @type {{accepted_at: number}} */ (
    application.durableCore.get(
      "SELECT accepted_at FROM codex_execution_queue WHERE work_id = ?",
      resource.adjudication.id,
    )
  ).accepted_at;
  application.durableCore.run(
    `UPDATE codex_execution_queue
     SET worker_id = 'retry-worker', fencing_token = 1,
         lease_expires_at = ?, started_at = ?
     WHERE work_id = ?`,
    retryStartedAt + 100,
    retryStartedAt,
    resource.adjudication.id,
  );
  application.durableCore.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'running', started_at = ?,
         codex_cli_version = '0.145.0'
     WHERE id = ?`,
    retryStartedAt,
    resource.adjudication.id,
  );
  createWaiverAdjudicationResultService(application.durableCore, {
    createDecisionId: () => assert.fail("failure created a Decision"),
    now: () => retryStartedAt + 1,
  }).fail(
    {
      fencingToken: 1,
      workerId: "retry-worker",
      workId: resource.adjudication.id,
    },
    Object.assign(new Error("Codex process failed"), {
      code: "codex_process_failed",
    }),
  );
  const failedRecovery = await request(path, {
    body,
    headers: {
      ...(await authenticatedOperatorHeaders(request)),
      "idempotency-key": "failed-recovery",
    },
    method: "POST",
  });
  assert.equal(failedRecovery.status, 409);
  assert.equal(
    await responseErrorCode(failedRecovery),
    "waiver_error_retry_ineligible",
  );
  assert.equal(
    application.durableCore.get(
      "SELECT count(*) AS count FROM waiver_adjudications",
    )?.count,
    2,
  );
  assert.equal(
    application.durableCore.get(
      `SELECT count(*) AS count FROM waiver_batch_idempotency
       WHERE idempotency_key = 'failed-recovery'`,
    )?.count,
    0,
  );
});

test("only the browser operator can recover exhausted Waiver Adjudication work", async () => {
  const { application, request } = await startApplication();
  seedCompletedEvaluation(application.durableCore);
  createWaiverBatchService(application.durableCore, {
    createAdjudicationId: () => "adjudication-exhausted",
    createRequestId: () => "request-exhausted",
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: "initial-exhausted",
    request: {
      requests: [
        {
          finding_id: "finding-1",
          rationale: "The exact checkout could not be prepared.",
        },
      ],
    },
  });
  application.durableCore.run(
    `INSERT INTO waiver_adjudication_pre_start_attempts (
       waiver_adjudication_id, retry_cycle, attempt_number,
       failed_at, error_code, error_detail, exhausted
     ) VALUES (
       'adjudication-exhausted', 1, 3, 20,
       'repository_git_read_failed',
       'The frozen Repository could not be prepared.', 1
    )`,
  );
  const projection = await request(
    "/api/v1/evaluations/evaluation-1/waiver-adjudications",
    { headers: { ...(await authenticatedOperatorHeaders(request)) } },
  );
  assert.equal(projection.status, 200);
  assert.deepEqual(await projection.json(), {
    items: [
      {
        completed_at: null,
        decisions: [],
        exhausted_at: "1970-01-01T00:00:00.020Z",
        execution_status: "queued",
        followup: null,
        id: "adjudication-exhausted",
        next_attempt_at: null,
        pre_start_attempt_count: 1,
        request_ids: ["request-exhausted"],
        retry_cycle: 1,
        retry_error: {
          code: "repository_git_read_failed",
          detail: "The frozen Repository could not be prepared.",
        },
        retry_state: "exhausted",
        started_at: null,
      },
    ],
  });
  const path = "/api/v1/waiver-adjudications/adjudication-exhausted/recover";
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const forbidden = await request(path, {
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": "machine-recovery",
    },
    method: "POST",
  });
  assert.equal(forbidden.status, 403);
  assert.equal(await responseErrorCode(forbidden), "authorization_forbidden");

  const recovered = await request(path, {
    headers: {
      ...(await authenticatedOperatorHeaders(request)),
      "idempotency-key": "operator-recovery",
    },
    method: "POST",
  });
  assert.equal(recovered.status, 200);
  const resource = /** @type {any} */ (await recovered.json());
  assert.equal(resource.adjudication.id, "adjudication-exhausted");
  assert.deepEqual(
    application.durableCore.get(
      `SELECT codex_execution_queue.retry_state,
              waiver_adjudications.retry_cycle
       FROM waiver_adjudications
       JOIN codex_execution_queue
         ON codex_execution_queue.work_id = waiver_adjudications.id
       WHERE waiver_adjudications.id = 'adjudication-exhausted'`,
    ),
    { retry_cycle: 2, retry_state: "ready" },
  );
});
