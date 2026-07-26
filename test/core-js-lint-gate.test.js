import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { runCoreJavaScriptLint } from "../scripts/core-js-lint.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

function fixture(name) {
  return readFileSync(
    resolve(repositoryRoot, "fixtures", "core-js-lint", `${name}.js.txt`),
    "utf8",
  );
}

test("the core JavaScript correctness gate accepts maintained JavaScript", async () => {
  const result = await runCoreJavaScriptLint({ repositoryRoot });

  assert.equal(result.outcome, "pass", result.report);
  assert.match(
    result.report,
    /core_javascript_lint: PASS \(\d+ maintained JavaScript files, zero warnings\)/,
  );
});

test("the core JavaScript correctness gate reports every required rule family", async () => {
  const expectedDiagnostics = {
    "recommended-no-undef": "no-undef",
    curly: "curly",
    "strict-equality": "eqeqeq",
    "implicit-coercion": "no-implicit-coercion",
    "error-only-throwing": "no-throw-literal",
    "constructed-non-error": "error-only-throwing/error-only-throwing",
    "bound-non-error": "error-only-throwing/error-only-throwing",
    "shadowed-error-name": "error-only-throwing/error-only-throwing",
    "unproven-import": "error-only-throwing/error-only-throwing",
    "unused-variable": "no-unused-vars",
    "object-shorthand": "object-shorthand",
    "immutable-binding": "prefer-const",
  };

  for (const [name, rule] of Object.entries(expectedDiagnostics)) {
    const result = await runCoreJavaScriptLint({
      files: [
        {
          path: `fixtures/core-js-lint/${name}.js`,
          source: fixture(name),
        },
      ],
      repositoryRoot,
    });

    assert.equal(result.outcome, "fail", `${name}: ${result.report}`);
    assert.match(result.report, new RegExp(`\\[${rule}\\]`));
  }
});

test("the core JavaScript environments stay separate", async () => {
  const acceptedBrowserCode = await runCoreJavaScriptLint({
    files: [
      {
        path: "src/browser/environment-fixture.js",
        source: "document.body.textContent = 'ready';\n",
      },
    ],
    repositoryRoot,
  });
  const acceptedNodeCode = await runCoreJavaScriptLint({
    files: [
      {
        path: "src/environment-fixture.js",
        source: "process.exitCode = 0;\n",
      },
    ],
    repositoryRoot,
  });
  const browserUsingNode = await runCoreJavaScriptLint({
    files: [
      {
        path: "src/browser/environment-fixture.js",
        source: "process.exitCode = 0;\n",
      },
    ],
    repositoryRoot,
  });
  const nodeUsingBrowser = await runCoreJavaScriptLint({
    files: [
      {
        path: "scripts/environment-fixture.mjs",
        source: "document.body.textContent = 'invalid';\n",
      },
    ],
    repositoryRoot,
  });

  assert.equal(acceptedBrowserCode.outcome, "pass", acceptedBrowserCode.report);
  assert.equal(acceptedNodeCode.outcome, "pass", acceptedNodeCode.report);
  assert.equal(browserUsingNode.outcome, "fail", browserUsingNode.report);
  assert.match(browserUsingNode.report, /\[no-undef\]/);
  assert.equal(nodeUsingBrowser.outcome, "fail", nodeUsingBrowser.report);
  assert.match(nodeUsingBrowser.report, /\[no-undef\]/);
});

test("Error-only throwing accepts actual Error ancestry", async () => {
  const result = await runCoreJavaScriptLint({
    files: [
      {
        path: "src/error-ancestry-fixture.js",
        source:
          "class ReviewFailure extends Error {}\nthrow new ReviewFailure('invalid');\n",
      },
    ],
    repositoryRoot,
  });

  assert.equal(result.outcome, "pass", result.report);
});

test("Error-only throwing accepts an aliased repository Error constructor", async () => {
  const result = await runCoreJavaScriptLint({
    files: [
      {
        path: "src/error-import-fixture.js",
        source:
          "import { DurableCoreError as Failure } from './durable-error.js';\nthrow new Failure('invalid', 'invalid');\n",
      },
    ],
    repositoryRoot,
  });

  assert.equal(result.outcome, "pass", result.report);
});

test("the core JavaScript correctness evidence records the complete cleanup", () => {
  const evidence = JSON.parse(
    readFileSync(
      resolve(
        repositoryRoot,
        "evidence/quality-foundation/issue-159-core-js-lint.json",
      ),
      "utf8",
    ),
  );

  assert.equal(evidence.ticket, 159);
  assert.equal(evidence.focused_command, "npm run lint:correctness");
  assert.equal(evidence.final_outcome, "pass");
  assert.deepEqual(evidence.initial_violations, [
    {
      column: 18,
      line: 47,
      path: "src/browser/operator.js",
      rule: "curly",
    },
    {
      column: 5,
      line: 255,
      path: "src/browser/operator.js",
      rule: "curly",
    },
    {
      column: 41,
      line: 294,
      path: "src/browser/operator.js",
      rule: "curly",
    },
    {
      column: 21,
      line: 338,
      path: "src/browser/operator.js",
      rule: "curly",
    },
    {
      column: 7,
      line: 11,
      path: "src/system-resource.js",
      rule: "no-unused-vars",
    },
    {
      column: 3,
      line: 16,
      path: "test/installation-environment.test.js",
      rule: "no-unused-vars",
    },
    {
      column: 10,
      line: 132,
      path: "test/quality-foundation.test.js",
      rule: "no-unused-vars",
    },
    {
      column: 10,
      line: 192,
      path: "test/quality-foundation.test.js",
      rule: "no-unused-vars",
    },
    {
      column: 10,
      line: 217,
      path: "test/quality-foundation.test.js",
      rule: "no-unused-vars",
    },
    {
      column: 13,
      line: 15,
      path: "src/durable-access.js",
      rule: "error-only-throwing/error-only-throwing",
    },
    {
      column: 11,
      line: 30,
      path: "src/durable-access.js",
      rule: "error-only-throwing/error-only-throwing",
    },
  ]);
});
