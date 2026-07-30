import { spawn } from "node:child_process";
import { join } from "node:path";

const child = spawn(
  process.execPath,
  [join(import.meta.dirname, "idle-child.mjs")],
  { stdio: "ignore" },
);
if (!Number.isSafeInteger(child.pid)) {
  throw new Error("leaderless process-group child did not start");
}
process.send?.({ childPid: child.pid });
process.once("message", (message) => {
  if (message !== "exit-leader") {
    throw new Error("leaderless process-group command is invalid");
  }
  process.exit(0);
});
