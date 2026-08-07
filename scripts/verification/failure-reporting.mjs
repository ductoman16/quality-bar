/**
 * @param {import("node:child_process").SpawnSyncReturns<string>} result
 * @param {string} command
 * @param {string[]} arguments_
 */
export function commandFailure(result, command, arguments_) {
  if (result.error) {
    return result.error.message;
  }

  const output = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
  if (output) {
    return output;
  }

  if (result.signal) {
    return `${command} ${arguments_.join(" ")} terminated by ${result.signal}`;
  }

  return `${command} ${arguments_.join(" ")} exited with code ${result.status}`;
}
