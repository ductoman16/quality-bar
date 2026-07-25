import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifestPath = resolve(
  repositoryRoot,
  process.env.QUALITY_BAR_EVIDENCE_PATH ??
    "artifacts/verification/evidence.json",
);
const startedAt = performance.now();
const gates = [];
const failures = [];

function commandFailure(result, command, arguments_) {
  if (result.error) {
    return result.error.message;
  }

  const output = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
  if (output) {
    return output;
  }

  if (result.signal) {
    return `${command} ${arguments_.join(" ")} terminated by ${result.signal}`;
  }

  return `${command} ${arguments_.join(" ")} exited with code ${result.status}`;
}

function captureCommand(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(commandFailure(result, command, arguments_));
  }

  return result.stdout.trim();
}

function readRequiredMatch(path, pattern, description) {
  const contents = readFileSync(resolve(repositoryRoot, path), "utf8");
  const value = contents.match(pattern)?.[1];
  if (!value) {
    throw new Error(`${path} does not define ${description}`);
  }
  return value;
}

function validatePackageFacts(facts) {
  const requirements = [
    [
      facts && typeof facts === "object" && !Array.isArray(facts),
      "must be an object",
    ],
    [facts?.serviceCount === 1, "serviceCount must equal 1"],
    [facts?.companionServiceCount === 0, "companionServiceCount must equal 0"],
    [facts?.network?.mode === "host", "network.mode must equal host"],
    [
      facts?.network?.httpBindAddress === "127.0.0.1",
      "network.httpBindAddress must equal 127.0.0.1",
    ],
    [facts?.platform === "linux/amd64", "platform must equal linux/amd64"],
    [
      facts?.image === `quality-bar:${applicationVersion}`,
      "image must match the application version",
    ],
    [
      facts?.applicationProcess?.uid === 10001,
      "applicationProcess.uid must equal 10001",
    ],
    [
      facts?.applicationProcess?.pid === 1,
      "applicationProcess.pid must equal 1",
    ],
    [
      facts?.applicationProcess?.executable === "node",
      "applicationProcess.executable must equal node",
    ],
    [
      facts?.applicationProcess?.entrypoint === "src/main.js",
      "applicationProcess.entrypoint must equal src/main.js",
    ],
    [facts?.liveness?.path === "/health/live", "liveness.path is invalid"],
    [facts?.liveness?.httpStatus === 200, "liveness.httpStatus must equal 200"],
    [
      facts?.liveness?.response?.status === "live",
      "liveness.response.status must equal live",
    ],
    [facts?.readiness?.path === "/health/ready", "readiness.path is invalid"],
    [
      facts?.readiness?.httpStatus === 200,
      "readiness.httpStatus must equal 200",
    ],
    [
      facts?.readiness?.response?.status === "ready",
      "readiness.response.status must equal ready",
    ],
    [
      facts?.storage?.databasePath ===
        "/var/lib/quality-bar/quality-bar.sqlite3",
      "storage.databasePath is invalid",
    ],
    [
      facts?.storage?.volumeTarget === "/var/lib/quality-bar",
      "storage.volumeTarget is invalid",
    ],
    [
      facts?.storage?.persistedAcrossRecreate === true,
      "storage.persistedAcrossRecreate must equal true",
    ],
    [
      facts?.storage?.checkoutsPath === "/var/cache/quality-bar/checkouts",
      "storage.checkoutsPath is invalid",
    ],
    [
      facts?.storage?.backupsPath === "/var/backups/quality-bar",
      "storage.backupsPath is invalid",
    ],
    [
      facts?.storage?.ownedPaths === true,
      "storage.ownedPaths must equal true",
    ],
    [
      facts?.storage?.localFilesystems === true,
      "storage.localFilesystems must equal true",
    ],
    [
      facts?.installation?.freeSpaceReserveBytes === 5 * 1024 ** 3,
      "installation.freeSpaceReserveBytes is invalid",
    ],
    [
      facts?.installation?.freeSpaceReserveMet === true,
      "installation.freeSpaceReserveMet must equal true",
    ],
    [
      facts?.tools?.git === "2.54.0",
      "tools.git must equal 2.54.0",
    ],
    [
      facts?.tools?.codex === "0.145.0",
      "tools.codex must equal 0.145.0",
    ],
    [
      facts?.tools?.persistentCodexLogin === false,
      "tools.persistentCodexLogin must equal false for the unprovisioned packaged fixture",
    ],
    [
      facts?.configuration?.configPath === "/etc/quality-bar/config.env",
      "configuration.configPath is invalid",
    ],
    [
      facts?.configuration?.masterKeyPath ===
        "/run/secrets/quality-bar-master-key",
      "configuration.masterKeyPath is invalid",
    ],
    [
      facts?.configuration?.encryptedVerifier === true,
      "configuration.encryptedVerifier must equal true",
    ],
    [
      facts?.authority?.operatorPasswordBootstrap === true,
      "authority.operatorPasswordBootstrap must equal true",
    ],
    [
      facts?.authenticatedHttpSmoke?.browserStatus === 200 &&
        typeof facts?.authenticatedHttpSmoke?.codexCapabilityCatalogVersion === "string" &&
        facts.authenticatedHttpSmoke.codexCapabilityCatalogVersion.length > 0 &&
        facts?.authenticatedHttpSmoke?.hasCodexCapabilityModels === true &&
        facts?.authenticatedHttpSmoke?.hasNavigation === true &&
        facts?.authenticatedHttpSmoke?.loginStatus === 204 &&
        facts?.authenticatedHttpSmoke?.openapiStatus === 200 &&
        facts?.authenticatedHttpSmoke?.openapiVersion === "3.1.0",
      "authenticatedHttpSmoke must prove the packaged authenticated HTTP, OpenAPI, and Codex capability catalog contract",
    ],
    [
      /^\d+\.\d+\.\d+$/.test(facts?.database?.databaseVersion),
      "database.databaseVersion must be semantic",
    ],
    [
      facts?.database?.foreignKeys === true,
      "database.foreignKeys must equal true",
    ],
    [
      facts?.database?.integrity === "ok",
      "database.integrity must equal ok",
    ],
    [
      facts?.database?.journalMode === "wal",
      "database.journalMode must equal wal",
    ],
    [
      facts?.database?.schemaVersion === 6,
      "database.schemaVersion must equal 6",
    ],
    [
      facts?.database?.synchronous === "full",
      "database.synchronous must equal full",
    ],
  ];

  return requirements.find(([valid]) => !valid)?.[1] ?? null;
}

function validateOperatorBrowserFacts(facts) {
  return facts?.engine !== "firefox"
    ? "engine must equal firefox"
    : facts?.authenticatedShell !== true
      ? "authenticatedShell must equal true"
      : facts?.systemFetch !== true
        ? "systemFetch must equal true"
        : typeof facts?.executableVersion !== "string" || facts.executableVersion.length === 0
          ? "executableVersion must be nonempty"
          : null;
}

function runGate(definition) {
  const gateStartedAt = performance.now();
  const result = spawnSync(process.execPath, definition.arguments, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const durationMs = Math.round(performance.now() - gateStartedAt);
  const combinedOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const testCountMatch = combinedOutput.match(/^# tests (\d+)$/m);
  const testCount = testCountMatch
    ? Number.parseInt(testCountMatch[1], 10)
    : null;
  const factsMatch = definition.factsMarker
    ? combinedOutput.match(
        new RegExp(`^# ${definition.factsMarker} (.+)$`, "m"),
      )
    : null;
  let facts = null;
  let outcome = "pass";
  let failure;

  if (result.status !== 0) {
    outcome = "fail";
    failure = {
      code: definition.failureCode,
      detail: commandFailure(result, process.execPath, definition.arguments),
    };
  } else if (testCount === null || testCount < 1) {
    outcome = "fail";
    failure = {
      code: "verification_evidence_invalid",
      detail: `${definition.name} passed without a positive '# tests' summary`,
    };
  } else if (definition.factsMarker && !factsMatch) {
    outcome = "fail";
    failure = {
      code: "verification_evidence_invalid",
      detail: `${definition.name} passed without ${definition.factsMarker}`,
    };
  } else if (factsMatch) {
    try {
      facts = JSON.parse(factsMatch[1]);
      const invalidFacts = definition.validateFacts?.(facts);
      if (invalidFacts) {
        facts = null;
        outcome = "fail";
        failure = {
          code: "verification_evidence_invalid",
          detail: `${definition.factsMarker} ${invalidFacts}`,
        };
      }
    } catch (error) {
      outcome = "fail";
      failure = {
        code: "verification_evidence_invalid",
        detail: `${definition.factsMarker} is not valid JSON: ${error.message}`,
      };
    }
  }

  const evidence = {
    name: definition.name,
    command: `node ${definition.arguments.join(" ")}`,
    testGroups: [
      {
        name: definition.testGroup,
        count: testCount,
      },
    ],
    durationMs,
    outcome,
  };
  if (facts) {
    evidence.facts = facts;
  }

  return {
    evidence,
    failure,
    output: combinedOutput,
  };
}

let applicationVersion = null;
let packagedNodeVersion = null;
let sourceCommit = null;
let runnerGitVersion = null;

try {
  applicationVersion = readRequiredMatch(
    ".env",
    /^QUALITY_BAR_VERSION=(\d+\.\d+\.\d+)$/m,
    "a semantic QUALITY_BAR_VERSION",
  );
  packagedNodeVersion = readRequiredMatch(
    "Dockerfile",
    /^FROM node:(\d+\.\d+\.\d+)-alpine@sha256:/m,
    "a digest-pinned Node version",
  );
  sourceCommit = captureCommand("git", ["rev-parse", "HEAD"]);
  runnerGitVersion = captureCommand("git", ["--version"]).replace(
    /^git version /,
    "",
  );
} catch (error) {
  failures.push({
    code: "verification_metadata_failed",
    detail: error.message,
  });
}

const gateDefinitions = [
  {
    name: "unit",
    testGroup: "browser-authority-and-request-security-unit",
    failureCode: "unit_tests_failed",
    arguments: [
      "--test",
      "test/application-readiness.test.js",
      "test/codex-capabilities.test.js",
      "test/configuration.test.js",
      "test/durable-core.test.js",
      "test/health-live.test.js",
      "test/http-port.test.js",
      "test/installation-environment.test.js",
      "test/operator-password.test.js",
      "test/browser-session.test.js",
      "test/implementer-token.test.js",
      "test/request-security.test.js",
      "test/review-validation.test.js",
    ],
  },
  {
    name: "browser-component",
    testGroup: "browser-authority-and-request-security-browser-boundary",
    failureCode: "browser_component_tests_failed",
    arguments: [
      "--test",
      "test/operator-password-browser-component.test.js",
      "test/browser-session-browser-component.test.js",
    ],
  },
  {
    name: "sqlite-integration",
    testGroup: "review-sqlite-resource-boundary",
    failureCode: "sqlite_integration_tests_failed",
    arguments: ["--test", "test/review.test.js"],
  },
  {
    name: "http-integration",
    testGroup: "review-http-resource-boundary",
    failureCode: "http_integration_tests_failed",
    arguments: ["--test", "test/review-http-integration.test.js"],
  },
  {
    name: "security-integration",
    testGroup: "browser-authority-and-request-security-integration",
    failureCode: "security_integration_tests_failed",
    arguments: [
      "--test",
      "test/operator-password-bootstrap.test.js",
      "test/browser-session-security-integration.test.js",
    ],
  },
  {
    name: "operator-browser-smoke",
    testGroup: "authenticated-firefox-browser-cross-process",
    failureCode: "operator_browser_smoke_failed",
    factsMarker: "QUALITY_BAR_OPERATOR_BROWSER_FACTS",
    validateFacts: validateOperatorBrowserFacts,
    arguments: ["--test", "test/operator-browser-smoke.test.js"],
  },
  {
    name: "package-integration",
    testGroup: "compose-service",
    failureCode: "package_integration_failed",
    factsMarker: "QUALITY_BAR_PACKAGE_FACTS",
    validateFacts: validatePackageFacts,
    arguments: ["--test", "test/package/compose.package-test.mjs"],
  },
];

if (failures.length === 0) {
  for (const definition of gateDefinitions) {
    const result = runGate(definition);
    gates.push(result.evidence);

    if (result.failure) {
      failures.push(result.failure);
      if (result.output) {
        process.stderr.write(`${result.output}\n`);
      }
      break;
    }
  }
}

const outcome = failures.length === 0 ? "pass" : "fail";
const packageFacts = gates.find(
  (gate) => gate.name === "package-integration",
)?.facts;
const operatorBrowserFacts = gates.find(
  (gate) => gate.name === "operator-browser-smoke",
)?.facts;
const manifest = {
  evidenceVersion: 1,
  sourceCommit,
  platform: {
    runner: `${process.platform}/${process.arch}`,
    package: "linux/amd64",
  },
  componentVersions: {
    application: applicationVersion,
    schema: packageFacts?.database?.schemaVersion ?? null,
    image: applicationVersion ? `quality-bar:${applicationVersion}` : null,
    runtime: packagedNodeVersion ? `node:${packagedNodeVersion}` : null,
    git: packageFacts?.tools?.git ?? null,
    codex: packageFacts?.tools?.codex ?? null,
    codexCapabilityCatalog: packageFacts?.authenticatedHttpSmoke?.codexCapabilityCatalogVersion ?? null,
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
    git: runnerGitVersion,
  },
  invokedGates: gates,
  totalDurationMs: Math.round(performance.now() - startedAt),
  outcome,
  failures,
};

mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

process.stdout.write(`Quality Bar verification: ${outcome.toUpperCase()}\n`);
if (gates.length === 0 && failures.length > 0) {
  process.stdout.write("- metadata: FAIL\n");
}
for (const gate of gates) {
  const count = gate.testGroups.reduce(
    (total, group) => total + (group.count ?? 0),
    0,
  );
  process.stdout.write(
    `- ${gate.name}: ${gate.outcome.toUpperCase()} (${count} test${count === 1 ? "" : "s"}, ${gate.durationMs} ms)\n`,
  );
}
for (const failure of failures) {
  const detailWasPrinted =
    failure.code === "unit_tests_failed" ||
    failure.code === "package_integration_failed";
  process.stdout.write(
    `- ${failure.code}${detailWasPrinted ? "" : `: ${failure.detail}`}\n`,
  );
}
process.stdout.write(`Evidence: ${manifestPath}\n`);

if (outcome === "fail") {
  process.exitCode = 1;
}
