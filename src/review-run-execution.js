import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateCodexConfiguration } from "./codex-capabilities.js";
import { prepareReviewRunCheckout } from "./review-run-checkout.js";
import { ReviewRunExecutionError } from "./review-run-result.js";

const submitPath = fileURLToPath(
  new URL("./quality-bar-submit.js", import.meta.url),
);

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 * @returns {never}
 */
function fail(code, message, cause) {
  throw new ReviewRunExecutionError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

/** @param {unknown} candidate */
export function reviewRunCodexArguments(candidate) {
  const input = /** @type {any} */ (candidate);
  const configuration = validateCodexConfiguration(input?.configuration);
  if (
    typeof input?.prompt !== "string" ||
    input.prompt.length === 0 ||
    !Array.isArray(input.criteria) ||
    input.criteria.length === 0
  ) {
    throw new TypeError("Review Run Codex input is invalid");
  }
  return [
    "--ignore-user-config",
    "--model",
    configuration.model,
    "--config",
    `model_reasoning_effort="${configuration.reasoning_effort}"`,
    "--config",
    `service_tier="${configuration.service_tier}"`,
    "exec",
    "--sandbox",
    "workspace-write",
    "--config",
    'approval_policy="never"',
    "--config",
    "sandbox_workspace_write.network_access=false",
    input.prompt,
  ];
}

/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *   get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined
 * }} durableCore
 * @param {string} workId
 */
function readRun(durableCore, workId) {
  const run = durableCore.get(
    `SELECT review_runs.id, review_runs.execution_status,
            evaluations.base_commit, evaluations.head_commit,
            repositories.normalized_url,
            reviews.name,
            review_versions.model, review_versions.reasoning_effort,
            review_versions.service_tier, review_versions.applicability_rule
     FROM review_runs
     JOIN evaluations ON evaluations.id = review_runs.evaluation_id
     JOIN repositories ON repositories.id = evaluations.repository_id
     JOIN reviews ON reviews.id = review_runs.review_id
     JOIN review_versions ON review_versions.id = review_runs.review_version_id
     WHERE review_runs.id = ?`,
    workId,
  );
  if (!run || run.execution_status !== "queued") {
    fail("review_run_state_invalid", "Review Run is not queued for execution");
  }
  if (run.applicability_rule !== null) {
    fail(
      "review_run_applicability_unsupported",
      "Only unconditional Reviews are supported by this Review Run",
    );
  }
  const criteria = durableCore
    .all(
      `SELECT criterion_id, impact, instruction
       FROM review_version_criteria
       JOIN review_runs
         ON review_runs.review_version_id =
            review_version_criteria.review_version_id
       WHERE review_runs.id = ?
       ORDER BY position`,
      workId,
    )
    .map((criterion) => {
      if (
        typeof criterion?.criterion_id !== "string" ||
        typeof criterion.impact !== "string" ||
        typeof criterion.instruction !== "string"
      ) {
        throw new TypeError("Frozen Review Criterion is invalid");
      }
      return {
        criterionId: criterion.criterion_id,
        impact: criterion.impact,
        instruction: criterion.instruction,
      };
    });
  if (
    typeof run.base_commit !== "string" ||
    typeof run.head_commit !== "string" ||
    typeof run.normalized_url !== "string" ||
    typeof run.name !== "string" ||
    criteria.length === 0
  ) {
    throw new TypeError("Frozen Review Run is invalid");
  }
  const prompt = [
    "Run this Quality Bar Review against only the frozen Changeset.",
    `base_commit: ${run.base_commit}`,
    `head_commit: ${run.head_commit}`,
    `review: ${run.name}`,
    ...criteria.flatMap((criterion) => [
      `criterion_id: ${criterion.criterionId}`,
      `impact: ${criterion.impact}`,
      `instruction: ${criterion.instruction}`,
    ]),
    `Submit one complete result with: quality-bar-submit`,
  ].join("\n");
  return {
    baseCommit: run.base_commit,
    configuration: {
      model: run.model,
      reasoning_effort: run.reasoning_effort,
      service_tier: run.service_tier,
    },
    criteria,
    headCommit: run.head_commit,
    prompt,
    repositoryUrl: run.normalized_url,
  };
}

/**
 * @param {{
 *   fencingToken: number,
 *   workerId: string,
 *   workId: string
 * }} claim
 * @param {{submit(claim: any, candidate: unknown): unknown}} resultService
 */
async function openSubmissionChannel(claim, resultService) {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-submit-"));
  const socketPath = join(directory, "submit.sock");
  const token = randomUUID();
  let accepted = false;
  const server = createServer((socket) => {
    let request = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      request += chunk;
      if (request.length > 1024 * 1024) {
        socket.destroy();
      }
    });
    socket.once("end", () => {
      try {
        const envelope = JSON.parse(request);
        if (envelope.token !== token) {
          fail(
            "submission_channel_unavailable",
            "Review Run submission channel is unavailable",
          );
        }
        resultService.submit(claim, envelope.candidate);
        accepted = true;
        socket.end('{"ok":true}\n');
      } catch (error) {
        const failure =
          error instanceof Error &&
          "code" in error &&
          typeof error.code === "string"
            ? error
            : new ReviewRunExecutionError(
                "review_run_submission_invalid",
                "Review Run submission is invalid",
              );
        socket.end(
          `${JSON.stringify({
            error: { code: failure.code, message: failure.message },
            ok: false,
          })}\n`,
        );
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve(undefined));
  });
  return {
    accepted: () => accepted,
    environment: {
      QUALITY_BAR_SUBMIT_PATH: submitPath,
      QUALITY_BAR_SUBMIT_SOCKET: socketPath,
      QUALITY_BAR_SUBMIT_TOKEN: token,
    },
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve(undefined)));
      });
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

/**
 * @param {any} durableCore
 * @param {{fencingToken: number, workerId: string, workId: string}} claim
 * @param {{
 *   checkoutRoot?: string,
 *   claimService: {
 *     start(claim: any): unknown,
 *     startRenewal(claim: any, onClaimLost: (error: unknown) => void): () => void
 *   },
 *   codexCommand?: string,
 *   codexPrefixArguments?: string[],
 *   prepareCheckout?: typeof prepareReviewRunCheckout,
 *   resultService: {submit(claim: any, candidate: unknown): unknown},
 *   spawnProcess?: typeof spawn
 * }} options
 */
export async function executeReviewRun(
  durableCore,
  claim,
  {
    checkoutRoot = "/var/cache/quality-bar/checkouts",
    claimService,
    codexCommand = "codex",
    codexPrefixArguments = [],
    prepareCheckout = prepareReviewRunCheckout,
    resultService,
    spawnProcess = spawn,
  },
) {
  const run = readRun(durableCore, claim.workId);
  /** @type {Error | null} */
  let claimFailure = null;
  const stopRenewal = claimService.startRenewal(claim, (error) => {
    claimFailure =
      error instanceof Error
        ? error
        : new TypeError("Review Run claim renewal failed");
  });
  try {
    const checkout = await prepareCheckout({
      baseCommit: run.baseCommit,
      checkoutRoot,
      fencingToken: claim.fencingToken,
      headCommit: run.headCommit,
      repositoryUrl: run.repositoryUrl,
      workId: claim.workId,
    });
    /** @type {Awaited<ReturnType<typeof openSubmissionChannel>> | undefined} */
    let channel;
    try {
      if (claimFailure) {
        throw claimFailure;
      }
      claimService.start(claim);
      channel = await openSubmissionChannel(claim, resultService);
      const openedChannel = channel;
      const arguments_ = [
        ...codexPrefixArguments,
        ...reviewRunCodexArguments(run),
      ];
      const result = await new Promise((resolve, reject) => {
        let child;
        try {
          child = spawnProcess(codexCommand, arguments_, {
            cwd: checkout.path,
            env: openedChannel.environment,
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (error) {
          reject(error);
          return;
        }
        let stdout = "";
        let stderr = "";
        child.stdout?.setEncoding("utf8").on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr?.setEncoding("utf8").on("data", (chunk) => {
          stderr += chunk;
        });
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          resolve({ code, signal, stderr, stdout });
        });
      }).catch((cause) =>
        fail(
          "codex_process_failed",
          "Codex Review Run process could not start",
          cause,
        ),
      );
      if (!openedChannel.accepted()) {
        const processResult = /** @type {any} */ (result);
        if (processResult.code === 0 && processResult.signal === null) {
          fail(
            "result_not_submitted",
            "Codex Review Run exited without an accepted Result",
          );
        }
        fail("codex_process_failed", "Codex Review Run process failed");
      }
    } finally {
      await channel?.close();
      checkout.remove();
    }
  } finally {
    stopRenewal();
  }
}
