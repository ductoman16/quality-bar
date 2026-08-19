import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @param {{evidencePath: string, failure: (error: unknown) => any, invocation: any, invoke: () => Promise<any>, sourceCommit: string}} input
 */
export async function runReleaseCanary({
  evidencePath,
  failure,
  invocation,
  invoke,
  sourceCommit,
}) {
  mkdirSync(dirname(evidencePath), { recursive: true });
  rmSync(evidencePath, { force: true });
  let evidence;
  try {
    evidence = await invoke();
    if (
      !evidence ||
      !["fail", "pass"].includes(evidence.outcome) ||
      evidence.sourceCommit !== sourceCommit
    ) {
      throw Object.assign(
        new Error("release canary returned invalid evidence"),
        {
          code: "release_canary_evidence_invalid",
        },
      );
    }
  } catch (error) {
    evidence = failure(error);
  }
  const completed = { ...evidence, invocation };
  writeFileSync(evidencePath, `${JSON.stringify(completed, null, 2)}\n`, {
    mode: 0o600,
  });
  return completed;
}
