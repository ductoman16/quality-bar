import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { waiverAdjudicatorCodexConfigurationArguments } from "../src/waiver/waiver-adjudicator-codex-configuration.ts";
import {
  authenticatedOperatorHeaders,
  startApplication,
} from "./http-integration-support.ts";

const fakeCodexPath = fileURLToPath(
  new URL(
    "../fixtures/test-probes/fake-codex-configuration.mjs",
    import.meta.url,
  ),
);

function runFakeCodex(configuration: unknown) {
  const result = spawnSync(
    process.execPath,
    [
      fakeCodexPath,
      ...waiverAdjudicatorCodexConfigurationArguments(configuration),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("a fake Codex launch receives only the exact configuration frozen for that later Adjudication", async () => {
  const { application, request } = await startApplication();
  const headers = await authenticatedOperatorHeaders(request);
  const path = "/api/v1/waiver-adjudicator-configuration";
  const first = {
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    service_tier: "standard",
  };
  const later = {
    model: "gpt-5.6-sol",
    reasoning_effort: "xhigh",
    service_tier: "fast",
  };

  assert.equal(
    (
      await request(path, {
        body: JSON.stringify(first),
        headers,
        method: "PATCH",
      })
    ).status,
    200,
  );
  const frozenForFirstAdjudication =
    application.freezeWaiverAdjudicatorConfiguration();
  assert.equal(
    (
      await request(path, {
        body: JSON.stringify(later),
        headers,
        method: "PATCH",
      })
    ).status,
    200,
  );

  const fakeCodexLaunches = [
    runFakeCodex(frozenForFirstAdjudication),
    runFakeCodex(application.freezeWaiverAdjudicatorConfiguration()),
  ];

  assert.deepEqual(fakeCodexLaunches, [first, later]);
  assert.deepEqual(Object.keys(fakeCodexLaunches[0]).sort(), [
    "model",
    "reasoning_effort",
    "service_tier",
  ]);
});
