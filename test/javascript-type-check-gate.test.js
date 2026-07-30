import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { test } from "node:test";

import { createGateDefinitions } from "../scripts/verification/gate-definitions.mjs";
import { BROWSER_ASSET_SOURCE_PATHS } from "../src/browser-assets.js";

const repositoryRoot = resolve(import.meta.dirname, "..");
const verificationMetadata = Object.freeze({
  applicationVersion: "1.2.3",
  coverageToolVersion: "12.0.0",
  eslintPluginNodeVersion: "18.2.2",
  eslintVersion: "9.39.1",
  formatterVersion: "3.7.4",
  jsonSchemaFormatsVersion: "3.0.1",
  jsonSchemaValidatorVersion: "8.20.0",
  openApiValidatorVersion: "2.9.0",
  typeCheckerVersion: "7.0.2",
});

/** @param {string[]} arguments_ */
function runTypeScript(arguments_) {
  return spawnSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", ...arguments_],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
}

const strictFamilyOptions = [
  "alwaysStrict",
  "noImplicitAny",
  "noImplicitThis",
  "strictBindCallApply",
  "strictBuiltinIteratorReturn",
  "strictFunctionTypes",
  "strictNullChecks",
  "strictPropertyInitialization",
  "useUnknownInCatchVariables",
];

/** @param {string} name */
function readConfiguration(name) {
  return JSON.parse(
    readFileSync(resolve(repositoryRoot, `tsconfig.${name}.json`), "utf8"),
  );
}

test("strict JavaScript checking owns every production Node and served browser module", () => {
  const node = readConfiguration("node");
  const browser = readConfiguration("browser");

  for (const configuration of [node, browser]) {
    assert.equal(configuration.compilerOptions.allowJs, true);
    assert.equal(configuration.compilerOptions.checkJs, true);
    assert.equal(configuration.compilerOptions.strict, true);
    assert.equal(configuration.compilerOptions.noEmit, true);
    for (const option of strictFamilyOptions) {
      assert.equal(
        Object.hasOwn(configuration.compilerOptions, option),
        false,
        `${option} must inherit from strict instead of being overridden`,
      );
    }
  }
  assert.deepEqual(node.include, ["src/**/*.js"]);
  assert.deepEqual(node.exclude, ["src/browser/**/*.js"]);
  assert.deepEqual(node.compilerOptions.lib, ["ES2024"]);
  assert.deepEqual(node.compilerOptions.types, ["node"]);
  assert.deepEqual(browser.files, BROWSER_ASSET_SOURCE_PATHS);
  assert.deepEqual(browser.compilerOptions.lib, [
    "ES2024",
    "DOM",
    "DOM.Iterable",
  ]);
  assert.deepEqual(browser.compilerOptions.types, []);
});

test("representative invalid Node and browser fixtures fail with owning diagnostics", () => {
  const fixtureDirectory = mkdtempSync(
    resolve(tmpdir(), "quality-bar-type-check-"),
  );
  try {
    const nodeFixture = resolve(fixtureDirectory, "node-invalid-assignment.js");
    const browserFixture = resolve(fixtureDirectory, "browser-using-node.js");
    writeFileSync(
      nodeFixture,
      readFileSync(
        resolve(
          repositoryRoot,
          "fixtures/javascript-type-check/node-invalid-assignment.js.txt",
        ),
        "utf8",
      ),
    );
    writeFileSync(
      browserFixture,
      readFileSync(
        resolve(
          repositoryRoot,
          "fixtures/javascript-type-check/browser-using-node.js.txt",
        ),
        "utf8",
      ),
    );

    const nodeProject = resolve(fixtureDirectory, "tsconfig.node.json");
    const browserProject = resolve(fixtureDirectory, "tsconfig.browser.json");
    writeFileSync(
      nodeProject,
      JSON.stringify({
        compilerOptions: {
          typeRoots: [resolve(repositoryRoot, "node_modules/@types")],
        },
        extends: resolve(repositoryRoot, "tsconfig.node.json"),
        files: [nodeFixture],
      }),
    );
    writeFileSync(
      browserProject,
      JSON.stringify({
        extends: resolve(repositoryRoot, "tsconfig.browser.json"),
        files: [browserFixture],
      }),
    );

    const nodeResult = runTypeScript(["--project", nodeProject]);
    const browserResult = runTypeScript(["--project", browserProject]);

    assert.equal(nodeResult.status, 1, nodeResult.stdout || nodeResult.stderr);
    assert.match(nodeResult.stdout, /error TS2322:/);
    assert.equal(
      browserResult.status,
      1,
      browserResult.stdout || browserResult.stderr,
    );
    assert.match(browserResult.stdout, /error TS2591:/);
  } finally {
    rmSync(fixtureDirectory, { force: true, recursive: true });
  }
});

test("the focused Node and browser JavaScript type checks pass", () => {
  for (const script of ["typecheck:node", "typecheck:browser"]) {
    const result = spawnSync("npm", ["run", script], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });

    assert.equal(
      result.status,
      0,
      `${script}\n${result.stdout}\n${result.stderr}`,
    );
  }
});

test("the canonical verifier owns the production type-check gate and its proof", () => {
  const definitions = createGateDefinitions(verificationMetadata);
  const production = definitions.find(
    ({ name }) => name === "production-type-check",
  );
  const proof = definitions.find(
    ({ name }) => name === "production-type-check-proof",
  );

  assert.deepEqual(production?.arguments, ["run", "typecheck:production"]);
  assert.deepEqual(proof, {
    name: "production-type-check-proof",
    testGroup: "production-node-and-served-browser-javascript",
    failureCode: "production_type_check_proof_failed",
    arguments: ["--test", "test/javascript-type-check-gate.test.js"],
  });
});

test("the JavaScript type-check evidence records the complete cleanup", () => {
  const evidence = JSON.parse(
    readFileSync(
      resolve(
        repositoryRoot,
        "evidence/quality-foundation/issue-161-javascript-type-check.json",
      ),
      "utf8",
    ),
  );

  assert.equal(evidence.ticket, 161);
  assert.deepEqual(evidence.focused_commands, [
    "npm run typecheck:node",
    "npm run typecheck:browser",
  ]);
  assert.equal(evidence.final_outcome, "pass");
  assert.deepEqual(
    evidence.served_browser_modules,
    BROWSER_ASSET_SOURCE_PATHS.filter(
      (path) =>
        ![
          "src/browser/evaluation-result.js",
          "src/browser/evaluation-feedback.js",
          "src/browser/waiver-batch.js",
          "src/browser/evaluation.js",
          "src/browser/analytics.js",
          "src/browser/analytics-contract.js",
          "src/browser/analytics-matching-facts.js",
          "src/browser/analytics-state.js",
          "src/browser/storage-reserve.js",
          "src/browser/system-attention.js",
        ].includes(path),
    ).map((path) => basename(path)),
  );
  assert.equal(
    evidence.initial_capture_base,
    "52980575e9fa1f785a02db2f39cc7af54e37dcc5",
  );
  assert.equal(evidence.initial_production_diagnostics.length, 616);
  const diagnosticIdentities = new Set();
  for (const diagnostic of evidence.initial_production_diagnostics) {
    assert.match(diagnostic.environment, /^(?:browser|node)$/);
    assert.match(diagnostic.path, /^src\//);
    assert.ok(diagnostic.line > 0);
    assert.ok(diagnostic.column > 0);
    assert.match(diagnostic.code, /^TS[0-9]+$/);
    assert.ok(diagnostic.message.length > 0);
    diagnosticIdentities.add(
      [
        diagnostic.environment,
        diagnostic.path,
        diagnostic.line,
        diagnostic.column,
        diagnostic.code,
        diagnostic.message,
      ].join(":"),
    );
  }
  assert.equal(
    diagnosticIdentities.size,
    evidence.initial_production_diagnostics.length,
  );
});
