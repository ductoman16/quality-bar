import { spawnSync } from "node:child_process";

import { PERFORMANCE_GATE_TEST_NAME } from "./verification/performance-budget.mjs";
import { PERFORMANCE_BUDGET_GATE } from "./verification/performance-gate-definition.mjs";

/** @param {string[]} arguments_ @returns {number} */
function run(arguments_) {
  const result = spawnSync(process.execPath, arguments_, { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    throw new Error(
      `test_command_terminated: ${arguments_.join(" ")} terminated by ${result.signal}`,
    );
  }
  return result.status ?? 1;
}

const ordinaryStatus = run([
  "--test",
  "--test-skip-pattern",
  PERFORMANCE_GATE_TEST_NAME,
  ...process.argv.slice(2),
]);
process.exitCode =
  ordinaryStatus === 0
    ? run(PERFORMANCE_BUDGET_GATE.arguments)
    : ordinaryStatus;
