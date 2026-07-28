import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  canonicalExplicitEvaluationRequest,
  EvaluationError,
  failEvaluation,
} from "./evaluation-validation.js";
import { RepositoryError } from "./repository-validation.js";

const GIT_CREDENTIAL_HELPER =
  'credential.helper=!f() { IFS= read -r username <&3; IFS= read -r password <&3; printf \'username=%s\\npassword=%s\\n\' "$username" "$password"; }; f';

function isolatedGitEnvironment() {
  return {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
}

/** @param {{token: string, username: string} | undefined} credential */
function gitCredentialIsValid(credential) {
  return (
    !credential ||
    Boolean(
      credential.username &&
      credential.token &&
      !/[\0\r\n]/.test(credential.username) &&
      !/[\0\r\n]/.test(credential.token),
    )
  );
}

/**
 * @param {{token: string, username: string} | undefined} credential
 * @param {string | undefined} certificateAuthorityPath
 * @param {boolean} followRedirects
 */
function secureGitConfiguration(
  credential,
  certificateAuthorityPath,
  followRedirects,
) {
  const arguments_ = ["-c", "credential.helper=", "-c", "core.askPass="];
  if (credential) {
    arguments_.push("-c", GIT_CREDENTIAL_HELPER);
  }
  if (certificateAuthorityPath) {
    arguments_.push("-c", `http.sslCAInfo=${certificateAuthorityPath}`);
  }
  if (!followRedirects) {
    arguments_.push("-c", "http.followRedirects=false");
  }
  return arguments_;
}

/** @param {unknown} cause */
function unavailable(cause) {
  return new RepositoryError(
    "repository_git_verification_unavailable",
    "Repository Git read verification could not run",
    cause === undefined ? undefined : { cause },
  );
}

/**
 * @param {string} normalizedUrl
 * @param {{token: string, username: string} | undefined} credential
 * @param {{
 *   certificateAuthorityPath?: string,
 *   definitiveHttpStatuses?: number[],
 *   followRedirects?: boolean,
 *   removeDirectory?: (path: string) => void,
 *   spawnProcess?: typeof spawn
 * }} [options]
 */
export function verifyRepositoryRead(
  normalizedUrl,
  credential,
  {
    certificateAuthorityPath,
    definitiveHttpStatuses,
    followRedirects = true,
    removeDirectory = (path) => rmSync(path, { force: true, recursive: true }),
    spawnProcess = spawn,
  } = {},
) {
  /** @type {string} */
  let verificationDirectory;
  try {
    verificationDirectory = mkdtempSync(
      join(tmpdir(), "quality-bar-git-read-"),
    );
  } catch (cause) {
    return Promise.reject(unavailable(cause));
  }
  /**
   * @param {unknown} cause
   * @param {boolean} preserveCause
   */
  function cleanupUnavailable(cause, preserveCause) {
    let failure = preserveCause ? cause : undefined;
    try {
      removeDirectory(verificationDirectory);
    } catch (cleanupCause) {
      failure = cleanupCause;
    }
    return unavailable(failure);
  }
  const environment = isolatedGitEnvironment();
  if (!gitCredentialIsValid(credential)) {
    return Promise.reject(
      cleanupUnavailable(new TypeError("Git credential is invalid"), true),
    );
  }
  return new Promise((resolve, reject) => {
    const arguments_ = secureGitConfiguration(
      credential,
      certificateAuthorityPath,
      followRedirects,
    );
    arguments_.push("ls-remote", "--", normalizedUrl);
    /** @type {import("node:child_process").ChildProcess} */
    let child;
    let completed = false;
    try {
      child = spawnProcess("git", arguments_, {
        cwd: verificationDirectory,
        env: environment,
        stdio: credential
          ? ["ignore", "ignore", "pipe", "pipe"]
          : ["ignore", "ignore", "pipe"],
      });
    } catch (cause) {
      reject(cleanupUnavailable(cause, false));
      return;
    }
    /** @param {RepositoryError | null} error */
    function complete(error) {
      if (completed) {
        return;
      }
      completed = true;
      try {
        removeDirectory(verificationDirectory);
      } catch (cause) {
        error = unavailable(cause);
      }
      if (error) {
        reject(error);
      } else {
        resolve(undefined);
      }
    }
    let definitiveFailure = definitiveHttpStatuses === undefined;
    let stderrTail = "";
    const stderr = child.stderr;
    if (!stderr) {
      child.kill();
      complete(unavailable(new Error("Git stderr pipe is unavailable")));
      return;
    }
    stderr.on("data", (chunk) => {
      const message = `${stderrTail}${String(chunk)}`;
      stderrTail = message.slice(-256);
      const status = /returned error: (\d{3})\b/.exec(message)?.[1];
      if (
        (status &&
          definitiveHttpStatuses?.includes(Number.parseInt(status, 10))) ||
        (definitiveHttpStatuses?.includes(401) &&
          /Authentication failed/i.test(message)) ||
        (definitiveHttpStatuses?.includes(404) &&
          /Repository not found/i.test(message))
      ) {
        definitiveFailure = true;
      }
    });
    if (credential) {
      const credentialPipe = child.stdio[3];
      if (!credentialPipe || !("end" in credentialPipe)) {
        child.kill();
        complete(unavailable(new Error("Git credential pipe is unavailable")));
        return;
      }
      // Git's exit status owns the verification result. A rejected pipe write
      // only means Git exited before requesting credentials.
      credentialPipe.on("error", () => {});
      credentialPipe.end(`${credential.username}\n${credential.token}\n`);
    }
    child.once("error", (cause) => {
      complete(unavailable(cause));
    });
    child.once("close", (code, signal) => {
      if (code === 0 && signal === null) {
        complete(null);
        return;
      }
      complete(
        definitiveFailure
          ? new RepositoryError(
              "repository_git_read_failed",
              "Repository Git read verification failed",
            )
          : unavailable(undefined),
      );
    });
  });
}

/**
 * @param {string} normalizedUrl
 * @param {{
 *   certificateAuthorityPath?: string,
 *   removeDirectory?: (path: string) => void
 * }} [options]
 */
export function verifyPublicRepositoryRead(normalizedUrl, options) {
  return verifyRepositoryRead(normalizedUrl, undefined, options);
}

/**
 * @param {string} normalizedUrl
 * @param {{token: string, username: string} | undefined} credential
 * @param {unknown} request
 * @param {{
 *   certificateAuthorityPath?: string,
 *   removeDirectory?: (path: string) => void,
 *   spawnProcess?: typeof spawn
 * }} [options]
 */
export async function resolvePushedCommitSelectors(
  normalizedUrl,
  credential,
  request,
  {
    certificateAuthorityPath,
    removeDirectory = (path) => rmSync(path, { force: true, recursive: true }),
    spawnProcess = spawn,
  } = {},
) {
  const selectors = canonicalExplicitEvaluationRequest(request);
  /** @type {string} */
  let objectDatabase;
  try {
    objectDatabase = mkdtempSync(join(tmpdir(), "quality-bar-evaluation-git-"));
  } catch (cause) {
    failEvaluation(
      "evaluation_git_acquisition_unavailable",
      "Evaluation Git acquisition could not start",
      cause,
    );
  }
  const environment = isolatedGitEnvironment();

  /**
   * @param {string[]} arguments_
   * @param {boolean} withCredential
   */
  function runGit(arguments_, withCredential) {
    return new Promise((resolve, reject) => {
      /** @type {import("node:child_process").ChildProcess} */
      let child;
      try {
        child = spawnProcess("git", arguments_, {
          cwd: objectDatabase,
          env: environment,
          stdio:
            withCredential && credential
              ? ["ignore", "pipe", "pipe", "pipe"]
              : ["ignore", "pipe", "pipe"],
        });
      } catch (cause) {
        reject(cause);
        return;
      }
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr = `${stderr}${String(chunk)}`.slice(-1024);
      });
      if (withCredential && credential) {
        const credentialPipe = child.stdio[3];
        if (!credentialPipe || !("end" in credentialPipe)) {
          child.kill();
          reject(new Error("Git credential pipe is unavailable"));
          return;
        }
        credentialPipe.on("error", () => {});
        credentialPipe.end(`${credential.username}\n${credential.token}\n`);
      }
      child.once("error", reject);
      child.once("close", (code, signal) => {
        if (code === 0 && signal === null) {
          resolve({ stderr, stdout });
          return;
        }
        reject(Object.assign(new Error("Git command failed"), { stderr }));
      });
    });
  }

  let acquired;
  let acquisitionFailure;
  try {
    if (!gitCredentialIsValid(credential)) {
      failEvaluation(
        "evaluation_git_acquisition_unavailable",
        "Evaluation Git acquisition could not run",
      );
    }
    await runGit(
      [
        ...secureGitConfiguration(credential, certificateAuthorityPath, false),
        "clone",
        "--mirror",
        "--quiet",
        "--",
        normalizedUrl,
        ".",
      ],
      true,
    );
    const objectFormat = /** @type {{stdout: string}} */ (
      await runGit(["rev-parse", "--show-object-format"], false)
    ).stdout.trim();
    const objectIdPattern =
      objectFormat === "sha1"
        ? /^[0-9a-f]{40}$/i
        : objectFormat === "sha256"
          ? /^[0-9a-f]{64}$/i
          : undefined;
    if (!objectIdPattern) {
      throw new TypeError("Repository object format is unsupported");
    }
    const resolved = [];
    for (const selector of [selectors.base, selectors.head]) {
      const revision =
        selector.type === "branch"
          ? `refs/heads/${selector.value}^{commit}`
          : `${selector.value}^{commit}`;
      try {
        resolved.push(
          /** @type {{stdout: string}} */ (
            await runGit(
              ["rev-parse", "--verify", "--end-of-options", revision],
              false,
            )
          ).stdout.trim(),
        );
      } catch (cause) {
        failEvaluation(
          "evaluation_selector_not_found",
          "An Evaluation selector does not identify a fetchable pushed commit",
          cause,
        );
      }
    }
    if (
      resolved.length !== 2 ||
      resolved.some((objectId) => !objectIdPattern.test(objectId))
    ) {
      throw new TypeError("Resolved Evaluation commits are invalid");
    }
    acquired = {
      base_commit: resolved[0].toLowerCase(),
      head_commit: resolved[1].toLowerCase(),
    };
  } catch (error) {
    acquisitionFailure = error;
  }
  try {
    removeDirectory(objectDatabase);
  } catch (cause) {
    failEvaluation(
      "evaluation_git_acquisition_unavailable",
      "Evaluation Git acquisition cleanup failed",
      cause,
    );
  }
  if (acquisitionFailure) {
    if (acquisitionFailure instanceof EvaluationError) {
      failEvaluation(
        acquisitionFailure.code,
        acquisitionFailure.message,
        acquisitionFailure,
      );
    }
    const stderr =
      acquisitionFailure instanceof Error &&
      "stderr" in acquisitionFailure &&
      typeof acquisitionFailure.stderr === "string"
        ? acquisitionFailure.stderr
        : "";
    if (
      /couldn't find remote ref|not our ref|unadvertised object/i.test(stderr)
    ) {
      failEvaluation(
        "evaluation_selector_not_found",
        "An Evaluation selector does not identify a fetchable pushed commit",
      );
    }
    if (/authentication failed|returned error: 401/i.test(stderr)) {
      failEvaluation(
        "repository_authentication_failed",
        "Repository authentication failed during Evaluation acquisition",
      );
    }
    if (/returned error: 403/i.test(stderr)) {
      failEvaluation(
        "repository_permission_denied",
        "Repository permission denied during Evaluation acquisition",
      );
    }
    failEvaluation(
      "evaluation_git_acquisition_failed",
      "Evaluation Git acquisition failed",
      acquisitionFailure,
    );
  }
  return /** @type {{base_commit: string, head_commit: string}} */ (acquired);
}
