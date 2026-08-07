import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import {
  gitCredentialIsValid,
  runGitCommand,
  secureGitConfiguration,
} from "./secure-git-command.js";
import { throwIoTerminationFailure } from "./io-operation-context.js";

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

const TRANSIENT_GIT_FAILURE_PATTERNS = Object.freeze([
  /could not resolve host/i,
  /temporary failure in name resolution/i,
  /network is unreachable/i,
  /(?:could not|failed to) connect to (?:server|[^:\s]+(?::\d+)?)/i,
  /connection (?:timed out|reset|refused|closed by peer)/i,
  /operation timed out/i,
  /returned error: (?:429|500|502|503|504)\b/i,
  /tls connection was non-properly terminated/i,
  /gnutls_recv error/i,
  /(?:recv|send) failure/i,
  /empty reply from server/i,
  /the remote end hung up unexpectedly/i,
  /early eof/i,
  /http\/2 stream .* not closed cleanly/i,
]);

/** @param {unknown} cause @param {string} [code] @param {string} [message] */
function checkoutFailed(
  cause,
  code = "review_run_checkout_failed_definitive",
  message = "Review Run checkout failed definitively",
) {
  return new ReviewRunCheckoutError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

/** @param {unknown} failure */
function classifyFilesystemFailure(failure) {
  const code =
    failure instanceof Error && "code" in failure
      ? String(failure.code)
      : undefined;
  if (code === "ENOSPC") {
    return checkoutFailed(
      failure,
      "storage_reserve_unavailable",
      "Storage reserve is unavailable during Review Run checkout",
    );
  }
  return checkoutFailed(
    failure,
    "filesystem_unavailable",
    "Review Run checkout filesystem is unavailable",
  );
}

/** @param {{stderr?: unknown}} failure @param {string[]} arguments_ */
function classifyGitFailure(failure, arguments_) {
  const stderr = typeof failure.stderr === "string" ? failure.stderr : "";
  if (
    failure instanceof Error &&
    "code" in failure &&
    ["EACCES", "ENOENT", "EPERM"].includes(String(failure.code))
  ) {
    return checkoutFailed(
      failure,
      "review_run_checkout_capability_unavailable",
      "Git checkout capability is unavailable",
    );
  }
  if (
    /could not read (?:username|password).*terminal prompts disabled/i.test(
      stderr,
    )
  ) {
    return checkoutFailed(
      failure,
      "repository_git_credentials_unavailable",
      "Repository Git credentials are unavailable during Review Run checkout",
    );
  }
  if (/authentication failed|returned error: 401/i.test(stderr)) {
    return checkoutFailed(
      failure,
      "repository_authentication_failed",
      "Repository authentication failed during Review Run checkout",
    );
  }
  if (/returned error: 403/i.test(stderr)) {
    return checkoutFailed(
      failure,
      "repository_permission_denied",
      "Repository permission denied during Review Run checkout",
    );
  }
  if (/repository not found|not found.*repository/i.test(stderr)) {
    return checkoutFailed(
      failure,
      "repository_not_found",
      "Repository was not found during Review Run checkout",
    );
  }
  if (
    /server certificate verification failed|ssl certificate problem|certificate verify failed/i.test(
      stderr,
    )
  ) {
    return checkoutFailed(
      failure,
      "repository_tls_configuration_invalid",
      "Repository TLS configuration is invalid during Review Run checkout",
    );
  }
  if (
    /transport .* not allowed|unsupported protocol|protocol .* not supported/i.test(
      stderr,
    )
  ) {
    return checkoutFailed(
      failure,
      "repository_checkout_configuration_invalid",
      "Repository checkout configuration is invalid",
    );
  }
  if (arguments_.includes("cat-file")) {
    return checkoutFailed(
      failure,
      "review_run_checkout_commit_unavailable",
      "Frozen Review Run commit is unavailable during checkout",
    );
  }
  if (TRANSIENT_GIT_FAILURE_PATTERNS.some((pattern) => pattern.test(stderr))) {
    return checkoutFailed(
      failure,
      "review_run_checkout_failed",
      "Temporary Review Run checkout failure",
    );
  }
  return checkoutFailed(failure);
}

/**
 * @param {string[]} arguments_
 * @param {string} cwd
 * @param {typeof spawn} spawnProcess
 * @param {{token: string, username: string} | undefined} credential
 * @param {AbortSignal | undefined} signal
 */
async function runGit(arguments_, cwd, spawnProcess, credential, signal) {
  let result;
  try {
    result =
      /** @type {{code: number | null, signal: NodeJS.Signals | null, stderr: string}} */ (
        await runGitCommand({
          arguments_,
          captureStdout: false,
          credential,
          cwd,
          signal,
          spawnProcess,
        })
      );
  } catch (failure) {
    if (signal?.aborted && failure === signal.reason) {
      throw failure;
    }
    if (
      signal?.aborted &&
      failure instanceof Error &&
      "code" in failure &&
      failure.code === "git_termination_failed"
    ) {
      throw checkoutFailed(
        failure,
        "review_run_checkout_termination_failed",
        "Review Run checkout could not terminate",
      );
    }
    throw classifyGitFailure(
      /** @type {Error & {stderr?: string}} */ (failure),
      arguments_,
    );
  }
  if (result.code !== 0 || result.signal !== null) {
    throw classifyGitFailure(result, arguments_);
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
 *   signal?: AbortSignal,
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
  signal,
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
    signal?.throwIfAborted();
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
      signal,
    );
    signal?.throwIfAborted();
    await runGit(
      ["-C", checkoutPath, "cat-file", "-e", `${baseCommit}^{commit}`],
      claimRoot,
      spawnProcess,
      undefined,
      signal,
    );
    signal?.throwIfAborted();
    await runGit(
      ["-C", checkoutPath, "cat-file", "-e", `${headCommit}^{commit}`],
      claimRoot,
      spawnProcess,
      undefined,
      signal,
    );
    signal?.throwIfAborted();
    await runGit(
      ["-C", checkoutPath, "checkout", "--quiet", "--detach", headCommit],
      claimRoot,
      spawnProcess,
      undefined,
      signal,
    );
    signal?.throwIfAborted();
    await runGit(
      ["-C", checkoutPath, "remote", "remove", "origin"],
      claimRoot,
      spawnProcess,
      undefined,
      signal,
    );
    signal?.throwIfAborted();
  } catch (cause) {
    throwIoTerminationFailure(cause, () =>
      rmSync(claimRoot, { force: true, recursive: true }),
    );
    try {
      rmSync(claimRoot, { force: true, recursive: true });
    } catch (cleanupCause) {
      throw checkoutFailed(cleanupCause);
    }
    if (signal?.aborted && cause === signal.reason) {
      throw cause;
    }
    throw cause instanceof ReviewRunCheckoutError
      ? cause
      : classifyFilesystemFailure(cause);
  }
  return {
    path: checkoutPath,
    remove() {
      try {
        rmSync(claimRoot, { force: true, recursive: true });
      } catch (cause) {
        throw classifyFilesystemFailure(cause);
      }
    },
  };
}
