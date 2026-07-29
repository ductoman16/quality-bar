import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";

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
 */
function runGit(arguments_, cwd, spawnProcess) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess("git", arguments_, {
        cwd,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }
    let stderr = "";
    child.stderr?.setEncoding("utf8").on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-2_048);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) {
        resolve(undefined);
        return;
      }
      reject(
        Object.assign(new Error("Git checkout command failed"), {
          code,
          signal,
          stderr,
        }),
      );
    });
  });
}

/**
 * @param {{
 *   baseCommit: string,
 *   checkoutRoot: string,
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
    );
    await runGit(
      ["-C", checkoutPath, "cat-file", "-e", `${baseCommit}^{commit}`],
      claimRoot,
      spawnProcess,
    );
    await runGit(
      ["-C", checkoutPath, "cat-file", "-e", `${headCommit}^{commit}`],
      claimRoot,
      spawnProcess,
    );
    await runGit(
      ["-C", checkoutPath, "checkout", "--quiet", "--detach", headCommit],
      claimRoot,
      spawnProcess,
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
