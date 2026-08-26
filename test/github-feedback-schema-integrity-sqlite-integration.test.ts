import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { arrangeGitHubFeedback as arrange } from "./github-feedback-publication-support.ts";

test("durable feedback cannot move or cross its frozen Evaluation", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-feedback-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  const { head } = arrange(core);
  const laterHead = "3".repeat(40);
  core.run(
    `INSERT INTO evaluations (
       id, repository_id, provenance,
       base_selector_type, base_selector_value,
       head_selector_type, head_selector_value,
       base_commit, head_commit, execution_status, created_at, completed_at
     ) VALUES (
       'evaluation-2', 'repository-1', 'explicit',
       'commit', ?, 'commit', ?, ?, ?, 'completed', 4, 5
     )`,
    head,
    laterHead,
    head,
    laterHead,
  );
  core.run(
    `INSERT INTO github_automatic_evaluations (
       evaluation_id, repository_id, pull_request_number,
       base_commit, head_commit
     ) VALUES ('evaluation-2', 'repository-1', 17, ?, ?)`,
    head,
    laterHead,
  );
  core.run(
    "INSERT INTO evaluation_results (evaluation_id, outcome, completed_at) VALUES ('evaluation-2', 'clear', 5)",
  );

  assert.throws(
    () =>
      core.run(
        `INSERT INTO github_finding_feedback (
           finding_id, evaluation_id, publication_status
         ) VALUES (
           'finding-whole', 'evaluation-2', 'aggregate_only'
         )`,
      ),
    /github_finding_feedback_evaluation_mismatch/,
  );
  core.run(
    `INSERT INTO github_finding_feedback (
       finding_id, evaluation_id, publication_status
     ) VALUES (
       'finding-whole', 'evaluation-1', 'aggregate_only'
     )`,
  );
  assert.throws(
    () =>
      core.run(
        `UPDATE github_finding_feedback
         SET publication_status = 'waiting',
             path = 'src/example.js', side = 'RIGHT', line = 1
         WHERE finding_id = 'finding-whole'`,
      ),
    /github_finding_feedback_immutable/,
  );
  core.run(
    `INSERT INTO github_finding_feedback (
       finding_id, evaluation_id, publication_status,
       path, side, start_line, start_side, line
     ) VALUES (
       'finding-inline', 'evaluation-1', 'waiting',
       'src/example.js', 'LEFT', 1, 'RIGHT', 2
     )`,
  );
  assert.throws(
    () =>
      core.run(
        `UPDATE github_finding_feedback
         SET line = 3
         WHERE finding_id = 'finding-inline'`,
      ),
    /github_finding_feedback_immutable/,
  );
  core.run(
    `UPDATE github_feedback_bundles
     SET publication_status = 'succeeded',
         external_id = 701, published_at = 6
     WHERE evaluation_id = 'evaluation-1'`,
  );
  assert.throws(
    () =>
      core.run(
        `UPDATE github_feedback_bundles
         SET external_id = 702
         WHERE evaluation_id = 'evaluation-1'`,
      ),
    /github_feedback_bundle_immutable/,
  );
});
