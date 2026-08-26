import assert from "node:assert/strict";
import { test } from "node:test";

import { startApplication } from "./http-integration-support.ts";

test("GET /health/live reports only process responsiveness", async () => {
  const { request } = await startApplication();
  const response = await request("/health/live");

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), { status: "live" });
});
