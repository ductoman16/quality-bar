import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { runVerification } from "../scripts/verification/verification-runner.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

const metadata = {
  applicationVersion: "1.2.3",
  coverageToolVersion: "12.0.0",
  eslintPluginNodeVersion: "18.2.2",
  eslintVersion: "9.39.1",
  formatterVersion: "3.7.4",
  jsonSchemaFormatsVersion: "3.0.1",
  jsonSchemaValidatorVersion: "8.20.0",
  openApiValidatorVersion: "2.9.0",
  packagedNodeVersion: "24.18.0",
  runnerGitVersion: "2.51.0",
  sourceCommit: "abc123",
  typeCheckerVersion: "7.0.2",
};

test("verification runner writes evidence through an injected manifest writer", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "quality-bar-runner-"));
  const evidencePath = resolve(directory, "evidence.json");
  const commandCalls = [];
  /** @type {Array<[string, Record<string, unknown>]>} */
  const persistedManifest = [];
  try {
    const noopCommand = resolve(directory, "noop.mjs");
    writeFileSync(noopCommand, "process.stdout.write('PASS\\n');\n");

    const result = runVerification({
      repositoryRoot,
      manifestPath: evidencePath,
      metadataReader: () => metadata,
      gateDefinitions: [
        {
          name: "noop",
          failureCode: "noop_failed",
          arguments: ["--test", noopCommand],
          command: process.execPath,
        },
      ],
      commandExecutor: (command, args, cwd) => {
        commandCalls.push([command, args, cwd]);
        return {
          status: 0,
          stdout: "# tests 1\n",
          stderr: "",
          signal: null,
          error: undefined,
          pid: 1,
          output: ["", ""],
        };
      },
      manifestWriter: (path, manifest) => {
        persistedManifest.push([path, manifest]);
      },
      failureOutputWriter: () => {},
    });

    assert.equal(result.manifest.outcome, "pass");
    assert.match(result.report, /Quality Bar verification: PASS/);
    assert.equal(result.manifest.invokedGates[0].name, "noop");
    assert.equal(commandCalls.length, 1);
    assert.equal(persistedManifest.length, 1);
    assert.equal(persistedManifest[0][0], evidencePath);
    assert.deepEqual(persistedManifest[0][1], result.manifest);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
