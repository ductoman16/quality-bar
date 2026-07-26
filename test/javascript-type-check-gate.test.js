import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { test } from "node:test";

import { BROWSER_ASSET_SOURCE_PATHS } from "../src/browser-assets.js";

const repositoryRoot = resolve(import.meta.dirname, "..");

function runTypeScript(arguments_) {
  return spawnSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", ...arguments_],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
}

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

    const nodeResult = runTypeScript([
      "--allowJs",
      "--checkJs",
      "--strict",
      "--noEmit",
      "--target",
      "ES2024",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--types",
      "node",
      nodeFixture,
    ]);
    const browserResult = runTypeScript([
      "--allowJs",
      "--checkJs",
      "--strict",
      "--noEmit",
      "--target",
      "ES2024",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      "--lib",
      "ES2024,DOM,DOM.Iterable",
      browserFixture,
    ]);

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

test("the canonical verifier owns the JavaScript type-check gate", () => {
  const definitions = readFileSync(
    resolve(repositoryRoot, "scripts/verification/gate-definitions.mjs"),
    "utf8",
  );

  assert.match(definitions, /name: "javascript-type-check"/);
  assert.match(definitions, /test\/javascript-type-check-gate\.test\.js/);
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
    BROWSER_ASSET_SOURCE_PATHS.map((path) => basename(path)),
  );
  assert.ok(evidence.initial_production_diagnostics.length > 0);
  for (const diagnostic of evidence.initial_production_diagnostics) {
    assert.match(diagnostic.path, /^src\//);
    assert.ok(diagnostic.count > 0);
  }
  assert.equal(
    evidence.initial_production_diagnostics.reduce(
      (total, diagnostic) => total + diagnostic.count,
      0,
    ),
    619,
  );
});
