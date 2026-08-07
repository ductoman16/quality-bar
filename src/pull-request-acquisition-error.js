import { failEvaluation } from "./evaluation-validation.js";

/** @param {string} stderr @param {unknown} cause */
export function failRepositoryGitReadLoss(stderr, cause) {
  if (/\b404\b|repository .*not found/i.test(stderr)) {
    failEvaluation(
      "repository_git_read_failed",
      "Repository Git read failed during Evaluation acquisition",
      cause,
    );
  }
}

/** @param {(arguments_: string[], withCredential: boolean) => Promise<any>} runGit @param {"forgejo" | "github" | undefined} provider @param {number} selectorIndex @param {{type: "branch" | "commit", value: string}} selector */
export async function resolveExactEvaluationSelector(
  runGit,
  provider,
  selectorIndex,
  selector,
) {
  const revision =
    selector.type === "branch"
      ? `refs/heads/${selector.value}^{commit}`
      : `${selector.value}^{commit}`;
  let resolved = "";
  try {
    resolved = /** @type {{stdout: string}} */ (
      await runGit(
        ["rev-parse", "--verify", "--end-of-options", revision],
        false,
      )
    ).stdout.trim();
  } catch (cause) {
    failEvaluationSelectorInaccessible(provider, selectorIndex, cause);
  }
  if (
    selector.type === "commit" &&
    resolved.toLowerCase() !== selector.value.toLowerCase()
  ) {
    failEvaluationSelectorInaccessible(provider, selectorIndex);
  }
  return resolved;
}

/** @param {"forgejo" | "github" | undefined} provider @param {number} selectorIndex @param {unknown} [cause] */
export function failEvaluationSelectorInaccessible(
  provider,
  selectorIndex,
  cause,
) {
  if (provider) {
    const kind = selectorIndex === 1 ? "head" : "merge_base";
    const label = selectorIndex === 1 ? "head" : "merge-base";
    failEvaluation(
      `${provider}_pull_request_${kind}_inaccessible`,
      `${provider === "github" ? "GitHub" : "Forgejo"} pull request ${label} is inaccessible`,
      cause,
    );
  }
  failEvaluation(
    "evaluation_selector_not_found",
    "An Evaluation selector does not identify a fetchable pushed commit",
    cause,
  );
}
