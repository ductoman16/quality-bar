import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { MCP_PROTOCOL_VERSION } from "../../src/mcp-contract.js";
import { validatePerformanceFacts } from "./performance-budget.mjs";
import { validateReleaseCanaries } from "./release-canary-schema.mjs";
import { updateVerificationEvidence } from "./release-canary-evidence.mjs";

/**
 * @typedef {{
 *   applicationVersion: string | null,
 *   coverageToolVersion: string | null,
 *   eslintPluginNodeVersion: string | null,
 *   eslintVersion: string | null,
 *   formatterVersion: string | null,
 *   jsonSchemaFormatsVersion: string | null,
 *   jsonSchemaValidatorVersion: string | null,
 *   openApiValidatorVersion: string | null,
 *   packagedNodeVersion: string | null,
 *   runnerGitVersion: string | null,
 *   sourceCommit: string | null,
 *   typeCheckerVersion: string | null,
 * }} VerificationMetadata
 */
/** @typedef {{code: string, detail: string}} VerificationFailure */
/**
 * @typedef {{
 *   kind: "cost-free",
 *   ownership: import("./verification-aggregation.mjs").VerificationAggregation["ownership"],
 *   groups: import("./verification-aggregation.mjs").VerificationAggregation["groups"],
 *   crossProcessSmokes: import("./verification-aggregation.mjs").VerificationAggregation["crossProcessSmokes"],
 *   traceability: import("./traceability-audit.mjs").TraceabilityAudit,
 * }} VerificationEvidence
 */
/**
 * @typedef {{
 *   name: string,
 *   command: string,
 *   testGroups: {name: string, count: number | null}[],
 *   checkGroups: {name: string, count: number | null, unit: string}[],
 *   tools: Record<string, string>,
 *   durationMs: number,
 *   outcome: "pass" | "fail",
 *   facts?: {
 *     database?: {schemaVersion?: number, databaseVersion?: string},
 *     tools?: {git?: string, codex?: string},
 *     authenticatedHttpSmoke?: {codexCapabilityCatalogVersion?: string},
 *     executableVersion?: string,
 *   } | import("./performance-budget.mjs").PerformanceFacts,
 * }} VerificationGate
 */
/**
 * @typedef {{
 *   evidenceVersion: number,
 *   invokedGates: VerificationGate[],
 *   verification?: VerificationEvidence | null,
 *   performance?: import("./performance-budget.mjs").PerformanceFacts | null,
 *   releaseCanaries: Record<string, any> | null,
 *   sourceCommit: string | null,
 *   outcome: "pass" | "fail",
 *   failures: VerificationFailure[],
 * }} VerificationManifest
 */

/**
 * @param {VerificationGate["facts"] | undefined} facts
 * @returns {facts is import("./performance-budget.mjs").PerformanceFacts}
 */
function isPerformanceFacts(facts) {
  return (
    typeof facts === "object" &&
    facts !== null &&
    "outcome" in facts &&
    (facts.outcome === "pass" || facts.outcome === "fail")
  );
}

/** @param {VerificationGate} gate @returns {VerificationGate} */
function withoutFacts(gate) {
  const copy = { ...gate };
  delete copy.facts;
  return copy;
}

/**
 * @param {{
 *   metadata: VerificationMetadata,
 *   gates: VerificationGate[],
 *   failures: VerificationFailure[],
 *   verificationAggregation?: import("./verification-aggregation.mjs").VerificationAggregation | null,
 *   startedAt: number,
 * }} input
 */
export function createManifest({
  metadata,
  gates,
  failures,
  startedAt,
  verificationAggregation,
}) {
  /** @typedef {{
   *   database?: {schemaVersion?: number, databaseVersion?: string},
   *   tools?: {git?: string, codex?: string},
   *   authenticatedHttpSmoke?: {codexCapabilityCatalogVersion?: string},
   *   executableVersion?: string,
   * }} RuntimeFacts */
  const packageFacts = /** @type {RuntimeFacts | undefined} */ (
    gates.find((gate) => gate.name === "package-integration")?.facts
  );
  const operatorBrowserFacts = /** @type {RuntimeFacts | undefined} */ (
    gates.find((gate) => gate.name === "operator-browser-smoke")?.facts
  );
  const applicationCoverageFacts = gates.find(
    (gate) => gate.name === "application-coverage",
  )?.facts;
  const performanceGate = gates.find(
    (gate) => gate.name === "performance-budgets",
  );
  const performanceGateRequired =
    verificationAggregation?.groups.local.includes("performance-budgets") ??
    (gates.length === 0 && failures.length === 0);
  const performanceGateMissing =
    performanceGateRequired && performanceGate === undefined;
  const performanceFactError = performanceGateMissing
    ? "performance gate was not invoked"
    : performanceGate === undefined
      ? null
      : performanceGate.facts === undefined
        ? "performance gate has no performance facts"
        : validatePerformanceFacts(performanceGate.facts);
  const performanceFacts =
    performanceFactError === null && isPerformanceFacts(performanceGate?.facts)
      ? performanceGate.facts
      : null;
  const performanceOutcomeMismatch =
    performanceFacts !== null &&
    performanceGate !== undefined &&
    performanceGate.outcome !== performanceFacts.outcome;
  /** @type {VerificationFailure[]} */
  const manifestFailures = [...failures];
  const performanceFailureReported = failures.some(
    (failure) => failure.code === "performance_budgets_failed",
  );
  if (
    (performanceGateMissing || performanceGate?.outcome === "fail") &&
    !performanceFailureReported
  ) {
    manifestFailures.push({
      code: "performance_budgets_failed",
      detail: performanceGateMissing
        ? "performance gate was not invoked"
        : "performance gate failed",
    });
  }
  if (performanceFactError) {
    manifestFailures.push({
      code: "verification_evidence_invalid",
      detail: `QUALITY_BAR_PERFORMANCE_FACTS ${performanceFactError}`,
    });
  } else if (performanceOutcomeMismatch) {
    manifestFailures.push({
      code: "performance_budgets_failed",
      detail: "performance gate and facts outcomes differ",
    });
  }
  if (performanceGate?.outcome === "pass" && performanceFailureReported) {
    manifestFailures.push({
      code: "verification_evidence_invalid",
      detail: "performance gate passed but its owning failure was reported",
    });
  }
  const invalidPerformanceEvidence =
    performanceGateMissing ||
    performanceFactError !== null ||
    performanceOutcomeMismatch ||
    (performanceGate?.outcome === "pass" && performanceFailureReported);
  const manifestGates = invalidPerformanceEvidence
    ? gates.map((gate) =>
        gate.name === "performance-budgets" ? withoutFacts(gate) : gate,
      )
    : gates;

  const outcome = /** @type {"pass" | "fail"} */ (
    manifestFailures.length === 0 ? "pass" : "fail"
  );
  return {
    evidenceVersion: 1,
    sourceCommit: metadata.sourceCommit,
    platform: {
      runner: `${process.platform}/${process.arch}`,
      package: "linux/amd64",
    },
    componentVersions: {
      application: metadata.applicationVersion,
      schema: packageFacts?.database?.schemaVersion ?? null,
      image: metadata.applicationVersion
        ? `quality-bar:${metadata.applicationVersion}`
        : null,
      runtime: metadata.packagedNodeVersion
        ? `node:${metadata.packagedNodeVersion}`
        : null,
      formatter: metadata.formatterVersion
        ? `prettier:${metadata.formatterVersion}`
        : null,
      typeChecker: metadata.typeCheckerVersion
        ? `typescript:${metadata.typeCheckerVersion}`
        : null,
      coverage: metadata.coverageToolVersion
        ? `c8:${metadata.coverageToolVersion}`
        : null,
      openApiValidator: metadata.openApiValidatorVersion
        ? `openapi-schema-validator:${metadata.openApiValidatorVersion}`
        : null,
      jsonSchemaValidator: metadata.jsonSchemaValidatorVersion
        ? `ajv:${metadata.jsonSchemaValidatorVersion}`
        : null,
      jsonSchemaFormats: metadata.jsonSchemaFormatsVersion
        ? `ajv-formats:${metadata.jsonSchemaFormatsVersion}`
        : null,
      git: packageFacts?.tools?.git ?? null,
      codex: packageFacts?.tools?.codex ?? null,
      codexCapabilityCatalog:
        packageFacts?.authenticatedHttpSmoke?.codexCapabilityCatalogVersion ??
        null,
      adapterProtocol: `mcp:${MCP_PROTOCOL_VERSION}`,
      browser: operatorBrowserFacts?.executableVersion ?? null,
      database: packageFacts?.database?.databaseVersion
        ? `sqlite:${packageFacts.database.databaseVersion}`
        : null,
      fixtures: "github-rest:2026-03-10",
    },
    securityBoundary: {
      authorityRecovery: "host-stdin-atomic-revocation",
      browserMutations: "exact-origin-and-session-bound-csrf",
      machineAuthentication: "authorization-bearer-only",
      plaintextHttp: "loopback-only",
      proxyFacts: "explicit-trusted-addresses-only",
    },
    runnerVersions: {
      node: process.version,
      eslint: metadata.eslintVersion,
      "eslint-plugin-n": metadata.eslintPluginNodeVersion,
      prettier: metadata.formatterVersion,
      ajv: metadata.jsonSchemaValidatorVersion,
      "ajv-formats": metadata.jsonSchemaFormatsVersion,
      "openapi-schema-validator": metadata.openApiValidatorVersion,
      typescript: metadata.typeCheckerVersion,
      git: metadata.runnerGitVersion,
    },
    applicationCoverage: applicationCoverageFacts ?? null,
    invokedGates: manifestGates,
    verification: verificationAggregation
      ? {
          kind: /** @type {"cost-free"} */ ("cost-free"),
          ownership: verificationAggregation.ownership,
          groups: verificationAggregation.groups,
          crossProcessSmokes: verificationAggregation.crossProcessSmokes,
          traceability: verificationAggregation.traceability,
        }
      : null,
    performance: invalidPerformanceEvidence ? null : performanceFacts,
    releaseCanaries: null,
    totalDurationMs: Math.round(performance.now() - startedAt),
    outcome,
    failures: manifestFailures,
  };
}

/** @param {any} current @param {VerificationManifest} manifest */
function retainedReleaseCanaries(current, manifest) {
  if (
    manifest.outcome !== "pass" ||
    manifest.failures.length !== 0 ||
    manifest.verification?.kind !== "cost-free" ||
    typeof manifest.sourceCommit !== "string" ||
    current?.sourceCommit !== manifest.sourceCommit
  ) {
    return null;
  }
  const canaries = current?.releaseCanaries;
  if (canaries === null || canaries === undefined) {
    return null;
  }
  if (
    current.evidenceVersion !== 1 ||
    current.outcome !== "pass" ||
    current.verification?.kind !== "cost-free" ||
    !Array.isArray(current.failures) ||
    current.failures.length !== 0 ||
    typeof canaries !== "object" ||
    Array.isArray(canaries)
  ) {
    throw new TypeError("existing release canary evidence is invalid");
  }
  try {
    validateReleaseCanaries(canaries, manifest.sourceCommit);
  } catch {
    throw new TypeError("existing release canary evidence is invalid");
  }
  return canaries;
}

/**
 * @param {string} manifestPath
 * @param {VerificationManifest} manifest
 */
export function writeManifest(manifestPath, manifest) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  updateVerificationEvidence({
    manifest,
    manifestPath,
    mergeEvidence: (current, replacement) => ({
      ...replacement,
      releaseCanaries: retainedReleaseCanaries(current, replacement),
    }),
  });
}

/**
 * @param {VerificationManifest} manifest
 * @param {string} manifestPath
 */
export function formatReport(manifest, manifestPath) {
  const lines = [`Quality Bar verification: ${manifest.outcome.toUpperCase()}`];
  if (manifest.invokedGates.length === 0 && manifest.failures.length > 0) {
    lines.push("- metadata: FAIL");
  }
  for (const gate of manifest.invokedGates) {
    const testCount = gate.testGroups.reduce(
      (total, group) => total + (group.count ?? 0),
      0,
    );
    const countsByUnit = new Map();
    for (const group of gate.checkGroups) {
      countsByUnit.set(
        group.unit,
        (countsByUnit.get(group.unit) ?? 0) + (group.count ?? 0),
      );
    }
    const counts = [];
    if (testCount > 0) {
      counts.push(`${testCount} test${testCount === 1 ? "" : "s"}`);
    }
    for (const [unit, count] of countsByUnit) {
      counts.push(`${count} ${unit}${count === 1 ? "" : "s"}`);
    }
    const tools = Object.entries(gate.tools)
      .map(([name, version]) => `${name} ${version}`)
      .join(", ");
    lines.push(
      `- ${gate.name}: ${gate.outcome.toUpperCase()} (${counts.join(", ")}, ${gate.durationMs} ms; ${tools})`,
    );
  }
  for (const failure of manifest.failures) {
    const detailWasPrinted =
      failure.code !== "verification_evidence_invalid" &&
      manifest.invokedGates.some((gate) => gate.outcome === "fail");
    lines.push(
      `- ${failure.code}${detailWasPrinted ? "" : `: ${failure.detail}`}`,
    );
  }
  lines.push(`Evidence: ${manifestPath}`);
  return `${lines.join("\n")}\n`;
}
