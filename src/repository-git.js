import { spawn } from "node:child_process";

import { RepositoryError } from "./repository-validation.js";

/**
 * @param {string} normalizedUrl
 * @param {{ environment?: Record<string, string> }} [options]
 */
export function verifyPublicRepositoryRead(
  normalizedUrl,
  { environment = {} } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      [
        "-c",
        "credential.helper=",
        "-c",
        "core.askPass=",
        "ls-remote",
        "--",
        normalizedUrl,
      ],
      {
        env: {
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          ...environment,
        },
        stdio: "ignore",
      },
    );
    child.once("error", (cause) => {
      reject(
        new RepositoryError(
          "repository_git_verification_unavailable",
          "Repository Git read verification could not run",
          { cause },
        ),
      );
    });
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) {
        resolve(undefined);
        return;
      }
      reject(
        new RepositoryError(
          "repository_git_read_failed",
          "Repository Git read verification failed",
        ),
      );
    });
  });
}
