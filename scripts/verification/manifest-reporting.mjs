import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @typedef {{
 *   applicationVersion: string | null,
 *   formatterVersion: string | null,
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
      prettier: metadata.formatterVersion,
      typescript: metadata.typeCheckerVersion,
      git: metadata.runnerGitVersion,
    },
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
    const count = gate.testGroups.reduce(
      (total, group) => total + (group.count ?? 0),
      0,
    );
    lines.push(
      `- ${gate.name}: ${gate.outcome.toUpperCase()} (${count} test${count === 1 ? "" : "s"}, ${gate.durationMs} ms)`,
    );
  }
  for (const failure of manifest.failures) {
    const detailWasPrinted =
      failure.code === "unit_tests_failed" ||
      failure.code === "package_integration_failed";
    lines.push(
      `- ${failure.code}${detailWasPrinted ? "" : `: ${failure.detail}`}`,
    );
  }
  lines.push(`Evidence: ${manifestPath}`);
  return `${lines.join("\n")}\n`;
}
