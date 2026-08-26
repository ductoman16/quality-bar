import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname } from "node:path";
import { test } from "node:test";

import { invokePaidCodexCanary } from "../scripts/release-canary/paid-codex.mts";
import { releaseCanarySourceCommit } from "./release-canary-test-fixtures.ts";

test("paid fixture cleanup reclaims the owned fixture tree", async () => {
  let checkoutPath = "";
  const evidence = await invokePaidCodexCanary({
    now: () => 1_700_000_000_000,
    readCodexVersion: () => "codex-cli 0.145.0",
    runCodex: async (input) => {
      checkoutPath = input.checkoutPath;
      throw Object.assign(new Error("synthetic failure"), {
        code: "codex_process_failed",
      });
    },
    sourceCommit: releaseCanarySourceCommit,
    sourceStatus: "",
  });

  assert.equal(evidence.outcome, "fail");
  assert.equal(existsSync(checkoutPath), false);
  assert.deepEqual(
    readdirSync(dirname(checkoutPath)).filter((name) =>
      name.includes(basename(checkoutPath)),
    ),
    [],
  );
});

test("paid fixture cleanup preserves a foreign replacement and the displaced owned fixture", async () => {
  let foreignPath = "";
  let displacedPath = "";
  const evidence = await invokePaidCodexCanary({
    now: () => 1_700_000_000_000,
    readCodexVersion: () => "codex-cli 0.145.0",
    runCodex: async ({ checkoutPath }) => {
      foreignPath = checkoutPath;
      displacedPath = `${checkoutPath}.displaced`;
      renameSync(checkoutPath, displacedPath);
      mkdirSync(checkoutPath);
      writeFileSync(`${checkoutPath}/foreign.txt`, "foreign\n");
      throw Object.assign(new Error("synthetic failure"), {
        code: "codex_process_failed",
      });
    },
    sourceCommit: releaseCanarySourceCommit,
    sourceStatus: "",
  });

  try {
    assert.equal(evidence.outcome, "fail");
    assert.equal(existsSync(`${foreignPath}/foreign.txt`), true);
    assert.equal(existsSync(`${displacedPath}/reviewed.txt`), true);
  } finally {
    rmSync(foreignPath, { force: true, recursive: true });
    rmSync(displacedPath, { force: true, recursive: true });
  }
});
