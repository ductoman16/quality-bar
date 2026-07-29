/**
 * @param {string[]} commits
 * @param {(commit: string, pathspec: string) => string[]} listPaths
 */
export function createGitPathMatcher(commits, listPaths) {
  /** @type {Map<string, Set<string>>} */
  const matchedPathsByPathspec = new Map();
  return (/** @type {string} */ pathspec, /** @type {string} */ path) => {
    let matchedPaths = matchedPathsByPathspec.get(pathspec);
    if (!matchedPaths) {
      matchedPaths = new Set(
        commits.flatMap((commit) => listPaths(commit, pathspec)),
      );
      matchedPathsByPathspec.set(pathspec, matchedPaths);
    }
    return matchedPaths.has(path);
  };
}
