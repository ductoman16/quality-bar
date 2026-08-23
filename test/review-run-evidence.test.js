import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import {
  createReviewRunEvidenceService,
  readTerminalTokenCounters,
} from "../src/review/review-run-evidence.js";
import { createReviewRunClaimService } from "../src/review/review-run-claim.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

test("reads only exact supplied counters from the terminal Codex JSONL event", () => {
  assert.deepEqual(
    readTerminalTokenCounters(
      [
        '{"type":"thread.started","thread_id":"thread-1"}',
        '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":45,"output_tokens":30}}',
        "",
      ].join("\n"),
    ),
    {
      cached_input_tokens: 45,
      input_tokens: 120,
      output_tokens: 30,
    },
  );

  assert.deepEqual(
    readTerminalTokenCounters(
      '{"type":"turn.completed","usage":{"input_tokens":120,"output_tokens":30}}\n',
    ),
    {
      cached_input_tokens: null,
      input_tokens: 120,
      output_tokens: 30,
    },
  );
});

test("missing, malformed, or nonterminal counters remain unavailable", () => {
  for (const transcript of [
    "",
    "not-json\n",
    '{"type":"item.completed","usage":{"input_tokens":1,"output_tokens":2}}\n',
    '{"type":"turn.completed","usage":{"input_tokens":-1,"output_tokens":2}}\n',
  ]) {
    assert.deepEqual(readTerminalTokenCounters(transcript), {
      cached_input_tokens: null,
      input_tokens: null,
      output_tokens: null,
    });
  }
});

test("started Review Runs append exact transcript chunks and retain terminal process facts", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-evidence-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  await createQueuedReviewRun(core);
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => "evidence-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);

  claims.start(claim, "0.145.0");
  const evidence = createReviewRunEvidenceService(core);
  evidence.appendTranscriptChunk(
    claim,
    "stdout",
    '{"type":"thread.started"}\n',
  );
  evidence.appendTranscriptChunk(
    claim,
    "stdout",
    '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":45,"output_tokens":30}}\n',
  );
  evidence.appendTranscriptChunk(claim, "stderr", "pinned diagnostic\n");
  evidence.complete(claim, {
    exitCode: null,
    signal: "SIGTERM",
    tokenCounters: {
      cached_input_tokens: 45,
      input_tokens: 120,
      output_tokens: 30,
    },
  });

  assert.deepEqual(
    core.all(
      `SELECT sequence, stream, content
       FROM review_run_transcript_chunks
       ORDER BY sequence`,
    ),
    [
      {
        content: '{"type":"thread.started"}\n',
        sequence: 1,
        stream: "stdout",
      },
      {
        content:
          '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":45,"output_tokens":30}}\n',
        sequence: 2,
        stream: "stdout",
      },
      {
        content: "pinned diagnostic\n",
        sequence: 3,
        stream: "stderr",
      },
    ],
  );
  assert.deepEqual(
    core.get(
      `SELECT codex_cli_version, process_exit_code, process_signal,
              input_tokens, cached_input_tokens, output_tokens
       FROM review_runs WHERE id = ?`,
      claim.workId,
    ),
    {
      cached_input_tokens: 45,
      codex_cli_version: "0.145.0",
      input_tokens: 120,
      output_tokens: 30,
      process_exit_code: null,
      process_signal: "SIGTERM",
    },
  );
});
