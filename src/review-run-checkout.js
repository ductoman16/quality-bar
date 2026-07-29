import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import {
  gitCredentialIsValid,
  runGitCommand,
  secureGitConfiguration,
} from "./secure-git-command.js";

export class ReviewRunCheckoutError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "ReviewRunCheckoutError";
    this.code = code;
  }
}

/** @param {unknown} cause */
function checkoutFailed(cause) {
  return new ReviewRunCheckoutError(
    "review_run_checkout_failed",
    "Review Run checkout preparation failed",
    cause === undefined ? undefined : { cause },
  );
}

/**
 * @param {string[]} arguments_
 * @param {string} cwd
 * @param {typeof spawn} spawnProcess
 * @param {{token: string, username: string} | undefined} credential
 */
async function runGit(arguments_, cwd, spawnProcess, credential) {
  const result =
    /** @type {{code: number | null, signal: NodeJS.Signals | null, stderr: string}} */ (
      await runGitCommand({
        arguments_,
        captureStdout: false,
        credential,
        cwd,
        spawnProcess,
      })
    );
  if (result.code !== 0 || result.signal !== null) {
    throw Object.assign(new Error("Git checkout command failed"), result);
  }
}

/**
 * @param {{
 *   baseCommit: string,
 *   checkoutRoot: string,
 *   credential?: {token: string, username: string},
 *   fencingToken: number,
 *   headCommit: string,
 *   repositoryUrl: string,
 *   spawnProcess?: typeof spawn,
 *   workId: string
 * }} input
 */
export async function prepareReviewRunCheckout({
  baseCommit,
  checkoutRoot,
  credential,
  fencingToken,
  headCommit,
  repositoryUrl,
  spawnProcess = spawn,
  workId,
}) {
  if (
    !isAbsolute(checkoutRoot) ||
    !/^[A-Za-z0-9._-]+$/.test(workId) ||
    !Number.isSafeInteger(fencingToken) ||
    fencingToken <= 0 ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(baseCommit) ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(headCommit) ||
    baseCommit.length !== headCommit.length ||
    !gitCredentialIsValid(credential) ||
    typeof repositoryUrl !== "string" ||
    repositoryUrl.length === 0
  ) {
    throw new TypeError("Review Run checkout input is invalid");
  }
  const claimRoot = join(checkoutRoot, workId, String(fencingToken));
  const checkoutPath = join(claimRoot, "checkout");
  try {
    mkdirSync(join(checkoutRoot, workId), { recursive: true });
    mkdirSync(claimRoot, { recursive: false });
    await runGit(
      [
        ...secureGitConfiguration(credential, undefined, false),
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "protocol.file.allow=always",
        "clone",
        "--no-checkout",
        "--no-local",
        "--quiet",
        "--",
        repositoryUrl,
        checkoutPath,
      ],
      claimRoot,
      spawnProcess,
      credential,
    );
    await runGit(
      ["-C", checkoutPath, "cat-file", "-e", `${baseCommit}^{commit}`],
      claimRoot,
      spawnProcess,
      undefined,
    );
    await runGit(
      ["-C", checkoutPath, "cat-file", "-e", `${headCommit}^{commit}`],
      claimRoot,
      spawnProcess,
      undefined,
    );
    await runGit(
      ["-C", checkoutPath, "checkout", "--quiet", "--detach", headCommit],
      claimRoot,
      spawnProcess,
      undefined,
    );
    await runGit(
      ["-C", checkoutPath, "remote", "remove", "origin"],
      claimRoot,
      spawnProcess,
      undefined,
    );
  } catch (cause) {
    try {
      rmSync(claimRoot, { force: true, recursive: true });
    } catch (cleanupCause) {
      throw checkoutFailed(cleanupCause);
    }
    throw checkoutFailed(cause);
  }
  return {
    path: checkoutPath,
    remove() {
      try {
        rmSync(claimRoot, { force: true, recursive: true });
      } catch (cause) {
        throw checkoutFailed(cause);
      }
    },
  };
}
