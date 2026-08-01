import assert from "node:assert/strict";

/**
 * @param {{api: Function, baseUrl: string, core: any, repository: any, service: any, setCurrentTime: (value: number) => void, token: string}} input
 */
export async function proveForgejoV16AutomaticEvaluation({
  api,
  baseUrl,
  core,
  repository,
  service,
  setCurrentTime,
  token,
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
    "/api/v1/repos/operator/private/contents/automatic-proof.txt",
    authorization,
    {
      branch: "quality-bar-automatic",
      content: Buffer.from("automatic proof\n").toString("base64"),
      message: "Add automatic proof",
    },
  );
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
}
