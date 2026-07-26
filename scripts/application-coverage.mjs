import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { verifyCoverageHistory } from "./application-coverage-history.mjs";
import {
  APPLICATION_COVERAGE_BOUNDARY,
  APPLICATION_COVERAGE_TEST_PATHS,
} from "./application-coverage-policy.mjs";
import { validateCoverageSummary } from "./application-coverage-report.mjs";
import { commandFailure } from "./verification/failure-reporting.mjs";

const COVERAGE_REPORT_PATH =
  "artifacts/verification/application-coverage/coverage-summary.json";

/** @param {string} repositoryRoot */
function readCoverageToolVersion(repositoryRoot) {
  const metadata = JSON.parse(
    readFileSync(
      resolve(repositoryRoot, "node_modules/c8/package.json"),
      "utf8",
    ),
  );
  if (metadata.version !== "12.0.0") {
    throw new Error(
      `application_coverage_tool_version_invalid: expected 12.0.0 received ${String(metadata.version)}`,
    );
  }
  return metadata.version;
}

/** @param {string} repositoryRoot */
export function runApplicationCoverage(repositoryRoot) {
  const history = verifyCoverageHistory(repositoryRoot);
  const reportDirectory = resolve(
    repositoryRoot,
    "artifacts/verification/application-coverage",
  );
  rmSync(reportDirectory, { force: true, recursive: true });
  const c8Path = resolve(repositoryRoot, "node_modules/c8/bin/c8.js");
  const arguments_ = [
    c8Path,
    "--all",
    "--clean",
    `--include=${APPLICATION_COVERAGE_BOUNDARY.include[0]}`,
    "--reporter=text",
    "--reporter=json-summary",
    `--report-dir=${reportDirectory}`,
    "--check-coverage",
    `--lines=${history.thresholds.lines}`,
    `--branches=${history.thresholds.branches}`,
    `--functions=${history.thresholds.functions}`,
    process.execPath,
    "--test",
    ...APPLICATION_COVERAGE_TEST_PATHS,
  ];
  const result = spawnSync(process.execPath, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (output.length > 0) {
    process.stdout.write(output);
  }
  if (result.status !== 0) {
    throw new Error(
      `application_coverage_collection_failed: ${commandFailure(
        result,
        process.execPath,
        arguments_,
      )}`,
    );
  }
  const summary = JSON.parse(
    readFileSync(resolve(repositoryRoot, COVERAGE_REPORT_PATH), "utf8"),
  );
  const coverage = validateCoverageSummary(
    repositoryRoot,
    summary,
    history.thresholds,
  );
  const facts = {
    boundary: APPLICATION_COVERAGE_BOUNDARY,
    coverageTool: `c8:${readCoverageToolVersion(repositoryRoot)}`,
    fileCount: coverage.fileCount,
    ledger: {
      entryCount: history.entryCount,
      identity: history.identity,
      priorIdentity: history.priorIdentity,
      trustedCommit: history.trustedCommit,
    },
    measured: coverage.measured,
    servedBrowserAssets: coverage.servedBrowserAssets,
    thresholds: history.thresholds,
  };
  process.stdout.write(
    `QUALITY_BAR_APPLICATION_COVERAGE_FACTS ${JSON.stringify(facts)}\n`,
  );
  return facts;
}

if (import.meta.main) {
  try {
    runApplicationCoverage(resolve(import.meta.dirname, ".."));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
