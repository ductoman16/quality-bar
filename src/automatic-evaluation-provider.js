import {
  prepareForgejoAutomaticEvaluation,
  recordForgejoPullRequestEvaluation,
} from "./forgejo-evaluation-admission.js";
import {
  prepareGitHubAutomaticEvaluation,
  recordGitHubPullRequestEvaluation,
} from "./github-evaluation-supersession.js";

/** @param {unknown} provider */
function requireProvider(provider) {
  if (provider !== "forgejo" && provider !== "github") {
    throw new TypeError("Automatic Evaluation provider is invalid");
  }
  return provider;
}

/** @param {any} transaction @param {any} input @param {() => number} now @param {(code: string, detail: string) => never} fail */
export function prepareAutomaticEvaluation(transaction, input, now, fail) {
  const provider = requireProvider(input.provider);
  const automaticInput = {
    changeset: input.changeset,
    pullRequestNumber: input.pullRequestNumber,
    repositoryId: input.repositoryId,
  };
  return provider === "github"
    ? prepareGitHubAutomaticEvaluation(transaction, automaticInput, now, fail)
    : prepareForgejoAutomaticEvaluation(transaction, automaticInput);
}

/** @param {any} transaction @param {string} evaluationId @param {any} input */
export function recordAutomaticEvaluation(transaction, evaluationId, input) {
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
