import assert from "node:assert/strict";
import { test } from "node:test";

import { operatorPage } from "../src/browser-pages.js";

test("Evaluation monitor retains explicit selector validation controls", () => {
  const page = operatorPage({ view: "evaluations" });
  assert.match(
    page,
    /id="evaluation-create-base-type"[\s\S]*<option value="branch">Branch<\/option><option value="commit">Commit<\/option>/,
  );
  assert.match(
    page,
    /id="evaluation-create-head-type"[\s\S]*<option value="branch">Branch<\/option><option value="commit">Commit<\/option>/,
  );
  assert.match(page, /id="evaluation-create-status"/);
});
