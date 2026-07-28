import assert from "node:assert/strict";
import { test } from "node:test";

import { createForgejoV16Verifier } from "../src/forgejo-v16.js";

test("Forgejo v16 verifier rejects an inferred repository selection before any request", async () => {
  let requested = false;
  const verifier = createForgejoV16Verifier({
    fetch: async () => {
      requested = true;
      return new Response();
    },
  });
  await assert.rejects(
    verifier.verify({
      baseUrl: "https://forgejo.example",
      repositoryIds: [],
      token: "operator-created-pat",
    }),
    { code: "forgejo_verification_request_invalid" },
  );
  assert.equal(requested, false);
});
