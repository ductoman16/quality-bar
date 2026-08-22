import assert from "node:assert/strict";

import { createWaiverAdjudicationResultService } from "../src/waiver/waiver-adjudication-result-service.js";
import { createWaiverBatchService } from "../src/waiver/waiver-batch.js";

/** @param {{api: Function, baseUrl: string, core: any, currentTime: number, service: any, setCurrentTime: (value: number) => void, token: string, verifier: any}} input */
export async function assertForgejoPublication({
  api,
  baseUrl,
  core,
  currentTime,
  service,
  setCurrentTime,
  token,
  verifier,
}) {
  const completedEvaluation = core.get(
    `SELECT evaluations.id, evaluations.head_commit,
            forgejo_automatic_evaluations.pull_request_number
     FROM evaluations
     JOIN forgejo_automatic_evaluations
       ON forgejo_automatic_evaluations.evaluation_id = evaluations.id
     WHERE evaluations.execution_status = 'queued'
     ORDER BY evaluations.created_at DESC
     LIMIT 1`,
  );
  assert.ok(completedEvaluation);
  core.run(
    `INSERT INTO evaluation_file_changes (
       evaluation_id, id, added, deleted, modified, renamed,
       before_path, after_path, base_line_count, head_line_count, patch
     ) VALUES (
       ?, 'change-waiver-v16', 0, 0, 1, 0,
       'automatic-proof.txt', 'automatic-proof.txt', 1, 1,
       '@@ -1 +1 @@\n-automatic proof\n+reenabled proof\n'
     )`,
    completedEvaluation.id,
  );
  const findingFacts = core.get(
    `SELECT review_runs.id AS review_run_id,
            review_version_criteria.criterion_id,
            evaluation_file_changes.id AS file_change_id
     FROM review_runs
     JOIN review_version_criteria
       ON review_version_criteria.review_version_id =
            review_runs.review_version_id
     JOIN evaluation_file_changes
       ON evaluation_file_changes.evaluation_id = review_runs.evaluation_id
     WHERE review_runs.evaluation_id = ?
       AND evaluation_file_changes.after_path = 'automatic-proof.txt'
     LIMIT 1`,
    completedEvaluation.id,
  );
  assert.ok(findingFacts);
  core.run(
    "UPDATE review_runs SET execution_status = 'running', started_at = ? WHERE id = ?",
    currentTime,
    findingFacts.review_run_id,
  );
  core.run(
    "INSERT INTO criterion_results (review_run_id, criterion_id, outcome) VALUES (?, ?, 'triggered')",
    findingFacts.review_run_id,
    findingFacts.criterion_id,
  );
  core.run(
    `INSERT INTO findings (
       id, evaluation_id, review_run_id, criterion_id,
       evidence, remediation, location_kind, file_change_id,
       side, start_line, end_line
     ) VALUES (
       'finding-waiver-v16', ?, ?, ?,
       'Pinned v16 evidence', 'Pinned v16 remediation',
       'line_range', ?, 'head', 1, 1
     )`,
    completedEvaluation.id,
    findingFacts.review_run_id,
    findingFacts.criterion_id,
    findingFacts.file_change_id,
  );
  core.run(
    "UPDATE review_runs SET execution_status = 'completed', started_at = ?, completed_at = ? WHERE evaluation_id = ?",
    currentTime,
    currentTime,
    completedEvaluation.id,
  );
  core.run(
    "UPDATE evaluations SET execution_status = 'completed', completed_at = ? WHERE id = ?",
    currentTime,
    completedEvaluation.id,
  );
  core.run(
    "INSERT INTO evaluation_results (evaluation_id, outcome, completed_at) VALUES (?, 'advisory', ?)",
    completedEvaluation.id,
    currentTime,
  );
  await service.publishWaiting();
  const statuses = await api(
    baseUrl,
    `/api/v1/repos/operator/private/commits/${completedEvaluation.head_commit}/statuses`,
    `token ${token}`,
  );
  assert.equal(statuses[0].context, "Quality Bar");
  assert.equal(statuses[0].status, "failure");
  const comments = await api(
    baseUrl,
    `/api/v1/repos/operator/private/issues/${completedEvaluation.pull_request_number}/comments`,
    `token ${token}`,
  );
  assert.match(comments.at(-1).body, /Outcome: advisory/);
  assert.match(
    comments.at(-1).body,
    new RegExp(completedEvaluation.head_commit),
  );
  const connection = { base_url: baseUrl, token };
  const repository = { full_name: "operator/private", id: 1 };
  assert.equal(
    await verifier.reconcileCommitStatus(connection, repository, {
      description: statuses[0].description,
      head: completedEvaluation.head_commit,
      state: statuses[0].status,
      targetUrl: statuses[0].target_url,
    }),
    statuses[0].id,
  );
  assert.equal(
    await verifier.reconcileAggregateFeedback(
      connection,
      repository,
      completedEvaluation.pull_request_number,
      comments.at(-1).body,
    ),
    comments.at(-1).id,
  );
  const original = core.get(
    `SELECT external_id, path, side, start_line, start_side, line
     FROM forgejo_finding_feedback
     WHERE finding_id = 'finding-waiver-v16'`,
  );
  assert.equal(
    core.get(
      "SELECT publication_status FROM forgejo_finding_feedback WHERE finding_id = 'finding-waiver-v16'",
    )?.publication_status,
    "succeeded",
  );
  assert.ok(original);
  core.run(
    `INSERT INTO waiver_adjudicator_configuration (
       singleton, model, reasoning_effort, service_tier, updated_at
     ) VALUES (1, 'gpt-5.6-terra', 'high', 'standard', ?)`,
    currentTime,
  );
  createWaiverBatchService(core, {
    createAdjudicationId: () => "adjudication-waiver-v16",
    createRequestId: () => "request-waiver-v16",
    now: () => currentTime + 1,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "browser_session",
    evaluationId: completedEvaluation.id,
    idempotencyKey: "waiver-v16",
    request: {
      requests: [
        {
          finding_id: "finding-waiver-v16",
          rationale: "The pinned v16 exception is justified.",
        },
      ],
    },
  });
  core.run(
    `UPDATE codex_execution_queue
     SET worker_id = 'worker-waiver-v16', fencing_token = 1,
         lease_expires_at = ?, started_at = ?
     WHERE work_id = 'adjudication-waiver-v16'`,
    currentTime + 10_000,
    currentTime + 2,
  );
  core.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'running', started_at = ?,
         codex_cli_version = '0.114.0'
     WHERE id = 'adjudication-waiver-v16'`,
    currentTime + 2,
  );
  await service.publishWaiting();
  createWaiverAdjudicationResultService(core, {
    createDecisionId: () => "decision-waiver-v16",
    now: () => currentTime + 3,
  }).prepare(
    {
      fencingToken: 1,
      workerId: "worker-waiver-v16",
      workId: "adjudication-waiver-v16",
    },
    {
      decisions: [
        {
          explanation: "The pinned v16 exception is justified.",
          outcome: "accepted",
          request_id: "request-waiver-v16",
        },
      ],
    },
  );
  await service.publishWaiting();
  const local = core.get(
    `SELECT publication_status, external_id, path, side,
            start_line, start_side, line
     FROM forgejo_waiver_decision_followups
     WHERE waiver_decision_id = 'decision-waiver-v16'`,
  );
  assert.equal(local?.publication_status, "succeeded");
  assert.notEqual(local?.external_id, original.external_id);
  assert.deepEqual(
    {
      line: local?.line,
      path: local?.path,
      side: local?.side,
      start_line: local?.start_line,
      start_side: local?.start_side,
    },
    {
      line: original.line,
      path: original.path,
      side: original.side,
      start_line: original.start_line,
      start_side: original.start_side,
    },
  );
  const followups = await api(
    baseUrl,
    `/api/v1/repos/operator/private/issues/${completedEvaluation.pull_request_number}/comments`,
    `token ${token}`,
  );
  assert.match(followups.at(-1).body, /Recomputed outcome: clear/);
  await api(
    baseUrl,
    "/api/v1/users/operator/tokens/quality-bar-reactivation",
    `Basic ${Buffer.from("operator:QualityBarForgejo16!").toString("base64")}`,
    undefined,
    "DELETE",
  );
  setCurrentTime(currentTime + 60_000);
  await service.runPolling();
  assert.deepEqual(service.read()?.health_error, {
    code: "forgejo_connection_credential_invalid",
    message: "Forgejo Connection credential is invalid",
  });
  assert.equal(
    core.get("SELECT health FROM repositories LIMIT 1")?.health,
    "healthy",
  );
}
