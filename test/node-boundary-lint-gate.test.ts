import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { runNodeBoundaryLint } from "../scripts/node-boundary-lint.mts";

const repositoryRoot = resolve(import.meta.dirname, "..");

function fixture(name: string) {
  return readFileSync(
    resolve(repositoryRoot, "fixtures", "node-boundary-lint", `${name}.js.txt`),
    "utf8",
  );
}

test("the Node and ownership-boundary gate accepts maintained JavaScript", async () => {
  const result = await runNodeBoundaryLint({ repositoryRoot });

  assert.equal(result.outcome, "pass", result.report);
  assert.match(
    result.report,
    /node_boundary_lint: PASS \(\d+ maintained JavaScript files, zero warnings\)/,
  );
});

test("the Node boundary gate rejects missing, extraneous, and unavailable imports", async () => {
  const expectedDiagnostics = {
    "missing-import": "n/no-missing-import",
    "extraneous-import": "n/no-extraneous-import",
    "unavailable-node-import": "n/no-missing-import",
  };

  for (const [name, rule] of Object.entries(expectedDiagnostics)) {
    const result = await runNodeBoundaryLint({
      files: [
        {
          path: `fixtures/node-boundary-lint/${name}.js`,
          source: fixture(name),
        },
      ],
      repositoryRoot,
    });

    assert.equal(result.outcome, "fail", `${name}: ${result.report}`);
    assert.match(result.report, new RegExp(`\\[${rule}\\]`));
  }
});

test("the Node boundary gate rejects unsupported Node features", async () => {
  const result = await runNodeBoundaryLint({
    files: [
      {
        path: "src/unsupported-node-feature.js",
        source: fixture("unsupported-node-feature"),
      },
    ],
    repositoryRoot,
  });

  assert.equal(result.outcome, "fail", result.report);
  assert.match(result.report, /\[n\/no-unsupported-features\/node-builtins\]/);
});

test("the Node boundary gate restricts console output and environment access", async () => {
  const rejectedConsole = await runNodeBoundaryLint({
    files: [
      {
        path: "src/console-fixture.js",
        source: fixture("console-output"),
      },
    ],
    repositoryRoot,
  });
  const rejectedEnvironment = await runNodeBoundaryLint({
    files: [
      {
        path: "src/environment-fixture.js",
        source: fixture("environment-access"),
      },
    ],
    repositoryRoot,
  });
  const acceptedProtocolOwner = await runNodeBoundaryLint({
    files: [
      {
        path: "fixtures/package/http-facts.mjs",
        source: fixture("console-output"),
      },
    ],
    repositoryRoot,
  });
  const rejectedUnownedFixture = await runNodeBoundaryLint({
    files: [
      {
        path: "fixtures/package/not-a-protocol-owner.mjs",
        source: fixture("console-output"),
      },
    ],
    repositoryRoot,
  });
  const acceptedEntrypoint = await runNodeBoundaryLint({
    files: [
      {
        path: "src/main.ts",
        source: fixture("environment-access"),
      },
    ],
    repositoryRoot,
  });
  const acceptedTestOwner = await runNodeBoundaryLint({
    files: [
      {
        path: "scripts/release-canary/run-paid-codex.mts",
        source: fixture("environment-access"),
      },
    ],
    repositoryRoot,
  });

  assert.equal(rejectedConsole.outcome, "fail", rejectedConsole.report);
  assert.match(rejectedConsole.report, /\[no-console\]/);
  assert.equal(rejectedEnvironment.outcome, "fail", rejectedEnvironment.report);
  assert.match(rejectedEnvironment.report, /\[no-restricted-syntax\]/);
  assert.equal(
    acceptedProtocolOwner.outcome,
    "pass",
    acceptedProtocolOwner.report,
  );
  assert.equal(
    rejectedUnownedFixture.outcome,
    "fail",
    rejectedUnownedFixture.report,
  );
  assert.match(rejectedUnownedFixture.report, /\[no-console\]/);
  assert.equal(acceptedEntrypoint.outcome, "pass", acceptedEntrypoint.report);
  assert.equal(acceptedTestOwner.outcome, "pass", acceptedTestOwner.report);
});

test("the Node boundary gate rejects global console and environment aliases", async () => {
  const consoleAliases = await runNodeBoundaryLint({
    files: [
      {
        path: "src/console-alias-fixture.js",
        source: fixture("console-aliases"),
      },
    ],
    repositoryRoot,
  });
  const environmentAliases = await runNodeBoundaryLint({
    files: [
      {
        path: "src/environment-alias-fixture.js",
        source: fixture("environment-aliases"),
      },
    ],
    repositoryRoot,
  });
  const processAlias = await runNodeBoundaryLint({
    files: [
      {
        path: "src/process-alias-fixture.js",
        source: fixture("process-alias"),
      },
    ],
    repositoryRoot,
  });
  const destructuredEnvironment = await runNodeBoundaryLint({
    files: [
      {
        path: "src/destructured-environment-fixture.js",
        source: fixture("destructured-environment"),
      },
    ],
    repositoryRoot,
  });
  const computedDestructuredEnvironment = await runNodeBoundaryLint({
    files: [
      {
        path: "src/computed-destructured-environment-fixture.js",
        source: fixture("computed-destructured-environment"),
      },
    ],
    repositoryRoot,
  });
  const fallbackAccessors = await runNodeBoundaryLint({
    files: [
      {
        path: "src/fallback-environment-fixture.js",
        source: fixture("fallback-environment"),
      },
    ],
    repositoryRoot,
  });
  const computedFallbackAccessors = await runNodeBoundaryLint({
    files: [
      {
        path: "src/computed-fallback-environment-fixture.js",
        source: fixture("computed-fallback-environment"),
      },
    ],
    repositoryRoot,
  });
  const unrelatedAccessors = await runNodeBoundaryLint({
    files: [
      {
        path: "src/unrelated-accessor-fixture.js",
        source: fixture("unrelated-accessors"),
      },
    ],
    repositoryRoot,
  });

  assert.equal(consoleAliases.outcome, "fail", consoleAliases.report);
  assert.match(consoleAliases.report, /\[no-restricted-globals\]/);
  assert.equal(environmentAliases.outcome, "fail", environmentAliases.report);
  assert.match(environmentAliases.report, /\[no-restricted-globals\]/);
  assert.equal(processAlias.outcome, "fail", processAlias.report);
  assert.match(processAlias.report, /\[no-restricted-syntax\]/);
  assert.equal(
    destructuredEnvironment.outcome,
    "fail",
    destructuredEnvironment.report,
  );
  assert.match(destructuredEnvironment.report, /\[no-restricted-syntax\]/);
  assert.equal(
    computedDestructuredEnvironment.outcome,
    "fail",
    computedDestructuredEnvironment.report,
  );
  assert.match(
    computedDestructuredEnvironment.report,
    /\[no-restricted-syntax\]/,
  );
  assert.equal(fallbackAccessors.outcome, "fail", fallbackAccessors.report);
  assert.match(fallbackAccessors.report, /\[no-restricted-syntax\]/);
  assert.equal(
    computedFallbackAccessors.outcome,
    "fail",
    computedFallbackAccessors.report,
  );
  assert.match(computedFallbackAccessors.report, /\[no-restricted-syntax\]/);
  assert.equal(unrelatedAccessors.outcome, "pass", unrelatedAccessors.report);
});

test("the Node boundary evidence records the complete ownership cleanup", () => {
  const evidence = JSON.parse(
    readFileSync(
      resolve(
        repositoryRoot,
        "evidence/quality-foundation/issue-160-node-boundary-lint.json",
      ),
      "utf8",
    ),
  );

  assert.equal(evidence.ticket, 160);
  assert.equal(evidence.focused_command, "npm run lint:boundaries");
  assert.deepEqual(evidence.initial_unowned_violations, []);
  assert.deepEqual(evidence.initial_unsupported_feature_reports, [
    {
      feature: "import.meta.main",
      paths: [
        "scripts/core-js-lint.mjs",
        "scripts/node-boundary-lint.mjs",
        "scripts/structural-lint.mjs",
      ],
    },
    {
      feature: "sqlite",
      paths: [
        "fixtures/package/database-facts.mjs",
        "fixtures/package/write-database-marker.mjs",
        "src/durable/durable-core.js",
        "src/installation-environment.js",
        "test/installation-environment.test.js",
      ],
    },
  ]);
  assert.deepEqual(evidence.approved_node_builtin_exceptions, [
    "import.meta.main",
    "sqlite",
  ]);
  assert.deepEqual(evidence.approved_console_owners, [
    "fixtures/package/authenticated-http-smoke.mjs",
    "fixtures/package/database-facts.mjs",
    "fixtures/package/filesystem-facts.mjs",
    "fixtures/package/http-facts.mjs",
    "scripts/package-proof/prove-compose-service.mjs",
    "test/operator-browser-smoke.test.js",
  ]);
  assert.deepEqual(evidence.approved_environment_owners, [
    "scripts/package-proof/package-fixture.mjs",
    "scripts/release-canary/run-paid-codex.mjs",
    "src/healthcheck.js",
    "src/main.js",
    "test/operator-browser-smoke.test.js",
    "scripts/release-canary/run-private-github.mjs",
  ]);
  assert.equal(evidence.final_outcome, "pass");
});
