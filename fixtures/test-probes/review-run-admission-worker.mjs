import { openDurableCore } from "../../src/durable-core.js";
import {
  createEvaluationService,
  EvaluationError,
} from "../../src/evaluation.js";

const [databasePath, idempotencyKey, evaluationId, reviewRunId] =
  process.argv.slice(2);
if (!databasePath || !idempotencyKey || !evaluationId || !reviewRunId) {
  throw new Error("review_run_admission_worker_arguments_invalid");
}

const core = openDurableCore(databasePath);
try {
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
    }),
    createId: () => evaluationId,
    createReviewRunId: () => reviewRunId,
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    now: () => 20,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  try {
    const accepted = await evaluations.createExplicit({
      channel: "implementer_token",
      idempotencyKey,
      repositoryId: "repository-1",
      request: {
        base: { type: "branch", value: "main" },
        head: { type: "branch", value: "topic" },
      },
    });
    process.stdout.write(
      `${JSON.stringify({ id: accepted.resource.id, outcome: "accepted" })}\n`,
    );
  } catch (error) {
    if (
      error instanceof EvaluationError &&
      error.code === "capacity_unavailable"
    ) {
      process.stdout.write(
        `${JSON.stringify({ code: error.code, outcome: "rejected" })}\n`,
      );
    } else {
      throw error;
    }
  }
} finally {
  core.close();
}
