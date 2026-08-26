import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.ts";

const path = "/api/v1/waiver-adjudicator-configuration";

test("only the operator can read and atomically change the installation-wide Waiver Adjudicator Configuration", async () => {
  const { application, request } = await startApplication();
  const anonymous = await request(path);
  assert.equal(anonymous.status, 401);

  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const machine = await request(path, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(machine.status, 403);
  assert.equal(await responseErrorCode(machine), "authorization_forbidden");

  const headers = await authenticatedOperatorHeaders(request);
  const initial = await request(path, { headers });
  assert.equal(initial.status, 200);
  assert.deepEqual(await initial.json(), { configured: false });

  const invalid = await request.invalidRequest(path, {
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      reasoning_effort: "ultra",
      service_tier: "standard",
    }),
    headers,
    method: "PATCH",
  });
  assert.equal(invalid.status, 422);
  assert.equal(
    await responseErrorCode(invalid),
    "codex_reasoning_effort_unsupported",
  );
  assert.deepEqual(await (await request(path, { headers })).json(), {
    configured: false,
  });

  const exact = {
    model: "gpt-5.6-sol",
    reasoning_effort: "xhigh",
    service_tier: "fast",
  };
  const changed = await request(path, {
    body: JSON.stringify(exact),
    headers,
    method: "PATCH",
  });
  assert.equal(changed.status, 200);
  assert.deepEqual(await changed.json(), {
    changed: true,
    configuration: exact,
  });
  assert.deepEqual(await (await request(path, { headers })).json(), {
    configured: true,
    configuration: exact,
  });

  application.durableCore.run(
    "UPDATE waiver_adjudicator_configuration SET model = ?",
    "gpt-5.6-obsolete",
  );
  const obsolete = await request(path, { headers });
  assert.equal(obsolete.status, 422);
  assert.equal(await responseErrorCode(obsolete), "codex_model_unsupported");
});
