import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ReviewRunExecutionError } from "./review-run-result.js";

const submitPath = fileURLToPath(
  new URL("./quality-bar-submit.js", import.meta.url),
);

/**
 * @param {unknown} failure
 * @param {unknown} cleanupFailure
 */
function preserveCleanupFailure(failure, cleanupFailure) {
  if (failure instanceof Error) {
    Object.defineProperty(failure, "submissionCleanupFailure", {
      configurable: true,
      enumerable: false,
      value: cleanupFailure,
    });
  }
}

/**
 * @param {{fencingToken: number, workerId: string, workId: string}} claim
 * @param {{prepare(claim: any, candidate: unknown): unknown}} resultService
 * @param {{
 *   removeDirectory?: (path: string, options: {force: boolean, recursive: boolean}) => void,
 *   writeCommand?: typeof writeFileSync
 * }} [options]
 */
export async function openReviewRunSubmissionChannel(
  claim,
  resultService,
  { removeDirectory = rmSync, writeCommand = writeFileSync } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-submit-"));
  try {
    const commandPath = join(directory, "quality-bar-submit");
    writeCommand(
      commandPath,
      `#!/usr/bin/env node\n${readFileSync(submitPath, "utf8")}`,
      { mode: 0o700 },
    );
    const socketPath = join(directory, "submit.sock");
    const token = randomUUID();
    let accepted = false;
    /** @type {unknown} */
    let preparedSubmission;
    /** @type {ReviewRunExecutionError | null} */
    let lastValidationFailure = null;
    /** @type {Error | null} */
    let unexpectedFailure = null;
    /** @type {Promise<void> | null} */
    let serverClose = null;
    /** @type {(result: "accepted" | "failed") => void} */
    let resolveResult;
    const result = new Promise((resolve) => {
      resolveResult = resolve;
    });
    const sockets = new Set();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
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
            throw new ReviewRunExecutionError(
              "submission_channel_unavailable",
              "Review Run submission channel is unavailable",
            );
          }
          preparedSubmission = resultService.prepare(claim, envelope.candidate);
          accepted = true;
          socket.end('{"ok":true}\n');
          stopAccepting(socket).catch((error) => {
            if (!unexpectedFailure) {
              unexpectedFailure =
                error instanceof Error
                  ? error
                  : new TypeError("Review Run submission channel failed");
            }
          });
          resolveResult("accepted");
        } catch (error) {
          if (!(error instanceof ReviewRunExecutionError)) {
            unexpectedFailure =
              error instanceof Error
                ? error
                : new TypeError("Review Run submission failed");
            socket.destroy();
            stopAccepting().catch(() => {});
            resolveResult("failed");
            return;
          }
          lastValidationFailure = error;
          socket.end(
            `${JSON.stringify({
              error: { code: error.code, message: error.message },
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
    /** @param {import("node:net").Socket} [respondingSocket] */
    function stopAccepting(respondingSocket) {
      for (const socket of sockets) {
        if (socket !== respondingSocket) {
          socket.destroy();
        }
      }
      serverClose ??= new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve(undefined)));
      });
      return serverClose;
    }
    return {
      accepted: () => accepted,
      commandDirectory: directory,
      environment: {
        QUALITY_BAR_SUBMIT_SOCKET: socketPath,
        QUALITY_BAR_SUBMIT_TOKEN: token,
      },
      failure: () => unexpectedFailure,
      lastValidationFailure: () => lastValidationFailure,
      submission: () => preparedSubmission,
      waitForResult: () => result,
      async close() {
        let closeFailure;
        try {
          await stopAccepting();
        } catch (error) {
          closeFailure = error;
        }
        try {
          removeDirectory(directory, { force: true, recursive: true });
        } catch (cleanupFailure) {
          if (!closeFailure) {
            throw cleanupFailure;
          }
          preserveCleanupFailure(closeFailure, cleanupFailure);
        }
        if (closeFailure) {
          throw closeFailure;
        }
      },
    };
  } catch (setupFailure) {
    try {
      removeDirectory(directory, { force: true, recursive: true });
    } catch (cleanupFailure) {
      preserveCleanupFailure(setupFailure, cleanupFailure);
    }
    throw setupFailure;
  }
}
