import assert from "node:assert/strict";
import { request as sendHttpRequest } from "node:http";
import { test } from "node:test";

import { createEvaluationService } from "../src/evaluation/evaluation.js";
import { createReviewRunClaimService } from "../src/review/review-run-claim.js";
import { createReviewRunEvidenceService } from "../src/review/review-run-evidence.js";
import { createReviewRunResultService } from "../src/review/review-run-result.js";
import { createReviewService } from "../src/review/review.js";
import {
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";

const baseCommit = "1".repeat(40);
const headCommit = "2".repeat(40);
const requestBody = {
  base: { type: "branch", value: "main" },
  head: { type: "branch", value: "topic" },
};

/**
 * @param {{implementerTokens: {create(password: string): string}}} application
 * @param {string | undefined} [idempotencyKey]
 */
function machineHeaders(application, idempotencyKey) {
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  return {
    headers: {
      authorization: `Bearer ${token}`,
      ...(idempotencyKey
        ? {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          }
        : {}),
    },
    token,
  };
}

test("the implementer token requests, polls, and reads canonical Evaluation facts", async () => {
  const { application, request } = await startApplication({
    createEvaluations(core, options) {
      return createEvaluationService(core, {
        ...options,
        acquireChangeset: async () => ({
          base_commit: baseCommit,
          head_commit: headCommit,
        }),
        createId: () => "evaluation-1",
        createReviewRunId: () => "review-run-1",
        createWaiverAdjudicationId: () => "waiver-adjudication-1",
        createWaiverRequestId: () => "waiver-request-1",
        now: () => 10,
      });
    },
  });
  application.durableCore.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://example.invalid/evaluation-1.git",
    1,
    1,
  );
  let factId = 0;
  createReviewService(application.durableCore, {
    createId: () => `machine-review-fact-${++factId}`,
    now: () => 1,
  }).create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [{ impact: "advisory", instruction: "Prove the claim." }],
    description: "Machine Evaluation Review",
    name: "Machine Evaluation",
  });
  const { headers, token } = machineHeaders(
    application,
    "queued-machine-evaluation",
  );
  const evaluationPath = "/api/v1/evaluations/evaluation-1";
  const queued = await request(
    "/api/v1/repositories/repository-1/evaluations",
    {
      body: JSON.stringify(requestBody),
      headers,
      method: "POST",
    },
  );
  assert.equal(queued.status, 201);
  assert.equal(queued.headers.get("location"), evaluationPath);
  assert.equal(
    /** @type {{execution_status: string}} */ (await queued.json())
      .execution_status,
    "queued",
  );
  const readHeaders = { authorization: `Bearer ${token}` };
  const earlyResult = await request(`${evaluationPath}/result`, {
    headers: readHeaders,
  });
  assert.equal(earlyResult.status, 409);
  assert.equal(
    await responseErrorCode(earlyResult),
    "evaluation_result_not_ready",
  );
  const claims = createReviewRunClaimService(application.durableCore, {
    createWorkerId: () => "machine-resource-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");
  const criterion = application.durableCore.get(
    `SELECT review_version_criteria.criterion_id
     FROM review_version_criteria
     JOIN review_runs
       ON review_runs.review_version_id =
            review_version_criteria.review_version_id
     WHERE review_runs.id = ?`,
    "review-run-1",
  );
  const criterionId = /** @type {string} */ (criterion?.criterion_id);
  assert.equal(typeof criterionId, "string");
  createReviewRunResultService(application.durableCore, {
    createFindingId: () => "finding-1",
    now: () => 30,
  }).prepare(
    claim,
    {
      criterion_results: [
        {
          criterion_id: criterionId,
          findings: [
            {
              evidence: "The machine-visible concern is exact.",
              location: { kind: "changeset" },
              remediation: "Resolve the exact concern.",
            },
          ],
          outcome: "triggered",
        },
      ],
    },
    [],
  );
  createReviewRunEvidenceService(application.durableCore).complete(claim, {
    exitCode: 0,
    signal: null,
    tokenCounters: {
      cached_input_tokens: null,
      input_tokens: null,
      output_tokens: null,
    },
  });

  const resultResponse = await request(`${evaluationPath}/result`, {
    headers: readHeaders,
  });
  const result = /** @type {{findings: unknown[], review_runs: unknown[]}} */ (
    await resultResponse.json()
  );
  for (const [path, expected] of /** @type {[string, unknown][]} */ ([
    [`${evaluationPath}/review-runs/review-run-1`, result.review_runs[0]],
    [`${evaluationPath}/findings/finding-1`, result.findings[0]],
  ])) {
    const response = await request(path, { headers: readHeaders });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
  }
  application.durableCore.run(
    `INSERT INTO waiver_adjudicator_configuration (
       singleton, model, reasoning_effort, service_tier, updated_at
     ) VALUES (1, 'gpt-5.6-terra', 'high', 'standard', 30)`,
  );
  const waiverBody = JSON.stringify({
    requests: [
      {
        finding_id: "finding-1",
        rationale: "This exact deployment must retain the flagged behavior.",
      },
    ],
  });
  const waiverPath = `${evaluationPath}/waiver-adjudications`;
  const waiver = await request(waiverPath, {
    body: waiverBody,
    headers: {
      ...readHeaders,
      "content-type": "application/json",
      "idempotency-key": "waiver-key",
    },
    method: "POST",
  });
  assert.equal(waiver.status, 201);
  assert.equal(
    waiver.headers.get("location"),
    "/api/v1/waiver-adjudications/waiver-adjudication-1",
  );
  const waiverResource = /** @type {any} */ (await waiver.json());
  assert.equal(waiverResource.adjudication.execution_status, "queued");
  assert.deepEqual(
    await (
      await request(waiverPath, {
        body: waiverBody,
        headers: {
          ...readHeaders,
          "content-type": "application/json",
          "idempotency-key": "waiver-key",
        },
        method: "POST",
      })
    ).json(),
    waiverResource,
  );
  const conflict = await request(waiverPath, {
    body: JSON.stringify({
      requests: [{ finding_id: "finding-1", rationale: "Different input" }],
    }),
    headers: {
      ...readHeaders,
      "content-type": "application/json",
      "idempotency-key": "waiver-key",
    },
    method: "POST",
  });
  assert.equal(conflict.status, 409);
  assert.equal(await responseErrorCode(conflict), "idempotency_conflict");
  const active = await request(waiverPath, {
    body: JSON.stringify({
      requests: [{ finding_id: "finding-1", rationale: "Another rationale" }],
    }),
    headers: {
      ...readHeaders,
      "content-type": "application/json",
      "idempotency-key": "active-waiver-key",
    },
    method: "POST",
  });
  assert.equal(active.status, 409);
  const activeError = /** @type {{
   * error: {code: string, message: string, request_id: string}
   * }} */ (await active.json()).error;
  assert.equal(activeError.code, "waiver_adjudication_active");
  assert.equal(
    activeError.message,
    "Waiver Adjudication waiver-adjudication-1 is queued",
  );
  assert.equal(typeof activeError.request_id, "string");
  const malformed = await request("/api/v1/evaluations/%ZZ/result", {
    headers: readHeaders,
  });
  assert.equal(malformed.status, 400);
  assert.equal(await responseErrorCode(malformed), "request_malformed");
});

test("disconnect after durable machine acceptance does not cancel Evaluation work", async () => {
  /** @type {(value?: unknown) => void} */
  let reportAccepted = () => {};
  const accepted = new Promise((resolve) => {
    reportAccepted = resolve;
  });
  /** @type {(value?: unknown) => void} */
  let releaseResponse = () => {};
  const responseReleased = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  const { application, origin } = await startApplication({
    createEvaluations(core, options) {
      const evaluations = createEvaluationService(core, {
        ...options,
        acquireChangeset: async () => ({
          base_commit: baseCommit,
          head_commit: headCommit,
        }),
        createId: () => "evaluation-disconnected",
        now: () => 40,
      });
      return {
        ...evaluations,
        async createExplicit(input) {
          const created = await evaluations.createExplicit(input);
          reportAccepted();
          await responseReleased;
          return created;
        },
      };
    },
  });
  application.durableCore.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-disconnected",
    "https://example.invalid/disconnected.git",
    1,
    1,
  );
  createReviewService(application.durableCore, {
    createId: () => "disconnect-review-fact",
    now: () => 2,
  }).create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [{ impact: "blocking", instruction: "Inspect the change." }],
    description: "Disconnect proof",
    name: "Disconnect proof",
  });
  const { headers } = machineHeaders(application, "disconnect-key");
  const body = JSON.stringify(requestBody);
  const target = new URL(
    "/api/v1/repositories/repository-disconnected/evaluations",
    origin,
  );
  const clientRequest = sendHttpRequest({
    headers: {
      ...headers,
      "content-length": Buffer.byteLength(body),
    },
    method: "POST",
    port: target.port,
    hostname: target.hostname,
    path: target.pathname,
  });
  const intentionalDisconnect = new Error("intentional machine disconnect");
  /** @type {Promise<void>} */
  const disconnected = new Promise((resolve, reject) => {
    clientRequest.once("error", (error) => {
      if (error === intentionalDisconnect) {
        resolve();
        return;
      }
      reject(error);
    });
  });
  clientRequest.end(body);
  await accepted;
  clientRequest.destroy(intentionalDisconnect);
  releaseResponse();
  await disconnected;

  assert.deepEqual(
    application.durableCore.get(
      "SELECT execution_status FROM evaluations WHERE id = ?",
      "evaluation-disconnected",
    ),
    { execution_status: "queued" },
  );
  assert.equal(
    application.durableCore.get(
      `SELECT count(*) AS count
       FROM codex_execution_queue
       JOIN review_runs ON review_runs.id = codex_execution_queue.work_id
       WHERE review_runs.evaluation_id = ?`,
      "evaluation-disconnected",
    )?.count,
    1,
  );
  assert.equal(
    application.durableCore.get(
      "SELECT count(*) AS count FROM evaluation_idempotency WHERE idempotency_key = ?",
      "disconnect-key",
    )?.count,
    1,
  );
});
