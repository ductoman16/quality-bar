import { failEvaluation } from "./evaluation-validation.js";

/**
 * @param {{get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined}} access
 * @param {string} channel
 * @param {string} route
 * @param {string} key
 * @param {string} requestHash
 */
export function readIdempotentReplay(access, channel, route, key, requestHash) {
  const replay = access.get(
    `SELECT request_hash, response_status, response_body
     FROM evaluation_idempotency
     WHERE channel = ? AND route = ? AND idempotency_key = ?`,
    channel,
    route,
    key,
  );
  if (!replay) {
    return null;
  }
  if (replay.request_hash !== requestHash) {
    failEvaluation(
      "idempotency_conflict",
      "Idempotency key was already used with different input",
    );
  }
  return {
    resource: JSON.parse(/** @type {string} */ (replay.response_body)),
    status: replay.response_status,
  };
}
