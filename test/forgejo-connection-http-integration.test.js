import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";

test("Forgejo Connection HTTP registration keeps PAT input write-only and preserves its owning error", async () => {
  /** @type {unknown[]} */
  const calls = [];
  const { request } = await startApplication({
    createForgejoConnections() {
      return {
        async discover() {
          throw new Error("unused Forgejo Connection discovery");
        },
        async connect(/** @type {unknown} */ input) {
          calls.push(input);
          throw Object.assign(
            new Error("Forgejo Connection requires stable v16.x"),
            { code: "forgejo_version_unsupported" },
          );
        },
        destroy() {},
        read() {
          return null;
        },
      };
    },
  });
  const headers = await authenticatedOperatorHeaders(request);
  const response = await request("/api/v1/forgejo-connections", {
    body: JSON.stringify({
      base_url: "https://forgejo.example",
      repository_ids: [11],
      token: "operator-created-pat",
    }),
    headers,
    method: "POST",
  });
  assert.equal(response.status, 422);
  assert.equal(
    await responseErrorCode(response),
    "forgejo_version_unsupported",
  );
  assert.deepEqual(calls, [
    {
      base_url: "https://forgejo.example",
      repository_ids: [11],
      token: "operator-created-pat",
    },
  ]);
});
