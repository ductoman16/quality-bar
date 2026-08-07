import {
  formatGitHubAggregateFeedback,
  formatGitHubInlineFeedback,
  projectFrozenDiffLineRange,
} from "./github-feedback.js";

export const formatForgejoAggregateFeedback = formatGitHubAggregateFeedback;
export const formatForgejoInlineFeedback = formatGitHubInlineFeedback;

/**
 * Forgejo accepts one side for a review comment. A frozen range that crosses
 * sides remains aggregate-only instead of being silently rewritten.
 *
 * @param {any} location
 * @param {any} fileChange
 */
export function projectForgejoDiffLineRange(location, fileChange) {
  const projected = projectFrozenDiffLineRange(location, fileChange);
  if (
    !projected ||
    (projected.start_side !== undefined &&
      projected.start_side !== projected.side)
  ) {
    return null;
  }
  const path =
    location.side === "base" ? fileChange.before_path : fileChange.after_path;
  if (typeof path !== "string" || path.length === 0) {
    return null;
  }
  return { ...projected, path };
}
