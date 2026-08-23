import { failEvaluation } from "../evaluation/evaluation-validation.js";

/**
 * @param {(arguments_: string[], withCredential: boolean) => Promise<unknown>} runGit
 * @param {string[]} resolved
 * @param {RegExp} objectIdPattern
 */
export async function proveMergeBase(runGit, resolved, objectIdPattern) {
  if (
    resolved.length !== 2 ||
    resolved.some((value) => typeof value !== "string")
  ) {
    throw new TypeError("Resolved pull request commits are invalid");
  }
  const commits = /** @type {[string, string]} */ (resolved);
  let frozenBase;
  try {
    frozenBase = /** @type {{stdout: string}} */ (
      await runGit(["merge-base", commits[0], commits[1]], false)
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
