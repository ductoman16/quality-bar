import { sign } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";

import { publishFile } from "./review-run-submission-files.js";

/**
 * @param {string} directory
 * @param {string} responsePath
 * @param {import("node:crypto").KeyObject} privateKey
 * @param {Record<string, unknown>} response
 * @param {string} requestId
 * @param {() => string} createId
 * @param {(temporaryPath: string, targetPath: string, requirements?: {uid?: number, gid?: number, mode?: number}) => {birthtimeMs: number, dev: number, ino: number}} [publish]
 * @returns {{birthtimeMs: number, dev: number, ino: number}}
 */
export function publishSignedResponse(
  directory,
  responsePath,
  privateKey,
  response,
  requestId,
  createId,
  publish = publishFile,
) {
  const temporaryPath = `${directory}/response.tmp-${createId()}`;
  const payload = { ...response, request_id: requestId };
  try {
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({
        payload,
        response_signature: sign(
          null,
          Buffer.from(JSON.stringify(payload)),
          privateKey,
        ).toString("base64"),
      })}\n`,
      { flag: "wx", mode: 0o600 },
    );
    return publish(temporaryPath, responsePath, {
      gid: process.getgid?.(),
      mode: 0o100600,
      uid: process.getuid?.(),
    });
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}
