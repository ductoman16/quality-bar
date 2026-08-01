import assert from "node:assert/strict";

/** @param {{api: Function, baseUrl: string, core: any, currentTime: number, service: any, token: string}} input */
export async function assertForgejoPublication({
  api,
  baseUrl,
  core,
  currentTime,
  service,
  token,
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
    "INSERT INTO evaluation_results (evaluation_id, outcome, completed_at) VALUES (?, 'clear', ?)",
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
  assert.equal(statuses[0].status, "success");
  const comments = await api(
    baseUrl,
    `/api/v1/repos/operator/private/issues/${completedEvaluation.pull_request_number}/comments`,
    `token ${token}`,
  );
  assert.match(comments.at(-1).body, /Outcome: clear/);
  assert.match(
    comments.at(-1).body,
    new RegExp(completedEvaluation.head_commit),
  );
}
