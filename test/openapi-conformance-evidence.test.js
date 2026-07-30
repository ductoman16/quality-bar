import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("the canonical OpenAPI conformance evidence records the complete cleanup", () => {
  const evidence = JSON.parse(
    readFileSync(
      new URL(
        "../evidence/quality-foundation/issue-165-openapi-conformance.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(evidence.ticket, 165);
  assert.deepEqual(evidence.published_contract, {
    documents: 1,
    operations: 12,
    response_statuses: 66,
    version: "3.1.0",
  });
  assert.deepEqual(evidence.cross_process_smokes, [
    "authenticated-firefox-browser-cross-process",
    "compose-service",
  ]);
  assert.equal(evidence.new_e2e_scenarios, 0);
  assert.equal(evidence.final_outcome, "pass");
});
