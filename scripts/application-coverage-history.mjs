import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  COVERAGE_GENESIS_HASH,
  COVERAGE_LEDGER_PATH,
  validateCoverageLedger,
} from "./application-coverage-ledger.mjs";

export const COVERAGE_GENESIS_SOURCE_COMMIT =
  "313f83f70a96e7959c5539b45eca4493430ebca0";

/**
 * @param {string} repositoryRoot
 * @param {string[]} arguments_
 */
function git(repositoryRoot, arguments_) {
  return spawnSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

/**
 * @param {string} repositoryRoot
 * @param {string[]} arguments_
 * @param {string} errorCode
 */
function requireGit(repositoryRoot, arguments_, errorCode) {
  const result = git(repositoryRoot, arguments_);
  if (result.status !== 0) {
    throw new Error(
      `${errorCode}: ${result.stderr.trim() || result.stdout.trim() || arguments_.join(" ")}`,
    );
  }
  return result.stdout.trim();
}

/** @param {string} contents @param {string} source */
function parseLedger(contents, source) {
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `application_coverage_ledger_json_invalid: ${source}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * @param {unknown[]} currentEntries
 * @param {unknown[]} priorEntries
 */
function verifyRetainedPrefix(currentEntries, priorEntries) {
  if (currentEntries.length < priorEntries.length) {
    throw new Error("application_coverage_history_truncated");
  }
  for (const [index, priorEntry] of priorEntries.entries()) {
    if (JSON.stringify(currentEntries[index]) !== JSON.stringify(priorEntry)) {
      throw new Error(
        `application_coverage_retained_prefix_changed: entry ${index}`,
      );
    }
  }
}

/**
 * @param {string} repositoryRoot
 * @param {Record<string, unknown>[]} entries
 * @param {string} genesisSourceCommit
 * @param {string} headCommit
 */
function verifySourceHistory(
  repositoryRoot,
  entries,
  genesisSourceCommit,
  headCommit,
) {
  if (entries[0]?.sourceCommit !== genesisSourceCommit) {
    throw new Error("application_coverage_genesis_source_changed");
  }
  const firstParentCommits = requireGit(
    repositoryRoot,
    ["rev-list", "--first-parent", headCommit],
    "application_coverage_first_parent_history_unavailable",
  ).split("\n");
  let priorPosition = Number.POSITIVE_INFINITY;
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const sourceCommit = /** @type {string} */ (entry.sourceCommit);
    if (seen.has(sourceCommit)) {
      throw new Error(
        `application_coverage_source_commit_repeated: entry ${index}`,
      );
    }
    seen.add(sourceCommit);
    const object = git(repositoryRoot, [
      "cat-file",
      "-e",
      `${sourceCommit}^{commit}`,
    ]);
    if (object.status !== 0) {
      throw new Error(
        `application_coverage_source_object_unavailable: entry ${index} ${sourceCommit}`,
      );
    }
    const position = firstParentCommits.indexOf(sourceCommit);
    if (position === -1) {
      throw new Error(
        `application_coverage_source_history_rewritten: entry ${index} ${sourceCommit}`,
      );
    }
    if (position >= priorPosition) {
      throw new Error(
        `application_coverage_source_history_reordered: entry ${index}`,
      );
    }
    priorPosition = position;
  }
}

/**
 * @param {string} repositoryRoot
 * @param {{genesisSourceCommit?: string}} [options]
 */
export function verifyCoverageHistory(
  repositoryRoot,
  { genesisSourceCommit = COVERAGE_GENESIS_SOURCE_COMMIT } = {},
) {
  const ledgerPath = resolve(repositoryRoot, COVERAGE_LEDGER_PATH);
  const currentContents = readFileSync(ledgerPath, "utf8");
  const currentLedger = parseLedger(currentContents, COVERAGE_LEDGER_PATH);
  const currentValidation = validateCoverageLedger(currentLedger);
  const headCommit = requireGit(
    repositoryRoot,
    ["rev-parse", "HEAD"],
    "application_coverage_head_unavailable",
  );
  const headLedger = git(repositoryRoot, [
    "show",
    `HEAD:${COVERAGE_LEDGER_PATH}`,
  ]);
  const ledgerDiffersFromHead =
    headLedger.status !== 0 || headLedger.stdout !== currentContents;
  const trustedCommit = ledgerDiffersFromHead
    ? headCommit
    : requireGit(
        repositoryRoot,
        ["rev-parse", "HEAD^1"],
        "application_coverage_trusted_commit_unavailable",
      );
  const trustedObject = git(repositoryRoot, [
    "cat-file",
    "-e",
    `${trustedCommit}^{commit}`,
  ]);
  if (trustedObject.status !== 0) {
    throw new Error(
      `application_coverage_trusted_commit_unavailable: ${trustedCommit}`,
    );
  }

  const priorLedgerResult = git(repositoryRoot, [
    "show",
    `${trustedCommit}:${COVERAGE_LEDGER_PATH}`,
  ]);
  let priorIdentity = COVERAGE_GENESIS_HASH;
  if (priorLedgerResult.status === 0) {
    const priorLedger = parseLedger(
      priorLedgerResult.stdout,
      `${trustedCommit}:${COVERAGE_LEDGER_PATH}`,
    );
    const priorValidation = validateCoverageLedger(priorLedger);
    verifyRetainedPrefix(currentLedger.entries, priorLedger.entries);
    priorIdentity = priorValidation.identity;
  } else if (
    trustedCommit !== genesisSourceCommit ||
    currentLedger.entries.length !== 1 ||
    currentLedger.entries[0]?.sourceCommit !== genesisSourceCommit
  ) {
    throw new Error(
      `application_coverage_prior_ledger_unavailable: ${trustedCommit}:${COVERAGE_LEDGER_PATH}`,
    );
  }

  verifySourceHistory(
    repositoryRoot,
    currentLedger.entries,
    genesisSourceCommit,
    headCommit,
  );
  return {
    ...currentValidation,
    headCommit,
    priorIdentity,
    thresholds: currentLedger.entries.at(-1).thresholds,
    trustedCommit,
  };
}
