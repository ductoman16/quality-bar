import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** @param {string} path @param {unknown} evidence @param {boolean} invalidate */
export function writeCanaryEvidence(path, evidence, invalidate = false) {
  mkdirSync(dirname(path), { recursive: true });
  if (invalidate) {
    rmSync(path, { force: true });
  }
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

/**
 * @param {{attempt: any, evidencePath: string, failure: (error: unknown) => any, invoke: () => Promise<any>}} input
 */
export async function runReleaseCanary({
  attempt,
  evidencePath,
  failure,
  invoke,
}) {
  writeCanaryEvidence(evidencePath, attempt, true);
  let evidence;
  try {
    evidence = await invoke();
    if (
      !evidence ||
      !["fail", "pass"].includes(evidence.outcome) ||
      evidence.sourceCommit !== attempt.sourceCommit
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
  const completed = { ...evidence, invocation: attempt.invocation };
  writeCanaryEvidence(evidencePath, completed);
  return completed;
}
