import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
 *   removeDirectory?: (path: string) => void
 * }} [options]
 */
export function verifyRepositoryRead(
  normalizedUrl,
  credential,
  {
    certificateAuthorityPath,
    followRedirects = true,
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
  if (credential) {
    const askPassPath = join(verificationDirectory, "askpass");
    try {
      writeFileSync(
        askPassPath,
        [
          "#!/bin/sh",
          'case "$1" in',
          '  Username*) printf "%s\\n" "$QUALITY_BAR_GIT_USERNAME" ;;',
          '  Password*) printf "%s\\n" "$QUALITY_BAR_GIT_TOKEN" ;;',
          "  *) exit 1 ;;",
          "esac",
          "",
        ].join("\n"),
        { mode: 0o700 },
      );
    } catch (cause) {
      return Promise.reject(cleanupUnavailable(cause, true));
    }
    environment.GIT_ASKPASS = askPassPath;
    environment.GIT_ASKPASS_REQUIRE = "force";
    environment.QUALITY_BAR_GIT_TOKEN = credential.token;
    environment.QUALITY_BAR_GIT_USERNAME = credential.username;
  }
  return new Promise((resolve, reject) => {
    const arguments_ = ["-c", "credential.helper=", "-c", "core.askPass="];
    if (certificateAuthorityPath) {
      arguments_.push("-c", `http.sslCAInfo=${certificateAuthorityPath}`);
    }
    if (!followRedirects) {
      arguments_.push("-c", "http.followRedirects=false");
    }
    arguments_.push("ls-remote", "--", normalizedUrl);
    /** @type {import("node:child_process").ChildProcess} */
    let child;
    try {
      child = spawn("git", arguments_, {
        cwd: verificationDirectory,
        env: environment,
        stdio: "ignore",
      });
    } catch (cause) {
      reject(cleanupUnavailable(cause, false));
      return;
    }
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
        error = unavailable(cause);
      }
      if (error) {
        reject(error);
      } else {
        resolve(undefined);
      }
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
