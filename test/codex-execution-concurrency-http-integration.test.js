import assert from "node:assert/strict";
import test from "node:test";

import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";

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
