import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RepositoryError } from "./repository-validation.js";

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
  /** @type {Record<string, string>} */
  const environment = {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  if (
    credential &&
    (!credential.username ||
      !credential.token ||
      /[\0\r\n]/.test(credential.username) ||
      /[\0\r\n]/.test(credential.token))
  ) {
    return Promise.reject(
      cleanupUnavailable(new TypeError("Git credential is invalid"), true),
    );
  }
  return new Promise((resolve, reject) => {
    const arguments_ = ["-c", "credential.helper=", "-c", "core.askPass="];
    if (credential) {
      arguments_.push(
        "-c",
        'credential.helper=!f() { IFS= read -r username <&3; IFS= read -r password <&3; printf \'username=%s\\npassword=%s\\n\' "$username" "$password"; }; f',
      );
    }
    if (certificateAuthorityPath) {
      arguments_.push("-c", `http.sslCAInfo=${certificateAuthorityPath}`);
    }
    if (!followRedirects) {
      arguments_.push("-c", "http.followRedirects=false");
    }
    arguments_.push("ls-remote", "--", normalizedUrl);
    /** @type {import("node:child_process").ChildProcess} */
    let child;
    let completed = false;
    try {
      child = spawnProcess("git", arguments_, {
        cwd: verificationDirectory,
        env: environment,
        stdio: credential ? ["ignore", "ignore", "ignore", "pipe"] : "ignore",
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
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) {
        complete(null);
        return;
      }
      complete(
        new RepositoryError(
          "repository_git_read_failed",
          "Repository Git read verification failed",
        ),
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
