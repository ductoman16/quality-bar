import assert from "node:assert/strict";
import { test } from "node:test";

import {
  responseErrorCode,
  startApplication,
} from "./http-integration-support.ts";

test("storage_unavailable exposes no product data or write-failure secret through browser, API, MCP, health, or logs", async () => {
  const logs: string[] = [];
  const secret = "transcript-write-secret-must-not-escape";
  const { application, origin } = await startApplication({
    writeLog(line) {
      logs.push(line);
    },
  });
  const token = application.implementerTokens.create(
    "a correct operator password",
  );

  application.durableCore.run("PRAGMA query_only = ON");
  assert.throws(
    () =>
      application.durableCore.transaction((transaction) => {
        transaction.run(
          "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
          "transcript_failure_secret",
          secret,
        );
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "storage_unavailable",
  );

  for (const [path, headers] of [
    ["/", {}],
    ["/assets/operator.js", {}],
    ["/api/v1/system", { authorization: `Bearer ${token}` }],
    [
      "/mcp/v1",
      {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
      },
    ],
  ] as Array<[string, Record<string, string>]>) {
    const response = await fetch(`${origin}${path}`, { headers });
    assert.equal(response.status, 503, path);
    assert.equal(await responseErrorCode(response), "storage_unavailable");
  }

  const live = await fetch(`${origin}/health/live`);
  assert.deepEqual(
    { body: await live.json(), status: live.status },
    { body: { status: "live" }, status: 200 },
  );
  const ready = await fetch(`${origin}/health/ready`);
  assert.deepEqual(
    { body: await ready.json(), status: ready.status },
    {
      body: { error: "storage_unavailable", status: "not_ready" },
      status: 503,
    },
  );
  assert.doesNotMatch(logs.join(""), new RegExp(secret));
  const storageFailureLog = logs
    .map((line) => JSON.parse(line))
    .find((record) => record.event === "storage_unavailable");
  assert.deepEqual(storageFailureLog, {
    component: "storage",
    detail: "SQLite durable write failed",
    error: "storage_unavailable",
    event: "storage_unavailable",
    outcome: "failure",
    severity: "error",
    timestamp: storageFailureLog.timestamp,
  });
});
