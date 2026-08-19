import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

/**
 * @param {string} repositoryRoot
 * @param {string} sourcePath
 * @param {string} servedSource
 * @param {object} context
 */
export function executeServedBrowserAsset(
  repositoryRoot,
  sourcePath,
  servedSource,
  context,
) {
  return runInNewContext(servedSource, context, {
    filename: resolve(repositoryRoot, sourcePath),
  });
}
