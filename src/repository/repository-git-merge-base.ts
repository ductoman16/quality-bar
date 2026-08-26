import { failEvaluation } from "../evaluation/evaluation-validation.ts";

export async function proveMergeBase(
  runGit: (arguments_: string[], withCredential: boolean) => Promise<unknown>,
  resolved: string[],
  objectIdPattern: RegExp,
) {
  if (
    resolved.length !== 2 ||
    resolved.some((value) => typeof value !== "string")
  ) {
    throw new TypeError("Resolved pull request commits are invalid");
  }
  const commits = resolved as [string, string];
  let frozenBase;
  try {
    frozenBase = (
      (await runGit(["merge-base", commits[0], commits[1]], false)) as {
        stdout: string;
      }
    ).stdout.trim();
  } catch (cause) {
    failEvaluation(
      "evaluation_pull_request_merge_base_unavailable",
      "Pull request merge-base could not be proved",
      cause,
    );
  }
  if (!objectIdPattern.test(frozenBase)) {
    throw new TypeError("Resolved pull request merge-base is invalid");
  }
  return frozenBase;
}
