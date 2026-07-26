import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");

/** @param {string} name */
function readConfiguration(name) {
  return JSON.parse(
    readFileSync(resolve(repositoryRoot, `tsconfig.${name}.json`), "utf8"),
  );
}

/** @param {string[]} arguments_ */
function runTypeScript(arguments_) {
  return spawnSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", ...arguments_],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
}

test("strict checking owns maintained tests, verification code, and executable probes", () => {
  const tests = readConfiguration("test");
  const verification = readConfiguration("verification");
  const browserProbe = readConfiguration("test-browser");

  assert.equal(tests.extends, "./tsconfig.node.json");
  assert.deepEqual(tests.include, [
    "test/**/*.js",
    "test/**/*.mjs",
    "fixtures/test-probes/**/*.mjs",
  ]);
  assert.equal(verification.extends, "./tsconfig.node.json");
  assert.deepEqual(verification.include, [
    "eslint.config.js",
    "scripts/**/*.mjs",
    "fixtures/package/**/*.mjs",
  ]);
  assert.equal(browserProbe.extends, "./tsconfig.browser.json");
  assert.deepEqual(browserProbe.files, ["fixtures/operator-browser-login.js"]);

  for (const configuration of [tests, verification, browserProbe]) {
    assert.equal(
      Object.hasOwn(configuration, "exclude"),
      false,
      "owning configurations must not omit maintained JavaScript",
    );
    assert.equal(
      Object.hasOwn(configuration, "compilerOptions"),
      false,
      "owning configurations must inherit the strict environment unchanged",
    );
  }
});

test("representative invalid test and verification fixtures fail with owning diagnostics", () => {
  const projectDirectory = mkdtempSync(
    resolve(repositoryRoot, ".test-verification-type-check-"),
  );
  const fixtureDirectory = mkdtempSync(
    resolve(tmpdir(), "quality-bar-test-verification-type-check-"),
  );
  try {
    for (const owner of ["test", "verification"]) {
      const fixturePath = resolve(fixtureDirectory, `${owner}-invalid.js`);
      writeFileSync(
        fixturePath,
        readFileSync(
          resolve(
            repositoryRoot,
            `fixtures/test-verification-type-check/${owner}-invalid.js.txt`,
          ),
          "utf8",
        ),
      );
      const projectPath = resolve(projectDirectory, `tsconfig.${owner}.json`);
      writeFileSync(
        projectPath,
        JSON.stringify({
          extends: resolve(repositoryRoot, `tsconfig.${owner}.json`),
          files: [fixturePath],
        }),
      );

      const result = runTypeScript(["--project", projectPath]);

      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stdout, /error TS2322:/);
    }
  } finally {
    rmSync(projectDirectory, { force: true, recursive: true });
    rmSync(fixtureDirectory, { force: true, recursive: true });
  }
});

test("the focused test and verification JavaScript type checks pass", () => {
  for (const script of ["typecheck:tests", "typecheck:verification"]) {
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

test("the canonical verifier owns the proof-code type-check gate and its proof", () => {
  const definitions = readFileSync(
    resolve(repositoryRoot, "scripts/verification/gate-definitions.mjs"),
    "utf8",
  );

  assert.match(definitions, /name: "proof-code-type-check"/);
  assert.match(definitions, /arguments: \["run", "typecheck:proof"\]/);
  assert.match(definitions, /name: "proof-code-type-check-proof"/);
  assert.match(
    definitions,
    /test\/test-verification-type-check-gate\.test\.js/,
  );
});

test("the test and verification type-check evidence records the complete cleanup", () => {
  const evidence = JSON.parse(
    readFileSync(
      resolve(
        repositoryRoot,
        "evidence/quality-foundation/issue-162-test-verification-type-check.json",
      ),
      "utf8",
    ),
  );

  assert.equal(evidence.ticket, 162);
  assert.equal(
    evidence.initial_capture_base,
    "d650e2cdc0f22375d5e3b91b1bce85aff2f158fe",
  );
  assert.deepEqual(evidence.focused_commands, [
    "npm run typecheck:tests",
    "npm run typecheck:verification",
  ]);
  assert.equal(evidence.final_outcome, "pass");
  assert.equal(evidence.initial_diagnostics.length, 772);

  const identities = new Set();
  for (const diagnostic of evidence.initial_diagnostics) {
    assert.match(
      diagnostic.environment,
      /^(?:test|verification|browser-probe)$/,
    );
    assert.match(
      diagnostic.path,
      /^(?:eslint\.config\.js|fixtures\/operator-browser-login\.js|fixtures\/package\/|fixtures\/test-probes\/|scripts\/|test\/)/,
    );
    assert.ok(diagnostic.line > 0);
    assert.ok(diagnostic.column > 0);
    assert.match(diagnostic.code, /^TS[0-9]+$/);
    assert.ok(diagnostic.message.length > 0);
    identities.add(
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
  assert.equal(identities.size, evidence.initial_diagnostics.length);
});
