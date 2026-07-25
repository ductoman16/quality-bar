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
    testGroup: "health-live",
    failureCode: "unit_tests_failed",
    arguments: ["--test", "test/health-live.test.js"],
  },
  {
    name: "package-integration",
    testGroup: "compose-service",
    failureCode: "package_integration_failed",
    factsMarker: "QUALITY_BAR_PACKAGE_FACTS",
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
const manifest = {
  evidenceVersion: 1,
  sourceCommit,
  platform: {
    runner: `${process.platform}/${process.arch}`,
    package: "linux/amd64",
  },
  componentVersions: {
    application: applicationVersion,
    schema: null,
    image: applicationVersion ? `quality-bar:${applicationVersion}` : null,
    runtime: packagedNodeVersion ? `node:${packagedNodeVersion}` : null,
    git: null,
    codex: null,
    adapterProtocol: null,
    browser: null,
    database: null,
    fixtures: null,
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
