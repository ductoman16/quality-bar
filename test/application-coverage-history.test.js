import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import {
  COVERAGE_GENESIS_HASH,
  COVERAGE_LEDGER_PATH,
  createCoverageEntry,
} from "../scripts/application-coverage-ledger.mjs";
import { verifyCoverageHistory } from "../scripts/application-coverage-history.mjs";

/** @param {string} repositoryRoot @param {string[]} arguments_ */
function git(repositoryRoot, arguments_) {
  const result = spawnSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${arguments_.join(" ")}: ${result.stderr}`);
  }
  return result.stdout.trim();
}

/** @param {string} repositoryRoot @param {string} message */
function commit(repositoryRoot, message) {
  git(repositoryRoot, ["add", "."]);
  git(repositoryRoot, [
    "-c",
    "user.name=Coverage Test",
    "-c",
    "user.email=coverage@example.invalid",
    "commit",
    "-m",
    message,
  ]);
  return git(repositoryRoot, ["rev-parse", "HEAD"]);
}

function createRepository() {
  const repositoryRoot = mkdtempSync(
    resolve(tmpdir(), "quality-bar-coverage-history-"),
  );
  git(repositoryRoot, ["init", "--initial-branch=main"]);
  writeFileSync(resolve(repositoryRoot, "application.txt"), "application\n");
  const genesisSourceCommit = commit(repositoryRoot, "application baseline");
  return { genesisSourceCommit, repositoryRoot };
}

/**
 * @param {string} repositoryRoot
 * @param {string} sourceCommit
 * @param {ReturnType<typeof createCoverageEntry>[]} [priorEntries]
 */
function writeLedger(repositoryRoot, sourceCommit, priorEntries = []) {
  const previousHash = priorEntries.at(-1)?.hash ?? COVERAGE_GENESIS_HASH;
  const entry = createCoverageEntry({
    previousHash,
    sourceCommit,
    thresholds: {
      lines: priorEntries.length === 0 ? "80.00" : "81.00",
      branches: "70.00",
      functions: "75.00",
    },
  });
  const ledger = {
    schemaVersion: 1,
    precision: 2,
    genesisHash: COVERAGE_GENESIS_HASH,
    entries: [...priorEntries, entry],
  };
  const ledgerPath = resolve(repositoryRoot, COVERAGE_LEDGER_PATH);
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  return ledger;
}

test("history accepts the uncommitted and committed fixed genesis", () => {
  const { genesisSourceCommit, repositoryRoot } = createRepository();
  try {
    const ledger = writeLedger(repositoryRoot, genesisSourceCommit);
    const uncommitted = verifyCoverageHistory(repositoryRoot, {
      genesisSourceCommit,
    });
    assert.equal(uncommitted.trustedCommit, genesisSourceCommit);
    assert.equal(uncommitted.identity, ledger.entries[0].hash);
    assert.equal(uncommitted.priorIdentity, COVERAGE_GENESIS_HASH);

    const coverageCommit = commit(repositoryRoot, "coverage genesis");
    const committed = verifyCoverageHistory(repositoryRoot, {
      genesisSourceCommit,
    });
    assert.equal(committed.headCommit, coverageCommit);
    assert.equal(committed.trustedCommit, genesisSourceCommit);
    assert.equal(committed.identity, ledger.entries[0].hash);
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test("history accepts only an exact retained prefix and first-parent append", () => {
  const { genesisSourceCommit, repositoryRoot } = createRepository();
  try {
    const genesis = writeLedger(repositoryRoot, genesisSourceCommit);
    const coverageCommit = commit(repositoryRoot, "coverage genesis");
    const appended = writeLedger(
      repositoryRoot,
      coverageCommit,
      genesis.entries,
    );

    const result = verifyCoverageHistory(repositoryRoot, {
      genesisSourceCommit,
    });
    assert.equal(result.entryCount, 2);
    assert.equal(result.priorIdentity, genesis.entries[0].hash);
    assert.equal(result.identity, appended.entries[1].hash);
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test("a dirty non-ledger working tree uses HEAD as its trusted base", () => {
  const { genesisSourceCommit, repositoryRoot } = createRepository();
  try {
    writeLedger(repositoryRoot, genesisSourceCommit);
    const coverageCommit = commit(repositoryRoot, "coverage genesis");
    writeFileSync(
      resolve(repositoryRoot, "application.txt"),
      "changed application\n",
    );

    const result = verifyCoverageHistory(repositoryRoot, {
      genesisSourceCommit,
    });
    assert.equal(result.headCommit, coverageCommit);
    assert.equal(result.trustedCommit, coverageCommit);
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test("history rejects truncation, retained-entry rewriting, and reordering", () => {
  const { genesisSourceCommit, repositoryRoot } = createRepository();
  try {
    const genesis = writeLedger(repositoryRoot, genesisSourceCommit);
    const coverageCommit = commit(repositoryRoot, "coverage genesis");
    const appended = writeLedger(
      repositoryRoot,
      coverageCommit,
      genesis.entries,
    );
    commit(repositoryRoot, "coverage append");

    const rewrittenGenesis = createCoverageEntry({
      previousHash: COVERAGE_GENESIS_HASH,
      sourceCommit: genesisSourceCommit,
      thresholds: {
        lines: "79.00",
        branches: "70.00",
        functions: "75.00",
      },
    });
    const rewrittenAppend = createCoverageEntry({
      previousHash: rewrittenGenesis.hash,
      sourceCommit: coverageCommit,
      thresholds: {
        lines: "81.00",
        branches: "70.00",
        functions: "75.00",
      },
    });
    for (const { entries, failure } of [
      {
        entries: genesis.entries,
        failure: /application_coverage_history_truncated/,
      },
      {
        entries: [rewrittenGenesis, rewrittenAppend],
        failure: /application_coverage_retained_prefix_changed/,
      },
      {
        entries: [...appended.entries].reverse(),
        failure: /application_coverage_ledger_previous_hash_invalid/,
      },
    ]) {
      const ledger = JSON.parse(
        readFileSync(resolve(repositoryRoot, COVERAGE_LEDGER_PATH), "utf8"),
      );
      ledger.entries = entries;
      writeFileSync(
        resolve(repositoryRoot, COVERAGE_LEDGER_PATH),
        `${JSON.stringify(ledger, null, 2)}\n`,
      );
      assert.throws(
        () => verifyCoverageHistory(repositoryRoot, { genesisSourceCommit }),
        failure,
      );
    }
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test("history hard-fails for a missing or non-first-parent source commit", () => {
  const { genesisSourceCommit, repositoryRoot } = createRepository();
  try {
    const genesis = writeLedger(repositoryRoot, genesisSourceCommit);
    commit(repositoryRoot, "coverage genesis");
    const missingSourceEntry = createCoverageEntry({
      previousHash: genesis.entries[0].hash,
      sourceCommit: "f".repeat(40),
      thresholds: {
        lines: "81.00",
        branches: "70.00",
        functions: "75.00",
      },
    });
    const ledger = {
      ...genesis,
      entries: [...genesis.entries, missingSourceEntry],
    };
    writeFileSync(
      resolve(repositoryRoot, COVERAGE_LEDGER_PATH),
      `${JSON.stringify(ledger, null, 2)}\n`,
    );
    assert.throws(
      () => verifyCoverageHistory(repositoryRoot, { genesisSourceCommit }),
      /application_coverage_source_object_unavailable/,
    );
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test("a new measurement must identify the exact trusted source commit", () => {
  const { genesisSourceCommit, repositoryRoot } = createRepository();
  try {
    const genesis = writeLedger(repositoryRoot, genesisSourceCommit);
    const coverageCommit = commit(repositoryRoot, "coverage genesis");
    writeFileSync(resolve(repositoryRoot, "application.txt"), "revision two\n");
    const currentHead = commit(repositoryRoot, "application revision");
    writeLedger(repositoryRoot, coverageCommit, genesis.entries);

    assert.throws(
      () => verifyCoverageHistory(repositoryRoot, { genesisSourceCommit }),
      new RegExp(
        `application_coverage_source_commit_mismatch: expected ${currentHead} received ${coverageCommit}`,
      ),
    );
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test("history hard-fails when the trusted prior commit object is unavailable", () => {
  const { genesisSourceCommit, repositoryRoot } = createRepository();
  try {
    writeLedger(repositoryRoot, genesisSourceCommit);
    commit(repositoryRoot, "coverage genesis");
    const objectPath = resolve(
      repositoryRoot,
      ".git",
      "objects",
      genesisSourceCommit.slice(0, 2),
      genesisSourceCommit.slice(2),
    );
    rmSync(objectPath);

    assert.throws(
      () => verifyCoverageHistory(repositoryRoot, { genesisSourceCommit }),
      /application_coverage_trusted_commit_unavailable/,
    );
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test("history hard-fails when the genesis prior tree object is unavailable", () => {
  const { genesisSourceCommit, repositoryRoot } = createRepository();
  try {
    writeLedger(repositoryRoot, genesisSourceCommit);
    commit(repositoryRoot, "coverage genesis");
    const tree = git(repositoryRoot, [
      "rev-parse",
      `${genesisSourceCommit}^{tree}`,
    ]);
    const objectPath = resolve(
      repositoryRoot,
      ".git",
      "objects",
      tree.slice(0, 2),
      tree.slice(2),
    );
    rmSync(objectPath);

    assert.throws(
      () => verifyCoverageHistory(repositoryRoot, { genesisSourceCommit }),
      /application_coverage_prior_tree_unavailable/,
    );
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});
