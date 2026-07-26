import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  REQUIRED_NODE_VERSION,
  assertExactNodeRuntime,
} from "../scripts/runtime-contract.mjs";

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
