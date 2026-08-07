import { runVerification } from "./verification/harness.mjs";
import { assertExactNodeRuntime } from "./runtime-contract.mjs";

try {
  assertExactNodeRuntime(process.version);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

const { manifest, report } = runVerification();
process.stdout.write(report);
if (manifest.outcome === "fail") {
  process.exitCode = 1;
}
