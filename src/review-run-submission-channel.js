import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
} from "./review-run-submission-files.js";
import { removeOwnedFile } from "./review-run-submission-file-cleanup.js";
import { createSubmissionChannelSurface } from "./review-run-submission-channel-surface.js";
import { publishTrustedProcess } from "./review-run-submission-trusted-process.js";
import {
  createTrustedProcessGroupBinding,
  isProcessDescendant,
  processGroupIdentity,
} from "./review-run-submission-process-group.js";

import {
  captureDirectoryIdentity,
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
 *   isProcessDescendant?: typeof isProcessDescendant,
 *   processGroupIdentity?: typeof processGroupIdentity,
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
    isProcessDescendant: inspectProcessDescendant = isProcessDescendant,
    processGroupIdentity: inspectProcessGroup = processGroupIdentity,
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
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "quality-bar-submit-")),
  );
  const directoryIdentity = captureDirectoryIdentity(directory);
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
    commandIdentity:
      /** @type {{birthtimeMs: number, dev: number, ino: number} | null} */ (
        null
      ),
    commandPath,
    runtimeIdentity:
      /** @type {{birthtimeMs: number, dev: number, ino: number} | null} */ (
        null
      ),
    runtimePath,
    tokenIdentity:
      /** @type {{birthtimeMs: number, dev: number, ino: number} | null} */ (
        null
      ),
    tokenPath: join(directory, "quality-bar-submit-token"),
    trustedProcessIdentity:
      /** @type {{birthtimeMs: number, dev: number, ino: number} | null} */ (
        null
      ),
    trustedProcessPath: join(directory, "quality-bar-submit-process"),
  };
  /** @type {{requestIdentity: {birthtimeMs: number, dev: number, ino: number} | null, lockIdentity: {birthtimeMs: number, dev: number, ino: number} | null, responseIdentity: {birthtimeMs: number, dev: number, ino: number} | null, acknowledgmentIdentity: {birthtimeMs: number, dev: number, ino: number} | null, closedIdentity: {birthtimeMs: number, dev: number, ino: number} | null}} */
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
    requireEndpointAvailable(
      installation.trustedProcessPath,
      isMissingPath,
      submissionChannelUnavailable,
    );
    const token = installSubmissionCommand(installation, {
      directory,
      responseDeadlineAt,
      responsePath,
      responsePublicKey,
      submissionFileName: endpointName,
      submissionMode,
      trustedProcessFile: installation.trustedProcessPath,
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
              submission.verified_client_start_identity,
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
      isProcessDescendant: inspectProcessDescendant,
      isSubmissionLeaseAlive,
      isSubmissionLeaseExpired,
      lockPath,
      parseSubmissionLock,
      processGroupIdentity: inspectProcessGroup,
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
      onBound: (binding) => {
        installation.trustedProcessIdentity = publishTrustedProcess({
          binding,
          directory,
          path: installation.trustedProcessPath,
          publishFile: publishSubmissionFile,
        });
        processSubmission();
      },
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
    return createSubmissionChannelSurface({
      bindProcessGroup: processGroupBinding.bind,
      commandPath,
      directory,
      directoryIdentity,
      endpointName,
      identities,
      installation,
      pendingSettlement: () => pendingSettlement,
      paths,
      removeDirectory,
      removeOwnedFile,
      result,
      runtimePath,
      state,
      stopAccepting,
      stopFailure: () => stopFailure,
      token,
      unexpectedFailure: () => unexpectedFailure,
    });
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
    cleanupOwnedFile(
      installation.tokenPath,
      installation.tokenIdentity,
      setupFailure,
      removeOwnedFile,
    );
    cleanupOwnedFile(
      installation.trustedProcessPath,
      installation.trustedProcessIdentity,
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
