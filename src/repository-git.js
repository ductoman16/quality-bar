import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RepositoryError } from "./repository-validation.js";

/**
 * @param {string} normalizedUrl
 * @param {{
 *   certificateAuthorityPath?: string,
 *   removeDirectory?: (path: string) => void
 * }} [options]
 */
export function verifyPublicRepositoryRead(
  normalizedUrl,
  {
    certificateAuthorityPath,
    removeDirectory = (path) => rmSync(path, { force: true, recursive: true }),
  } = {},
) {
  /** @type {string} */
  let verificationDirectory;
  try {
    verificationDirectory = mkdtempSync(
      join(tmpdir(), "quality-bar-git-read-"),
    );
  } catch (cause) {
    return Promise.reject(
      new RepositoryError(
        "repository_git_verification_unavailable",
        "Repository Git read verification could not run",
        { cause },
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const arguments_ = ["-c", "credential.helper=", "-c", "core.askPass="];
    if (certificateAuthorityPath) {
      arguments_.push("-c", `http.sslCAInfo=${certificateAuthorityPath}`);
    }
    arguments_.push("ls-remote", "--", normalizedUrl);
    const child = spawn("git", arguments_, {
      cwd: verificationDirectory,
      env: {
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
      stdio: "ignore",
    });
    let completed = false;
    /** @param {RepositoryError | null} error */
    function complete(error) {
      if (completed) {
        return;
      }
      completed = true;
      try {
        removeDirectory(verificationDirectory);
      } catch (cause) {
        error = new RepositoryError(
          "repository_git_verification_unavailable",
          "Repository Git read verification could not run",
          { cause },
        );
      }
      if (error) {
        reject(error);
      } else {
        resolve(undefined);
      }
    }
    child.once("error", (cause) => {
      complete(
        new RepositoryError(
          "repository_git_verification_unavailable",
          "Repository Git read verification could not run",
          { cause },
        ),
      );
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
