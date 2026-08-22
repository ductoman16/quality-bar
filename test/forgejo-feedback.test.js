import assert from "node:assert/strict";
import { test } from "node:test";

import { projectForgejoDiffLineRange } from "../src/forgejo/forgejo-feedback.js";

const fileChange = {
  after_path: "src/example.js",
  before_path: "src/example.js",
  patch: "@@ -1,2 +1,3 @@\n context\n-old\n+new\n+head\n",
};

test("Forgejo projects only one-side frozen diff coordinates", () => {
  assert.deepEqual(
    projectForgejoDiffLineRange(
      { kind: "line_range", side: "head", start_line: 2, end_line: 2 },
      fileChange,
    ),
    { line: 2, path: "src/example.js", side: "RIGHT" },
  );
  assert.equal(
    projectForgejoDiffLineRange(
      { kind: "line_range", side: "base", start_line: 1, end_line: 2 },
      fileChange,
    ),
    null,
  );
  assert.equal(
    projectForgejoDiffLineRange(
      { kind: "whole_side", side: "head" },
      fileChange,
    ),
    null,
  );
  assert.equal(
    projectForgejoDiffLineRange({ kind: "changeset" }, fileChange),
    null,
  );
});
