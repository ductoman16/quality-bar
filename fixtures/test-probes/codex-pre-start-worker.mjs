import { openDurableCore } from "../../src/durable/durable-core.js";
import { createReviewRunClaimService } from "../../src/review/review-run-claim.js";

const [databasePath, attemptedAtValue, workerId, action = "fail"] =
  process.argv.slice(2);
const attemptedAt = Number(attemptedAtValue);
if (
  !databasePath ||
  !Number.isSafeInteger(attemptedAt) ||
  attemptedAt < 0 ||
  !workerId
) {
  throw new TypeError("Codex pre-start worker input is invalid");
}

const core = openDurableCore(databasePath);
try {
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => workerId,
    now: () => attemptedAt,
  });
  const claim = claims.claimNext();
  if (!claim) {
    throw new Error("Codex pre-start work is not claimable");
  }
  if (action === "begin-and-crash") {
    claims.beginPreStartAttempt(claim);
    process.exit(17);
  }
  if (action !== "fail") {
    throw new TypeError("Codex pre-start worker action is invalid");
  }
  const result = claims.recordPreStartFailure(
    claim,
    Object.assign(new Error("Temporary Review Run checkout failure"), {
      code: "review_run_checkout_failed",
    }),
  );
  process.stdout.write(JSON.stringify(result));
} finally {
  core.close();
}
