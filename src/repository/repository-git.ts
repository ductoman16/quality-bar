import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  canonicalExplicitEvaluationRequest,
  EvaluationError,
  failEvaluation,
} from "../evaluation/evaluation-validation.ts";
import { fileChangesFromGitNameStatus, gitPathFields } from "../file-change.ts";
import { RepositoryError } from "./repository-validation.ts";
import {
  gitCredentialIsValid,
  runGitCommand,
  secureGitConfiguration,
} from "../secure-git-command.ts";
import { throwIoTerminationFailure } from "../io-operation-context.ts";
import { createFrozenFileContentReader } from "../frozen-file-content.ts";
import { createGitPathMatcher } from "../git-path-matcher.ts";
import { proveMergeBase } from "./repository-git-merge-base.ts";
import {
  failRepositoryGitReadLoss,
  resolveExactEvaluationSelector,
} from "../pull-request-acquisition-error.ts";

export type ResolvedPushedCommitSelectors = {
  base_commit: string;
  head_commit: string;
  file_changes?: ReturnType<typeof fileChangesFromGitNameStatus>;
  matches_path?: (pathspec: string, path: string) => boolean;
  read_content?: (
    fileChange: any,
    side: "before" | "after",
  ) => { state: "absent" | "binary" } | { state: "text"; value: string };
  release?: () => void;
};

function unavailable(cause: unknown) {
  return new RepositoryError(
    "repository_git_verification_unavailable",
    "Repository Git read verification could not run",
    cause === undefined ? undefined : { cause },
  );
}

export function verifyRepositoryRead(
  normalizedUrl: string,
  credential: { token: string; username: string } | undefined,
  {
    certificateAuthorityPath,
    definitiveHttpStatuses,
    followRedirects = true,
    removeDirectory = (path) => rmSync(path, { force: true, recursive: true }),
    spawnProcess = spawn,
  }: {
    certificateAuthorityPath?: string;
    definitiveHttpStatuses?: number[];
    followRedirects?: boolean;
    removeDirectory?: (path: string) => void;
    spawnProcess?: typeof spawn;
  } = {},
) {
  let verificationDirectory: string;
  try {
    verificationDirectory = mkdtempSync(
      join(tmpdir(), "quality-bar-git-read-"),
    );
  } catch (cause) {
    return Promise.reject(unavailable(cause));
  }
  function cleanupUnavailable(cause: unknown, preserveCause: boolean) {
    let failure = preserveCause ? cause : undefined;
    try {
      removeDirectory(verificationDirectory);
    } catch (cleanupCause) {
      failure = cleanupCause;
    }
    return unavailable(failure);
  }
  if (!gitCredentialIsValid(credential)) {
    return Promise.reject(
      cleanupUnavailable(new TypeError("Git credential is invalid"), true),
    );
  }
  return (async () => {
    const arguments_ = secureGitConfiguration(
      credential,
      certificateAuthorityPath,
      followRedirects,
    );
    arguments_.push("ls-remote", "--", normalizedUrl);
    let definitiveFailure = definitiveHttpStatuses === undefined;
    let stderrTail = "";
    let result;
    try {
      result = (await runGitCommand({
        arguments_,
        captureStdout: false,
        credential,
        cwd: verificationDirectory,
        onStderr(chunk) {
          const message = `${stderrTail}${chunk}`;
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
        },
        spawnProcess,
      })) as { code: number | null; signal: NodeJS.Signals | null };
    } catch (cause) {
      throwIoTerminationFailure(cause, () =>
        removeDirectory(verificationDirectory),
      );
      throw cleanupUnavailable(cause, false);
    }
    let error =
      result.code === 0 && result.signal === null
        ? null
        : definitiveFailure
          ? new RepositoryError(
              "repository_git_read_failed",
              "Repository Git read verification failed",
            )
          : unavailable(undefined);
    try {
      removeDirectory(verificationDirectory);
    } catch (cause) {
      error = unavailable(cause);
    }
    if (error) {
      throw error;
    }
  })();
}

export function verifyPublicRepositoryRead(
  normalizedUrl: string,
  options?: {
    certificateAuthorityPath?: string;
    removeDirectory?: (path: string) => void;
  },
) {
  return verifyRepositoryRead(normalizedUrl, undefined, options);
}

export async function resolvePushedCommitSelectors(
  normalizedUrl: string,
  credential: { token: string; username: string } | undefined,
  request: unknown,
  {
    certificateAuthorityPath,
    objectDatabaseRoot,
    removeDirectory = (path) => rmSync(path, { force: true, recursive: true }),
    spawnProcess = spawn,
    useMergeBase = false,
    pullRequestProvider = useMergeBase ? "github" : undefined,
  }: {
    certificateAuthorityPath?: string;
    objectDatabaseRoot: string;
    pullRequestProvider?: "forgejo" | "github";
    removeDirectory?: (path: string) => void;
    spawnProcess?: typeof spawn;
    useMergeBase?: boolean;
  },
) {
  const selectors = canonicalExplicitEvaluationRequest(request);
  if (
    typeof objectDatabaseRoot !== "string" ||
    objectDatabaseRoot.length === 0
  ) {
    failEvaluation(
      "evaluation_git_acquisition_unavailable",
      "Evaluation Git acquisition root is unavailable",
    );
  }
  let objectDatabase: string;
  try {
    objectDatabase = mkdtempSync(
      join(objectDatabaseRoot, "quality-bar-evaluation-git-"),
    );
  } catch (cause) {
    failEvaluation(
      "evaluation_git_acquisition_unavailable",
      "Evaluation Git acquisition could not start",
      cause,
    );
  }
  function runGit(arguments_: string[], withCredential: boolean) {
    return runGitCommand({
      arguments_,
      captureStdout: true,
      credential: withCredential ? credential : undefined,
      cwd: objectDatabase,
      spawnProcess,
    }).then((result) => {
      const command = result as {
        code: number | null;
        signal: NodeJS.Signals | null;
        stderr: string;
        stdout: string;
        stdoutBuffer: Buffer;
      };
      if (command.code === 0 && command.signal === null) {
        return command;
      }
      throw Object.assign(new Error("Git command failed"), {
        stderr: command.stderr,
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
    const objectFormat = (
      (await runGit(["rev-parse", "--show-object-format"], false)) as {
        stdout: string;
      }
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
    if (
      typeof useMergeBase !== "boolean" ||
      (pullRequestProvider !== undefined &&
        !["forgejo", "github"].includes(pullRequestProvider))
    ) {
      throw new TypeError("Evaluation merge-base mode is invalid");
    }
    const resolved = [];
    const selectorEntries = [selectors.base, selectors.head];
    for (const [selectorIndex, selector] of selectorEntries.entries()) {
      if (selector.type === "commit" && !objectIdPattern.test(selector.value)) {
        failEvaluation(
          "evaluation_selector_invalid",
          "Commit selector does not match the Repository object format",
        );
      }
      resolved.push(
        await resolveExactEvaluationSelector(
          runGit,
          pullRequestProvider,
          selectorIndex,
          selector as { type: "branch" | "commit"; value: string },
        ),
      );
    }
    if (
      resolved.length !== 2 ||
      resolved.some((objectId) => !objectIdPattern.test(objectId))
    ) {
      throw new TypeError("Resolved Evaluation commits are invalid");
    }
    let frozenBase = resolved[0];
    if (useMergeBase) {
      frozenBase = await proveMergeBase(runGit, resolved, objectIdPattern);
    }
    acquired = {
      base_commit: frozenBase.toLowerCase(),
      head_commit: resolved[1].toLowerCase(),
      file_changes: fileChangesFromGitNameStatus(
        (
          (await runGit(
            [
              "diff",
              "--find-renames",
              "--name-status",
              "-z",
              frozenBase,
              resolved[1],
            ],
            false,
          )) as { stdoutBuffer: Buffer }
        ).stdoutBuffer,
      ),
    };
  } catch (error) {
    acquisitionFailure = error;
  }
  if (acquisitionFailure) {
    throwIoTerminationFailure(acquisitionFailure, () =>
      removeDirectory(objectDatabase),
    );
    try {
      removeDirectory(objectDatabase);
    } catch (cause) {
      failEvaluation(
        "evaluation_git_acquisition_unavailable",
        "Evaluation Git acquisition cleanup failed",
        cause,
      );
    }
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
    failRepositoryGitReadLoss(stderr, acquisitionFailure);
    failEvaluation(
      "evaluation_git_acquisition_failed",
      "Evaluation Git acquisition failed",
      acquisitionFailure,
    );
  }
  const frozen = acquired as ResolvedPushedCommitSelectors & {
    file_changes: ReturnType<typeof fileChangesFromGitNameStatus>;
    matches_path: (pathspec: string, path: string) => boolean;
    read_content: (
      fileChange: any,
      side: "before" | "after",
    ) => { state: "absent" | "binary" } | { state: "text"; value: string };
    release: () => void;
  };
  const gitEnvironment = {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    LC_ALL: "C",
  };
  frozen.matches_path = createGitPathMatcher(
    [frozen.base_commit, frozen.head_commit],
    (commit, pathspec) => {
      try {
        return gitPathFields(
          execFileSync(
            "git",
            [
              "-C",
              objectDatabase,
              "ls-files",
              "-z",
              `--with-tree=${commit}`,
              "--",
              pathspec,
            ],
            {
              env: gitEnvironment,
              maxBuffer: Number.MAX_SAFE_INTEGER,
            },
          ),
        );
      } catch (cause) {
        throw Object.assign(new Error("Frozen Git path matching failed"), {
          cause,
          code: "applicability_git_match_failed",
        });
      }
    },
  );
  frozen.read_content = createFrozenFileContentReader({
    baseCommit: frozen.base_commit,
    fileChanges: frozen.file_changes,
    headCommit: frozen.head_commit,
    objectDatabase,
  });
  let released = false;
  frozen.release = () => {
    if (released) {
      throw new TypeError("Frozen Changeset is already released");
    }
    released = true;
    try {
      removeDirectory(objectDatabase);
    } catch (cause) {
      failEvaluation(
        "evaluation_git_acquisition_unavailable",
        "Evaluation Git acquisition cleanup failed",
        cause,
      );
    }
  };
  return frozen;
}
