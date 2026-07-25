import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifestPath = resolve(
  repositoryRoot,
  process.env.QUALITY_BAR_EVIDENCE_PATH ??
    "artifacts/verification/evidence.json",
);
const packageMetadata = JSON.parse(
  readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
);

function commandOutput(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${arguments_.join(" ")} exited with code ${result.status}`,
    );
  }
  return result.stdout.trim();
}

function runGate(name, testGroup, arguments_) {
  const startedAt = performance.now();
  const result = spawnSync(process.execPath, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const durationMs = Math.round(performance.now() - startedAt);
  const combinedOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const testCount = Number.parseInt(
    combinedOutput.match(/^# tests (\d+)$/m)?.[1] ?? "0",
    10,
  );

  return {
    evidence: {
      name,
      command: `node ${arguments_.join(" ")}`,
      testGroups: [{ name: testGroup, count: testCount }],
      durationMs,
      outcome: result.status === 0 ? "pass" : "fail",
    },
    output: combinedOutput.trim(),
    status: result.status,
  };
}

const sourceCommit = commandOutput("git", ["rev-parse", "HEAD"]);
const gitVersion = commandOutput("git", ["--version"]).replace(/^git version /, "");
const startedAt = performance.now();
const gateDefinitions = [
  {
    name: "unit",
    testGroup: "health-live",
    arguments: ["--test", "test/health-live.test.js"],
  },
  {
    name: "package-integration",
    testGroup: "compose-service",
    arguments: ["--test", "test/package/compose.package-test.mjs"],
  },
];
const gates = [];
const failures = [];

for (const definition of gateDefinitions) {
  const result = runGate(
    definition.name,
    definition.testGroup,
    definition.arguments,
  );
  gates.push(result.evidence);

  if (result.status !== 0) {
    failures.push({
      code: "verification_gate_failed",
      detail: `${definition.name} exited with code ${result.status}`,
    });
    if (result.output) {
      process.stderr.write(`${result.output}\n`);
    }
    break;
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
    application: packageMetadata.version,
    schema: null,
    image: `quality-bar:${packageMetadata.version}`,
    git: gitVersion,
    codex: null,
    adapterProtocol: null,
    browser: null,
    database: null,
    fixtures: null,
  },
  invokedGates: gates,
  totalDurationMs: Math.round(performance.now() - startedAt),
  outcome,
  failures,
};

mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

process.stdout.write(`Quality Bar verification: ${outcome.toUpperCase()}\n`);
for (const gate of gates) {
  const count = gate.testGroups.reduce(
    (total, group) => total + group.count,
    0,
  );
  process.stdout.write(
    `- ${gate.name}: ${gate.outcome.toUpperCase()} (${count} test${count === 1 ? "" : "s"}, ${gate.durationMs} ms)\n`,
  );
}
process.stdout.write(`Evidence: ${manifestPath}\n`);

if (outcome === "fail") {
  process.exitCode = 1;
}
