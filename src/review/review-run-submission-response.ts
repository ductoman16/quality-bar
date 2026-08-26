import { sign } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";

import { publishFile } from "./review-run-submission-files.ts";

export function publishSignedResponse(
  directory: string,
  responsePath: string,
  privateKey: import("node:crypto").KeyObject,
  response: Record<string, unknown>,
  requestId: string,
  createId: () => string,
  publish: (
    temporaryPath: string,
    targetPath: string,
    requirements?: { uid?: number; gid?: number; mode?: number },
  ) => { birthtimeMs: number; dev: number; ino: number } = publishFile,
): { birthtimeMs: number; dev: number; ino: number } {
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
