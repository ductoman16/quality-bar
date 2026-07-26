import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { runStructuralLint } from "../scripts/structural-lint.mjs";

test("the structural lint gate accepts every maintained JavaScript file", async () => {
  const result = await runStructuralLint({
    repositoryRoot: resolve(import.meta.dirname, ".."),
  });

  assert.equal(result.outcome, "pass", result.report);
});
