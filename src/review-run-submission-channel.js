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
 * @param {{submit(claim: any, candidate: unknown): unknown}} resultService
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
    /** @type {Error | null} */
    let unexpectedFailure = null;
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
            throw new ReviewRunExecutionError(
              "submission_channel_unavailable",
              "Review Run submission channel is unavailable",
            );
          }
          resultService.submit(claim, envelope.candidate);
          accepted = true;
          socket.end('{"ok":true}\n');
        } catch (error) {
          if (!(error instanceof ReviewRunExecutionError)) {
            unexpectedFailure =
              error instanceof Error
                ? error
                : new TypeError("Review Run submission failed");
            socket.destroy();
            return;
          }
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
    return {
      accepted: () => accepted,
      commandDirectory: directory,
      environment: {
        QUALITY_BAR_SUBMIT_SOCKET: socketPath,
        QUALITY_BAR_SUBMIT_TOKEN: token,
      },
      failure: () => unexpectedFailure,
      async close() {
        let closeFailure;
        try {
          await new Promise((resolve, reject) => {
            server.close((error) =>
              error ? reject(error) : resolve(undefined),
            );
          });
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
