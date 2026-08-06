import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  invokePaidCodexCanary,
  mergePaidCodexCanaryEvidence,
} from "../scripts/verification/paid-codex-canary-invocation.mjs";
import { mergePrivateGitHubCanaryEvidence } from "../scripts/verification/private-github-canary.mjs";
import {
  paidCodexFailure,
  paidCodexPass,
  privateGitHubPass,
  releaseCanarySourceCommit,
} from "./release-canary-test-fixtures.js";

const sourceCommit = releaseCanarySourceCommit;

function costFreeManifest() {
  return {
    evidenceVersion: 1,
    failures: [],
    outcome: "pass",
    sourceCommit,
    verification: { kind: "cost-free" },
  };
}

function privateGitHubCanary() {
  return privateGitHubPass();
}

test("paid Codex canary passes only after the fixed candidate reaches the accepted submission seam", async () => {
  /** @type {any[]} */
  const calls = [];
  /** @type {number[]} */
  const trackedProcessGroups = [];
  const evidence = await invokePaidCodexCanary({
    applicationVersion: "1.2.3",
    now: (() => {
      const values = [1_700_000_000_000, 1_700_000_000_123];
      return () => values.shift() ?? 0;
    })(),
    readCodexVersion: () => "codex-cli 0.145.0",
    runCodex: async ({
      claim,
      evidenceService,
      finishProcessGroup,
      resultService,
      run,
      startProcessGroup,
      terminateOnParentDisconnect,
    }) => {
      calls.push({ claim, run, terminateOnParentDisconnect });
      startProcessGroup(71);
      assert.ok(evidenceService);
      evidenceService.appendTranscriptChunk(
        claim,
        "stdout",
        '{"type":"thread.started"}\n{"type":"turn.started"}\n',
      );
      evidenceService.appendTranscriptChunk(
        claim,
        "stdout",
        '{"type":"item.started","item":{"id":"submission-1","type":"command_execution","command":"quality-bar-submit .quality-bar-result.json"}}\n',
      );
      resultService.prepare(claim, {
        criterion_results: [
          { criterion_id: "paid-codex-canary", outcome: "clear" },
        ],
      });
      evidenceService.appendTranscriptChunk(
        claim,
        "stdout",
        '{"type":"item.completed","item":{"id":"submission-1","type":"command_execution","command":"quality-bar-submit .quality-bar-result.json","status":"completed","exit_code":0}}\n',
      );
      finishProcessGroup();
      return { diagnosticFailures: [] };
    },
    sourceCommit,
    sourceStatus: "",
    trackProcessGroup(processGroupId) {
      trackedProcessGroups.push(processGroupId);
    },
  });

  assert.equal(evidence.outcome, "pass");
  assert.deepEqual(evidence.failure, null);
  assert.deepEqual(evidence.fixture, {
    id: "paid-codex-canary-fixture-v1",
    file: "reviewed.txt",
  });
  assert.equal(evidence.versions.codex, "codex-cli 0.145.0");
  assert.deepEqual(evidence.observations, {
    acceptedSubmission: true,
    eventProtocol: "jsonl",
    processGroup: "started",
    submissionCommand: "accepted",
    turnStarted: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].claim.workerId, "paid-codex-canary");
  assert.equal(calls[0].terminateOnParentDisconnect, true);
  assert.deepEqual(trackedProcessGroups, [71]);
  assert.match(
    calls[0].run.prompt,
    /quality-bar-submit \.quality-bar-result\.json/u,
  );
  assert.match(
    calls[0].run.prompt,
    /Immediately execute exactly this shell command/u,
  );
  assert.match(calls[0].run.prompt, /already at \.quality-bar-result\.json/u);
  assert.match(calls[0].run.prompt, /one reviewable file/u);
  assert.match(calls[0].run.prompt, /no other command/u);
});

test("paid Codex canary rejects a completed process with no accepted Result", async () => {
  const evidence = await invokePaidCodexCanary({
    now: () => 1_700_000_000_000,
    readCodexVersion: () => "codex-cli 0.145.0",
    runCodex: async ({ startProcessGroup }) => {
      startProcessGroup(71);
      return { diagnosticFailures: [] };
    },
    sourceCommit,
    sourceStatus: "",
  });

  assert.equal(evidence.outcome, "fail");
  assert.deepEqual(evidence.failure, {
    code: "paid_codex_canary_submission_missing",
    detail: "paid Codex canary did not accept a complete candidate Result",
  });
  assert.equal(evidence.sourceCommit, sourceCommit);
});

test("paid Codex canary fences a dirty source tree before provider launch", async () => {
  let launches = 0;
  const evidence = await invokePaidCodexCanary({
    now: () => 1_700_000_000_000,
    readCodexVersion: () => "codex-cli 0.145.0",
    runCodex: async () => {
      launches += 1;
      return { diagnosticFailures: [] };
    },
    sourceCommit,
    sourceStatus: " M scripts/verification/paid-codex-canary-invocation.mjs",
  });

  assert.equal(launches, 0);
  assert.deepEqual(evidence.failure, {
    code: "paid_codex_canary_source_dirty",
    detail: "paid Codex canary source tree must be clean",
  });
});

test("paid Codex canary does not infer a clean source when status is omitted", async () => {
  let launches = 0;
  const evidence = await invokePaidCodexCanary(
    /** @type {any} */ ({
      now: () => 1_700_000_000_000,
      readCodexVersion: () => "codex-cli 0.145.0",
      runCodex: async () => {
        launches += 1;
        return { diagnosticFailures: [] };
      },
      sourceCommit,
    }),
  );

  assert.equal(launches, 0);
  assert.deepEqual(evidence.failure, {
    code: "paid_codex_canary_source_dirty",
    detail: "paid Codex canary source tree must be clean",
  });
});

test("paid Codex canary fences an unpinned CLI before provider launch", async () => {
  let launches = 0;
  const evidence = await invokePaidCodexCanary({
    now: () => 1_700_000_000_000,
    readCodexVersion: () => "codex-cli 0.144.0",
    runCodex: async () => {
      launches += 1;
      return { diagnosticFailures: [] };
    },
    sourceCommit,
    sourceStatus: "",
  });

  assert.equal(launches, 0);
  assert.deepEqual(evidence.failure, {
    code: "paid_codex_canary_version_unsupported",
    detail: "paid Codex canary CLI version does not match the pinned catalog",
  });
});

test("paid Codex canary does not infer JSONL proof from an accepted submission", async () => {
  const evidence = await invokePaidCodexCanary({
    now: () => 1_700_000_000_000,
    readCodexVersion: () => "codex-cli 0.145.0",
    runCodex: async ({ claim, resultService, startProcessGroup }) => {
      startProcessGroup(71);
      resultService.prepare(claim, {
        criterion_results: [
          { criterion_id: "paid-codex-canary", outcome: "clear" },
        ],
      });
      return { diagnosticFailures: [] };
    },
    sourceCommit,
    sourceStatus: "",
  });

  assert.deepEqual(evidence.failure, {
    code: "paid_codex_canary_event_evidence_missing",
    detail: "paid Codex canary JSONL event evidence is incomplete",
  });
});

test("paid Codex canary rejects malformed event output after submission", async () => {
  const evidence = await invokePaidCodexCanary({
    now: () => 1_700_000_000_000,
    readCodexVersion: () => "codex-cli 0.145.0",
    runCodex: async ({
      claim,
      evidenceService,
      resultService,
      startProcessGroup,
    }) => {
      startProcessGroup(71);
      assert.ok(evidenceService);
      evidenceService.appendTranscriptChunk(claim, "stdout", "not-json\n");
      resultService.prepare(claim, {
        criterion_results: [
          { criterion_id: "paid-codex-canary", outcome: "clear" },
        ],
      });
      return { diagnosticFailures: [] };
    },
    sourceCommit,
    sourceStatus: "",
  });

  assert.deepEqual(evidence.failure, {
    code: "paid_codex_canary_event_protocol_invalid",
    detail: "paid Codex canary stdout is not valid JSONL event output",
  });
});

test("paid Codex canary preserves the adapter's owning failure without exposing diagnostics", async () => {
  const evidence = await invokePaidCodexCanary({
    now: () => 1_700_000_000_000,
    readCodexVersion: () => "codex-cli 0.145.0",
    runCodex: async () => {
      throw Object.assign(new Error("credential value must not escape"), {
        code: "authentication_failed",
      });
    },
    sourceCommit,
    sourceStatus: "",
  });

  assert.equal(evidence.outcome, "fail");
  assert.equal(evidence.failure?.code, "authentication_failed");
  assert.equal(evidence.failure?.detail, "Codex host login is unavailable");
});

test("paid Codex canary reports bounded process diagnostics without transcript contents", async () => {
  const evidence = await invokePaidCodexCanary({
    now: () => 1_700_000_000_000,
    readCodexVersion: () => "codex-cli 0.145.0",
    runCodex: async () => {
      const error = Object.assign(new Error("unsafe transcript"), {
        cause: {
          code: 0,
          signal: null,
          stderr: "secret stderr",
          stdout:
            '{"type":"turn.started"}\n{"type":"item.completed","item":{"type":"command_execution"}}\n',
        },
        code: "result_not_submitted",
      });
      throw error;
    },
    sourceCommit,
    sourceStatus: "",
  });

  assert.deepEqual(evidence.failure, {
    code: "result_not_submitted",
    detail: "Codex Review Run did not submit an accepted Result",
    diagnostics: {
      commandExecutions: 1,
      eventsInspected: 2,
      eventsTruncated: false,
      exactSubmissionCommandEvents: 0,
      exitCode: 0,
      failedCommandExecutions: 0,
      invalidJsonlLines: 0,
      knownEventCounts: {
        itemCompleted: 1,
        itemStarted: 0,
        threadStarted: 0,
        turnCompleted: 0,
        turnFailed: 0,
        turnStarted: 1,
      },
      signaled: false,
      stderrBytes: 13,
      stdoutBytes: 86,
      unknownEventTypes: 0,
    },
  });
  assert.equal(JSON.stringify(evidence).includes("secret"), false);
});

test("release evidence retains private GitHub and paid Codex proof in either invocation order", () => {
  const paidCodex = paidCodexPass();
  const privateThenPaid = mergePaidCodexCanaryEvidence(
    mergePrivateGitHubCanaryEvidence(costFreeManifest(), privateGitHubCanary()),
    paidCodex,
  );
  const paidThenPrivate = mergePrivateGitHubCanaryEvidence(
    mergePaidCodexCanaryEvidence(costFreeManifest(), paidCodex),
    privateGitHubCanary(),
  );

  for (const manifest of [privateThenPaid, paidThenPrivate]) {
    assert.deepEqual(manifest.releaseCanaries, {
      paidCodex,
      privateGitHub: privateGitHubCanary(),
    });
  }
});

test("a failed retry replaces stale passing paid evidence", () => {
  const privateGitHub = privateGitHubCanary();
  const failedPaidCodex = paidCodexFailure();
  const merged = mergePaidCodexCanaryEvidence(
    {
      ...costFreeManifest(),
      releaseCanaries: {
        paidCodex: paidCodexPass(),
        privateGitHub,
      },
    },
    failedPaidCodex,
  );
  assert.deepEqual(merged.releaseCanaries, {
    paidCodex: failedPaidCodex,
    privateGitHub,
  });
});

test("paid publication rejects incomplete retained release evidence", () => {
  assert.throws(
    () =>
      mergePaidCodexCanaryEvidence(
        {
          ...costFreeManifest(),
          releaseCanaries: {
            privateGitHub: { kind: "private-github-canary" },
          },
        },
        paidCodexPass(),
      ),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "paid_codex_canary_cost_free_evidence_invalid",
  );
});

test("the explicit paid canary remains outside every routine gate", () => {
  const repositoryRoot = resolve(import.meta.dirname, "..");
  const packageMetadata = JSON.parse(
    readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
  );
  assert.equal(
    packageMetadata.scripts["canary:paid-codex"],
    "node scripts/run-with-exact-node.mjs scripts/verification/run-paid-codex-canary.mjs",
  );
  const ownership = JSON.parse(
    readFileSync(
      resolve(
        repositoryRoot,
        "evidence/quality-foundation/issue-125-paid-codex-canary.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(ownership.proof, ["paid-codex-canary"]);
  assert.deepEqual(ownership.routine_gate_membership, []);
  assert.equal(ownership.new_e2e_scenarios, 0);
  assert.equal(ownership.final_outcome, "pending");
});
