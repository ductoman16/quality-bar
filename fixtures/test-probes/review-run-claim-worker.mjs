import { openDurableCore } from "../../src/durable-core.js";
import { createReviewRunClaimService } from "../../src/review-run-claim.js";
import { createCodexExecutionConcurrencyService } from "../../src/codex-execution-concurrency.js";

const [
  databasePath,
  action,
  workerId,
  timestamp,
  workId,
  workKind,
  fencingToken,
] = process.argv.slice(2);
if (!databasePath || !action || !workerId || !timestamp) {
  throw new Error("review_run_claim_worker_arguments_invalid");
}
const now = Number(timestamp);
if (!Number.isSafeInteger(now)) {
  throw new Error("review_run_claim_worker_time_invalid");
}

const core = openDurableCore(databasePath);
try {
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => workerId,
    now: () => now,
  });
  if (action === "claim") {
    process.stdout.write(
      `${JSON.stringify({ claim: claims.claimNext() ?? null })}\n`,
    );
  } else if (action === "set-concurrency" && workId) {
    process.stdout.write(
      `${JSON.stringify({
        maximumRunning: createCodexExecutionConcurrencyService(core).set(
          Number(workId),
        ),
      })}\n`,
    );
  } else if (
    action === "start" &&
    workId &&
    (workKind === "review_run" || workKind === "waiver_adjudication") &&
    fencingToken &&
    Number.isSafeInteger(Number(fencingToken))
  ) {
    try {
      claims.start(
        {
          fencingToken: Number(fencingToken),
          leaseExpiresAt: 0,
          workerId,
          workId,
          workKind,
        },
        "0.145.0",
      );
      process.stdout.write(`${JSON.stringify({ outcome: "started" })}\n`);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["review_run_claim_lost", "waiver_adjudication_claim_lost"].includes(
          String(error.code),
        )
      ) {
        process.stdout.write(
          `${JSON.stringify({ code: error.code, outcome: "rejected" })}\n`,
        );
      } else {
        throw error;
      }
    }
  } else {
    throw new Error("review_run_claim_worker_action_invalid");
  }
} finally {
  core.close();
}
