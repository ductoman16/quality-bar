import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
 *   },
 * }} VerificationGate
 */
/**
 * @typedef {{
 *   invokedGates: VerificationGate[],
 *   outcome: "pass" | "fail",
 *   failures: VerificationFailure[],
 * }} VerificationManifest
 */

/**
 * @param {{
 *   metadata: VerificationMetadata,
 *   gates: VerificationGate[],
 *   failures: VerificationFailure[],
 *   startedAt: number,
 * }} input
 */
export function createManifest({ metadata, gates, failures, startedAt }) {
  const packageFacts = gates.find(
    (gate) => gate.name === "package-integration",
  )?.facts;
  const operatorBrowserFacts = gates.find(
    (gate) => gate.name === "operator-browser-smoke",
  )?.facts;
  const applicationCoverageFacts = gates.find(
    (gate) => gate.name === "application-coverage",
  )?.facts;

  const outcome = /** @type {"pass" | "fail"} */ (
    failures.length === 0 ? "pass" : "fail"
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
      adapterProtocol: null,
      browser: operatorBrowserFacts?.executableVersion ?? null,
      database: packageFacts?.database?.databaseVersion
        ? `sqlite:${packageFacts.database.databaseVersion}`
        : null,
      fixtures: null,
    },
    securityBoundary: {
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
    invokedGates: gates,
    totalDurationMs: Math.round(performance.now() - startedAt),
    outcome,
    failures,
  };
}

/**
 * @param {string} manifestPath
 * @param {VerificationManifest} manifest
 */
export function writeManifest(manifestPath, manifest) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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
