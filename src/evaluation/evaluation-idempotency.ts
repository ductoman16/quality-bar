import { failEvaluation } from "./evaluation-validation.ts";

export function readIdempotentReplay(
  access: {
    get(
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ): Record<string, import("node:sqlite").SQLInputValue> | undefined;
  },
  channel: string,
  route: string,
  key: string,
  requestHash: string,
) {
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
    resource: JSON.parse(replay.response_body as string),
    status: replay.response_status,
  };
}
