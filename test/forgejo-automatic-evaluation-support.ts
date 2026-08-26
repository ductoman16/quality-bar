import assert from "node:assert/strict";

export async function proveForgejoAutomaticEvaluation({
  api,
  baseUrl,
  core,
  repository,
  repositoryId,
  repositories,
  service,
  setCurrentTime,
  token,
}: {
  api: Function;
  baseUrl: string;
  core: any;
  repository: any;
  repositoryId: string;
  repositories: any;
  service: any;
  setCurrentTime: (value: number) => void;
  token: string;
}) {
  const authorization = `token ${token}`;
  const commonBranch = await api(
    baseUrl,
    `/api/v1/repos/operator/private/branches/${repository.default_branch}`,
    authorization,
  );
  await api(baseUrl, "/api/v1/repos/operator/private/branches", authorization, {
    new_branch_name: "quality-bar-automatic",
    old_branch_name: repository.default_branch,
  });
  await api(
    baseUrl,
    "/api/v1/repos/operator/private/contents/automatic-proof.txt?ref=quality-bar-automatic",
    authorization,
    {
      branch: "quality-bar-automatic",
      content: Buffer.from("automatic proof\n").toString("base64"),
      message: "Add automatic proof",
    },
  );
  await api(baseUrl, "/api/v1/repos/operator/private/branches", authorization, {
    new_branch_name: "quality-bar-retarget",
    old_branch_name: "quality-bar-automatic",
  });
  await api(
    baseUrl,
    "/api/v1/repos/operator/private/contents/target-advanced.txt",
    authorization,
    {
      branch: repository.default_branch,
      content: Buffer.from("target advanced\n").toString("base64"),
      message: "Advance target",
    },
  );
  const newlyReady = await api(
    baseUrl,
    "/api/v1/repos/operator/private/pulls",
    authorization,
    {
      base: repository.default_branch,
      head: "quality-bar-automatic",
      title: "Forgejo automatic Evaluation proof",
    },
  );
  setCurrentTime(121_000);
  await service.runPolling();
  assert.deepEqual(
    core.get(
      `SELECT forgejo_automatic_evaluations.pull_request_number,
              evaluations.base_commit, evaluations.head_commit
         FROM forgejo_automatic_evaluations
         JOIN evaluations
           ON evaluations.id = forgejo_automatic_evaluations.evaluation_id`,
    ),
    {
      base_commit: newlyReady.merge_base,
      head_commit: newlyReady.head.sha,
      pull_request_number: newlyReady.number,
    },
  );
  assert.equal(newlyReady.merge_base, commonBranch.commit.id);
  assert.notEqual(newlyReady.base.sha, commonBranch.commit.id);
  const readEvaluationStatuses = () =>
    core.all(
      "SELECT execution_status FROM evaluations ORDER BY created_at, id",
    );
  assert.deepEqual(readEvaluationStatuses(), [{ execution_status: "queued" }]);

  const automaticFile = await api(
    baseUrl,
    "/api/v1/repos/operator/private/contents/automatic-proof.txt?ref=quality-bar-automatic",
    authorization,
  );
  await api(
    baseUrl,
    "/api/v1/repos/operator/private/contents/automatic-proof.txt",
    authorization,
    {
      branch: "quality-bar-automatic",
      content: Buffer.from("force-push proof\n").toString("base64"),
      message: "Force-push automatic proof",
      sha: automaticFile.sha,
    },
    "PUT",
  );
  const forcePushedPullRequest = await api(
    baseUrl,
    `/api/v1/repos/operator/private/pulls/${newlyReady.number}`,
    authorization,
  );
  setCurrentTime(181_000);
  await service.runPolling();
  assert.deepEqual(
    core.all(
      `SELECT evaluations.execution_status,
              forgejo_automatic_evaluations.pull_request_number
         FROM evaluations
         JOIN forgejo_automatic_evaluations
           ON forgejo_automatic_evaluations.evaluation_id = evaluations.id
        ORDER BY evaluations.created_at, evaluations.id`,
    ),
    [
      {
        execution_status: "cancelled",
        pull_request_number: newlyReady.number,
      },
      { execution_status: "queued", pull_request_number: newlyReady.number },
    ],
  );
  assert.deepEqual(readEvaluationStatuses(), [
    { execution_status: "cancelled" },
    { execution_status: "queued" },
  ]);

  await repositories.setLifecycle(repositoryId, { lifecycle: "disabled" });
  const disabledFile = await api(
    baseUrl,
    "/api/v1/repos/operator/private/contents/automatic-proof.txt?ref=quality-bar-automatic",
    authorization,
  );
  await api(
    baseUrl,
    "/api/v1/repos/operator/private/contents/automatic-proof.txt",
    authorization,
    {
      branch: "quality-bar-automatic",
      content: Buffer.from("disabled proof\n").toString("base64"),
      message: "Disabled repository proof",
      sha: disabledFile.sha,
    },
    "PUT",
  );
  const disabledPullRequest = await api(
    baseUrl,
    `/api/v1/repos/operator/private/pulls/${newlyReady.number}`,
    authorization,
  );
  setCurrentTime(481_000);
  await service.runPolling();
  assert.deepEqual(readEvaluationStatuses(), [
    { execution_status: "cancelled" },
    { execution_status: "queued" },
  ]);

  await repositories.setLifecycle(repositoryId, { lifecycle: "enabled" });
  assert.deepEqual(readEvaluationStatuses(), [
    { execution_status: "cancelled" },
    { execution_status: "queued" },
  ]);
  setCurrentTime(541_000);
  await service.runPolling();
  assert.deepEqual(readEvaluationStatuses(), [
    { execution_status: "cancelled" },
    { execution_status: "queued" },
  ]);

  const reenabledFile = await api(
    baseUrl,
    "/api/v1/repos/operator/private/contents/automatic-proof.txt?ref=quality-bar-automatic",
    authorization,
  );
  await api(
    baseUrl,
    "/api/v1/repos/operator/private/contents/automatic-proof.txt",
    authorization,
    {
      branch: "quality-bar-automatic",
      content: Buffer.from("reenabled proof\n").toString("base64"),
      message: "Re-enabled repository proof",
      sha: reenabledFile.sha,
    },
    "PUT",
  );
  const reenabledPullRequest = await api(
    baseUrl,
    `/api/v1/repos/operator/private/pulls/${newlyReady.number}`,
    authorization,
  );
  assert.notEqual(reenabledPullRequest.head.sha, disabledPullRequest.head.sha);
  setCurrentTime(601_000);
  await service.runPolling();
  assert.deepEqual(readEvaluationStatuses(), [
    { execution_status: "cancelled" },
    { execution_status: "cancelled" },
    { execution_status: "queued" },
  ]);

  await api(
    baseUrl,
    `/api/v1/repos/operator/private/pulls/${newlyReady.number}`,
    authorization,
    { state: "closed" },
    "PATCH",
  );
  setCurrentTime(661_000);
  await service.runPolling();
  assert.deepEqual(readEvaluationStatuses(), [
    { execution_status: "cancelled" },
    { execution_status: "cancelled" },
    { execution_status: "queued" },
  ]);

  await api(
    baseUrl,
    `/api/v1/repos/operator/private/pulls/${newlyReady.number}`,
    authorization,
    { state: "open" },
    "PATCH",
  );
  setCurrentTime(721_000);
  await service.runPolling();
  assert.deepEqual(readEvaluationStatuses(), [
    { execution_status: "cancelled" },
    { execution_status: "cancelled" },
    { execution_status: "queued" },
  ]);

  await api(
    baseUrl,
    `/api/v1/repos/operator/private/pulls/${newlyReady.number}`,
    authorization,
    { draft: true },
    "PATCH",
  );
  setCurrentTime(781_000);
  await service.runPolling();
  assert.deepEqual(readEvaluationStatuses(), [
    { execution_status: "cancelled" },
    { execution_status: "cancelled" },
    { execution_status: "queued" },
  ]);

  await api(
    baseUrl,
    `/api/v1/repos/operator/private/pulls/${newlyReady.number}`,
    authorization,
    { draft: false },
    "PATCH",
  );
  setCurrentTime(841_000);
  await service.runPolling();
  assert.deepEqual(readEvaluationStatuses(), [
    { execution_status: "cancelled" },
    { execution_status: "cancelled" },
    { execution_status: "queued" },
  ]);

  await api(
    baseUrl,
    `/api/v1/repos/operator/private/pulls/${newlyReady.number}`,
    authorization,
    { base: "quality-bar-retarget" },
    "PATCH",
  );
  setCurrentTime(901_000);
  await service.runPolling();
  assert.deepEqual(
    core.all(
      `SELECT evaluations.execution_status,
              evaluations.base_commit, evaluations.head_commit
         FROM evaluations ORDER BY evaluations.created_at, evaluations.id`,
    ),
    [
      {
        base_commit: newlyReady.merge_base,
        execution_status: "cancelled",
        head_commit: newlyReady.head.sha,
      },
      {
        base_commit: newlyReady.merge_base,
        execution_status: "cancelled",
        head_commit: forcePushedPullRequest.head.sha,
      },
      {
        base_commit: newlyReady.merge_base,
        execution_status: "cancelled",
        head_commit: reenabledPullRequest.head.sha,
      },
      {
        base_commit: newlyReady.head.sha,
        execution_status: "queued",
        head_commit: reenabledPullRequest.head.sha,
      },
    ],
  );

  await api(
    baseUrl,
    `/api/v1/repos/operator/private/pulls/${newlyReady.number}/merge`,
    authorization,
    { Do: "merge" },
    "POST",
  );
  const mergedPullRequest = await api(
    baseUrl,
    `/api/v1/repos/operator/private/pulls/${newlyReady.number}`,
    authorization,
  );
  assert.equal(mergedPullRequest.merged, true);
  assert.equal(mergedPullRequest.state, "closed");
  assert.notEqual(mergedPullRequest.merged_at, null);
  setCurrentTime(961_000);
  await service.runPolling();
  assert.deepEqual(readEvaluationStatuses(), [
    { execution_status: "cancelled" },
    { execution_status: "cancelled" },
    { execution_status: "cancelled" },
    { execution_status: "queued" },
  ]);
}
