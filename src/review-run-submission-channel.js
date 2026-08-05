import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REVIEW_RUN_DEADLINE_MILLISECONDS } from "./review-run-deadline.js";
import { installSubmissionCommand } from "./review-run-submission-installation.js";
import { createSubmissionProcessor } from "./review-run-submission-processor.js";
import { processPendingResponse as readPendingResponse } from "./review-run-submission-pending.js";
import { publishSignedResponse } from "./review-run-submission-response.js";
import {
  cleanupOwnedFile,
  cleanupOwnedDirectory,
  cleanupSubmissionFiles,
  drainSubmissionArtifacts,
  mergeCleanupFailure,
  preserveCleanupFailure,
  removeSubmissionDirectory,
} from "./review-run-submission-cleanup.js";
import {
  isProcessAlive,
  isMissingPath,
  isSubmissionLeaseAlive,
  isSubmissionLeaseExpired,
  parseSubmissionLock,
  processStartIdentity,
  publishFile,
  readSubmissionFile,
  removeOwnedFile,
} from "./review-run-submission-files.js";
import {
  createTrustedProcessGroupBinding,
  processGroupIdentity,
} from "./review-run-submission-process-group.js";

import {
  captureExistingIdentity,
  requireCheckoutPath,
  requireEndpointAvailable,
  submissionChannelUnavailable,
} from "./review-run-submission-paths.js";

/**
 * @param {{fencingToken: number, workerId: string, workId: string}} claim
 * @param {{prepare(claim: any, candidate: unknown): unknown}} resultService
 * @param {{
 *   checkoutPath: string,
 *   createEndpointName?: () => string,
 *   removeDirectory?: (path: string, options: {force: boolean, recursive: boolean}) => void,
 *   publishFile?: typeof publishFile,
 *   submissionMode?: "review-file" | "generic",
 *   writeCommand?: typeof writeFileSync
 * }} options
 */
export async function openReviewRunSubmissionChannel(
  claim,
  resultService,
  {
    checkoutPath,
    createEndpointName = () => `.qbs-${randomBytes(8).toString("base64url")}.s`,
    removeDirectory = removeSubmissionDirectory,
    publishFile: publishSubmissionFile = publishFile,
    submissionMode = "review-file",
    writeCommand = writeFileSync,
  },
) {
  requireCheckoutPath(checkoutPath);
  const endpointName = createEndpointName();
  if (
    typeof endpointName !== "string" ||
    endpointName.length === 0 ||
    endpointName.includes("/") ||
    endpointName.includes("\\") ||
    endpointName.includes("\0") ||
    endpointName === "." ||
    endpointName === ".."
  ) {
    throw new TypeError("Review Run submission endpoint name is invalid");
  }
  const closedName = `${endpointName}.closed`;
  const lockName = `${endpointName}.lock`;
  const requestPath = join(checkoutPath, endpointName);
  const closedPath = join(checkoutPath, closedName);
  const lockPath = join(checkoutPath, lockName);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-submit-"));
  const directoryStatus = lstatSync(directory);
  const directoryIdentity = {
    dev: directoryStatus.dev,
    ino: directoryStatus.ino,
    uid: directoryStatus.uid,
    gid: directoryStatus.gid,
  };
  /** @param {string} path @param {() => Error} unavailable */
  const readTrustedSubmissionFile = (path, unavailable) =>
    readSubmissionFile(path, unavailable, directoryIdentity);
  const responsePath = join(directory, "response");
  const acknowledgmentPath = join(directory, "response.ack");
  const responsePublicKey = publicKey
    .export({ format: "pem", type: "spki" })
    .toString();
  const responseDeadlineAt = Date.now() + REVIEW_RUN_DEADLINE_MILLISECONDS;
  const commandPath = join(directory, "quality-bar-submit");
  const runtimePath = join(directory, "quality-bar-submit-runtime.js");
  const installation = {
    commandIdentity: /** @type {{dev: number, ino: number} | null} */ (null),
    commandPath,
    runtimeIdentity: /** @type {{dev: number, ino: number} | null} */ (null),
    runtimePath,
  };
  /** @type {{requestIdentity: {dev: number, ino: number} | null, lockIdentity: {dev: number, ino: number} | null, responseIdentity: {dev: number, ino: number} | null, acknowledgmentIdentity: {dev: number, ino: number} | null, closedIdentity: {dev: number, ino: number} | null}} */
  const identities = {
    acknowledgmentIdentity: null,
    closedIdentity: null,
    lockIdentity: null,
    requestIdentity: null,
    responseIdentity: null,
  };
  try {
    requireEndpointAvailable(
      requestPath,
      isMissingPath,
      submissionChannelUnavailable,
    );
    requireEndpointAvailable(
      closedPath,
      isMissingPath,
      submissionChannelUnavailable,
    );
    requireEndpointAvailable(
      lockPath,
      isMissingPath,
      submissionChannelUnavailable,
    );
    const token = installSubmissionCommand(installation, {
      directory,
      responseDeadlineAt,
      responsePath,
      responsePublicKey,
      submissionMode,
      writeCommand,
      publishFile: publishSubmissionFile,
    });
    const state = {
      accepted: false,
      committed: false,
      lastValidationFailure:
        /** @type {import("./review-run-result.js").ReviewRunExecutionError | null} */ (
          null
        ),
      pendingResponse: /** @type {any} */ (null),
      processing: false,
      stopped: false,
    };
    /** @type {Error | null} */
    let unexpectedFailure = null;
    /** @type {Error | null} */
    let stopFailure = null;
    /** @type {(result: "accepted" | "failed") => void} */
    let resolveResult = () => {};
    const result = new Promise((resolve) => {
      resolveResult = resolve;
    });
    /** @type {Promise<"accepted" | "failed">} */
    let pendingSettlement = Promise.resolve("failed");
    /** @type {(result: "accepted" | "failed") => void} */
    let resolvePendingSettlement = () => {};
    /** @type {ReturnType<typeof setInterval> | null} */
    let pollTimer = null;

    function stopAccepting() {
      if (state.stopped) {
        return;
      }
      const temporaryPath = join(
        checkoutPath,
        `${closedName}.tmp-${randomUUID()}`,
      );
      try {
        try {
          identities.requestIdentity = captureExistingIdentity(
            requestPath,
            identities.requestIdentity,
          );
          identities.lockIdentity = captureExistingIdentity(
            lockPath,
            identities.lockIdentity,
          );
          identities.responseIdentity = captureExistingIdentity(
            responsePath,
            identities.responseIdentity,
          );
          identities.acknowledgmentIdentity = captureExistingIdentity(
            acknowledgmentPath,
            identities.acknowledgmentIdentity,
          );
        } catch (error) {
          stopFailure =
            error instanceof Error
              ? error
              : new TypeError("Review Run submission channel failed");
        }
        try {
          writeFileSync(temporaryPath, "closed\n", {
            flag: "wx",
            mode: 0o600,
          });
          identities.closedIdentity = publishSubmissionFile(
            temporaryPath,
            closedPath,
          );
        } catch (error) {
          rmSync(temporaryPath, { force: true });
          throw error;
        }
      } catch (error) {
        stopFailure ??=
          error instanceof Error
            ? error
            : new TypeError("Review Run submission channel failed");
      }
      unexpectedFailure ??= stopFailure;
      state.stopped = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    /**
     * @param {Record<string, unknown>} response
     * @param {string} requestId
     */
    function writeResponse(response, requestId) {
      pendingSettlement = new Promise((resolve) => {
        resolvePendingSettlement = resolve;
      });
      identities.responseIdentity = publishSignedResponse(
        directory,
        responsePath,
        privateKey,
        response,
        requestId,
        randomUUID,
      );
    }

    /** @param {unknown} error */
    function failUnexpectedly(error) {
      unexpectedFailure =
        error instanceof Error
          ? error
          : new TypeError("Review Run submission failed");
      stopAccepting();
      resolvePendingSettlement("failed");
      resolveResult("failed");
    }

    function processPendingResponse() {
      const result = /** @type {any} */ (
        readPendingResponse({
          acknowledgmentPath,
          acknowledgmentIdentity: identities.acknowledgmentIdentity,
          setAcknowledgmentIdentity: (identity) => {
            identities.acknowledgmentIdentity = identity;
          },
          failUnexpectedly,
          isMissingPath,
          isPendingClientAlive: (submission) =>
            isProcessAlive(submission.client_pid) &&
            processStartIdentity(submission.client_pid) ===
              submission.client_start_identity,
          isSubmissionLeaseAlive,
          isSubmissionLeaseExpired,
          lockPath,
          parseSubmissionLock,
          pendingResponse: state.pendingResponse,
          readSubmissionFile: readTrustedSubmissionFile,
          removeOwnedFile,
          requestChannelUnavailable: submissionChannelUnavailable,
          resolveResult,
          responseIdentity: identities.responseIdentity,
          responsePath,
          setLastValidationFailure: (failure) => {
            state.lastValidationFailure = failure;
          },
          settlePendingResponse: (settled) => {
            resolvePendingSettlement(settled);
          },
          stopAccepting,
        })
      );
      if ("pendingResponse" in result) {
        state.pendingResponse = result.pendingResponse;
        identities.responseIdentity = result.responseIdentity;
        identities.acknowledgmentIdentity = result.acknowledgmentIdentity;
        state.accepted ||= result.accepted;
      }
      return result.handled;
    }

    const processSubmission = createSubmissionProcessor({
      claim,
      failUnexpectedly,
      identities,
      isMissingPath,
      isProcessAlive,
      isSubmissionLeaseAlive,
      isSubmissionLeaseExpired,
      lockPath,
      parseSubmissionLock,
      processGroupIdentity,
      processStartIdentity,
      processPendingResponse,
      readSubmissionFile: readTrustedSubmissionFile,
      removeOwnedFile,
      requestPath,
      resultService,
      resolveResult,
      state,
      submissionChannelUnavailable,
      token,
      trustedProcessGroup: () => processGroupBinding.current(),
      writeResponse,
    });

    pollTimer = setInterval(processSubmission, 10);
    pollTimer.unref?.();
    const processGroupBinding = createTrustedProcessGroupBinding({
      isProcessAlive,
      onBound: processSubmission,
      processStartIdentity,
    });
    processSubmission();
    const paths = {
      acknowledgmentPath,
      closedPath,
      lockPath,
      requestPath,
      responsePath,
    };
    return {
      accepted: () => state.accepted,
      bindProcessGroup: processGroupBinding.bind,
      hasCommittedSubmission: () => state.committed,
      commandDirectory: directory,
      environment: {
        QUALITY_BAR_SUBMIT_FILE: endpointName,
        QUALITY_BAR_SUBMIT_TOKEN: token,
      },
      failure: () => unexpectedFailure,
      lastValidationFailure: () => state.lastValidationFailure,
      hasPendingSubmission: () => state.pendingResponse !== null,
      hasPendingAcceptedSubmission: () =>
        state.pendingResponse?.accepted === true,
      waitForResult: () => result,
      waitForPendingSubmission: () => pendingSettlement,
      stop: async () => {
        stopAccepting();
      },
      async close() {
        stopAccepting();
        /** @type {unknown} */
        let closeFailure = stopFailure;
        const drained = await drainSubmissionArtifacts(
          paths,
          identities,
          closeFailure,
          removeOwnedFile,
        );
        closeFailure = drained.failure;
        if (!drained.drained) {
          closeFailure = mergeCleanupFailure(
            closeFailure,
            new Error("Review Run submission channel did not drain"),
          );
        } else {
          closeFailure = cleanupSubmissionFiles(
            paths,
            identities,
            closeFailure,
            removeOwnedFile,
          );
        }
        closeFailure = cleanupOwnedFile(
          commandPath,
          installation.commandIdentity,
          closeFailure,
          removeOwnedFile,
        );
        closeFailure = cleanupOwnedFile(
          runtimePath,
          installation.runtimeIdentity,
          closeFailure,
          removeOwnedFile,
        );
        closeFailure = cleanupOwnedDirectory(
          directory,
          directoryIdentity,
          closeFailure,
          removeDirectory,
        );
        if (closeFailure) {
          throw closeFailure;
        }
      },
    };
  } catch (setupFailure) {
    cleanupOwnedFile(
      commandPath,
      installation.commandIdentity,
      setupFailure,
      removeOwnedFile,
    );
    cleanupOwnedFile(
      runtimePath,
      installation.runtimeIdentity,
      setupFailure,
      removeOwnedFile,
    );
    const setupCleanupFailure = cleanupOwnedDirectory(
      directory,
      directoryIdentity,
      null,
      removeDirectory,
    );
    if (setupCleanupFailure) {
      preserveCleanupFailure(setupFailure, setupCleanupFailure);
    }
    throw setupFailure;
  }
}
