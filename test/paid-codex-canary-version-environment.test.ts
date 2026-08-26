import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";

import { invokePaidCodexCanary } from "../scripts/release-canary/paid-codex.mts";
import { releaseCanarySourceCommit } from "./release-canary-test-fixtures.ts";

test("the default Codex version probe receives only the host allowlist", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "paid-codex-version-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const commandPath = join(directory, "codex");
  const observationPath = join(directory, "environment.json");
  const executablePath = [
    directory,
    dirname(process.execPath),
    "/usr/bin",
    "/bin",
  ].join(delimiter);
  writeFileSync(
    commandPath,
    `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync(${JSON.stringify(observationPath)}, JSON.stringify(process.env));
process.stdout.write("codex-cli 0.145.0\\n");
`,
    { mode: 0o700 },
  );
  chmodSync(commandPath, 0o700);
  await invokePaidCodexCanary({
    now: () => 1_700_000_000_000,
    processEnvironment: {
      PATH: executablePath,
      QUALITY_BAR_VERSION_PROBE_SECRET: "must-not-reach-codex",
    },
    runCodex: async () => {
      throw Object.assign(new Error("stop before provider execution"), {
        code: "cancelled_by_operator",
      });
    },
    sourceCommit: releaseCanarySourceCommit,
    sourceStatus: "",
  });

  const observedEnvironment = JSON.parse(readFileSync(observationPath, "utf8"));
  assert.equal(
    "QUALITY_BAR_VERSION_PROBE_SECRET" in observedEnvironment,
    false,
  );
  assert.equal(observedEnvironment.PATH, executablePath);
});
