import { randomUUID } from "node:crypto";

const CHANNELS = new Set([
  "browser_session",
  "host",
  "implementer_token",
  "onboarding_token",
]);
const OUTCOMES = new Set(["success", "failure", "forbidden"]);

export type AuthorityAttribution = {
  action: string;
  channel: string;
  errorCode?: string;
  occurredAt: number;
  outcome: string;
};

function assertAttribution(event: AuthorityAttribution) {
  if (
    !event ||
    !CHANNELS.has(event.channel) ||
    typeof event.action !== "string" ||
    !/^[a-z_]+$/.test(event.action) ||
    !OUTCOMES.has(event.outcome) ||
    !Number.isSafeInteger(event.occurredAt) ||
    event.occurredAt < 0 ||
    (event.errorCode !== undefined &&
      (typeof event.errorCode !== "string" ||
        !/^[a-z_]+$/.test(event.errorCode)))
  ) {
    throw new TypeError("authority attribution is invalid");
  }
}

export function insertAuthorityAttribution(
  store: {
    run: (
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ) => unknown;
  },
  event: AuthorityAttribution,
) {
  assertAttribution(event);
  store.run(
    `INSERT INTO authority_attributions
      (id, channel, action, outcome, error_code, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    event.channel,
    event.action,
    event.outcome,
    event.errorCode ?? null,
    event.occurredAt,
  );
}
