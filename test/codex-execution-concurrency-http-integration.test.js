import assert from "node:assert/strict";
import test from "node:test";

import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";
import { createCodexExecutionClaimService } from "../src/codex/codex-execution-claim.js";
import { seedQueuedCodexExecutionKinds } from "./codex-execution-ordering-support.js";

const path = "/api/v1/system/codex-concurrency";

test("the operator changes durable Codex concurrency through the running application", async () => {
  const { application, request } = await startApplication();
  assert.equal((await request(path)).status, 401);
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const machine = await request(path, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(machine.status, 403);
  assert.equal(await responseErrorCode(machine), "authorization_forbidden");

  const headers = await authenticatedOperatorHeaders(request);
  assert.deepEqual(await (await request(path, { headers })).json(), {
    maximum_running: 1,
  });
  for (const maximumRunning of [2, 1]) {
    const changed = await request(path, {
      body: JSON.stringify({ maximum_running: maximumRunning }),
      headers,
      method: "PATCH",
    });
    assert.equal(changed.status, 200);
    assert.deepEqual(await changed.json(), {
      maximum_running: maximumRunning,
    });
  }

  const invalid = await request.invalidRequest(path, {
    body: JSON.stringify({ maximum_running: 5 }),
    headers,
    method: "PATCH",
  });
  assert.equal(invalid.status, 422);
  assert.equal(
    await responseErrorCode(invalid),
    "codex_execution_concurrency_invalid",
  );
  assert.deepEqual(await (await request(path, { headers })).json(), {
    maximum_running: 1,
  });
});

test("the authenticated System resource exposes queue order, leases, and the no-new-start concurrency gate", async () => {
  const { application, request } = await startApplication();
  seedQueuedCodexExecutionKinds(application.durableCore, {
    adjudicationReadyAt: 10,
    reviewRunReadyAt: 10,
  });
  const claims = createCodexExecutionClaimService(application.durableCore, {
    createWorkerId: () => "worker-a",
    now: () => 10,
  });
  const running = claims.claimNext();
  assert.ok(running);
  claims.start(running, "0.145.0");

  const headers = await authenticatedOperatorHeaders(request);
  const response = await request("/api/v1/system", { headers });
  assert.equal(response.status, 200);
  const system = /** @type {{codex_execution: any}} */ (await response.json());
  assert.deepEqual(system.codex_execution, {
    concurrency: {
      maximum_running: 1,
      running_count: 1,
      start_gate: "no_new_start",
    },
    failures: [],
    queue: {
      count: 1,
      rows: [
        {
          evaluation_id: "evaluation-queued",
          execution_status: "queued",
          gate: { code: "no_new_start" },
          lease: {
            expires_at: null,
            fencing_token: 0,
            status: "unclaimed",
            worker_id: null,
          },
          next_attempt_at: "1970-01-01T00:00:00.010Z",
          pre_start_attempt_count: 0,
          queue_position: 1,
          retry_cycle: 1,
          retry_error: null,
          retry_state: "ready",
          review_run_id: "review-run-z",
        },
      ],
    },
    running: {
      count: 1,
      rows: [
        {
          execution_status: "running",
          gate: { code: "running" },
          lease: {
            expires_at: "1970-01-01T00:02:00.010Z",
            fencing_token: 1,
            status: "running",
            worker_id: "worker-a",
          },
          pre_start_attempt_count: 0,
          retry_cycle: 1,
          retry_error: null,
          retry_state: "ready",
          waiver_adjudication_id: "adjudication-a",
        },
      ],
    },
  });
});
