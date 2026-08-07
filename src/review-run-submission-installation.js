import { createHash, randomUUID } from "node:crypto";
import { chmodSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  publishFile as publishInstalledFile,
  requirePrivateFile,
} from "./review-run-submission-files.js";
import { removeOwnedFile } from "./review-run-submission-file-cleanup.js";

const submitPath = fileURLToPath(
  new URL("./quality-bar-submit.js", import.meta.url),
);
const submitRuntimePath = fileURLToPath(
  new URL("./quality-bar-submit-runtime.js", import.meta.url),
);

/**
 * @param {{commandPath: string, runtimePath: string, tokenPath: string, trustedProcessPath: string, commandIdentity: {birthtimeMs: number, dev: number, ino: number} | null, runtimeIdentity: {birthtimeMs: number, dev: number, ino: number} | null, tokenIdentity: {birthtimeMs: number, dev: number, ino: number} | null, trustedProcessIdentity: {birthtimeMs: number, dev: number, ino: number} | null}} installation
 * @param {{
 *   directory: string,
 *   responseDeadlineAt: number,
 *   responsePath: string,
 *   responsePublicKey: string,
 *   submissionFileName: string,
 *   trustedProcessFile: string,
 *   submissionMode: "review-file" | "generic",
 *   writeCommand?: typeof writeFileSync,
 *   publishFile?: typeof publishInstalledFile
 * }} options
 * @returns {string}
 */
export function installSubmissionCommand(
  installation,
  {
    directory,
    responseDeadlineAt,
    responsePath,
    responsePublicKey,
    submissionFileName,
    submissionMode,
    trustedProcessFile,
    writeCommand = writeFileSync,
    publishFile = publishInstalledFile,
  },
) {
  const token = randomUUID();
  const runtimeSource = readFileSync(submitRuntimePath, "utf8")
    .replace(
      '"__QUALITY_BAR_SUBMIT_RESPONSE_FILE__"',
      JSON.stringify(responsePath),
    )
    .replace(
      '"__QUALITY_BAR_SUBMIT_RESPONSE_PUBLIC_KEY__"',
      JSON.stringify(responsePublicKey),
    )
    .replace(
      '"__QUALITY_BAR_SUBMIT_FILE__"',
      JSON.stringify(submissionFileName),
    )
    .replace(
      '"__QUALITY_BAR_SUBMIT_TRUSTED_PROCESS_FILE__"',
      JSON.stringify(trustedProcessFile),
    )
    .replace('"__QUALITY_BAR_SUBMIT_DEADLINE__"', String(responseDeadlineAt))
    .replace('"__QUALITY_BAR_SUBMIT_MODE__"', JSON.stringify(submissionMode));
  const runtimeHash = createHash("sha256").update(runtimeSource).digest("hex");
  const commandSource = readFileSync(submitPath, "utf8").replace(
    '"__QUALITY_BAR_SUBMIT_RUNTIME_SHA256__"',
    JSON.stringify(runtimeHash),
  );
  const runtimeTemporaryPath = join(
    directory,
    `quality-bar-submit-runtime.tmp-${randomUUID()}`,
  );
  const tokenTemporaryPath = join(
    directory,
    `quality-bar-submit-token.tmp-${randomUUID()}`,
  );
  const commandTemporaryPath = join(
    directory,
    `quality-bar-submit.tmp-${randomUUID()}`,
  );
  /** @type {{birthtimeMs: number, dev: number, ino: number} | null} */
  let commandTemporaryIdentity = null;
  /** @type {{birthtimeMs: number, dev: number, ino: number} | null} */
  let runtimeTemporaryIdentity = null;
  /** @type {{birthtimeMs: number, dev: number, ino: number} | null} */
  let tokenTemporaryIdentity = null;
  try {
    writeCommand(
      commandTemporaryPath,
      `#!/usr/bin/env node\n${commandSource}`,
      {
        flag: "wx",
        mode: 0o700,
      },
    );
    chmodSync(commandTemporaryPath, 0o700);
    const commandStatus = requirePrivateFile(commandTemporaryPath, 0o700);
    commandTemporaryIdentity = {
      birthtimeMs: commandStatus.birthtimeMs,
      dev: commandStatus.dev,
      ino: commandStatus.ino,
    };
    writeFileSync(runtimeTemporaryPath, runtimeSource, {
      flag: "wx",
      mode: 0o600,
    });
    chmodSync(runtimeTemporaryPath, 0o600);
    const runtimeStatus = requirePrivateFile(
      runtimeTemporaryPath,
      0o600,
      commandStatus,
    );
    runtimeTemporaryIdentity = {
      birthtimeMs: runtimeStatus.birthtimeMs,
      dev: runtimeStatus.dev,
      ino: runtimeStatus.ino,
    };
    installation.runtimeIdentity = publishFile(
      runtimeTemporaryPath,
      installation.runtimePath,
    );
    const installedRuntimeStatus = lstatSync(installation.runtimePath);
    if (
      installedRuntimeStatus.dev !== installation.runtimeIdentity.dev ||
      installedRuntimeStatus.ino !== installation.runtimeIdentity.ino ||
      installedRuntimeStatus.birthtimeMs !==
        installation.runtimeIdentity.birthtimeMs
    ) {
      throw new TypeError("Review Run submission runtime identity changed");
    }
    requirePrivateFile(installation.runtimePath, 0o600, commandStatus);
    writeFileSync(tokenTemporaryPath, token, {
      flag: "wx",
      mode: 0o600,
    });
    chmodSync(tokenTemporaryPath, 0o600);
    const tokenStatus = requirePrivateFile(
      tokenTemporaryPath,
      0o600,
      commandStatus,
    );
    tokenTemporaryIdentity = {
      birthtimeMs: tokenStatus.birthtimeMs,
      dev: tokenStatus.dev,
      ino: tokenStatus.ino,
    };
    installation.tokenIdentity = publishFile(
      tokenTemporaryPath,
      installation.tokenPath,
    );
    const installedTokenStatus = lstatSync(installation.tokenPath);
    if (
      installedTokenStatus.dev !== installation.tokenIdentity.dev ||
      installedTokenStatus.ino !== installation.tokenIdentity.ino ||
      installedTokenStatus.birthtimeMs !==
        installation.tokenIdentity.birthtimeMs
    ) {
      throw new TypeError("Review Run submission token identity changed");
    }
    requirePrivateFile(installation.tokenPath, 0o600, commandStatus);
    installation.commandIdentity = publishFile(
      commandTemporaryPath,
      installation.commandPath,
    );
    const installedCommandStatus = lstatSync(installation.commandPath);
    if (
      installedCommandStatus.dev !== installation.commandIdentity.dev ||
      installedCommandStatus.ino !== installation.commandIdentity.ino ||
      installedCommandStatus.birthtimeMs !==
        installation.commandIdentity.birthtimeMs
    ) {
      throw new TypeError("Review Run submission command identity changed");
    }
    requirePrivateFile(installation.commandPath, 0o700, installedRuntimeStatus);
    return token;
  } catch (error) {
    let cleanupFailure = null;
    /** @type {Array<[string, {birthtimeMs: number, dev: number, ino: number} | null]>} */
    const temporaryFiles = [
      [commandTemporaryPath, commandTemporaryIdentity],
      [runtimeTemporaryPath, runtimeTemporaryIdentity],
      [tokenTemporaryPath, tokenTemporaryIdentity],
    ];
    for (const [path, identity] of temporaryFiles) {
      if (!identity) {
        continue;
      }
      try {
        removeOwnedFile(path, identity);
      } catch (failure) {
        cleanupFailure ??= failure;
      }
    }
    if (cleanupFailure && error instanceof Error) {
      Object.defineProperty(error, "submissionCleanupFailure", {
        configurable: true,
        enumerable: false,
        value: cleanupFailure,
      });
    }
    throw error;
  }
}
