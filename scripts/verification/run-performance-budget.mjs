import { spawnSync } from "node:child_process";

const PERFORMANCE_CONTAINER_IMAGE =
  "node:24.18.0-alpine@sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc";
const PERFORMANCE_CONTAINER_MEMORY_BYTES = 8 * 1024 ** 3;

/** @param {number} status */
function exitWithStatus(status) {
  process.exitCode = status;
}

const testArguments = process.argv.slice(2);
const result = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--platform",
    "linux/amd64",
    "--cpus",
    "4",
    "--memory",
    String(PERFORMANCE_CONTAINER_MEMORY_BYTES),
    "--volume",
    `${process.cwd()}:/workspace:ro`,
    "--workdir",
    "/workspace",
    "--entrypoint",
    "node",
    PERFORMANCE_CONTAINER_IMAGE,
    "scripts/run-with-exact-node.mjs",
    ...testArguments,
  ],
  {
    encoding: "utf8",
  },
);

process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.error) {
  process.stderr.write(
    `performance_execution_profile_unsupported: ${result.error.message}\n`,
  );
  exitWithStatus(1);
} else if (result.signal) {
  process.stderr.write(
    `performance_execution_terminated: ${String(result.signal)}\n`,
  );
  exitWithStatus(1);
} else {
  exitWithStatus(result.status ?? 1);
}
