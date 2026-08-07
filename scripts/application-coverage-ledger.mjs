import { createHash } from "node:crypto";

export const COVERAGE_PRECISION = 2;
export const COVERAGE_LEDGER_PATH =
  "evidence/quality-foundation/application-coverage-ledger.json";
export const COVERAGE_GENESIS_HASH =
  "sha256:b1b0f6bb68e31b46812072358bf8610164fdd110c9553011478434d2a8f1102f";

/** @type {("lines" | "branches" | "functions")[]} */
const COMPONENTS = ["lines", "branches", "functions"];
const ENTRY_KEYS = ["hash", "previousHash", "sourceCommit", "thresholds"];
const LEDGER_KEYS = ["entries", "genesisHash", "precision", "schemaVersion"];
const THRESHOLD_KEYS = [...COMPONENTS].sort();
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const THRESHOLD_PATTERN = /^(?:100\.00|[0-9]{1,2}\.[0-9]{2})$/;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {Record<string, unknown>} value @param {string[]} expected */
function hasExactKeys(value, expected) {
  return (
    Object.keys(value).sort().join("\0") === [...expected].sort().join("\0")
  );
}

/** @param {string} value */
function basisPoints(value) {
  return Number.parseInt(value.replace(".", ""), 10);
}

/** @param {unknown} thresholds @param {number} entryIndex */
function validateThresholds(thresholds, entryIndex) {
  if (!isRecord(thresholds) || !hasExactKeys(thresholds, THRESHOLD_KEYS)) {
    throw new Error(
      `application_coverage_threshold_keys_invalid: entry ${entryIndex}`,
    );
  }
  for (const component of COMPONENTS) {
    if (
      typeof thresholds[component] !== "string" ||
      !THRESHOLD_PATTERN.test(thresholds[component])
    ) {
      throw new Error(
        `application_coverage_threshold_invalid: entry ${entryIndex} ${component}`,
      );
    }
  }
  return /** @type {Record<"lines" | "branches" | "functions", string>} */ (
    thresholds
  );
}

/**
 * @param {{
 *   previousHash: string,
 *   sourceCommit: string,
 *   thresholds: Record<string, string>,
 * }} input
 */
function hashCoverageEntry(input) {
  const canonical = JSON.stringify({
    previousHash: input.previousHash,
    sourceCommit: input.sourceCommit,
    thresholds: {
      lines: input.thresholds.lines,
      branches: input.thresholds.branches,
      functions: input.thresholds.functions,
    },
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

/**
 * @param {{
 *   previousHash: string,
 *   sourceCommit: string,
 *   thresholds: Record<string, string>,
 * }} input
 */
export function createCoverageEntry(input) {
  return {
    previousHash: input.previousHash,
    sourceCommit: input.sourceCommit,
    thresholds: { ...input.thresholds },
    hash: hashCoverageEntry(input),
  };
}

/** @param {unknown} ledger */
export function validateCoverageLedger(ledger) {
  if (!isRecord(ledger) || !hasExactKeys(ledger, LEDGER_KEYS)) {
    throw new Error("application_coverage_ledger_keys_invalid");
  }
  if (ledger.schemaVersion !== 1) {
    throw new Error("application_coverage_ledger_schema_invalid");
  }
  if (ledger.precision !== COVERAGE_PRECISION) {
    throw new Error("application_coverage_ledger_precision_invalid");
  }
  if (ledger.genesisHash !== COVERAGE_GENESIS_HASH) {
    throw new Error("application_coverage_ledger_genesis_invalid");
  }
  if (!Array.isArray(ledger.entries) || ledger.entries.length === 0) {
    throw new Error("application_coverage_ledger_entries_invalid");
  }

  let previousHash = COVERAGE_GENESIS_HASH;
  /** @type {Record<"lines" | "branches" | "functions", string>} */
  const historicalMaximum = {
    lines: "0.00",
    branches: "0.00",
    functions: "0.00",
  };

  for (const [entryIndex, entry] of ledger.entries.entries()) {
    if (!isRecord(entry) || !hasExactKeys(entry, ENTRY_KEYS)) {
      throw new Error(
        `application_coverage_ledger_entry_keys_invalid: entry ${entryIndex}`,
      );
    }
    if (entry.previousHash !== previousHash) {
      throw new Error(
        `application_coverage_ledger_previous_hash_invalid: entry ${entryIndex}`,
      );
    }
    if (
      typeof entry.sourceCommit !== "string" ||
      !COMMIT_PATTERN.test(entry.sourceCommit)
    ) {
      throw new Error(
        `application_coverage_source_commit_invalid: entry ${entryIndex}`,
      );
    }
    const thresholds = validateThresholds(entry.thresholds, entryIndex);
    for (const component of COMPONENTS) {
      if (
        basisPoints(thresholds[component]) <
        basisPoints(historicalMaximum[component])
      ) {
        throw new Error(
          `application_coverage_threshold_decreased: ${component} at entry ${entryIndex}`,
        );
      }
      historicalMaximum[component] = thresholds[component];
    }
    const expectedHash = hashCoverageEntry({
      previousHash,
      sourceCommit: entry.sourceCommit,
      thresholds,
    });
    if (
      typeof entry.hash !== "string" ||
      !HASH_PATTERN.test(entry.hash) ||
      entry.hash !== expectedHash
    ) {
      throw new Error(
        `application_coverage_ledger_hash_invalid: entry ${entryIndex}`,
      );
    }
    previousHash = entry.hash;
  }

  return {
    entryCount: ledger.entries.length,
    historicalMaximum,
    identity: previousHash,
  };
}
