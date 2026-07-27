import { spawnSync } from "node:child_process";

/**
 * @typedef {import("node:child_process").SpawnSyncReturns<string>} CommandResult
 */

/**
 * @typedef {(command: string, arguments_: string[], repositoryRoot: string, options?: import("node:child_process").SpawnSyncOptions) => CommandResult} CommandExecutor
 */

/**
 * @param {string} command
 * @param {string[]} arguments_
 * @param {string} repositoryRoot
 * @param {import("node:child_process").SpawnSyncOptions} options
 */
function spawnCommand(command, arguments_, repositoryRoot, options) {
  const commandOptions = options ?? {};
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    ...commandOptions,
  });
  return /** @type {CommandResult} */ (result);
}

/**
 * @param {string} command
 * @param {string[]} arguments_
 * @param {string} repositoryRoot
 * @param {import("node:child_process").SpawnSyncOptions} [options]
 */
export function runCommand(command, arguments_, repositoryRoot, options = {}) {
  return spawnCommand(command, arguments_, repositoryRoot, options);
}
