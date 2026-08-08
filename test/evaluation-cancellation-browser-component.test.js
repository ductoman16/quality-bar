import assert from "node:assert/strict";
import { test } from "node:test";

import { operatorPage } from "../src/browser-pages.js";

test("Evaluation monitor keeps mutations scoped to Cancel and Retry", () => {
  const page = operatorPage({ view: "evaluations" });
  assert.match(page, /id="evaluation-list"/);
  assert.match(page, /id="evaluation-error"/);
  assert.doesNotMatch(
    page,
    /waiver-adjudications|evaluation-result\.js|evaluation-feedback\.js/,
  );
});
