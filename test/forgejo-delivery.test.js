import assert from "node:assert/strict";
import { test } from "node:test";

import {
  forgejoDeliveryFailure,
  nextForgejoDeliveryAttemptAt,
} from "../src/forgejo-delivery.js";

test("Forgejo delivery retries transient failures indefinitely with provider-aware delay capped at one hour", () => {
  assert.equal(
    nextForgejoDeliveryAttemptAt(10_000, 1, {
      code: "forgejo_api_unavailable",
    }),
    70_000,
  );
  assert.equal(
    nextForgejoDeliveryAttemptAt(10_000, 20, {
      code: "forgejo_api_unavailable",
    }),
    3_610_000,
  );
  assert.equal(
    nextForgejoDeliveryAttemptAt(10_000, 1, {
      code: "forgejo_api_rate_limited",
      nextAttemptAt: 7_210_000,
    }),
    3_610_000,
  );
});

test("Forgejo delivery distinguishes definitive failures and uncertain creates", () => {
  assert.deepEqual(
    forgejoDeliveryFailure(
      Object.assign(
        new Error("Forgejo publication route failed with HTTP 403"),
        {
          code: "forgejo_api_request_failed",
          responseStatus: 403,
        },
      ),
      { operation: "create" },
    ),
    {
      code: "forgejo_api_request_failed",
      definitive: true,
      detail: "Forgejo publication route failed with HTTP 403",
      responseStatus: 403,
      uncertain: false,
    },
  );
  assert.deepEqual(
    forgejoDeliveryFailure(
      Object.assign(new Error("Forgejo publication route is unavailable"), {
        code: "forgejo_api_unavailable",
      }),
      { operation: "create" },
    ),
    {
      code: "forgejo_api_unavailable",
      definitive: false,
      detail: "Forgejo publication route is unavailable",
      uncertain: true,
    },
  );
  assert.deepEqual(
    forgejoDeliveryFailure(
      Object.assign(new Error("Forgejo rate limit is active"), {
        code: "forgejo_api_rate_limited",
        nextAttemptAt: 125_000,
        responseStatus: 429,
      }),
      { operation: "create" },
    ),
    {
      code: "forgejo_api_rate_limited",
      definitive: false,
      detail: "Forgejo rate limit is active",
      nextAttemptAt: 125_000,
      providerGate: true,
      responseStatus: 429,
      uncertain: false,
    },
  );
});
