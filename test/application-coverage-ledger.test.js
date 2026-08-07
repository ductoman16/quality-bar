import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  COVERAGE_GENESIS_HASH,
  COVERAGE_PRECISION,
  createCoverageEntry,
  validateCoverageLedger,
} from "../scripts/application-coverage-ledger.mjs";

const sourceCommit = "313f83f70a96e7959c5539b45eca4493430ebca0";
const repositoryRoot = resolve(import.meta.dirname, "..");

function genesisLedger() {
  return {
    schemaVersion: 1,
    precision: COVERAGE_PRECISION,
    genesisHash: COVERAGE_GENESIS_HASH,
    entries: [
      createCoverageEntry({
        previousHash: COVERAGE_GENESIS_HASH,
        sourceCommit,
        thresholds: {
          lines: "80.00",
          branches: "70.00",
          functions: "75.00",
        },
      }),
    ],
  };
}

test("the fixed genesis anchors an exact two-decimal coverage entry", () => {
  const ledger = genesisLedger();
  const validated = validateCoverageLedger(ledger);

  assert.equal(validated.entryCount, 1);
  assert.equal(validated.identity, ledger.entries[0].hash);
  assert.deepEqual(validated.historicalMaximum, {
    lines: "80.00",
    branches: "70.00",
    functions: "75.00",
  });
});

test("the ledger accepts an append that preserves every retained entry", () => {
  const ledger = genesisLedger();
  ledger.entries.push(
    createCoverageEntry({
      previousHash: ledger.entries[0].hash,
      sourceCommit: "418a5d2cc0b3ae1805c65f93ab7cc0431e4ee8c1",
      thresholds: {
        lines: "81.25",
        branches: "70.00",
        functions: "76.50",
      },
    }),
  );

  assert.deepEqual(validateCoverageLedger(ledger).historicalMaximum, {
    lines: "81.25",
    branches: "70.00",
    functions: "76.50",
  });
});

test("the ledger rejects a damaged hash chain", () => {
  const ledger = genesisLedger();
  ledger.entries[0].thresholds.lines = "81.00";

  assert.throws(
    () => validateCoverageLedger(ledger),
    /application_coverage_ledger_hash_invalid: entry 0/,
  );
});

test("the ledger rejects imprecise, decreasing, and malformed thresholds", () => {
  for (const thresholds of [
    { lines: "80.0", branches: "70.00", functions: "75.00" },
    { lines: "101.00", branches: "70.00", functions: "75.00" },
    { lines: "NaN", branches: "70.00", functions: "75.00" },
  ]) {
    const ledger = genesisLedger();
    ledger.entries = [
      createCoverageEntry({
        previousHash: COVERAGE_GENESIS_HASH,
        sourceCommit,
        thresholds,
      }),
    ];
    assert.throws(
      () => validateCoverageLedger(ledger),
      /application_coverage_threshold_invalid/,
    );
  }

  const decreasing = genesisLedger();
  decreasing.entries.push(
    createCoverageEntry({
      previousHash: decreasing.entries[0].hash,
      sourceCommit: "418a5d2cc0b3ae1805c65f93ab7cc0431e4ee8c1",
      thresholds: {
        lines: "79.99",
        branches: "70.00",
        functions: "75.00",
      },
    }),
  );
  assert.throws(
    () => validateCoverageLedger(decreasing),
    /application_coverage_threshold_decreased: lines/,
  );
});

test("the ledger rejects reordered and structurally corrupt entries", () => {
  const ledger = genesisLedger();
  const second = createCoverageEntry({
    previousHash: ledger.entries[0].hash,
    sourceCommit: "418a5d2cc0b3ae1805c65f93ab7cc0431e4ee8c1",
    thresholds: {
      lines: "81.00",
      branches: "71.00",
      functions: "76.00",
    },
  });
  ledger.entries.push(second);
  ledger.entries.reverse();
  assert.throws(
    () => validateCoverageLedger(ledger),
    /application_coverage_ledger_previous_hash_invalid: entry 0/,
  );

  const corrupt = genesisLedger();
  /** @type {Record<string, unknown>} */ (corrupt.entries[0]).unexpected = true;
  assert.throws(
    () => validateCoverageLedger(corrupt),
    /application_coverage_ledger_entry_keys_invalid: entry 0/,
  );
});

test("ticket evidence records the honest baseline, ledger, and unchanged smokes", () => {
  const evidence = JSON.parse(
    readFileSync(
      resolve(
        repositoryRoot,
        "evidence/quality-foundation/issue-164-application-coverage.json",
      ),
      "utf8",
    ),
  );
  assert.equal(evidence.ticket, 164);
  assert.equal(evidence.baseline_source_commit, sourceCommit);
  assert.equal(evidence.coverage_tool, "c8:12.0.0");
  assert.deepEqual(evidence.measured_baseline, {
    lines: "86.01",
    branches: "83.26",
    functions: "88.71",
  });
  assert.equal(
    evidence.ledger.identity,
    "sha256:e21af3df8aa40242c9b9cfd839845227b3f088051a4c240f682fad3be7286914",
  );
  assert.deepEqual(evidence.cross_process_smokes, [
    "authenticated-firefox-browser-cross-process",
    "compose-service",
  ]);
  assert.equal(evidence.new_e2e_scenarios, 0);
  assert.equal(evidence.final_outcome, "pass");
});
