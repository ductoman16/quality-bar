import {
  prepareForgejoAutomaticEvaluation,
  recordForgejoPullRequestEvaluation,
} from "./forgejo/forgejo-evaluation-admission.ts";
import {
  prepareGitHubAutomaticEvaluation,
  recordGitHubPullRequestEvaluation,
} from "./github/github-evaluation-supersession.ts";

function requireProvider(provider: unknown) {
  if (provider !== "forgejo" && provider !== "github") {
    throw new TypeError("Automatic Evaluation provider is invalid");
  }
  return provider;
}

export function prepareAutomaticEvaluation(
  transaction: any,
  input: any,
  now: () => number,
  fail: (code: string, detail: string) => never,
) {
  const provider = requireProvider(input.provider);
  const automaticInput = {
    changeset: input.changeset,
    pullRequestNumber: input.pullRequestNumber,
    repositoryId: input.repositoryId,
  };
  return provider === "github"
    ? prepareGitHubAutomaticEvaluation(transaction, automaticInput, now, fail)
    : prepareForgejoAutomaticEvaluation(transaction, automaticInput, now, fail);
}

export function recordAutomaticEvaluation(
  transaction: any,
  evaluationId: string,
  input: any,
) {
  const provider = requireProvider(input.provider);
  const automaticInput = {
    changeset: input.changeset,
    pullRequestNumber: input.pullRequestNumber,
    repositoryId: input.repositoryId,
  };
  transaction.run(
    `INSERT INTO ${provider}_automatic_evaluations (
       evaluation_id, repository_id, pull_request_number,
       base_commit, head_commit
     ) VALUES (?, ?, ?, ?, ?)`,
    evaluationId,
    input.repositoryId,
    input.pullRequestNumber,
    input.changeset.base_commit,
    input.changeset.head_commit,
  );
  const record =
    provider === "github"
      ? recordGitHubPullRequestEvaluation
      : recordForgejoPullRequestEvaluation;
  record(transaction, evaluationId, automaticInput);
}
