import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { runCoreJavaScriptLint } from "../scripts/core-js-lint.mts";

const repositoryRoot = resolve(import.meta.dirname, "..");

function fixture(name: string) {
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
    "destructured-frozen-non-error": "error-only-throwing/error-only-throwing",
    "destructured-frozen-aliased-non-error":
      "error-only-throwing/error-only-throwing",
    "destructured-frozen-defaulted-non-error":
      "error-only-throwing/error-only-throwing",
    "destructured-frozen-absent-defaulted-non-error":
      "error-only-throwing/error-only-throwing",
    "destructured-frozen-void-defaulted-non-error":
      "error-only-throwing/error-only-throwing",
    "destructured-frozen-absent-non-error":
      "error-only-throwing/error-only-throwing",
    "destructured-frozen-undefined-non-error":
      "error-only-throwing/error-only-throwing",
    "destructured-frozen-void-non-error":
      "error-only-throwing/error-only-throwing",
    "bound-non-error": "error-only-throwing/error-only-throwing",
    "bare-error-constructor": "error-only-throwing/error-only-throwing",
    "bare-non-error-constructor": "error-only-throwing/error-only-throwing",
    "called-non-error": "error-only-throwing/error-only-throwing",
    "called-built-in-non-error": "error-only-throwing/error-only-throwing",
    "inline-called-non-error": "error-only-throwing/error-only-throwing",
    "member-function-non-error": "error-only-throwing/error-only-throwing",
    "member-function-result-non-error":
      "error-only-throwing/error-only-throwing",
    "member-built-in-result-non-error":
      "error-only-throwing/error-only-throwing",
    "member-non-error": "error-only-throwing/error-only-throwing",
    "shadowed-error-name": "error-only-throwing/error-only-throwing",
    "reassigned-non-error": "error-only-throwing/error-only-throwing",
    "snapshot-function-non-error": "error-only-throwing/error-only-throwing",
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

test("Error-only throwing accepts an imported Error-suffixed constructor", async () => {
  const result = await runCoreJavaScriptLint({
    files: [
      {
        path: "src/error-import-fixture.js",
        source:
          "import { DurableCoreError as Failure } from './durable/durable-error.ts';\nthrow new Failure('invalid', 'invalid');\n",
      },
    ],
    repositoryRoot,
  });

  assert.equal(result.outcome, "pass", result.report);
});

test("Error-only throwing rejects an imported constructor without an Error suffix", async () => {
  const result = await runCoreJavaScriptLint({
    files: [
      {
        path: "src/non-error-import-fixture.js",
        source:
          "import { SomeUtility } from './durable/durable-error.ts';\nthrow new SomeUtility('invalid');\n",
      },
    ],
    repositoryRoot,
  });

  assert.equal(result.outcome, "fail", result.report);
  assert.match(result.report, /\[error-only-throwing\/error-only-throwing\]/);
});

test("Error-only throwing does not reject calls or members changed to Error values", async () => {
  const result = await runCoreJavaScriptLint({
    files: [
      {
        path: "src/error-reassignment-fixture.js",
        source:
          "let factory = () => new String('invalid');\nfactory = () => new Error('valid');\nconst holder = { failure: new String('invalid') };\nholder['failure'] = new Error('valid');\nconst aliasHolder = { failure: new String('invalid') };\nconst alias = aliasHolder;\nalias.failure = new Error('valid');\nlet value = new String('invalid');\nconst captured = () => value;\nvalue = new Error('valid');\nfunction throwFactory() {\n  throw factory();\n}\nfunction throwHolder() {\n  throw holder.failure;\n}\nfunction throwAliasHolder() {\n  throw aliasHolder.failure;\n}\nfunction throwCaptured() {\n  throw captured();\n}\nfunction throwConditional(condition) {\n  let conditional = new Error('valid');\n  if (condition) {\n    conditional = new String('invalid');\n  }\n  throw conditional;\n}\nfunction throwDeferred() {\n  let deferred = new Error('valid');\n  const deferredWrite = () => {\n    deferred = new String('invalid');\n  };\n  Object.freeze(deferredWrite);\n  throw deferred;\n}\nlet ordered = new Error('valid');\nfunction throwLater() {\n  throw ordered;\n}\nordered = new String('invalid');\nthrowFactory();\nthrowHolder();\nthrowAliasHolder();\nthrowCaptured();\nthrowConditional(false);\nthrowDeferred();\nthrowLater();\n",
      },
    ],
    repositoryRoot,
  });

  assert.equal(result.outcome, "pass", result.report);
});

test("Error-only throwing accepts an Error default for an undefined frozen property", async () => {
  const result = await runCoreJavaScriptLint({
    files: [
      {
        path: "src/error-default-fixture.js",
        source:
          "const { failure: reason = new Error('valid') } = Object.freeze({ failure: undefined });\nthrow reason;\n",
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
      path: "src/system/system-resource.js",
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
      path: "src/durable/durable-access.js",
      rule: "error-only-throwing/error-only-throwing",
    },
    {
      column: 11,
      line: 30,
      path: "src/durable/durable-access.js",
      rule: "error-only-throwing/error-only-throwing",
    },
  ]);
});
