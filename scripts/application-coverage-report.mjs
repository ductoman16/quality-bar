import { readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { APPLICATION_COVERAGE_BOUNDARY } from "./application-coverage-policy.mjs";

/** @type {("lines" | "branches" | "functions")[]} */
const COMPONENTS = ["lines", "branches", "functions"];

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {string} repositoryRoot */
export function maintainedApplicationPaths(repositoryRoot) {
  return readdirSync(resolve(repositoryRoot, "src"), {
    encoding: "utf8",
    recursive: true,
  })
    .filter((path) => typeof path === "string" && path.endsWith(".js"))
    .map((path) => `src/${path.split(sep).join("/")}`)
    .sort();
}

/**
 * @param {string} repositoryRoot
 * @param {Record<string, unknown>} summary
 * @param {Record<string, string>} thresholds
 */
export function validateCoverageSummary(repositoryRoot, summary, thresholds) {
  const total = summary.total;
  if (!isRecord(total)) {
    throw new Error("application_coverage_total_missing");
  }
  /** @type {Record<string, string>} */
  const measured = {};
  for (const component of COMPONENTS) {
    const metric = total[component];
    if (
      !isRecord(metric) ||
      typeof metric.pct !== "number" ||
      !Number.isFinite(metric.pct)
    ) {
      throw new Error(`application_coverage_${component}_missing`);
    }
    measured[component] = metric.pct.toFixed(2);
    if (Number(measured[component]) < Number(thresholds[component])) {
      throw new Error(
        `application_coverage_below_threshold: ${component} measured ${measured[component]} required ${thresholds[component]}`,
      );
    }
  }

  const reportedPaths = Object.keys(summary)
    .filter((path) => path !== "total")
    .map((path) => relative(repositoryRoot, path).split(sep).join("/"))
    .sort();
  const expectedPaths = maintainedApplicationPaths(repositoryRoot);
  if (JSON.stringify(reportedPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error(
      `application_coverage_file_boundary_mismatch: expected ${expectedPaths.join(",")} received ${reportedPaths.join(",")}`,
    );
  }
  for (const browserAsset of APPLICATION_COVERAGE_BOUNDARY.servedBrowserAssets) {
    if (!reportedPaths.includes(browserAsset)) {
      throw new Error(
        `application_coverage_served_browser_asset_missing: ${browserAsset}`,
      );
    }
  }
  return {
    fileCount: reportedPaths.length,
    measured,
    servedBrowserAssets: [...APPLICATION_COVERAGE_BOUNDARY.servedBrowserAssets],
  };
}

/** @param {unknown} facts */
export function validateApplicationCoverageFacts(facts) {
  if (!isRecord(facts)) {
    return "must be an object";
  }
  if (
    JSON.stringify(facts.boundary) !==
    JSON.stringify(APPLICATION_COVERAGE_BOUNDARY)
  ) {
    return "must record the exact reviewed application boundary";
  }
  if (facts.coverageTool !== "c8:12.0.0") {
    return "must record c8:12.0.0";
  }
  if (
    typeof facts.fileCount !== "number" ||
    !Number.isInteger(facts.fileCount) ||
    facts.fileCount < 1
  ) {
    return "must record a positive maintained application file count";
  }
  if (
    JSON.stringify(facts.servedBrowserAssets) !==
    JSON.stringify(APPLICATION_COVERAGE_BOUNDARY.servedBrowserAssets)
  ) {
    return "must record the exact served browser assets";
  }
  if (
    !isRecord(facts.ledger) ||
    typeof facts.ledger.entryCount !== "number" ||
    !Number.isInteger(facts.ledger.entryCount) ||
    facts.ledger.entryCount < 1 ||
    typeof facts.ledger.identity !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(facts.ledger.identity) ||
    typeof facts.ledger.priorIdentity !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(facts.ledger.priorIdentity) ||
    typeof facts.ledger.trustedCommit !== "string" ||
    !/^[0-9a-f]{40}$/.test(facts.ledger.trustedCommit)
  ) {
    return "must record a valid coverage-ledger identity";
  }
  for (const component of COMPONENTS) {
    const thresholdPattern = /^(?:100\.00|[0-9]{1,2}\.[0-9]{2})$/;
    if (
      !isRecord(facts.measured) ||
      !isRecord(facts.thresholds) ||
      typeof facts.measured[component] !== "string" ||
      typeof facts.thresholds[component] !== "string" ||
      !thresholdPattern.test(facts.measured[component]) ||
      !thresholdPattern.test(facts.thresholds[component]) ||
      Number(facts.measured[component]) < Number(facts.thresholds[component])
    ) {
      return `must record passing ${component} coverage`;
    }
  }
  return null;
}
