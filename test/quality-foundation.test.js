import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  REQUIRED_NODE_VERSION,
  assertExactNodeRuntime,
} from "../scripts/runtime-contract.mjs";
import {
  listMaintainedJavaScriptFiles,
  runStructuralLint,
} from "../scripts/structural-lint.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("Node declarations pin the same exact runtime", () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
  );
  const dockerfile = readFileSync(
    resolve(repositoryRoot, "Dockerfile"),
    "utf8",
  );
  const nodeVersionFile = readFileSync(
    resolve(repositoryRoot, ".nvmrc"),
    "utf8",
  );
  const npmConfiguration = readFileSync(
    resolve(repositoryRoot, ".npmrc"),
    "utf8",
  );

  assert.equal(REQUIRED_NODE_VERSION, "v24.18.0");
  assert.equal(packageJson.engines.node, "24.18.0");
  assert.equal(packageJson.packageManager, "npm@11.16.0");
  assert.equal(packageJson.devDependencies.prettier, "3.7.4");
  assert.equal(packageJson.devDependencies.typescript, "7.0.2");
  assert.equal(packageJson.devDependencies["@types/node"], "24.13.3");
  assert.equal(nodeVersionFile, "24.18.0\n");
  assert.equal(npmConfiguration, "engine-strict=true\n");
  assert.match(dockerfile, /^FROM node:24\.18\.0-alpine@sha256:/m);
});

test("the verifier runtime contract rejects every nonexact Node version", () => {
  assert.doesNotThrow(() => assertExactNodeRuntime(REQUIRED_NODE_VERSION));
  assert.throws(
    () => assertExactNodeRuntime("v24.18.1"),
    new Error(
      "verification_runtime_mismatch: expected v24.18.0, received v24.18.1",
    ),
  );
});

test("the shared command runner invokes child Node with the validated runtime", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/run-with-exact-node.mjs",
      "--eval",
      "process.stdout.write(process.version)",
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, REQUIRED_NODE_VERSION);
});

test("the focused formatter rejects the representative unformatted fixture", () => {
  const result = spawnSync(
    resolve(repositoryRoot, "node_modules/.bin/prettier"),
    ["--check", "fixtures/formatting/unformatted.js"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 1, result.stderr || result.stdout);
});

test("structural-lint evidence records the complete pre-enforcement cleanup", () => {
  const evidence = JSON.parse(
    readFileSync(
      resolve(
        repositoryRoot,
        "evidence/quality-foundation/issue-158-structural-lint.json",
      ),
      "utf8",
    ),
  );

  assert.equal(evidence.ticket, 158);
  assert.equal(evidence.focused_command, "npm run lint:structure");
  assert.deepEqual(evidence.initial_violations, [
    { logical_lines: 609, path: "src/canonical-api.js", rule: "max-lines" },
    {
      logical_lines: 403,
      path: "test/durable-core.test.js",
      rule: "max-lines",
    },
  ]);
  assert.equal(evidence.final_outcome, "pass");
});

test("the structural inventory includes root configuration and JavaScript", () => {
  const paths = listMaintainedJavaScriptFiles(repositoryRoot).map((path) =>
    path.slice(repositoryRoot.length + 1),
  );

  assert.ok(paths.includes("eslint.config.js"));
  assert.ok(paths.includes("scripts/structural-lint-policy.mjs"));
});

test("structural lint reports oversized, omitted, and excluded maintained JavaScript", async () => {
  const directory = mkdtempSync(
    resolve(tmpdir(), "quality-bar-structural-lint-"),
  );
  try {
    mkdirSync(resolve(directory, "src"), { recursive: true });
    mkdirSync(resolve(directory, "fixtures"), { recursive: true });
    mkdirSync(resolve(directory, "scripts"), { recursive: true });
    mkdirSync(resolve(directory, "test"), { recursive: true });
    writeFileSync(
      resolve(directory, "src/oversized.js"),
      Array.from(
        { length: 401 },
        (value, index) =>
          `const line${index} = ${value === undefined ? index : value};`,
      ).join("\n"),
    );
    writeFileSync(
      resolve(directory, "oversized.config.js"),
      'export default [{ files: ["src/**/*.js"], rules: { "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }] } }];\n',
    );
    const oversized = await runStructuralLint({
      repositoryRoot: directory,
      configFile: "oversized.config.js",
    });
    assert.equal(oversized.outcome, "fail");
    assert.match(
      oversized.report,
      /structural_lint_max_lines: src\/oversized\.js:401:1 \[max-lines\]/,
    );

    writeFileSync(
      resolve(directory, "omitted.config.js"),
      'export default [{ files: ["scripts/**/*.mjs"], rules: { "max-lines": "error" } }];\n',
    );
    const omitted = await runStructuralLint({
      repositoryRoot: directory,
      configFile: "omitted.config.js",
    });
    assert.equal(omitted.outcome, "fail");
    assert.match(
      omitted.report,
      /structural_lint_omitted_maintained_file: src\/oversized\.js/,
    );

    writeFileSync(
      resolve(directory, "excluded.config.js"),
      'export default [{ ignores: ["src/**"] }, { files: ["src/**/*.js"], rules: { "max-lines": "error" } }];\n',
    );
    const excluded = await runStructuralLint({
      repositoryRoot: directory,
      configFile: "excluded.config.js",
    });
    assert.equal(excluded.outcome, "fail");
    assert.match(
      excluded.report,
      /structural_lint_unapproved_exclusion: src\/oversized\.js/,
    );

    writeFileSync(resolve(directory, "outside.js"), "const outside = true;\n");
    const omittedRootFile = await runStructuralLint({
      repositoryRoot: directory,
      configFile: "oversized.config.js",
    });
    assert.equal(omittedRootFile.outcome, "fail");
    assert.match(
      omittedRootFile.report,
      /structural_lint_omitted_maintained_file: outside\.js/,
    );

    writeFileSync(
      resolve(directory, "suppressed.js"),
      `/* eslint-disable max-lines */\n${Array.from(
        { length: 401 },
        (value, index) =>
          `const suppressed${index} = ${value === undefined ? index : value};`,
      ).join("\n")}`,
    );
    writeFileSync(
      resolve(directory, "suppressed.config.js"),
      'export default [{ files: ["suppressed.js"], linterOptions: { noInlineConfig: true }, rules: { "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }] } }];\n',
    );
    const suppression = await runStructuralLint({
      repositoryRoot: directory,
      configFile: "suppressed.config.js",
    });
    assert.equal(suppression.outcome, "fail");
    assert.match(
      suppression.report,
      /structural_lint_inline_suppression: suppressed\.js:1:1 \[configuration\]/,
    );
    assert.match(
      suppression.report,
      /structural_lint_max_lines: suppressed\.js:402:1 \[max-lines\]/,
    );

    writeFileSync(
      resolve(directory, "disabled.js"),
      Array.from(
        { length: 401 },
        (value, index) =>
          `const disabled${index} = ${value === undefined ? index : value};`,
      ).join("\n"),
    );
    writeFileSync(
      resolve(directory, "disabled.config.js"),
      'export default [{ files: ["disabled.js"], rules: { "max-lines": "off" } }];\n',
    );
    const disabled = await runStructuralLint({
      repositoryRoot: directory,
      configFile: "disabled.config.js",
    });
    assert.equal(disabled.outcome, "fail");
    assert.match(
      disabled.report,
      /structural_lint_invalid_max_lines_configuration: disabled\.js/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
