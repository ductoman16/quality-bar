import { randomUUID } from "node:crypto";

const FAILURE_CODE = /^[a-z][a-z0-9_]*$/u;

/** @param {unknown} error */
function owningCode(error) {
  const candidate =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "paid_codex_canary_failed";
  return candidate.length <= 96 && FAILURE_CODE.test(candidate)
    ? candidate
    : "paid_codex_canary_failed";
}

/** @param {unknown} error @param {string} code */
function owningDetail(error, code) {
  if (code.startsWith("paid_codex_canary_") && error instanceof Error) {
    return error.message.slice(0, 512) || "paid Codex canary failed";
  }
  return "paid Codex canary failed";
}

/**
 * @param {{applicationVersion?: string | null, attemptId?: string, code: string, detail: string, now: () => number, sourceCommit: string}} input
 */
function failureEvidence({
  applicationVersion = null,
  attemptId,
  code,
  detail,
  now,
  sourceCommit,
}) {
  const at = new Date(now()).toISOString();
  return {
    completedAt: at,
    failure: {
      code,
      detail,
      ...(code === "paid_codex_canary_attempt_started" && attemptId
        ? { attemptId }
        : {}),
    },
    fixture: { file: "reviewed.txt", id: "paid-codex-canary-fixture-v1" },
    invocation: { attemptId, command: "canary:paid-codex" },
    kind: "paid-codex-canary",
    observations: null,
    outcome: "fail",
    sourceCommit,
    startedAt: at,
    versions: {
      application: applicationVersion,
      codex: null,
      node: process.version,
    },
  };
}

/** @param {unknown} error @param {{applicationVersion?: string | null, attemptId: string, now: () => number, sourceCommit: string}} input */
function evidenceForError(error, input) {
  const code = owningCode(error);
  return failureEvidence({
    ...input,
    code,
    detail: owningDetail(error, code),
  });
}

/** @param {unknown} left @param {unknown} right */
function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Execute one paid attempt with durable pre-spend invalidation and
 * attempt-bound final publication.
 *
 * @param {{
 *   applicationVersion: () => string,
 *   canaryPath: string,
 *   createAttemptId?: () => string,
 *   invoke: (input: {applicationVersion: string, sourceCommit: string, sourceStatus: string, trackProcessGroup: (processGroupId: number) => void}) => Promise<any>,
 *   lockPath: string,
 *   manifestPath: string,
 *   mergeEvidence: (manifest: any, canary: any) => any,
 *   now?: () => number,
 *   publish: (input: {canary: any, canaryPath: string, manifestPath: string, mergeEvidence: (manifest: any, canary: any) => any}) => void,
 *   requireCostFreeEvidence: () => void,
 *   sourceCommit: string,
 *   sourceStatus: string,
 *   withLease: (lockPath: string, operation: (assertOwned: () => void, trackProcessGroup: (processGroupId: number) => void) => Promise<any>) => Promise<any>,
 * }} input
 */
export async function runPaidCodexCanaryLifecycle({
  applicationVersion,
  canaryPath,
  createAttemptId = randomUUID,
  invoke,
  lockPath,
  manifestPath,
  mergeEvidence,
  now = () => Date.now(),
  publish,
  requireCostFreeEvidence,
  sourceCommit,
  sourceStatus,
  withLease,
}) {
  let attemptEvidence = /** @type {any | null} */ (null);
  let attemptPublished = false;
  let leaseEntered = false;
  let lifecycleFailure = /** @type {unknown} */ (null);
  let knownApplicationVersion = /** @type {string | null} */ (null);
  let finalEvidence;
  try {
    finalEvidence = await withLease(
      lockPath,
      async (assertOwned, trackProcessGroup) => {
        leaseEntered = true;
        const attemptId = createAttemptId();
        attemptEvidence = failureEvidence({
          applicationVersion: null,
          attemptId,
          code: "paid_codex_canary_attempt_started",
          detail: "paid Codex canary attempt started",
          now,
          sourceCommit,
        });
        assertOwned();
        publish({
          canary: attemptEvidence,
          canaryPath,
          manifestPath,
          mergeEvidence,
        });
        attemptPublished = true;
        assertOwned();
        requireCostFreeEvidence();
        knownApplicationVersion = applicationVersion();
        const canary = await invoke({
          applicationVersion: knownApplicationVersion,
          sourceCommit,
          sourceStatus,
          trackProcessGroup,
        });
        assertOwned();
        if (
          !canary ||
          !["fail", "pass"].includes(canary.outcome) ||
          (canary.outcome === "fail" && !canary.failure)
        ) {
          throw Object.assign(
            new Error("paid Codex canary returned invalid evidence"),
            { code: "paid_codex_canary_evidence_invalid" },
          );
        }
        return {
          ...canary,
          invocation: { attemptId, command: "canary:paid-codex" },
        };
      },
    );
  } catch (error) {
    if (!leaseEntered) {
      throw error instanceof Error
        ? error
        : new TypeError("paid Codex canary lease acquisition failed", {
            cause: error,
          });
    }
    lifecycleFailure = error;
    finalEvidence = evidenceForError(error, {
      applicationVersion: knownApplicationVersion,
      attemptId: attemptEvidence?.invocation?.attemptId ?? createAttemptId(),
      now,
      sourceCommit,
    });
  }

  if (!attemptPublished || attemptEvidence === null) {
    throw lifecycleFailure instanceof Error
      ? lifecycleFailure
      : new TypeError("paid Codex canary failed before attempt publication", {
          cause: lifecycleFailure,
        });
  }

  /** @param {any} manifest @param {any} canary */
  const mergeOwnedAttempt = (manifest, canary) => {
    if (!exactJson(manifest?.releaseCanaries?.paidCodex, attemptEvidence)) {
      throw Object.assign(
        new Error("paid Codex canary attempt ownership changed"),
        { code: "paid_codex_canary_attempt_superseded" },
      );
    }
    return mergeEvidence(manifest, canary);
  };
  publish({
    canary: finalEvidence,
    canaryPath,
    manifestPath,
    mergeEvidence: mergeOwnedAttempt,
  });
  return finalEvidence;
}
