import assert from "node:assert/strict";
import { test } from "node:test";

import { invokePaidCodexCanary } from "../scripts/release-canary/paid-codex.mjs";

const sourceCommit = "a".repeat(40);

/** @param {{afterAcceptance?: string, beforeAcceptance: string}} events */
async function invokeAccepted(events) {
  return await invokePaidCodexCanary({
    applicationVersion: "1.2.3",
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
      evidenceService.appendTranscriptChunk(
        claim,
        "stdout",
        events.beforeAcceptance,
      );
      resultService.prepare(claim, {
        criterion_results: [
          { criterion_id: "paid-codex-canary", outcome: "clear" },
        ],
      });
      if (events.afterAcceptance) {
        evidenceService.appendTranscriptChunk(
          claim,
          "stdout",
          events.afterAcceptance,
        );
      }
      return { diagnosticFailures: [] };
    },
    sourceCommit,
    sourceStatus: "",
  });
}

test("correlates acceptance with an exact submission command event", async () => {
  const evidence = await invokeAccepted({
    beforeAcceptance:
      '{"type":"turn.started"}\n{"type":"item.started","item":{"id":"submission-1","type":"command_execution","command":"quality-bar-submit .quality-bar-result.json"}}\n',
    afterAcceptance:
      '{"type":"item.completed","item":{"id":"submission-1","type":"command_execution","command":"quality-bar-submit .quality-bar-result.json","status":"completed","exit_code":0}}\n',
  });
  assert.equal(evidence.outcome, "pass");
  assert.equal(evidence.observations?.submissionCommand, "accepted");
});

test("does not infer ACK settlement from command start alone", async () => {
  const evidence = await invokeAccepted({
    beforeAcceptance:
      '{"type":"turn.started"}\n{"type":"item.started","item":{"id":"submission-1","type":"command_execution","command":"quality-bar-submit .quality-bar-result.json"}}\n',
  });
  assert.equal(evidence.outcome, "fail");
  assert.equal(
    evidence.failure?.code,
    "paid_codex_canary_event_evidence_missing",
  );
});

test("requires successful command completion after server acceptance", async () => {
  const evidence = await invokeAccepted({
    beforeAcceptance:
      '{"type":"turn.started"}\n{"type":"item.started","item":{"id":"submission-1","type":"command_execution","command":"quality-bar-submit .quality-bar-result.json"}}\n{"type":"item.completed","item":{"id":"submission-1","type":"command_execution","command":"quality-bar-submit .quality-bar-result.json","status":"completed","exit_code":0}}\n',
  });
  assert.equal(evidence.outcome, "fail");
  assert.equal(
    evidence.failure?.code,
    "paid_codex_canary_event_evidence_missing",
  );
});

test("does not combine different command execution identities", async () => {
  const evidence = await invokeAccepted({
    beforeAcceptance:
      '{"type":"turn.started"}\n{"type":"item.started","item":{"id":"submission-a","type":"command_execution","command":"quality-bar-submit .quality-bar-result.json"}}\n',
    afterAcceptance:
      '{"type":"item.completed","item":{"id":"submission-b","type":"command_execution","command":"quality-bar-submit .quality-bar-result.json","status":"completed","exit_code":0}}\n',
  });
  assert.equal(evidence.outcome, "fail");
  assert.equal(
    evidence.failure?.code,
    "paid_codex_canary_event_evidence_missing",
  );
});

test("accepts Codex's exact non-login shell display wrapper", async () => {
  const evidence = await invokeAccepted({
    beforeAcceptance:
      '{"type":"turn.started"}\n{"type":"item.started","item":{"id":"submission-1","type":"command_execution","command":"/bin/zsh -c \'quality-bar-submit .quality-bar-result.json\'","status":"in_progress","exit_code":null}}\n',
    afterAcceptance:
      '{"type":"item.completed","item":{"id":"submission-1","type":"command_execution","command":"/bin/zsh -c \'quality-bar-submit .quality-bar-result.json\'","status":"completed","exit_code":0}}\n',
  });
  assert.equal(evidence.outcome, "pass");
  assert.equal(evidence.observations?.submissionCommand, "accepted");
});

test("rejects an explicitly failed submission command event", async () => {
  const evidence = await invokeAccepted({
    beforeAcceptance:
      '{"type":"turn.started"}\n{"type":"item.completed","item":{"id":"submission-1","type":"command_execution","command":"quality-bar-submit .quality-bar-result.json","status":"failed","exit_code":1}}\n',
  });
  assert.equal(evidence.outcome, "fail");
  assert.equal(
    evidence.failure?.code,
    "paid_codex_canary_event_evidence_missing",
  );
});

test("rejects a wrapper command that merely contains the submission command", async () => {
  const evidence = await invokeAccepted({
    beforeAcceptance: `{"type":"turn.started"}\n${JSON.stringify({
      type: "item.started",
      item: {
        id: "submission-1",
        type: "command_execution",
        command:
          "/bin/zsh -c 'quality-bar-submit .quality-bar-result.json; true'",
      },
    })}\n`,
  });
  assert.equal(evidence.outcome, "fail");
  assert.equal(
    evidence.failure?.code,
    "paid_codex_canary_event_evidence_missing",
  );
});

test("does not correlate a command event emitted after acceptance", async () => {
  const evidence = await invokeAccepted({
    beforeAcceptance: '{"type":"turn.started"}\n',
    afterAcceptance:
      '{"type":"item.started","item":{"id":"submission-1","type":"command_execution","command":"quality-bar-submit .quality-bar-result.json"}}\n',
  });
  assert.equal(evidence.outcome, "fail");
  assert.equal(
    evidence.failure?.code,
    "paid_codex_canary_event_evidence_missing",
  );
});

test("rejects a correlated submission command that fails after acceptance", async () => {
  const evidence = await invokeAccepted({
    beforeAcceptance:
      '{"type":"turn.started"}\n{"type":"item.started","item":{"id":"submission-1","type":"command_execution","command":"quality-bar-submit .quality-bar-result.json"}}\n',
    afterAcceptance:
      '{"type":"item.completed","item":{"id":"submission-1","type":"command_execution","command":"quality-bar-submit .quality-bar-result.json","status":"failed","exit_code":1}}\n',
  });
  assert.equal(evidence.outcome, "fail");
  assert.equal(
    evidence.failure?.code,
    "paid_codex_canary_event_evidence_missing",
  );
});

test("rejects malformed event output emitted after acceptance", async () => {
  const evidence = await invokeAccepted({
    beforeAcceptance:
      '{"type":"turn.started"}\n{"type":"item.started","item":{"id":"submission-1","type":"command_execution","command":"quality-bar-submit .quality-bar-result.json"}}\n',
    afterAcceptance: "not-json\n",
  });
  assert.equal(evidence.outcome, "fail");
  assert.equal(
    evidence.failure?.code,
    "paid_codex_canary_event_protocol_invalid",
  );
});

test("persists only bounded allowlisted process diagnostics", async () => {
  const sentinel = "secret-event-and-status-sentinel";
  const line = `${JSON.stringify({
    type: sentinel,
    item: {
      type: "command_execution",
      command: sentinel,
      status: sentinel,
      exit_code: 1,
    },
  })}\n`;
  const evidence = await invokePaidCodexCanary({
    now: () => 1_700_000_000_000,
    readCodexVersion: () => "codex-cli 0.145.0",
    runCodex: async () => {
      throw Object.assign(new Error("unsafe"), {
        cause: {
          code: 1,
          signal: sentinel,
          stderr: sentinel.repeat(1_000),
          stdout: line.repeat(2_000),
        },
        code: "result_not_submitted",
      });
    },
    sourceCommit,
    sourceStatus: "",
  });
  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes(sentinel), false);
  assert.ok(Buffer.byteLength(serialized) < 4_096);
  assert.equal("eventTypes" in (evidence.failure?.diagnostics ?? {}), false);
  assert.equal(evidence.failure?.diagnostics?.eventsTruncated, true);
});

test("does not trust a provider-spoofed canary code to expose detail", async () => {
  const sentinel = "secret-spoofed-canary-detail";
  const evidence = await invokePaidCodexCanary({
    now: () => 1_700_000_000_000,
    readCodexVersion: () => "codex-cli 0.145.0",
    runCodex: async () => {
      throw Object.assign(new Error(sentinel), {
        code: "paid_codex_canary_provider_spoof",
      });
    },
    sourceCommit,
    sourceStatus: "",
  });
  assert.equal(evidence.failure?.code, "paid_codex_canary_provider_spoof");
  assert.equal(evidence.failure?.detail, "paid Codex canary failed");
  assert.equal(JSON.stringify(evidence).includes(sentinel), false);
});
