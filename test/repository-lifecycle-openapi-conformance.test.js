import { test } from "node:test";

import { canonicalOpenApiDocument } from "../src/canonical-api.js";
import { createHttpConformanceAssertion } from "../scripts/openapi-conformance.mjs";

test("Forgejo Repository lifecycle responses conform to the canonical resource", async () => {
  const assertion = await createHttpConformanceAssertion(
    canonicalOpenApiDocument(),
  );
  await assertion.assertExchange({
    request: {
      body: JSON.stringify({ lifecycle: "retired" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
      url: "http://127.0.0.1/api/v1/repositories/repository-2/lifecycle",
    },
    response: Response.json({
      api_url: "https://forgejo.example/api/v1/repos/operator/private",
      assignment_count: 1,
      credential_type: "forge_connection",
      deletion_eligible: false,
      forge_connection_id: "forgejo-connection-1",
      forge_repository_id: 11,
      health: "healthy",
      health_error: null,
      id: "repository-2",
      lifecycle: "retired",
      name: "operator/private",
      provider: "forgejo",
      url: "https://forgejo.example/operator/private.git",
      verification_id: "verification-2",
      verified_at: 2_000,
      web_url: "https://forgejo.example/operator/private",
    }),
  });
});
