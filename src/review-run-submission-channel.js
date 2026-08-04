import { randomBytes, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
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

function submissionChannelUnavailable() {
  return new ReviewRunExecutionError(
    "submission_channel_unavailable",
    "Review Run submission channel is unavailable",
  );
}

/** @param {unknown} error */
function isMissingPath(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** @param {string} path */
function requireEndpointAvailable(path) {
  try {
    lstatSync(path);
  } catch (error) {
    if (isMissingPath(error)) {
      return;
    }
    throw error;
  }
  throw submissionChannelUnavailable();
}

/** @param {string} path */
function readSocketIdentity(path) {
  const status = lstatSync(path);
  if (!status.isSocket()) {
    throw submissionChannelUnavailable();
  }
  return { dev: status.dev, ino: status.ino };
}

/**
 * @param {{dev: number, ino: number}} actual
 * @param {{dev: number, ino: number}} expected
 */
function hasSocketIdentity(actual, expected) {
  return actual.dev === expected.dev && actual.ino === expected.ino;
}

/**
 * @param {{fencingToken: number, workerId: string, workId: string}} claim
 * @param {{prepare(claim: any, candidate: unknown): unknown}} resultService
 * @param {{
 *   checkoutPath: string,
 *   removeDirectory?: (path: string, options: {force: boolean, recursive: boolean}) => void,
 *   removeSocket?: (path: string) => void,
 *   writeCommand?: typeof writeFileSync
 * }} options
 */
export async function openReviewRunSubmissionChannel(
  claim,
  resultService,
  {
    checkoutPath,
    removeDirectory = rmSync,
    removeSocket = (path) => rmSync(path, { force: true }),
    writeCommand = writeFileSync,
  },
) {
  if (
    typeof checkoutPath !== "string" ||
    !isAbsolute(checkoutPath) ||
    checkoutPath.includes("\0")
  ) {
    throw new TypeError("Review Run checkout path is invalid");
  }
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-submit-"));
  const socketName = `.qbs-${randomBytes(8).toString("base64url")}.s`;
  const socketPath = join(checkoutPath, socketName);
  const socketAddressPath = join(directory, "checkout", socketName);
  /** @type {{dev: number, ino: number} | null} */
  let socketIdentity = null;
  /** @type {string | null} */
  let preservedReplacementPath = null;
  try {
    const commandPath = join(directory, "quality-bar-submit");
    writeCommand(
      commandPath,
      `#!/usr/bin/env node\n${readFileSync(submitPath, "utf8")}`,
      { mode: 0o700 },
    );
    requireEndpointAvailable(socketPath);
    symlinkSync(checkoutPath, join(directory, "checkout"), "dir");
    const token = randomUUID();
    let accepted = false;
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
          resultService.prepare(claim, envelope.candidate);
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
      server.listen(socketAddressPath, () => {
        try {
          socketIdentity = readSocketIdentity(socketPath);
          resolve(undefined);
        } catch (error) {
          server.close((closeError) => reject(closeError ?? error));
        }
      });
    });

    /** @returns {string | null} */
    function preserveReplacement() {
      if (!socketIdentity) {
        return null;
      }
      let currentIdentity;
      try {
        currentIdentity = readSocketIdentity(socketPath);
      } catch (error) {
        if (isMissingPath(error)) {
          return null;
        }
        if (error instanceof ReviewRunExecutionError) {
          const replacementPath = join(
            directory,
            `.qbs-replaced-${randomUUID()}`,
          );
          renameSync(socketPath, replacementPath);
          preservedReplacementPath = replacementPath;
          return replacementPath;
        }
        throw error;
      }
      if (hasSocketIdentity(currentIdentity, socketIdentity)) {
        return null;
      }
      const replacementPath = join(directory, `.qbs-replaced-${randomUUID()}`);
      renameSync(socketPath, replacementPath);
      preservedReplacementPath = replacementPath;
      return replacementPath;
    }

    function removeOwnedSocket() {
      if (!socketIdentity) {
        return;
      }
      let currentIdentity;
      try {
        currentIdentity = readSocketIdentity(socketPath);
      } catch (error) {
        if (isMissingPath(error) || error instanceof ReviewRunExecutionError) {
          return;
        }
        throw error;
      }
      if (hasSocketIdentity(currentIdentity, socketIdentity)) {
        removeSocket(socketPath);
      }
    }

    async function restoreReplacement() {
      if (!preservedReplacementPath) {
        return;
      }
      renameSync(preservedReplacementPath, socketPath);
      preservedReplacementPath = null;
    }

    /** @param {import("node:net").Socket} [respondingSocket] */
    function stopAccepting(respondingSocket) {
      for (const socket of sockets) {
        if (socket !== respondingSocket) {
          socket.destroy();
        }
      }
      serverClose ??= new Promise((resolve, reject) => {
        /** @type {unknown} */
        let closeFailure = null;
        try {
          preserveReplacement();
        } catch (error) {
          closeFailure = error;
        }
        server.close((error) => {
          if (error && !closeFailure) {
            closeFailure = error;
          }
          try {
            removeOwnedSocket();
          } catch (cleanupFailure) {
            if (!closeFailure) {
              closeFailure = cleanupFailure;
            } else {
              preserveCleanupFailure(closeFailure, cleanupFailure);
            }
          }
          restoreReplacement()
            .then(() => {
              if (closeFailure) {
                reject(closeFailure);
              } else {
                resolve(undefined);
              }
            })
            .catch((restoreFailure) => {
              if (closeFailure) {
                preserveCleanupFailure(closeFailure, restoreFailure);
                reject(closeFailure);
              } else {
                reject(restoreFailure);
              }
            });
        });
      });
      return serverClose;
    }
    return {
      accepted: () => accepted,
      commandDirectory: directory,
      environment: {
        QUALITY_BAR_SUBMIT_SOCKET: socketName,
        QUALITY_BAR_SUBMIT_TOKEN: token,
      },
      failure: () => unexpectedFailure,
      lastValidationFailure: () => lastValidationFailure,
      waitForResult: () => result,
      async close() {
        let closeFailure;
        try {
          await stopAccepting();
        } catch (error) {
          closeFailure = error;
        }
        if (preservedReplacementPath) {
          closeFailure ??= submissionChannelUnavailable();
        }
        try {
          if (!preservedReplacementPath) {
            removeDirectory(directory, { force: true, recursive: true });
          }
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
