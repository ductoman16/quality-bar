import { failEvaluation } from "./evaluation/evaluation-validation.ts";

export function failRepositoryGitReadLoss(stderr: string, cause: unknown) {
  if (/\b404\b|repository .*not found/i.test(stderr)) {
    failEvaluation(
      "repository_git_read_failed",
      "Repository Git read failed during Evaluation acquisition",
      cause,
    );
  }
}

export async function resolveExactEvaluationSelector(
  runGit: (arguments_: string[], withCredential: boolean) => Promise<any>,
  provider: "forgejo" | "github" | undefined,
  selectorIndex: number,
  selector: { type: "branch" | "commit"; value: string },
) {
  const revision =
    selector.type === "branch"
      ? `refs/heads/${selector.value}^{commit}`
      : `${selector.value}^{commit}`;
  let resolved = "";
  try {
    resolved = (
      (await runGit(
        ["rev-parse", "--verify", "--end-of-options", revision],
        false,
      )) as { stdout: string }
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

export function failEvaluationSelectorInaccessible(
  provider: "forgejo" | "github" | undefined,
  selectorIndex: number,
  cause?: unknown,
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
