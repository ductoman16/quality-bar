import { openDurableCore } from "../../src/durable-core.js";
import { createReviewRunClaimService } from "../../src/review-run-claim.js";

const [databasePath, action, workerId, timestamp, workId, fencingToken] =
  process.argv.slice(2);
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
  } else if (
    action === "start" &&
    workId &&
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
        },
        "0.145.0",
      );
      process.stdout.write(`${JSON.stringify({ outcome: "started" })}\n`);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "review_run_claim_lost"
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
