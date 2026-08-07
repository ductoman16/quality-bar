import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { tmpdir } from "node:os";

import { readPrivateGitHubCanaryConfiguration } from "../scripts/verification/private-github-canary-configuration.mjs";
import {
  invokePrivateGitHubCanary,
  mergePrivateGitHubCanaryEvidence,
} from "../scripts/verification/private-github-canary.mjs";
import { createGateDefinitions } from "../scripts/verification/gate-definitions.mjs";
import { privateGitHubPass } from "./release-canary-test-fixtures.js";

const base = "a".repeat(40);
const head = "b".repeat(40);
const fixture = {
  fixture_id: "private-github-canary-fixture-v1",
  installation_id: 73,
  repository: { full_name: "operator/private-canary", id: 101 },
  pull_request: {
    base,
    head,
    inline: { line: 1, path: "canary.txt", side: "RIGHT" },
    number: 17,
  },
  target_origin: "https://quality-bar.example",
};

function credential() {
  return {
    app_id: 47,
    app_slug: "quality-bar-canary",
    client_id: "Iv1.client",
    owner: { id: 91, login: "operator", type: "User" },
    pem: "secret private key",
  };
}

test("one private GitHub canary self-judges every live adapter surface and reconciliation", async () => {
  /** @type {any[][]} */
  const calls = [];
  const identities = { aggregate: 701, inline: 702, status: 703 };
  const verifier = {
    async verifyInstallation() {
      const installationId = arguments[1];
      const repositoryIds = arguments[2];
      calls.push(["authentication", installationId, repositoryIds]);
      return {
        repositories: [
          {
            full_name: fixture.repository.full_name,
            id: fixture.repository.id,
            private: true,
          },
        ],
      };
    },
    async listPullRequests() {
      calls.push(["polling"]);
      return [
        {
          base: { sha: base },
          draft: false,
          head: { sha: head },
          merged_at: null,
          number: 17,
          state: "open",
        },
      ];
    },
    async reconcileCommitStatus() {
      calls.push(["reconcile-status"]);
      return calls.filter(([name]) => name === "publish-status").length
        ? identities.status
        : null;
    },
    async publishCommitStatus() {
      const input = arguments[3];
      calls.push(["publish-status", input]);
      return identities.status;
    },
    async reconcileAggregateFeedback() {
      calls.push(["reconcile-aggregate"]);
      return calls.filter(([name]) => name === "publish-aggregate").length
        ? identities.aggregate
        : null;
    },
    async publishAggregateFeedback() {
      const body = arguments[4];
      calls.push(["publish-aggregate", body]);
      return identities.aggregate;
    },
    async reconcileInlineFeedback() {
      calls.push(["reconcile-inline"]);
      return calls.filter(([name]) => name === "publish-inline").length
        ? identities.inline
        : null;
    },
    async publishInlineFeedback() {
      const comment = arguments[4];
      calls.push(["publish-inline", comment]);
      return identities.inline;
    },
  };

  const evidence = await invokePrivateGitHubCanary({
    applicationVersion: "1.2.3",
    credential: credential(),
    fixture,
    gitVersion: "2.54.0",
    now: (() => {
      const values = [1_700_000_000_000, 1_700_000_000_123];
      return () => values.shift() ?? 0;
    })(),
    sourceCommit: "c".repeat(40),
    verifier,
  });

  assert.equal(evidence.outcome, "pass");
  assert.equal(JSON.stringify(evidence).includes("secret private key"), false);
  assert.deepEqual(evidence.observations, {
    authentication: "verified",
    polling: "verified",
    exactHead: head,
    status: identities.status,
    aggregate: identities.aggregate,
    inline: identities.inline,
    reconciliation: "idempotent",
  });
  assert.equal(calls.filter(([name]) => name.startsWith("publish-")).length, 3);
  assert.equal(
    calls.filter(([name]) => name.startsWith("reconcile-")).length,
    6,
  );
});

test("a repeated canary reconciles the same identities without duplicate writes", async () => {
  let writes = 0;
  const verifier = {
    async verifyInstallation() {
      return { repositories: [{ ...fixture.repository, private: true }] };
    },
    async listPullRequests() {
      return [
        {
          base: { sha: base },
          draft: false,
          head: { sha: head },
          merged_at: null,
          number: 17,
          state: "open",
        },
      ];
    },
    async reconcileCommitStatus() {
      return 703;
    },
    async reconcileAggregateFeedback() {
      return 701;
    },
    async reconcileInlineFeedback() {
      return 702;
    },
    async publishCommitStatus() {
      writes += 1;
    },
    async publishAggregateFeedback() {
      writes += 1;
    },
    async publishInlineFeedback() {
      writes += 1;
    },
  };

  const evidence = await invokePrivateGitHubCanary({
    credential: credential(),
    fixture,
    now: () => 1_700_000_000_000,
    verifier,
  });
  assert.equal(evidence.outcome, "pass");
  assert.equal(writes, 0);
});

test("a stale or incomplete pull request fails with the exact owning error and no writes", async () => {
  let writes = 0;
  const verifier = {
    async verifyInstallation() {
      return { repositories: [{ ...fixture.repository, private: true }] };
    },
    async listPullRequests() {
      return [
        {
          base: { sha: base },
          draft: false,
          head: { sha: "d".repeat(40) },
          merged_at: null,
          number: 17,
          state: "open",
        },
      ];
    },
    async publishCommitStatus() {
      writes += 1;
    },
  };
  const evidence = await invokePrivateGitHubCanary({
    credential: credential(),
    fixture,
    now: () => 1_700_000_000_000,
    verifier,
  });
  assert.equal(evidence.outcome, "fail");
  assert.deepEqual(evidence.failure, {
    code: "private_github_canary_pull_request_mismatch",
    detail: "dedicated pull request does not match the frozen fixture",
  });
  assert.equal(evidence.observations, null);
  assert.equal(writes, 0);
});

test("a status that GitHub creates but cannot reconcile fails at the owning surface", async () => {
  const verifier = {
    async verifyInstallation() {
      return { repositories: [{ ...fixture.repository, private: true }] };
    },
    async listPullRequests() {
      return [
        {
          base: { sha: base },
          draft: false,
          head: { sha: head },
          merged_at: null,
          number: 17,
          state: "open",
        },
      ];
    },
    async reconcileCommitStatus() {
      return null;
    },
    async publishCommitStatus() {
      return 703;
    },
  };
  const evidence = await invokePrivateGitHubCanary({
    credential: credential(),
    fixture,
    now: () => 1_700_000_000_000,
    verifier,
  });
  assert.equal(evidence.outcome, "fail");
  assert.equal(
    evidence.failure?.code,
    "private_github_canary_status_reconciliation_failed",
  );
  assert.equal(evidence.observations, null);
});

test("shared evidence accepts only a passing same-commit cost-free manifest", () => {
  const sourceCommit = "c".repeat(40);
  const canary = privateGitHubPass({ sourceCommit });
  const manifest = {
    evidenceVersion: 1,
    sourceCommit,
    outcome: "pass",
    failures: [],
    verification: { kind: "cost-free" },
  };
  assert.deepEqual(
    mergePrivateGitHubCanaryEvidence(manifest, canary).releaseCanaries,
    { privateGitHub: canary },
  );
  assert.throws(
    () =>
      mergePrivateGitHubCanaryEvidence(
        { ...manifest, outcome: "fail" },
        canary,
      ),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "private_github_canary_cost_free_evidence_invalid",
  );
  assert.throws(
    () =>
      mergePrivateGitHubCanaryEvidence(manifest, {
        ...canary,
        sourceCommit: "d".repeat(40),
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "private_github_canary_source_commit_mismatch",
  );
  assert.throws(
    () =>
      mergePrivateGitHubCanaryEvidence(
        {
          ...manifest,
          releaseCanaries: { paidCodex: { kind: "paid-codex-canary" } },
        },
        canary,
      ),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "private_github_canary_cost_free_evidence_invalid",
  );
});

test("credential loading requires a private key outside the checkout", () => {
  const directory = mkdtempSync(join(tmpdir(), "private-github-canary-test-"));
  const checkout = join(directory, "checkout");
  const keyPath = join(directory, "app.pem");
  const configurationPath = join(directory, "canary.json");
  try {
    mkdirSync(checkout);
    writeFileSync(keyPath, "private key", { mode: 0o600 });
    chmodSync(keyPath, 0o600);
    writeFileSync(
      configurationPath,
      JSON.stringify({
        credential: {
          app_id: 47,
          app_slug: "quality-bar-canary",
          client_id: null,
          owner: { id: 91, login: "operator", type: "User" },
          pem_path: keyPath,
        },
        fixture,
      }),
    );
    const loaded = readPrivateGitHubCanaryConfiguration(checkout, {
      QUALITY_BAR_PRIVATE_GITHUB_CANARY_CONFIG: configurationPath,
    });
    assert.equal(loaded.credential.pem, "private key");
    assert.equal(JSON.stringify(loaded).includes(keyPath), false);

    chmodSync(keyPath, 0o644);
    assert.throws(
      () =>
        readPrivateGitHubCanaryConfiguration(checkout, {
          QUALITY_BAR_PRIVATE_GITHUB_CANARY_CONFIG: configurationPath,
        }),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "private_github_canary_credential_path_invalid",
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the explicit live canary is absent from every routine gate", () => {
  const packageMetadata = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
  );
  assert.equal(
    packageMetadata.scripts["canary:private-github"],
    "node scripts/run-with-exact-node.mjs scripts/verification/run-private-github-canary.mjs",
  );
  assert.equal(
    JSON.stringify(
      createGateDefinitions({
        applicationVersion: "1.2.3",
        coverageToolVersion: "12.0.0",
        eslintPluginNodeVersion: "18.2.2",
        eslintVersion: "9.39.1",
        formatterVersion: "3.7.4",
        jsonSchemaFormatsVersion: "3.0.1",
        jsonSchemaValidatorVersion: "8.20.0",
        openApiValidatorVersion: "2.9.0",
        typeCheckerVersion: "7.0.2",
      }),
    ).includes("canary:private-github"),
    false,
  );

  const evidence = JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        "../evidence/quality-foundation/issue-126-private-github-canary.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(evidence.proof, ["private-github-canary"]);
  assert.deepEqual(evidence.routine_gate_membership, []);
  assert.equal(evidence.new_e2e_scenarios, 0);
  assert.equal("live_blocker" in evidence, false);
  assert.equal(evidence.final_outcome, "pass");
});
