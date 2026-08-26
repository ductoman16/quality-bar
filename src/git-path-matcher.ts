export function createGitPathMatcher(
  commits: string[],
  listPaths: (commit: string, pathspec: string) => string[],
) {
  const matchedPathsByPathspec: Map<string, Set<string>> = new Map();
  return (pathspec: string, path: string) => {
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
