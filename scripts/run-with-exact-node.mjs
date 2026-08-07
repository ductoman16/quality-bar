import { spawnSync } from "node:child_process";

import { assertExactNodeRuntime } from "./runtime-contract.mjs";

assertExactNodeRuntime(process.version);

const arguments_ = process.argv.slice(2);
if (arguments_.length === 0) {
  throw new Error(
    "node_command_missing: expected Node arguments after the runtime check",
  );
}

const result = spawnSync(process.execPath, arguments_, { stdio: "inherit" });
if (result.error) {
  throw result.error;
}
if (result.signal) {
  throw new Error(
    `node_command_terminated: ${arguments_.join(" ")} terminated by ${result.signal}`,
  );
}
process.exitCode = result.status;
