import { executeReviewRun } from "../src/review-run-execution.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import { createReviewRunResultService } from "../src/review-run-result.js";

/**
 * @param {ReturnType<typeof import("../src/durable-core.js").openDurableCore>} core
 * @param {Error} underlyingFailure
 */
export async function executeUnexpectedReviewRun(core, underlyingFailure) {
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => "unexpected-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  if (!claim) {
    throw new Error("Expected a queued Review Run");
  }
  return executeReviewRun(core, claim, {
    claimService: claims,
    prepareCheckout: async () => ({
      path: "/discarded-checkout",
      remove() {},
    }),
    readFileChanges: () => [],
    resultService: createReviewRunResultService(core, { now: () => 30 }),
    async runCodex() {
      throw underlyingFailure;
    },
  });
}
