import { readSync } from "node:fs";

export class SubmissionTooLargeError extends Error {}

/**
 * @param {number} descriptor
 * @param {number} maxBytes
 */
export function readBoundedText(descriptor, maxBytes) {
  const chunks = [];
  let length = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(64 * 1024);
    const bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
    if (bytesRead === 0) {
      return Buffer.concat(chunks, length).toString("utf8");
    }
    length += bytesRead;
    if (length > maxBytes) {
      throw new SubmissionTooLargeError();
    }
    chunks.push(chunk.subarray(0, bytesRead));
  }
}
