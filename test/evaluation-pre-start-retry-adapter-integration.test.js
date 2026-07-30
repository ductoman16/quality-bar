import assert from "node:assert/strict";
import test from "node:test";

import { createEvaluationService } from "../src/evaluation.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import { createReviewService } from "../src/review.js";
import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";

test("browser retry appends a fresh cycle to the same accepted Evaluation", async () => {
  let authenticationAvailable = true;
  const { application, request } = await startApplication({
    validateCodexAuthentication() {
      if (!authenticationAvailable) {
        throw Object.assign(new Error("Codex authentication is unavailable"), {
          code: "codex_authentication_unavailable",
          unavailable: true,
        });
      }
    },
    createEvaluations(core, options) {
      let evaluation = 0;
      let reviewRun = 0;
      return createEvaluationService(core, {
        ...options,
        acquireChangeset: async () => ({
          base_commit: "1".repeat(40),
          head_commit: "2".repeat(40),
        }),
        createId: () => `evaluation-${++evaluation}`,
        createReviewRunId: () => `review-run-${++reviewRun}`,
      });
    },
  });
  application.durableCore.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://example.invalid/repository.git",
    1,
    1,
  );
  const reviews = createReviewService(application.durableCore, {
    now: () => 1,
  });
  reviews.create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [{ impact: "blocking", instruction: "Prove the retry." }],
    description: "Pre-start retry proof",
    name: "Retry proof",
  });
  reviews.create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [{ impact: "blocking", instruction: "Prove aggregation." }],
    description: "Pre-start retry aggregation proof",
    name: "Retry aggregation proof",
  });
  const headers = await authenticatedOperatorHeaders(request);
  const created = await request(
    "/api/v1/repositories/repository-1/evaluations",
    {
      body: JSON.stringify({
        base: { type: "branch", value: "main" },
        head: { type: "branch", value: "topic" },
      }),
      headers: { ...headers, "idempotency-key": "create-evaluation" },
      method: "POST",
    },
  );
  const createdBody = await created.text();
  assert.equal(created.status, 201, createdBody);
  const accepted = JSON.parse(createdBody);

  let currentTime =
    Number(
      application.durableCore.get(
        "SELECT ready_at FROM codex_execution_queue WHERE work_id = 'review-run-1'",
      )?.ready_at,
    ) + 1;
  const claims = createReviewRunClaimService(application.durableCore, {
    createWorkerId: () => `worker-${++worker}`,
    now: () => currentTime,
  });
  let worker = 0;
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.recordPreStartFailure(
    claim,
    Object.assign(new Error("Repository permission denied"), {
      code: "repository_permission_denied",
    }),
  );
  currentTime += 1;
  const laterClaim = claims.claimNext();
  assert.ok(laterClaim);
  assert.equal(laterClaim.workId, "review-run-2");
  claims.recordPreStartFailure(
    laterClaim,
    Object.assign(new Error("Temporary checkout failure"), {
      code: "review_run_checkout_failed",
    }),
  );

  const exhaustedResponse = await request(
    `/api/v1/evaluations/${accepted.id}`,
    { headers },
  );
  const exhausted = /** @type {any} */ (await exhaustedResponse.json());
  assert.equal(exhausted.retry_state, "exhausted");
  assert.deepEqual(exhausted.retry_error, {
    code: "repository_permission_denied",
    detail: "Repository permission denied",
  });

  application.durableCore.run(
    `UPDATE repositories
     SET health = 'error',
         health_error_code = 'repository_probe_failed',
         health_error_message = 'Repository probe failed'
     WHERE id = 'repository-1'`,
  );
  const healthBlocked = await request(
    `/api/v1/evaluations/${accepted.id}/retry`,
    {
      headers: { ...headers, "idempotency-key": "health-blocked-retry" },
      method: "POST",
    },
  );
  assert.equal(healthBlocked.status, 503);
  assert.equal(
    await responseErrorCode(healthBlocked),
    "repository_probe_failed",
  );
  assert.equal(
    application.durableCore.get(
      "SELECT retry_cycle FROM review_runs WHERE id = 'review-run-1'",
    )?.retry_cycle,
    1,
  );
  assert.equal(
    application.durableCore.get(
      "SELECT count(*) AS count FROM evaluation_pre_start_retries",
    )?.count,
    0,
  );
  application.durableCore.run(
    `UPDATE repositories
     SET health = 'healthy',
         health_error_code = NULL,
         health_error_message = NULL
     WHERE id = 'repository-1'`,
  );

  authenticationAvailable = false;
  const authenticationBlocked = await request(
    `/api/v1/evaluations/${accepted.id}/retry`,
    {
      headers: {
        ...headers,
        "idempotency-key": "authentication-blocked-retry",
      },
      method: "POST",
    },
  );
  assert.equal(authenticationBlocked.status, 503);
  assert.equal(
    await responseErrorCode(authenticationBlocked),
    "codex_authentication_unavailable",
  );
  assert.equal(
    application.durableCore.get(
      "SELECT retry_cycle FROM review_runs WHERE id = 'review-run-1'",
    )?.retry_cycle,
    1,
  );
  assert.equal(
    application.durableCore.get(
      "SELECT count(*) AS count FROM evaluation_pre_start_retries",
    )?.count,
    0,
  );
  authenticationAvailable = true;

  const retriedResponse = await request(
    `/api/v1/evaluations/${accepted.id}/retry`,
    {
      headers: { ...headers, "idempotency-key": "retry-evaluation" },
      method: "POST",
    },
  );
  assert.equal(retriedResponse.status, 200);
  const retried = /** @type {any} */ (await retriedResponse.json());
  assert.equal(retried.id, accepted.id);
  assert.equal(retried.retry_state, "ready");
  assert.equal(retried.pre_start_attempt_count, 2);
  assert.equal(
    application.durableCore.get(
      "SELECT retry_cycle FROM review_runs WHERE id = 'review-run-1'",
    )?.retry_cycle,
    2,
  );

  currentTime = Number(
    application.durableCore.get(
      "SELECT ready_at FROM codex_execution_queue WHERE work_id = 'review-run-2'",
    )?.ready_at,
  );
  const advancedClaim = claims.claimNext();
  assert.ok(advancedClaim);
  assert.equal(advancedClaim.workId, "review-run-1");
  claims.recordPreStartFailure(
    advancedClaim,
    Object.assign(new Error("Later temporary checkout failure"), {
      code: "review_run_checkout_failed",
    }),
  );

  const replay = await request(`/api/v1/evaluations/${accepted.id}/retry`, {
    headers: { ...headers, "idempotency-key": "retry-evaluation" },
    method: "POST",
  });
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), retried);
  assert.equal(
    application.durableCore.get(
      "SELECT retry_cycle FROM review_runs WHERE id = 'review-run-1'",
    )?.retry_cycle,
    2,
  );

  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const forbidden = await request(`/api/v1/evaluations/${accepted.id}/retry`, {
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": "machine-retry",
    },
    method: "POST",
  });
  assert.equal(forbidden.status, 403);
  assert.equal(await responseErrorCode(forbidden), "authorization_forbidden");
});
